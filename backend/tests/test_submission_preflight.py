import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock
from backend.agent2.submission_preflight import check_submission
from backend.agent2.image_constraints import explicit_output_parameters


class SubmissionPreflightTest(unittest.IsolatedAsyncioTestCase):
    async def check(self, result, ctx=None, items=None):
        complete = AsyncMock(return_value=SimpleNamespace(json=lambda: {
            'choices': [{'message': {'content': json.dumps(result)}}]}))
        ctx = ctx or SimpleNamespace(state={'skill_ref_attempted': True, 'request': '完整动作，红门场景'})
        outcome = await check_submission(ctx, items or [{'prompt': '动作', 'reference_image_ids': ['action']}], [],
            read_image=lambda ctx, rid: (b'image', rid), encode_image=lambda data, size: 'image', complete=complete)
        return outcome, complete, ctx

    async def test_explicit_submission_conflict_blocks(self):
        result, _, _ = await self.check({'conflicts': [{'index': 0, 'reason': '未授权禁止帽子，改变原动作接触'}]})
        self.assertIn('尚未付费', result['error'])

    async def test_good_submission_passes(self):
        result, _, _ = await self.check({'conflicts': []})
        self.assertIsNone(result)

    async def test_invalid_verdict_fails_closed(self):
        for verdict in [{'conflicts': 'none'}, {'conflicts': [{'index': 9, 'reason': 'bad'}]}, {}]:
            result, _, _ = await self.check(verdict)
            self.assertIn('有效结果', result['error'])

    async def test_corrected_prompt_is_rechecked(self):
        _, _, ctx = await self.check({'conflicts': [{'index': 0, 'reason': '木凳无依据'}]})
        result, complete, _ = await self.check({'conflicts': []}, ctx,
            [{'prompt': '去掉擅加木凳，原场景不变', 'reference_image_ids': ['action']}])
        self.assertIsNone(result)
        complete.assert_awaited_once()

    async def test_normal_requests_do_not_gain_a_new_vlm_call(self):
        _, complete, _ = await self.check({}, SimpleNamespace(state={}))
        complete.assert_not_called()

    def test_unambiguous_parameters_and_latest_user_override(self):
        self.assertEqual(explicit_output_parameters([{'text': '分辨率4K，比例3：4'}]),
            {'resolution': '4K', 'aspect_ratio': '3:4'})
        self.assertEqual(explicit_output_parameters([{'text': '4K'}, {'answer': '改成2K'}])['resolution'], '2K')
        self.assertIsNone(explicit_output_parameters([{'text': '1K和4K各做一张'}])['resolution'])
        self.assertNotIn('resolution', explicit_output_parameters([{'text': '不要4K'}]))
        self.assertNotIn('aspect_ratio', explicit_output_parameters([{'text': '10:30前制作商品图'}]))
