import unittest
from unittest.mock import Mock, patch

from backend.penpot_browser_refresh import wait_for_text_layout


class LayoutReadyTest(unittest.TestCase):
    def doc(self, text="new", rendered="new", x=10):
        return {"data": {"pagesIndex": {"p": {"objects": {"t": {
            "x": x, "content": {"children": [{"text": text}]},
            "positionData": [{"text": rendered, "x": x}],
        }}}}}}

    @patch("backend.penpot_browser_refresh.time.sleep")
    def test_waits_for_matching_persisted_layout(self, sleep):
        client = Mock()
        client.get_file.side_effect = [self.doc(rendered="old"), self.doc(x=1)] + [self.doc()] * 4
        self.assertTrue(wait_for_text_layout(client, "f", "p", ["t"]))
        self.assertEqual(client.get_file.call_count, 6)

    @patch("backend.penpot_browser_refresh.time.sleep")
    @patch("backend.penpot_browser_refresh.time.monotonic", side_effect=[0, 0, 2])
    def test_stale_layout_is_not_success(self, clock, sleep):
        client = Mock()
        client.get_file.return_value = self.doc(rendered="old")
        self.assertFalse(wait_for_text_layout(client, "f", "p", ["t"], timeout=1))

    def test_no_text_needs_no_poll(self):
        client = Mock()
        self.assertTrue(wait_for_text_layout(client, "f", "p", []))
        client.get_file.assert_not_called()
