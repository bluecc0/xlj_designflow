import copy
import unittest

from backend.penpot_client import PenpotClient, kw, to_transit


class TextAlignmentTest(unittest.TestCase):
    def setUp(self):
        self.client = PenpotClient('http://unused', '')

    def changes(self, **kwargs):
        return self.client.set_text_content(
            'layer', 'page', '11/07 new text', 0, 200, 0, 0, 160,
            grow_type='fixed', vertical_align='center', **kwargs,
        )[0]['operations']

    def test_template_alignment_is_string_and_source_is_unchanged(self):
        for value in ('center', 'left', 'right', '~:center', kw('center')):
            with self.subTest(value=value):
                source = {'type': 'root', 'children': [{'type': 'paragraph-set', 'children': [{
                    'type': 'paragraph', 'textAlign': value, 'textDirection': '~:ltr',
                    'children': [{'text': 'old', 'textAlign': 'left', 'fontSize': '18'}, {'text': 'extra'}],
                }]}]}
                before = to_transit(copy.deepcopy(source))
                operations = self.changes(raw_content=source)
                paragraph = operations[0]['val']['children'][0]['children'][0]
                expected = value if isinstance(value, str) and not value.startswith('~:') else 'center'
                self.assertEqual(paragraph['text-align'], expected)
                self.assertEqual(paragraph['text-direction'], 'ltr')
                self.assertEqual(paragraph['children'][0]['text-align'], expected)
                self.assertEqual(paragraph['children'][0]['font-size'], '18')
                self.assertEqual(len(paragraph['children']), 1)
                self.assertEqual(to_transit(source), before)
                self.assertIsNone(operations[1]['val'])
                self.assertEqual(to_transit(operations[2]['val']), '~:fixed')
                self.assertEqual(to_transit(operations[3]['val']), '~:center')

    def test_fallback_content_uses_string_enums(self):
        paragraph = self.changes(text_align='center')[0]['val']['children'][0]['children'][0]
        for node in (paragraph, paragraph['children'][0]):
            self.assertEqual(to_transit(node['text-align']), 'center')
            self.assertEqual(to_transit(node['text-direction']), 'ltr')


if __name__ == '__main__':
    unittest.main()
