import asyncio
import json
import unittest
from unittest.mock import AsyncMock, patch

from backend.agent2 import engine, skill_policy


class SkillPolicyTests(unittest.TestCase):
    def setUp(self):
        self.memories = [{'content': '除非我明确指定，否则不要默认使用 skill。'}]
        self.patcher = patch.object(skill_policy.memory, 'list_memories', side_effect=lambda uid: self.memories if uid == 'u1' else [])
        self.patcher.start()
        self.addCleanup(self.patcher.stop)

    def test_matching_request_not_authorization(self):
        self.assertFalse(skill_policy.skill_allowed('u1', '做一组童装摄影', 'kids-lookbook'))

    def test_explicit_name_authorizes_only_that_skill(self):
        self.assertTrue(skill_policy.skill_allowed('u1', '使用kids-lookbook技能出图', 'kids-lookbook'))
        self.assertFalse(skill_policy.skill_allowed('u1', '使用kids-lookbook技能出图', 'text-art-design'))

    def test_menu_and_current_prohibition(self):
        self.assertTrue(skill_policy.skill_allowed('u1', '生成海报', 'kids-lookbook', 'kids-lookbook'))
        self.assertFalse(skill_policy.skill_allowed('u1', '不要用技能，生成海报', 'kids-lookbook', 'kids-lookbook'))

    def test_no_preference_preserves_existing_behavior(self):
        self.assertTrue(skill_policy.skill_allowed('u2', '做童装摄影', 'kids-lookbook'))

    def test_deleted_memory_takes_effect(self):
        self.memories.clear()
        self.assertTrue(skill_policy.skill_allowed('u1', '做童装摄影', 'kids-lookbook'))

    def test_plain_prohibition(self):
        self.memories[:] = [{'content': '不要使用技能'}]
        self.assertFalse(skill_policy.skill_allowed('u1', '做海报', 'text-art-design'))

    def test_current_default_prohibition_without_memory(self):
        self.assertFalse(skill_policy.skill_allowed('u2', '不要默认使用skill，做海报', 'text-art-design'))

    def test_guard_blocks_all_skill_handlers(self):
        for name in skill_policy.SKILL_TOOLS:
            handler = AsyncMock(return_value={})
            tool = engine.Tool(name, '', {}, handler)
            raw = asyncio.run(engine._run_tool(tool, name,
                {'id': 'c', 'arguments': json.dumps({'name': 'kids-lookbook'})},
                {'user': {'id': 'u1'}, 'session_id': 's', 'turn_id': 't', 'state': {'request': '做童装摄影'}}, AsyncMock()))
            self.assertEqual(json.loads(raw)['code'], 'skill_not_authorized')
            handler.assert_not_awaited()

    def test_guard_allows_explicit_request(self):
        handler = AsyncMock(return_value={'ok': True})
        tool = engine.Tool('load_skill', '', {}, handler)
        asyncio.run(engine._run_tool(tool, 'load_skill', {'id': 'c', 'arguments': '{"name":"kids-lookbook"}'},
            {'user': {'id': 'u1'}, 'session_id': 's', 'turn_id': 't', 'state': {'request': '使用kids-lookbook技能'}}, AsyncMock()))
        handler.assert_awaited_once()
