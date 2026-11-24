import unittest
from backend.agent2.image_constraints import bind_upload_numbers, reference_order_error
from backend.agent2.service import upload_note
from backend.agent2.prompts import SYSTEM_PROMPT


class AuditRegressions(unittest.TestCase):
    def setUp(self):
        self.inputs = [{'uploads': [{'id': 'pose', 'kind': 'upload'}, {'id': 'person', 'kind': 'upload'}]}]

    def test_all_chinese_number_aliases_reject_reordering(self):
        for prompt in ['以@图片2为底图，参考@图片1', '图2为基础，图1是动作', '参考图2是人物']:
            self.assertTrue(reference_order_error(self.inputs, ['person', 'pose'], prompt))

    def test_fixed_order_keeps_meaning(self):
        self.assertEqual(bind_upload_numbers('以@图片2为底图，参考@图片1', ['pose', 'person'], self.inputs),
                         '以参考图2为底图，参考参考图1')

    def test_followup_inserted_result_renumbers_original_uploads(self):
        self.assertEqual(bind_upload_numbers('使用@图片2服装和@图片1姿势', ['old', 'pose', 'person'], self.inputs),
                         '使用参考图3服装和参考图2姿势')

    def test_missing_alias_cannot_silently_point_elsewhere(self):
        with self.assertRaises(ValueError): bind_upload_numbers('使用@图片2', ['pose'], self.inputs)

    def test_unlabelled_prompt_unchanged(self):
        self.assertEqual(bind_upload_numbers('红色海报', [], self.inputs), '红色海报')

    def test_fixed_numbers_are_visible_to_model(self):
        note = upload_note([{'kind': 'upload', 'id': 'a'}, {'kind': 'upload', 'id': 'b'}])
        self.assertIn('图片1=a', note)
        self.assertIn('图片2=b', note)
        self.assertIn('不需要通过看图确认', note)

    def test_prompt_covers_audited_failures(self):
        for word in ['支撑物', '接触关系', '踩滑板', '2:5', '优先9:16', '未实际对照']:
            self.assertIn(word, SYSTEM_PROMPT)
