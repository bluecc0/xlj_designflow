"""Submission contracts: image pixels and aesthetic scores are not acceptance criteria."""
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from backend.agent2 import tools


class SubmissionContractTest(unittest.IsolatedAsyncioTestCase):
    async def submit(self, text, args, uploads=(), used=0):
        ctx = SimpleNamespace(user={'id': 'u'}, session_id='s', turn_id='t', state={'request': text})
        ctx.state['images'] = used
        events = [{'turn_id': 't', 'type': 'turn.started', 'payload': {
            'text': text, 'uploads': [{'id': rid, 'kind': 'upload'} for rid in uploads]}}]
        calls = []

        async def capture(ctx, index, item, **kwargs):
            calls.append({'item': item, **kwargs})
            return {'id': 'out_' + str(index), 'index': index}

        with patch.object(tools.store, 'list_events', return_value=events), \
             patch.object(tools.store, 'turn_characters', return_value=[]), \
             patch.object(tools.store, 'get_artifact', return_value=None), \
             patch.object(tools, '_artifact_bytes', side_effect=lambda ctx, rid: (rid.encode(), rid)), \
             patch.object(tools, 'check_reference_roles', AsyncMock(return_value=None)), \
             patch.object(tools, '_generate_one', side_effect=capture):
            result = await tools.generate_image(ctx, args)
        return result, calls

    async def test_valid_models_parameters_and_counts_reach_submission(self):
        for model, resolution, ratio, count in [
            ('gpt-image-2.6', '1K', '3:4', 4), ('gpt-image-2.5', '2K', '4:3', 2),
            ('nano-banana-pro', '4K', '1:1', 1), ('seedream-5-5', '1.5K', '2:1', 3),
        ]:
            with self.subTest(model=model):
                prompt = '保留黑色外套，红门背景，不要文字'
                result, calls = await self.submit('生成商品照片', {'model': model,
                    'resolution': resolution, 'aspect_ratio': ratio, 'images': [{'prompt': prompt}] * count})
                self.assertNotIn('error', result)
                self.assertEqual(len(calls), count)
                for call in calls:
                    self.assertEqual((call['model'], call['resolution'], call['size']), (model, resolution, ratio))
                    self.assertEqual(call['item']['prompt'], prompt)

    async def test_each_image_has_all_user_inputs_and_exactly_its_action(self):
        refs = ['person', 'scene', 'vest', 'shirt', 'pants', 'shoes']
        images = [{'prompt': '参考图1人物，参考图2场景，参考图7仅动作，不取背景',
                   'reference_image_ids': refs + ['action_' + code],
                   'reference_roles': dict(zip(refs + ['action_' + code],
                       ['身份', '场景', '马甲', '卫衣', '裤子', '鞋子', '仅动作，不取背景']))}
                  for code in ['0125', '0059', '0057', '0400']]
        result, calls = await self.submit('图片1人物，图片2场景，图片3马甲，图片4卫衣，图片5裤子，图片6鞋子',
            {'model': 'gpt-image-2.6', 'resolution': '1K', 'aspect_ratio': '3:4', 'images': images}, refs)
        self.assertNotIn('error', result)
        self.assertEqual(len(calls), 4)
        for call, code in zip(calls, ['0125', '0059', '0057', '0400']):
            self.assertEqual(call['item']['reference_image_ids'], refs + ['action_' + code])

    async def test_explicit_user_resolution_must_not_silently_change(self):
        result, calls = await self.submit('生成1张商品图，4K', {
            'resolution': '1K', 'images': [{'prompt': '商品图'}]})
        self.assertIn('error', result)
        self.assertEqual(calls, [])

    async def test_explicit_user_ratio_must_not_silently_change(self):
        result, calls = await self.submit('生成1张商品图，比例3:4', {
            'aspect_ratio': '1:1', 'images': [{'prompt': '商品图'}]})
        self.assertIn('error', result)
        self.assertEqual(calls, [])

    async def test_excess_images_must_not_be_paid_before_quantity_check(self):
        result, calls = await self.submit('生成2张商品图', {
            'images': [{'prompt': '商品图'}] * 4})
        self.assertIn('error', result)
        self.assertEqual(calls, [])

    async def test_partial_batches_stay_within_requested_total(self):
        result, calls = await self.submit('生成4张商品图', {
            'images': [{'prompt': '商品图'}] * 2}, used=2)
        self.assertNotIn('error', result)
        self.assertEqual(len(calls), 2)
        result, calls = await self.submit('生成4张商品图', {
            'images': [{'prompt': '商品图'}]}, used=4)
        self.assertIn('error', result)
        self.assertEqual(calls, [])

    async def test_resolution_comparison_does_not_force_one_global_value(self):
        result, calls = await self.submit('1K和4K各做一张', {
            'resolution': '4K', 'images': [{'prompt': '商品图'}]})
        self.assertNotIn('error', result)
        self.assertEqual(calls[0]['resolution'], '4K')
