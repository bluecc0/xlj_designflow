from __future__ import annotations

import asyncio
import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from backend import job_store
from backend.agent2 import service, store
from backend.agent2.engine import ModelStep, Tool


class FakeModel:
    """按脚本依次返回每一步：("text", "...") 或 ("call", name, args)。"""

    def __init__(self, steps):
        self.steps = list(steps)
        self.seen = []

    async def stream(self, messages, tools):
        self.seen.append([dict(m) for m in messages])
        step = self.steps.pop(0)
        text, calls = "", []
        for part in step:
            if part[0] == "text":
                text += part[1]
                yield ("text", part[1])
            elif part[0] == "reset":
                yield ("reset", None)
            else:
                calls.append({"id": f"call_{len(self.seen)}_{len(calls)}", "name": part[1],
                              "arguments": json.dumps(part[2], ensure_ascii=False)})
        yield ("step", ModelStep(text=text, tool_calls=calls))


def _events(chunks):
    out = []
    for chunk in chunks:
        data = chunk.split("data: ", 1)[1]
        out.append(json.loads(data))
    return out


async def _collect(gen):
    return [c async for c in gen]


class Agent2EngineTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db_patch = patch.object(job_store, "_DB_PATH", Path(self.tmp.name) / "a2.db")
        self.db_patch.start()
        store.init_tables()
        self.user = {"id": "u1", "username": "tester"}
        self.session = store.create_session("u1")
        self.calls = []

        async def echo(ctx, args):
            self.calls.append(args)
            await ctx.emit("tool.progress", {"call_id": ctx.call_id, "progress": 50})
            return {"images": [{"id": "img_1", "url": "/x.png"}]}

        async def noop(ctx, args):
            return {}

        self.tools = {
            "generate_image": Tool("generate_image", "gen", {"type": "object"}, echo),
            "ask_user": Tool("ask_user", "ask", {"type": "object"}, noop, suspends=True),
        }
        self.patches = [
            patch.object(service, "tools_factory", lambda: self.tools),
            patch.object(service, "_user_skill_dir", lambda user: None),
        ]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.db_patch.stop()
        self.tmp.cleanup()

    def _run(self, model, text="生成 3 张小红书风格的跑步海报图"):
        with patch.object(service, "model_factory", lambda: model):
            session = store.get_session(self.session["id"], "u1")
            return _events(asyncio.run(_collect(service.start_turn(self.user, session, text, []))))

    def test_act_first_tool_call_then_reply_with_next_steps(self):
        model = FakeModel([
            [("text", "好的，正在生成 3 张。"), ("call", "generate_image", {"images": [{"prompt": "小红书风格，跑步海报"}] * 3, "aspect_ratio": "3:4"})],
            [("text", "3 张都好了。\n[[NEXT: 加上跑鞋 | 换个标题]]")],
        ])
        events = self._run(model)
        types = [e["type"] for e in events]
        self.assertEqual(types[0], "turn.started")
        self.assertIn("tool.started", types)
        self.assertIn("tool.progress", types)
        self.assertIn("tool.finished", types)
        self.assertNotIn("input.required", types)
        self.assertEqual(types[-2:], ["suggestions", "turn.finished"])
        self.assertEqual(events[-2]["payload"]["options"], ["加上跑鞋", "换个标题"])
        self.assertEqual(events[-1]["payload"]["text"], "3 张都好了。")
        self.assertEqual(self.calls[0]["aspect_ratio"], "3:4")
        # 第二步模型看到了工具结果
        self.assertEqual(model.seen[1][-1]["role"], "tool")
        # 事件全部落库，可以按 seq 回放
        stored = store.list_events(self.session["id"])
        self.assertEqual([e["seq"] for e in stored], list(range(1, len(stored) + 1)))
        self.assertEqual(len(stored), len(events))

    def test_preparation_beyond_twelve_steps_still_generates(self):
        async def prepare(ctx, args):
            return {"ready": True}

        self.tools["read_skill_file"] = Tool("read_skill_file", "read", {"type": "object"}, prepare)
        model = FakeModel(
            [[("call", "read_skill_file", {"index": i})] for i in range(20)]
            + [[("call", "generate_image", {"images": [{"prompt": "lookbook"}]})],
               [("text", "Lookbook ready.")]]
        )
        events = self._run(model)
        self.assertEqual(len(model.seen), 22)
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(events[-1]["type"], "turn.finished")
        self.assertEqual(events[-1]["payload"]["text"], "Lookbook ready.")
        saved = store.get_session(self.session["id"], "u1")
        self.assertEqual(store.load_session_messages(saved)[-1]["content"], "Lookbook ready.")

    def test_claiming_done_without_any_tool_is_corrected_once(self):
        # 线上出现过：模型只写了"正在生成……已生成……"，没调用生图工具，用户什么也没收到
        model = FakeModel([
            [("text", "好的，正在为你生成这张海报。已生成这张未来都市广场的街头时尚大片。")],
            [("call", "generate_image", {"images": [{"prompt": "未来都市广场街头时尚大片"}]})],
            [("text", "已生成这张街头时尚大片。")],
        ])
        events = self._run(model, "生成图片：街头时尚大片")
        types = [e["type"] for e in events]
        self.assertIn("message.reset", types)
        self.assertLess(types.index("message.reset"), types.index("tool.started"))
        self.assertEqual(len(self.calls), 1)
        # 纠正提示发给了模型，编出来的那段话没有留在历史里
        second = model.seen[1]
        self.assertEqual(second[-1]["role"], "system")
        self.assertIn("没有调用任何工具", second[-1]["content"])
        self.assertFalse(any(m.get("content", "") and "未来都市广场的街头" in str(m.get("content")) and m["role"] == "assistant"
                             for m in second))
        self.assertEqual(events[-1]["payload"]["text"], "已生成这张街头时尚大片。")
        # 纠正提示不留在会话历史里
        saved = store.get_session(self.session["id"], "u1")
        self.assertNotIn("系统检查", json.dumps(store.load_session_messages(saved), ensure_ascii=False))

    def test_fake_done_correction_does_not_loop_and_skips_normal_replies(self):
        model = FakeModel([[("text", "已生成。")], [("text", "抱歉，这次没能生成图片。")]])
        events = self._run(model)
        self.assertEqual([e["type"] for e in events].count("message.reset"), 1)
        self.assertEqual(events[-1]["payload"]["text"], "抱歉，这次没能生成图片。")
        # 只纠正一次：第二次仍然声称完成也不再拦
        events = self._run(FakeModel([[("text", "已生成。")], [("text", "已生成好了。")]]))
        self.assertEqual([e["type"] for e in events].count("message.reset"), 1)
        # 普通问答、工具调用之后的"已生成"都不拦
        events = self._run(FakeModel([[("text", "你好，我可以帮你做海报和抠图。")]]), "你好")
        self.assertNotIn("message.reset", [e["type"] for e in events])

    def test_answering_about_earlier_results_is_not_treated_as_fake(self):
        # 审核复现：上一轮已出图，用户问"刚才的图在哪里下载"，如实回答"已生成的图片在上方卡片里"不能被拦
        self._run(FakeModel([[("call", "generate_image", {"images": [{"prompt": "跑鞋海报"}]})], [("text", "已生成跑鞋海报。")]]))
        model = FakeModel([[("text", "已生成的图片在上方卡片里，点下载按钮就行，不需要重新生成。")]])
        events = self._run(model, "刚才的图在哪里下载？不要重新做")
        self.assertNotIn("message.reset", [e["type"] for e in events])
        self.assertEqual(len(model.seen), 1)  # 没有额外再调一次模型
        self.assertEqual(events[-1]["payload"]["text"], "已生成的图片在上方卡片里，点下载按钮就行，不需要重新生成。")
        # 确认之前的结果也不拦
        model = FakeModel([[("text", "对，之前已经生成好了 1 张，就是上面那张。")]])
        events = self._run(model, "之前是不是已经做好了？")
        self.assertNotIn("message.reset", [e["type"] for e in events])
        # 但有历史结果时，说了"正在为你生成"却不调工具，仍然要纠正
        model = FakeModel([[("text", "好的，正在为你生成一张竖版的。已生成。")],
                           [("call", "generate_image", {"images": [{"prompt": "竖版跑鞋海报"}], "aspect_ratio": "3:4"})],
                           [("text", "竖版做好了。")]])
        events = self._run(model, "再来一张竖版的")
        self.assertEqual([e["type"] for e in events].count("message.reset"), 1)
        self.assertEqual(len(self.calls), 2)

    def test_recovered_results_reply_is_not_treated_as_fake(self):
        # 后台补回的图：用户消息里带补回说明，回复"已经生成好了"是如实转告
        self.session = store.create_session("u1")
        model = FakeModel([[("text", "刚才那张已经生成好了，服务重启后已补回到上方卡片里。")]])
        events = self._run(model, "刚才不是做好了吗？\n\n[服务重启后，之前没完成的生图已在后台补回：img_rec1（春季海报）]")
        self.assertNotIn("message.reset", [e["type"] for e in events])
        self.assertEqual(len(model.seen), 1)

    def test_ask_user_suspends_and_resume_continues(self):
        model = FakeModel([[("call", "ask_user", {"question": "货号是多少？", "options": []})]])
        events = self._run(model, "做一个特殊品")
        self.assertEqual(events[-1]["type"], "input.required")
        turn_id = events[-1]["turn_id"]
        turn = store.get_turn(turn_id, "u1")
        self.assertEqual(turn["status"], "waiting_user")

        model2 = FakeModel([[("text", "收到。\n[[NEXT: 改文案]]")]])
        with patch.object(service, "model_factory", lambda: model2):
            session = store.get_session(self.session["id"], "u1")
            events2 = _events(asyncio.run(_collect(service.resume_turn(self.user, session, turn, "ARMW001-31"))))
        self.assertEqual(events2[0]["type"], "input.answered")
        self.assertEqual(events2[-1]["type"], "turn.finished")
        last_tool = [m for m in model2.seen[0] if m["role"] == "tool"][-1]
        self.assertIn("ARMW001-31", last_tool["content"])
        self.assertEqual(store.get_turn(turn_id, "u1")["status"], "done")

    def test_conversation_persists_across_turns(self):
        self._run(FakeModel([[("text", "第一轮")]]), "你好")
        model = FakeModel([[("text", "第二轮")]])
        self._run(model, "继续")
        roles = [m["role"] for m in model.seen[0]]
        self.assertEqual(roles, ["system", "user", "assistant", "user"])
        self.assertEqual(store.get_session(self.session["id"], "u1")["title"], "你好")

    def test_model_failure_emits_turn_failed(self):
        class Broken:
            async def stream(self, messages, tools):
                raise RuntimeError("模型服务暂不可用")
                yield  # pragma: no cover

        events = self._run(Broken())
        self.assertEqual(events[-1]["type"], "turn.failed")
        self.assertIn("模型服务暂不可用", events[-1]["payload"]["message"])

    def test_bad_tool_arguments_return_error_to_model(self):
        model = FakeModel([[("call", "generate_image", {})], [("text", "好")]])
        model.steps[0] = [("call", "missing_tool", {})]
        events = self._run(model)
        self.assertEqual(events[-1]["type"], "turn.finished")
        tool_msg = [m for m in model.seen[1] if m["role"] == "tool"][0]
        self.assertIn("没有名为", tool_msg["content"])

    def test_cancel_stops_running_turn(self):
        started = asyncio.Event()

        async def slow(ctx, args):
            started.set()
            await asyncio.sleep(30)
            return {}

        self.tools["generate_image"] = Tool("generate_image", "gen", {"type": "object"}, slow)
        model = FakeModel([[("call", "generate_image", {"images": [{"prompt": "x"}]})]])

        async def scenario():
            with patch.object(service, "model_factory", lambda: model):
                session = store.get_session(self.session["id"], "u1")
                chunks = []

                async def consume():
                    async for c in service.start_turn(self.user, session, "画一张", []):
                        chunks.append(c)

                consumer = asyncio.create_task(consume())
                await asyncio.wait_for(started.wait(), 5)
                turn_id = store.list_events(self.session["id"])[0]["turn_id"]
                self.assertTrue(service.cancel_turn(turn_id))
                await asyncio.wait_for(consumer, 5)
                return chunks, turn_id

        chunks, turn_id = asyncio.run(scenario())
        self.assertEqual(_events(chunks)[-1]["type"], "turn.cancelled")
        self.assertEqual(store.get_turn(turn_id, "u1")["status"], "cancelled")

    def _durable_image_tools(self, img: Path, *, fail: str = ""):
        """用真实任务表走 generate_image：执行器直接把任务写成完成（或失败）。"""
        from unittest.mock import MagicMock
        from backend.agent2 import tools as a2tools

        job_store.init_db()
        executed = []

        async def fake_execute(worker, job_id, initial=None):
            job = job_store.load_ai_image_job(job_id)
            executed.append(job)
            job_store.save_ai_image_job(
                job_id=job_id, user_id=job["user_id"], status="failed" if fail else "done", model=job["model"],
                prompt=job["prompt"], size=job["size"], resolution=job["resolution"], error=fail or None,
                image_url=None if fail else "/output/out.png", progress=100, request_meta=job["request_meta"],
                created_at=job["created_at"])

        main_stub = MagicMock()
        main_stub._resolve_public_asset_path.return_value = img
        self.tools["generate_image"] = a2tools.build_tools()["generate_image"]
        patches = [patch.object(a2tools, "execute_image_job", fake_execute), patch.object(a2tools, "_main", lambda: main_stub),
                   patch.object(a2tools, "JOB_POLL_SECONDS", 0.01)]
        return patches, executed

    def test_generate_image_uses_durable_job_without_self_check(self):
        from backend.agent2 import tools as a2tools

        img = Path(self.tmp.name) / "out.png"
        img.write_bytes(b"png")

        async def no_vlm(*args, **kwargs):
            raise AssertionError("出图后不应再调用看图模型自检")

        patches, executed = self._durable_image_tools(img)
        model = FakeModel([
            [("call", "generate_image", {"images": [{"prompt": "小红书风格，跑步海报"}], "aspect_ratio": "3:4"})],
            [("text", "好了。")],
        ])
        with patches[0], patches[1], patches[2], patch.object(a2tools, "routed_chat_completion", no_vlm):
            events = self._run(model)
        # 走可恢复任务：默认 GPT Image 2.5 快速模式、1K，带恢复断点
        job = executed[0]
        self.assertEqual((job["model"], job["request_meta"]["variant"], job["resolution"]), ("gpt-image-2.5", "flare", "1K"))
        self.assertEqual(job["request_meta"]["recovery"]["phase"], "queued")
        self.assertEqual(job["request_meta"]["source"], "agent2")
        self.assertEqual(len([e for e in events if e["type"] == "artifact.created"]), 1)
        self.assertNotIn("image.checked", [e["type"] for e in events])
        tool_msg = [m for m in model.seen[1] if m["role"] == "tool"][0]
        self.assertNotIn("check", json.loads(tool_msg["content"])["images"][0])

    def test_each_image_can_use_its_own_model(self):
        from backend.agent2 import tools as a2tools

        img = Path(self.tmp.name) / "out.png"
        img.write_bytes(b"png")

        patches, executed = self._durable_image_tools(img)
        model = FakeModel([
            [("call", "generate_image", {"images": [
                {"prompt": "猫", "label": "GPT Image 2.5"},
                {"prompt": "猫", "label": "Nano Banana Pro", "model": "nano-banana-pro"},
                {"prompt": "猫", "label": "Seedream", "model": "seedream-5.0-pro"}]})],
            [("call", "generate_image", {"images": [{"prompt": "猫", "model": "midjourney"}]})],
            [("text", "好了")],
        ])
        with patches[0], patches[1], patches[2]:
            events = self._run(model)
        # 实际提交的任务各用各的模型，而不是只改了名称
        self.assertEqual(sorted(j["model"] for j in executed), ["gpt-image-2.5", "nano-banana-pro", "seedream-5.0-pro"])
        created = {e["payload"]["artifact"]["label"]: e["payload"]["artifact"]["model"]
                   for e in events if e["type"] == "artifact.created"}
        self.assertEqual(created, {"GPT Image 2.5": "gpt-image-2.5", "Nano Banana Pro": "nano-banana-pro",
                                   "Seedream": "seedream-5.0-pro"})
        finished = [e["payload"] for e in events if e["type"] == "tool.finished"]
        self.assertEqual(sorted(i["model"] for i in finished[0]["result"]["images"]),
                         ["gpt-image-2.5", "nano-banana-pro", "seedream-5.0-pro"])
        # 不支持的模型整批拒绝，不会偷偷换成默认模型
        self.assertIn("midjourney", finished[1]["result"]["error"])
        self.assertEqual(len(executed), 3)

    def test_failed_image_job_is_reported_to_model(self):
        img = Path(self.tmp.name) / "out.png"
        patches, _ = self._durable_image_tools(img, fail="上游安全审核拦截")
        model = FakeModel([[("call", "generate_image", {"images": [{"prompt": "x"}]})], [("text", "没生成成功")]])
        with patches[0], patches[1], patches[2]:
            self._run(model)
        tool_msg = [m for m in model.seen[1] if m["role"] == "tool"][0]
        self.assertIn("上游安全审核拦截", tool_msg["content"])

    def test_recovered_job_is_backfilled_once(self):
        from backend.agent2 import tools as a2tools

        img = Path(self.tmp.name) / "out.png"
        img.write_bytes(b"png")
        patches, _ = self._durable_image_tools(img)
        job_store.save_ai_image_job(
            job_id="j1", user_id="u1", status="done", model="gpt-image-2.5", prompt="x", size="3:4",
            image_url="/output/out.png", request_meta={"source": "agent2", "session_id": self.session["id"],
                                                       "turn_id": "t1", "tool_call_id": "c1", "label": "首屏"})
        with patches[1]:
            asyncio.run(a2tools.backfill_recovered_job("j1"))
            asyncio.run(a2tools.backfill_recovered_job("j1"))
        events = [e for e in store.list_events(self.session["id"]) if e["type"] == "artifact.created"]
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["payload"]["call_id"], "c1")
        self.assertEqual(store.list_call_artifacts("c1")[0]["label"], "首屏")

    def _stored(self):
        return store.load_session_messages(store.get_session(self.session["id"], "u1"))

    def test_model_failure_after_tool_keeps_conversation(self):
        class FailSecond(FakeModel):
            async def stream(self, messages, tools):
                if len(self.seen) == 1:
                    self.seen.append(messages)
                    raise RuntimeError("总结超时")
                async for part in super().stream(messages, tools):
                    yield part

        model = FailSecond([[("call", "generate_image", {"images": [{"prompt": "x"}]})]])
        events = self._run(model, "画一张跑鞋")
        self.assertEqual(events[-1]["type"], "turn.failed")
        roles = [m["role"] for m in self._stored()]
        self.assertEqual(roles, ["user", "assistant", "tool"])
        self.assertIn("img_1", self._stored()[2]["content"])

    def test_cancel_during_tool_saves_settled_sequence_with_created_images(self):
        started = asyncio.Event()

        async def slow(ctx, args):
            store.create_artifact(session_id=ctx.session_id, user_id="u1", kind="image", url="/a.png",
                                  label="首屏", source_tool_call_id=ctx.call_id)
            started.set()
            await asyncio.sleep(30)

        self.tools["generate_image"] = Tool("generate_image", "gen", {"type": "object"}, slow)
        model = FakeModel([[("call", "generate_image", {"images": [{"prompt": "x"}]})]])

        async def scenario():
            with patch.object(service, "model_factory", lambda: model):
                session = store.get_session(self.session["id"], "u1")
                consumer = asyncio.create_task(_collect(service.start_turn(self.user, session, "画一张", [])))
                await asyncio.wait_for(started.wait(), 5)
                service.cancel_turn(store.list_events(self.session["id"])[0]["turn_id"])
                await asyncio.wait_for(consumer, 5)

        asyncio.run(scenario())
        stored = self._stored()
        self.assertEqual([m["role"] for m in stored], ["user", "assistant", "tool"])
        result = json.loads(stored[2]["content"])
        self.assertIn("没有完成", result["error"])
        self.assertEqual(result["images"][0]["label"], "首屏")

    def test_session_allows_one_running_turn(self):
        first = store.claim_turn(self.session["id"], "u1", "a")
        self.assertIsNotNone(first)
        self.assertIsNone(store.claim_turn(self.session["id"], "u1", "b"))
        session = store.get_session(self.session["id"], "u1")
        with self.assertRaises(service.TurnBusy):
            service.claim_turn(self.user, session, "b")
        store.update_turn(first["id"], status="done")
        self.assertIsNotNone(store.claim_turn(self.session["id"], "u1", "c"))

    def test_answer_can_only_be_claimed_once(self):
        events = self._run(FakeModel([[("call", "ask_user", {"question": "货号？"})]]), "做特殊品")
        turn_id = events[-1]["turn_id"]
        self.assertTrue(store.claim_answer(turn_id, "u1"))
        self.assertFalse(store.claim_answer(turn_id, "u1"))

    def test_new_message_while_waiting_settles_the_question(self):
        events = self._run(FakeModel([[("call", "ask_user", {"question": "货号？"})]]), "做特殊品")
        waiting = events[-1]["turn_id"]
        model = FakeModel([[("text", "好的")]])
        self._run(model, "算了，先画一张海报")
        self.assertEqual(store.get_turn(waiting, "u1")["status"], "done")
        roles = [m["role"] for m in model.seen[0]]
        self.assertEqual(roles, ["system", "user", "assistant", "tool", "user"])
        self.assertIn("没有完成", model.seen[0][3]["content"])

    def test_stale_running_turns_fail_on_startup(self):
        turn = store.claim_turn(self.session["id"], "u1", "a")
        service.fail_stale_turns()
        self.assertEqual(store.get_turn(turn["id"], "u1")["status"], "failed")
        self.assertEqual(store.list_events(self.session["id"])[-1]["type"], "turn.failed")
        self.assertIsNone(store.get_active_turn(self.session["id"]))

    def test_restart_recovery_reaches_user_and_model_without_refresh(self):
        from types import SimpleNamespace
        from backend.agent2 import routes, tools as a2tools

        img = Path(self.tmp.name) / "out.png"
        img.write_bytes(b"png")
        patches, _ = self._durable_image_tools(img)
        sid = self.session["id"]
        # 重启前：轮次运行中，生图工具已发起（消息已落库），任务还在上游执行
        turn = store.claim_turn(sid, "u1", "画一张跑鞋")
        store.save_session_messages(sid, [
            {"role": "user", "content": "画一张跑鞋"},
            {"role": "assistant", "content": None, "tool_calls": [
                {"id": "c1", "type": "function", "function": {"name": "generate_image", "arguments": "{}"}}]},
        ])
        meta = {"source": "agent2", "session_id": sid, "turn_id": turn["id"], "tool_call_id": "c1", "label": "首屏",
                "recovery": {"version": 1, "phase": "accepted", "task_id": "t1"}}
        job = dict(job_id="j1", user_id="u1", model="gpt-image-2.5", prompt="跑鞋", size="1:1", request_meta=meta)
        job_store.save_ai_image_job(status="processing", **job)

        request = SimpleNamespace(state=SimpleNamespace(user=self.user))
        service.fail_stale_turns()
        snapshot = routes.get_session(request, sid)
        # 轮次已结束，但还有后台任务：前端据 pending_jobs 继续轮询
        self.assertIsNone(snapshot["active_turn"])
        self.assertEqual(snapshot["pending_jobs"], 1)

        # 后台恢复完成 → 回填
        job_store.save_ai_image_job(status="done", image_url="/output/out.png", progress=100, **job)
        with patches[1]:
            asyncio.run(a2tools.backfill_recovered_job("j1"))
        after = routes.get_session(request, sid, after_seq=snapshot["events"][-1]["seq"])
        self.assertEqual(after["pending_jobs"], 0)
        self.assertEqual([e["type"] for e in after["events"]], ["artifact.created"])
        self.assertTrue(after["events"][0]["payload"]["recovered"])
        image_id = after["events"][0]["payload"]["artifact"]["id"]

        # 下一轮：模型能看到补回的图片 ID，悬空的工具调用也被补齐
        model = FakeModel([[("text", "看到了")]])
        self._run(model, "把刚才那张背景换成蓝色")
        sent = model.seen[0]
        self.assertIn(image_id, sent[-1]["content"])
        self.assertEqual([m["role"] for m in sent[1:]], ["user", "assistant", "tool", "user"])
        self.assertIn(image_id, sent[3]["content"])
        # 只告知一次
        model2 = FakeModel([[("text", "好")]])
        self._run(model2, "再来一张")
        self.assertNotIn("后台补回", model2.seen[0][-1]["content"])

    def _recovering_job(self):
        """服务重启后的状态：轮次已被标记失败，一条 Agent 生图任务还在后台恢复。"""
        from types import SimpleNamespace
        sid = self.session["id"]
        turn = store.claim_turn(sid, "u1", "画一张跑鞋")
        meta = {"source": "agent2", "session_id": sid, "turn_id": turn["id"], "tool_call_id": "c1", "label": "首屏",
                "recovery": {"version": 1, "phase": "accepted", "task_id": "t1"}}
        job = dict(job_id="j1", user_id="u1", model="gpt-image-2.5", prompt="跑鞋", size="1:1", request_meta=meta)
        job_store.save_ai_image_job(status="processing", **job)
        service.fail_stale_turns()
        return SimpleNamespace(state=SimpleNamespace(user=self.user)), sid, job

    def test_poll_never_reports_idle_while_image_done_but_not_delivered(self):
        from backend.agent2 import routes, tools as a2tools
        img = Path(self.tmp.name) / "out.png"
        img.write_bytes(b"png")
        patches, _ = self._durable_image_tools(img)
        request, sid, job = self._recovering_job()
        seq = routes.get_session(request, sid)["events"][-1]["seq"]

        # 任务已写成 done，回填还没执行：仍算待处理，前端不会停止轮询
        job_store.save_ai_image_job(status="done", image_url="/output/out.png", progress=100, **job)
        gap = routes.get_session(request, sid, after_seq=seq)
        self.assertEqual((gap["events"], gap["active_turn"], gap["pending_jobs"]), ([], None, 1))

        with patches[1]:
            asyncio.run(a2tools.backfill_recovered_job("j1"))
            asyncio.run(a2tools.backfill_recovered_job("j1"))  # 重复回填不重复登记
        after = routes.get_session(request, sid, after_seq=seq)
        self.assertEqual([e["type"] for e in after["events"]], ["artifact.created"])
        self.assertEqual(after["pending_jobs"], 0)

        # 很久以前完成却没登记的任务不再算待处理，避免前端一直轮询
        job_store.save_ai_image_job(status="done", image_url="/output/old.png", progress=100,
                                    **{**job, "job_id": "j-old"})
        with job_store._connect() as conn:
            conn.execute("UPDATE ai_image_jobs SET updated_at = ? WHERE id = 'j-old'",
                         (time.time() - store.UNDELIVERED_WINDOW_SECONDS - 1,))
        self.assertEqual(routes.get_session(request, sid, after_seq=seq)["pending_jobs"], 0)

    def test_poll_snapshot_is_consistent_when_backfill_lands_between_reads(self):
        import threading
        from backend.agent2 import routes, tools as a2tools
        img = Path(self.tmp.name) / "out.png"
        img.write_bytes(b"png")
        patches, _ = self._durable_image_tools(img)
        request, sid, job = self._recovering_job()
        seq = routes.get_session(request, sid)["events"][-1]["seq"]

        def finish():
            job_store.save_ai_image_job(status="done", image_url="/output/out.png", progress=100, **job)
            asyncio.run(a2tools.backfill_recovered_job("j1"))

        worker = threading.Thread(target=finish)
        real_list_events = store._list_events

        def list_events_then_finish(conn, session_id, after_seq):
            # 审核复现的交错：事件已读完，后台此刻完成并写入补图事件，之后才读活动轮次和待处理数
            rows = real_list_events(conn, session_id, after_seq)
            worker.start()
            worker.join(0.3)
            return rows

        with patches[1], patch.object(store, "_list_events", list_events_then_finish):
            first = routes.get_session(request, sid, after_seq=seq)
            worker.join(5)
        self.assertFalse(worker.is_alive())
        # 同一快照：没读到事件，就一定还报告有待处理任务，前端会继续轮询
        self.assertEqual((first["events"], first["pending_jobs"]), ([], 1))
        second = routes.get_session(request, sid, after_seq=seq)
        self.assertEqual([e["type"] for e in second["events"]], ["artifact.created"])
        self.assertEqual(second["pending_jobs"], 0)

    def test_delete_session_removes_records_for_owner_only(self):
        self._run(FakeModel([[("text", "好")]]), "你好")
        sid = self.session["id"]
        self.assertFalse(store.delete_session(sid, "someone-else"))
        self.assertTrue(store.delete_session(sid, "u1"))
        self.assertIsNone(store.get_session(sid, "u1"))
        self.assertEqual(store.list_events(sid), [])


if __name__ == "__main__":
    unittest.main()
