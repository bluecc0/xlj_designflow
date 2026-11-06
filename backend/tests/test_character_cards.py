from __future__ import annotations

import asyncio
import io
import json
import re
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
from PIL import Image

from backend import character_cards, job_store, main, team_canvas
from backend.agent2 import service, store
from backend.agent2 import tools as a2tools
from backend.agent2.engine import ModelStep, ToolContext

OWNER = {"id": "owner", "username": "小王", "role": "user"}
MEMBER = {"id": "member", "username": "小李", "role": "user"}
ADMIN = {"id": "admin", "username": "admin", "role": "admin"}
USERS = {user["id"]: user for user in (OWNER, MEMBER, ADMIN)}


def _png(color: str = "red", size: tuple[int, int] = (8, 8)) -> bytes:
    output = io.BytesIO()
    Image.new("RGB", size, color).save(output, format="PNG")
    return output.getvalue()


def _card(name: str, image_count: int, description: str = "", gender: str = "") -> dict:
    return {"id": name, "owner_id": "owner", "name": name, "description": description, "gender": gender,
            "images": [{"id": f"{name}{i}", "file": f"{i}.jpg"} for i in range(image_count)]}


class CharacterPromptTest(unittest.TestCase):
    def test_locks_identity_and_leaves_everything_else_to_the_request(self) -> None:
        text = character_cards.build_character_prompt(character_cards.people_from_cards([_card("小鹿", 2, "短发")], 3))
        self.assertIn("必须是下面这个人本人", text)
        self.assertIn("[image 3]、[image 4]", text)
        self.assertIn("人物简介：短发", text)
        self.assertIn("服装、发型、妆容、姿势、表情、场景、构图、光线和画风都按上面的需求来", text)
        self.assertIn("需求明确要改某个特征时", text)
        self.assertNotIn("其他参考图", text)
        self.assertNotIn("参考图仅用于", text)

    def test_other_references_cannot_replace_the_person(self) -> None:
        text = character_cards.build_character_prompt(character_cards.people_from_cards([_card("小鹿", 1)], 2), [1, 3])
        self.assertIn("[image 1]、[image 3] 是其他参考图，按上面的需求使用", text)
        self.assertIn("不要用他们的长相替换指定人物", text)

    def test_gender_is_written_only_when_it_helps_identify_the_person(self) -> None:
        for gender, label in (("adult_male", "成年男性"), ("adult_female", "成年女性"), ("boy", "男童"), ("girl", "女童")):
            people = character_cards.people_from_cards([_card("小鹿", 1, gender=gender)], 1)
            self.assertIn(f"“小鹿（{label}）”", character_cards.build_character_prompt(people))
        self.assertIn("“小鹿”", character_cards.build_character_prompt(character_cards.people_from_cards([_card("小鹿", 1)], 1)))

    def test_several_people_keep_their_own_image_numbers(self) -> None:
        text = character_cards.build_character_prompt(character_cards.people_from_cards([_card("甲", 2), _card("乙", 1)], 1))
        self.assertIn("同时出现", text)
        self.assertIn("“甲”：长相以 [image 1]、[image 2] 为准", text)
        self.assertIn("“乙”：长相以 [image 3] 为准", text)


class CharacterCardApiTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        self.output = root / "output"
        (self.output / "ai-images").mkdir(parents=True)
        mounts = {route.name: route.app for route in main.app.routes if getattr(route, "name", "") in ("ai-images", "output")}
        for patcher in (
            patch.object(job_store, "_DB_PATH", root / "jobs.db"),
            patch.object(main.settings, "output_path", self.output),
            patch.object(team_canvas.settings, "allowed_login_users", list(USERS.values())),
            patch.object(mounts["ai-images"], "all_directories", [str(self.output / "ai-images")]),
            patch.object(mounts["output"], "all_directories", [str(self.output)]),
            patch.object(main, "_get_session_user", side_effect=lambda request: USERS.get(
                request.cookies.get("designflow_session"))),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)
        job_store.init_db()
        team_canvas.init_team_canvas_tables()
        character_cards.init_character_card_tables()
        store.init_tables()

    def _client(self, user: dict) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test",
                                 cookies={"designflow_session": user["id"]})

    async def _create(self, user: dict = OWNER, *, shared: bool = False, images: int = 1, name: str = "小鹿") -> dict:
        async with self._client(user) as client:
            resp = await client.post("/character-cards", data={"name": name, "description": "短发", "is_shared": str(shared).lower()},
                                     files=[("images", (f"{i}.png", _png(), "image/png")) for i in range(images)])
        self.assertEqual(resp.status_code, 200, resp.text)
        return resp.json()["card"]

    async def test_avatar_falls_back_to_first_image_and_can_be_replaced_or_removed(self) -> None:
        card = await self._create()
        self.assertFalse(card["has_avatar"])
        self.assertEqual(card["avatar_url"], card["images"][0]["url"])
        keep = {"name": "小鹿", "gender": "adult_female", "keep_image_ids": json.dumps([card["images"][0]["id"]])}
        folder = self.output / "ai-images" / "owner" / "characters" / card["id"]
        async with self._client(OWNER) as client:
            first = (await client.put(f"/character-cards/{card['id']}", data=keep,
                                      files=[("avatar", ("a.png", _png(size=(900, 900)), "image/png"))])).json()["card"]
            self.assertTrue(first["has_avatar"])
            self.assertEqual(first["gender"], "adult_female")
            avatar = Image.open(io.BytesIO((await client.get(first["avatar_url"])).content))
            self.assertLessEqual(max(avatar.size), 512)
            # 只改其他字段时头像不变
            same = (await client.put(f"/character-cards/{card['id']}", data=keep)).json()["card"]
            self.assertEqual(same["avatar_url"], first["avatar_url"])
            replaced = (await client.put(f"/character-cards/{card['id']}", data=keep,
                                         files=[("avatar", ("b.png", _png("blue"), "image/png"))])).json()["card"]
            self.assertNotEqual(replaced["avatar_url"], first["avatar_url"])
            self.assertFalse((folder / first["avatar_url"].rsplit("/", 1)[1]).exists())
            removed = (await client.put(f"/character-cards/{card['id']}", data={**keep, "remove_avatar": "true"})).json()["card"]
        self.assertFalse(removed["has_avatar"])
        self.assertEqual(removed["avatar_url"], card["images"][0]["url"])
        self.assertEqual(len(list(folder.iterdir())), 1)

    async def test_avatar_is_not_sent_as_reference_and_follows_sharing(self) -> None:
        async with self._client(OWNER) as client:
            created = await client.post("/character-cards", data={"name": "小鹿", "gender": "boy", "is_shared": "true"}, files=[
                ("images", ("a.png", _png(), "image/png")), ("avatar", ("b.png", _png("blue"), "image/png"))])
            self.assertEqual(created.status_code, 200, created.text)
            card = created.json()["card"]
            self.assertEqual((await client.post("/character-cards", data={"name": "错", "gender": "x"}, files=[
                ("images", ("a.png", _png(), "image/png"))])).status_code, 400)
        kwargs = await self._submit(card, uploads=0)
        self.assertEqual(len(kwargs["refs"]), 1)
        self.assertIn("“小鹿（男童）”", kwargs["prompt"])
        async with self._client(MEMBER) as client:
            self.assertEqual((await client.get(card["avatar_url"])).status_code, 200)
        async with self._client(OWNER) as client:
            await client.put(f"/character-cards/{card['id']}", data={
                "name": "小鹿", "is_shared": "false", "keep_image_ids": json.dumps([card["images"][0]["id"]])})
        async with self._client(MEMBER) as client:
            self.assertEqual((await client.get(card["avatar_url"])).status_code, 404)

    async def test_old_table_gets_new_columns(self) -> None:
        with job_store._connect() as conn:
            conn.execute("DROP TABLE character_cards")
            conn.execute("CREATE TABLE character_cards (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, owner_name TEXT NOT NULL, "
                         "name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', images_json TEXT NOT NULL, "
                         "is_shared INTEGER NOT NULL DEFAULT 0, created_at REAL NOT NULL, updated_at REAL NOT NULL)")
            conn.execute("INSERT INTO character_cards VALUES ('old', 'owner', '小王', 'A', '', '[{\"id\": \"i\", \"file\": \"i.jpg\"}]', 0, 1, 1)")
        character_cards.init_character_card_tables()
        listed = character_cards.list_cards(OWNER)
        self.assertEqual((listed[0]["gender"], listed[0]["has_avatar"]), ("", False))
        self.assertTrue(listed[0]["avatar_url"].endswith("/old/i.jpg"))

    async def test_private_card_is_hidden_from_colleagues(self) -> None:
        card = await self._create()
        async with self._client(MEMBER) as client:
            self.assertEqual((await client.get("/character-cards")).json()["cards"], [])
            self.assertEqual((await client.get(card["images"][0]["url"])).status_code, 404)
            resp = await client.post("/ai-image", data={"model": "gpt-image-2.6", "prompt": "海报", "character_ids": json.dumps([card["id"]])})
            self.assertEqual(resp.status_code, 400)
            self.assertEqual((await client.delete(f"/character-cards/{card['id']}")).status_code, 404)

    async def test_shared_card_can_be_used_but_only_owner_or_admin_can_edit(self) -> None:
        card = await self._create(shared=True)
        async with self._client(MEMBER) as client:
            listed = (await client.get("/character-cards")).json()["cards"]
            self.assertEqual([c["id"] for c in listed], [card["id"]])
            self.assertFalse(listed[0]["can_edit"])
            self.assertEqual((await client.get(card["images"][0]["url"])).status_code, 200)
            resp = await client.put(f"/character-cards/{card['id']}", data={"name": "改名", "keep_image_ids": "[]"})
            self.assertEqual(resp.status_code, 403)
            self.assertEqual((await client.delete(f"/character-cards/{card['id']}")).status_code, 403)
        async with self._client(ADMIN) as client:
            self.assertTrue((await client.get("/character-cards")).json()["cards"][0]["can_edit"])

    async def test_unsharing_closes_access_again(self) -> None:
        card = await self._create(shared=True)
        async with self._client(OWNER) as client:
            resp = await client.put(f"/character-cards/{card['id']}", data={
                "name": "小鹿", "is_shared": "false", "keep_image_ids": json.dumps([card["images"][0]["id"]])})
            self.assertEqual(resp.status_code, 200, resp.text)
        async with self._client(MEMBER) as client:
            self.assertEqual((await client.get(card["images"][0]["url"])).status_code, 404)

    async def test_card_needs_an_image_and_respects_the_image_limit(self) -> None:
        async with self._client(OWNER) as client:
            self.assertEqual((await client.post("/character-cards", data={"name": "小鹿"})).status_code, 400)
            resp = await client.post("/character-cards", data={"name": "小鹿"}, files=[
                ("images", (f"{i}.png", _png(), "image/png")) for i in range(5)])
            self.assertEqual(resp.status_code, 400)
            resp = await client.post("/character-cards", data={"name": "小鹿"}, files=[("images", ("a.png", b"nope", "image/png"))])
            self.assertEqual(resp.status_code, 400)

    async def test_update_removes_dropped_images_and_delete_removes_folder(self) -> None:
        card = await self._create(images=2)
        folder = self.output / "ai-images" / "owner" / "characters" / card["id"]
        self.assertEqual(len(list(folder.iterdir())), 2)
        async with self._client(OWNER) as client:
            resp = await client.put(f"/character-cards/{card['id']}", data={
                "name": "小鹿", "keep_image_ids": json.dumps([card["images"][1]["id"]])})
            self.assertEqual([i["id"] for i in resp.json()["card"]["images"]], [card["images"][1]["id"]])
            self.assertEqual(len(list(folder.iterdir())), 1)
            self.assertEqual((await client.delete(f"/character-cards/{card['id']}")).status_code, 200)
        self.assertFalse(folder.exists())

    async def _submit(self, card: dict, *, user: dict = OWNER, uploads: int = 1, prompt: str = "穿红裙的海报") -> dict:
        """走真实接口提交，只替换后台执行，返回传给后台任务的参数。"""
        background = AsyncMock()
        with patch.object(main, "_run_ai_image_background", background), \
                patch.object(main, "_track_ai_image_task", side_effect=lambda coro: asyncio.ensure_future(coro)):
            async with self._client(user) as client:
                resp = await client.post("/ai-image", data={
                    "model": "gpt-image-2.5", "prompt": prompt, "character_ids": json.dumps([card["id"]])},
                    files=[("image", (f"u{i}.png", _png("blue"), "image/png")) for i in range(uploads)] or None)
            await asyncio.sleep(0)
        self.assertEqual(resp.status_code, 200, resp.text)
        return background.await_args.kwargs

    async def test_generation_puts_character_images_after_user_images(self) -> None:
        card = await self._create(images=2)
        kwargs = await self._submit(card)
        self.assertEqual(len(kwargs["refs"]), 3)
        self.assertEqual(kwargs["refs"][0][1], "u0.png")
        self.assertTrue(kwargs["has_reference"])
        self.assertTrue(kwargs["prompt"].startswith("穿红裙的海报\n\n【指定人物】"))
        self.assertIn("[image 2]、[image 3]", kwargs["prompt"])
        self.assertIn("[image 1] 是其他参考图", kwargs["prompt"])
        self.assertEqual(kwargs["original_prompt"], "穿红裙的海报")
        meta = kwargs["request_meta"]
        self.assertEqual((meta["manual_reference_count"], meta["character_reference_count"], meta["context_reference_count"]), (1, 2, 0))
        self.assertEqual(meta["characters"], [{"id": card["id"], "name": "小鹿"}])
        self.assertEqual([r["type"] for r in meta["reference_images"]], ["manual", "character", "character"])

    async def test_colleague_can_generate_with_shared_card(self) -> None:
        card = await self._create(shared=True)
        kwargs = await self._submit(card, user=MEMBER, uploads=0)
        self.assertIn("[image 1]", kwargs["prompt"])
        self.assertEqual(len(kwargs["refs"]), 1)

    async def test_character_turns_off_text_only_gif(self) -> None:
        card = await self._create()
        background = AsyncMock()
        with patch.object(main, "_run_ai_image_background", background), \
                patch.object(main, "_track_ai_image_task", side_effect=lambda coro: asyncio.ensure_future(coro)):
            async with self._client(OWNER) as client:
                resp = await client.post("/ai-image", data={
                    "model": "gpt-image-2.6", "prompt": "做个 gif 动图", "character_ids": json.dumps([card["id"]])})
            await asyncio.sleep(0)
        self.assertEqual(resp.status_code, 200, resp.text)
        self.assertEqual(background.await_args.kwargs["request_meta"]["output_format"], "")

    async def test_too_many_reference_images_is_rejected_without_writing_a_session(self) -> None:
        card = await self._create(images=2)
        async with self._client(OWNER) as client:
            resp = await client.post("/ai-image", data={"model": "gpt-image-2.5", "prompt": "海报", "character_ids": json.dumps([card["id"]])},
                                     files=[("image", (f"u{i}.png", _png(), "image/png")) for i in range(8)])
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(job_store.list_ai_chat_sessions(user_id="owner"), [])

    async def test_agent_registers_each_character_image_once_per_session(self) -> None:
        card = await self._create(images=2)
        full = character_cards.resolve_cards(OWNER, json.dumps([card["id"]]))
        session = store.create_session(OWNER["id"])
        first = service.register_characters(OWNER, session["id"], full)
        second = service.register_characters(OWNER, session["id"], full)
        self.assertEqual(first, second)
        ids = first[0]["artifact_ids"]
        self.assertEqual(len(ids), 2)
        note = character_cards.build_agent_note(first)
        self.assertIn("no_character", note)
        self.assertIn(ids[0], note)
        # 卡片删除后会话里的图片 ID 仍然可用
        async with self._client(OWNER) as client:
            await client.delete(f"/character-cards/{card['id']}")
        artifact = store.get_artifact(ids[0], OWNER["id"])
        self.assertEqual(artifact["kind"], "character_ref")
        self.assertTrue(Path(artifact["path"]).is_file())

    async def _run_agent_turn(self, card: dict, model, *, uploads: int = 1) -> list[dict]:
        """走真实接口和真实工具跑完一轮 Agent，只替换模型和生图执行，返回这轮建的生图任务。"""
        jobs: list[dict] = []
        result = self.output / "ai-images" / "owner" / "result.png"
        result.parent.mkdir(parents=True, exist_ok=True)
        result.write_bytes(_png())

        async def fake_execute(_runner, job_id, initial=None):
            job = job_store.load_ai_image_job(job_id)
            jobs.append({**job, "refs": initial["refs"]})
            job_store.save_ai_image_job(
                job_id=job_id, user_id=job["user_id"], status="done", model=job["model"], prompt=job["prompt"], size=job["size"],
                provider="auto", resolution=job["resolution"], original_prompt=job["original_prompt"], resolved_prompt=job["resolved_prompt"],
                image_url="/ai-images/owner/result.png", request_meta=job["request_meta"], created_at=job["created_at"])

        session = store.create_session(OWNER["id"])
        with patch.object(service, "model_factory", lambda: model), patch.object(service, "_user_skill_dir", lambda user: None), \
                patch.object(a2tools, "execute_image_job", fake_execute), patch.object(a2tools, "JOB_POLL_SECONDS", 0.01):
            async with self._client(OWNER) as client:
                resp = await client.post(f"/agent2/sessions/{session['id']}/messages", data={
                    "message": "出图", "character_ids": json.dumps([card["id"]])},
                    files=[("images", (f"u{i}.png", _png("blue"), "image/png")) for i in range(uploads)] or None)
        self.assertEqual(resp.status_code, 200, resp.text)
        return jobs

    async def test_agent_turn_gets_character_prompt_from_backend_even_with_a_vague_model_prompt(self) -> None:
        card = await self._create(images=2)
        model = _ScriptedAgent()
        jobs = await self._run_agent_turn(card, model)
        # 第一次没带人物参考图，被工具拦下，没有建任务
        self.assertIn("人物参考图全部放进", model.first_tool_result)
        self.assertEqual(len(jobs), 2)
        with_person, product_only = jobs
        # 其他参考图在前时，序号按这一张实际的参考图顺序写
        self.assertEqual(with_person["original_prompt"], "海报")
        self.assertTrue(with_person["resolved_prompt"].startswith("海报\n\n【指定人物】"))
        self.assertIn("“小鹿”：长相以 [image 2]、[image 3] 为准", with_person["resolved_prompt"])
        self.assertIn("[image 1] 是其他参考图", with_person["resolved_prompt"])
        self.assertEqual(len(with_person["refs"]), 3)
        self.assertEqual(with_person["request_meta"]["execution_prompt"], with_person["resolved_prompt"])
        # 用户明确不要人物的那一张：不带人物图，也不加人物段
        self.assertEqual(product_only["resolved_prompt"], "纯商品图")
        self.assertEqual(len(product_only["refs"]), 1)

    async def test_agent_keeps_requirement_after_waiting_for_the_user(self) -> None:
        card = await self._create()
        full = character_cards.resolve_cards(OWNER, json.dumps([card["id"]]))
        session = store.create_session(OWNER["id"])
        people = service.register_characters(OWNER, session["id"], full)
        store.append_event(session["id"], "t1", "turn.started", {"text": "x", "characters": people})
        # 新的 state 模拟 ask_user 之后继续：要求来自事件记录，不来自内存

        async def emit(*args):
            pass

        ctx = ToolContext(user=OWNER, session_id=session["id"], turn_id="t1", call_id="c", emit=emit, state={})
        result = await a2tools.generate_image(ctx, {"images": [{"prompt": "海报"}]})
        self.assertIn("error", result)
        self.assertEqual(ctx.state["images"], 0)

    async def test_agent_reusing_earlier_character_image_still_gets_its_person_prompt(self) -> None:
        card = await self._create()
        full = character_cards.resolve_cards(OWNER, json.dumps([card["id"]]))
        session = store.create_session(OWNER["id"])
        people = service.register_characters(OWNER, session["id"], full)

        async def emit(*args):
            pass

        ctx = ToolContext(user=OWNER, session_id=session["id"], turn_id="later", call_id="c", emit=emit, state={})
        text = a2tools._with_character_prompt(ctx, "海报", people[0]["artifact_ids"])
        self.assertIn("“小鹿”：长相以 [image 1] 为准", text)
        self.assertIn("人物简介：短发", text)


class _ScriptedAgent:
    """模拟写得很笼统的模型：第一次忘带人物图，第二次带上，并有一张明确不要人物的图。"""

    def __init__(self) -> None:
        self.step = 0
        self.first_tool_result = ""

    async def stream(self, messages, tools):
        self.step += 1
        calls: list[dict] = []
        if self.step == 1:
            calls = [{"id": "c1", "name": "generate_image", "arguments": json.dumps({"images": [{"prompt": "海报"}]})}]
        elif self.step == 2:
            self.first_tool_result = next(m["content"] for m in reversed(messages) if m.get("role") == "tool")
            user = next(m["content"] for m in reversed(messages) if m.get("role") == "user")
            people = re.search(r"参考图：([^）；]+)", user).group(1).split("、")
            upload = re.search(r"用户上传了图片：(img_\w+)", user).group(1)
            calls = [{"id": "c2", "name": "generate_image", "arguments": json.dumps({"images": [
                {"prompt": "海报", "reference_image_ids": [upload, *people]},
                {"prompt": "纯商品图", "reference_image_ids": [upload], "no_character": True},
            ]})}]
        yield ("step", ModelStep(text="" if calls else "好了", tool_calls=calls))


if __name__ == "__main__":
    unittest.main()
