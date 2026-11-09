from __future__ import annotations

import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from PIL import Image

from backend import job_store, user_profile


class UserProfileTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        users_path = root / "login_users.json"
        users_path.write_text(json.dumps([
            {"id": "u1", "username": "小王", "role": "user", "password_hash": job_store.hash_password("old-pass"),
             "display_name": "王小明"},
            {"id": "u2", "username": "小李", "role": "user"},
        ], ensure_ascii=False), encoding="utf-8")
        self.patches = [
            patch.object(job_store, "_DB_PATH", root / "jobs.db"),
            patch.object(user_profile.settings, "root_dir", root),
            patch.object(user_profile.settings, "login_users_path", users_path),
        ]
        for p in self.patches:
            p.start()
        self.addCleanup(self._restore_users)
        user_profile.settings.reload_login_users()
        job_store.init_db()
        user_profile.init_user_profile_tables()
        self.user = job_store.get_or_create_user("小王", "old-pass")

    def _restore_users(self) -> None:
        for p in reversed(self.patches):
            p.stop()
        user_profile.settings.reload_login_users()
        self.tmp.cleanup()

    def test_preferences_default_validate_and_persist(self) -> None:
        self.assertEqual(user_profile.load_preferences("u1"), user_profile.PREFERENCE_DEFAULTS)
        saved = user_profile.save_preferences("u1", {"send_shortcut": "mod_enter", "default_ratio": "3:4"})
        self.assertEqual(saved["send_shortcut"], "mod_enter")
        self.assertEqual(saved["default_ratio"], "3:4")
        self.assertEqual(saved["default_model"], "gpt-image-2.6")
        self.assertEqual(user_profile.save_preferences("u1", {"default_resolution": "2K"})["send_shortcut"], "mod_enter")
        for bad in ({"send_shortcut": "space"}, {"theme": "dark"}, {}):
            with self.assertRaises(HTTPException):
                user_profile.save_preferences("u1", bad)
        self.assertEqual(user_profile.load_preferences("u2"), user_profile.PREFERENCE_DEFAULTS)

    def test_public_user_includes_profile_without_password_hash_or_real_name(self) -> None:
        data = user_profile.public_user(self.user)
        self.assertEqual(data["nickname"], "")
        self.assertEqual(data["avatar_url"], "")
        self.assertEqual(data["preferences"], user_profile.PREFERENCE_DEFAULTS)
        self.assertNotIn("password_hash", data)
        # 后台设置的真实姓名只给管理后台用，不下发给前台
        self.assertNotIn("display_name", data)

    def test_nickname_is_separate_from_admin_real_name(self) -> None:
        self.assertEqual(user_profile.real_name(self.user), "王小明")
        self.assertEqual(user_profile.set_nickname(self.user, "  王  大锤 ")["nickname"], "王 大锤")
        # 昵称只给自己看，别人看到的仍是后台真实姓名
        self.assertEqual(user_profile.real_name(self.user), "王小明")
        # login_users.json 里的真实姓名不受影响，后台统计仍按它映射
        entry = next(u for u in user_profile.settings.allowed_login_users if u["id"] == "u1")
        self.assertEqual(entry["display_name"], "王小明")
        saved = json.loads(user_profile.settings.login_users_path.read_text(encoding="utf-8"))
        self.assertEqual(next(u for u in saved if u["id"] == "u1")["display_name"], "王小明")
        self.assertEqual(job_store._admin_display_name_map()["u1"], "王小明")
        self.assertEqual(user_profile.set_nickname(self.user, "")["nickname"], "")
        # 没有设置真实姓名的账号，别人看到登录名
        self.assertEqual(user_profile.real_name(job_store.get_or_create_user("小李")), "小李")
        with self.assertRaises(HTTPException):
            user_profile.set_nickname(self.user, "名" * 41)

    def test_change_password_requires_current_and_invalidates_old_sessions(self) -> None:
        session = job_store.create_session("u1")
        with self.assertRaises(HTTPException):
            user_profile.change_password(self.user, "wrong", "new-pass-1")
        with self.assertRaises(HTTPException):
            user_profile.change_password(self.user, "old-pass", "123")
        with self.assertRaises(HTTPException):
            user_profile.change_password(self.user, "old-pass", "old-pass")
        self.assertIsNotNone(job_store.get_user_by_session(session))

        user_profile.change_password(self.user, "old-pass", "new-pass-1")
        self.assertIsNone(job_store.get_user_by_session(session))
        self.assertEqual(job_store.get_user_by_session(job_store.create_session("u1"))["id"], "u1")
        with self.assertRaises(ValueError):
            job_store.get_or_create_user("小王", "old-pass")
        self.assertEqual(job_store.get_or_create_user("小王", "new-pass-1")["id"], "u1")

    def test_new_password_round_trips_through_real_login_endpoint(self) -> None:
        from fastapi import Response

        from backend import main

        # 首尾空格会在登录时被去掉，修改时直接拒绝，避免改完就登不上
        for padded in (" new-pass-1 ", "new-pass-1 ", " new-pass-1"):
            with self.assertRaises(HTTPException) as raised:
                user_profile.change_password(self.user, "old-pass", padded)
            self.assertIn("首尾", raised.exception.detail)
        self.assertEqual(job_store.get_or_create_user("小王", "old-pass")["id"], "u1")

        # 当前密码按登录的规则去掉首尾空格后校验
        user_profile.change_password(self.user, "  old-pass ", "new-pass-1")
        result = main.auth_login_lite(main.LiteLoginRequest(username="小王", password="new-pass-1"), Response())
        self.assertEqual(result["user"]["id"], "u1")
        with self.assertRaises(HTTPException) as raised:
            main.auth_login_lite(main.LiteLoginRequest(username="小王", password="old-pass"), Response())
        self.assertEqual(raised.exception.status_code, 401)

    def test_avatar_is_cropped_square_versioned_and_removable(self) -> None:
        buf = io.BytesIO()
        Image.new("RGB", (800, 400), (200, 80, 60)).save(buf, format="JPEG")
        url = user_profile.save_avatar("小王", buf.getvalue())
        self.assertTrue(url.startswith("/avatars/小王.png?v="))
        with Image.open(user_profile.avatar_path("小王")) as img:
            self.assertEqual(img.size, (256, 256))
        self.assertEqual(user_profile.avatar_url_for_user_id("u1"), url)
        with self.assertRaises(HTTPException):
            user_profile.save_avatar("小王", b"not an image")
        user_profile.avatar_path("小王").unlink()
        self.assertEqual(user_profile.avatar_url("小王"), "")


if __name__ == "__main__":
    unittest.main()
