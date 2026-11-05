from __future__ import annotations

import asyncio
import io
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from PIL import Image

from backend import job_store
from backend.agent2 import store
from backend.agent2 import tools as a2tools
from backend.agent2.engine import ToolContext


def _png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (20, 30), "white").save(buf, format="PNG")
    return buf.getvalue()


class UseSkillImageTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.db_patch = patch.object(job_store, "_DB_PATH", root / "a2.db")
        self.db_patch.start()
        job_store.init_db()
        store.init_tables()
        self.skill_dir = root / "skill"
        (self.skill_dir / "assets").mkdir(parents=True)
        (self.skill_dir / "assets" / "0007.jpg").write_bytes(_png())
        (self.skill_dir / "SKILL.md").write_text("x", encoding="utf-8")
        (root / "outside.png").write_bytes(_png())
        skill = SimpleNamespace(name="kids-lookbook", source_path=self.skill_dir)
        self.patches = [
            patch.object(a2tools, "_load_skill", lambda ctx, name: skill),
            patch.object(a2tools.settings, "output_path", root / "output"),
        ]
        for p in self.patches:
            p.start()
        session = store.create_session("u1")
        self.events = []

        async def emit(*args):
            self.events.append(args)

        self.ctx = ToolContext(user={"id": "u1"}, session_id=session["id"], turn_id="t1", call_id="c1",
                               emit=emit, state={}, publish=emit)

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.db_patch.stop()
        self.tmp.cleanup()

    def test_registers_skill_images_without_publishing(self):
        result = asyncio.run(a2tools.use_skill_image(self.ctx, {
            "name": "kids-lookbook", "paths": ["assets/0007.jpg", "../outside.png", "SKILL.md", "assets/none.png"]}))
        self.assertEqual([i["path"] for i in result["images"]], ["assets/0007.jpg"])
        self.assertEqual(len(result["failed"]), 3)
        self.assertEqual(result["failed"][2]["nearby"], ["assets/0007.jpg"])
        self.assertEqual(self.events, [])
        image_id = result["images"][0]["id"]
        data, _name = a2tools._artifact_bytes(self.ctx, image_id)
        self.assertEqual(data, (self.skill_dir / "assets" / "0007.jpg").read_bytes())
        self.assertEqual(store.get_artifact(image_id, "u1")["kind"], "skill_ref")
        # 另一个用户拿不到
        other = ToolContext(user={"id": "u2"}, session_id="s", turn_id="t", call_id="c", emit=self.ctx.emit, state={})
        with self.assertRaises(ValueError):
            a2tools._artifact_bytes(other, image_id)

    def test_generate_requires_skill_refs_per_image(self):
        ref = asyncio.run(a2tools.use_skill_image(self.ctx, {"name": "kids-lookbook", "paths": ["assets/0007.jpg"]}))
        ref_id = ref["images"][0]["id"]
        two = [{"prompt": "a"}, {"prompt": "b"}]
        shared = asyncio.run(a2tools.generate_image(self.ctx, {"images": two, "reference_image_ids": [ref_id]}))
        self.assertIn("每一项自己的", shared["error"])
        unused = asyncio.run(a2tools.generate_image(self.ctx, {"images": two}))
        self.assertIn("没有传进任何一张", unused["error"])
        self.assertEqual(self.ctx.state["images"], 0)
        fresh = ToolContext(user={"id": "u1"}, session_id=self.ctx.session_id, turn_id="t2", call_id="c2",
                            emit=self.ctx.emit, state={})
        asyncio.run(a2tools.use_skill_image(fresh, {"name": "kids-lookbook", "paths": ["assets/missing/"]}))
        self.assertIn("还没有登记成功", asyncio.run(a2tools.generate_image(fresh, {"images": two}))["error"])

        async def fake_one(ctx, index, item, **kw):
            return {"index": index, "id": f"img_{index}", "url": "/x"}

        per_item = [{"prompt": "a", "reference_image_ids": [ref_id]}, {"prompt": "b", "reference_image_ids": [ref_id]}]
        with patch.object(a2tools, "_generate_one", fake_one):
            ok = asyncio.run(a2tools.generate_image(self.ctx, {"images": per_item}))
        self.assertEqual(len(ok["images"]), 2)

    def test_tool_and_platform_note_registered(self):
        self.assertIn("use_skill_image", a2tools.build_tools())
        self.assertIn("use_skill_image", a2tools.SKILL_PLATFORM_NOTE)


if __name__ == "__main__":
    unittest.main()
