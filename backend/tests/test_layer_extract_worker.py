from __future__ import annotations

import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image
from psd_tools import PSDImage

from backend import layer_extract_worker as worker


def png_bytes(size: tuple[int, int], color) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGBA", size, color).save(buffer, format="PNG")
    return buffer.getvalue()


class LayerExtractWorkerTest(unittest.TestCase):
    def run_worker(self, layers: list[dict]) -> tuple[int, dict, dict, list]:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "input.png"
            source.write_bytes(png_bytes((16, 12), "white"))
            output = root / "job"
            remote = {
                "provider": "apimart", "model": "seedream-5-5", "task_id": "task-1",
                "result_layers": layers,
            }
            with (
                patch("sys.argv", ["worker", "--src", str(source), "--out-dir", str(output), "--user-id", "test"]),
                patch.object(worker, "_run_remote_decomposition", return_value=remote) as decompose,
                patch.object(worker, "_emit") as emit,
            ):
                code = worker.main()
            decompose.assert_awaited_once()
            payload = emit.call_args.args[0]
            manifest = {}
            exported = []
            if code == 0:
                manifest = json.loads(Path(payload["manifest_path"]).read_text(encoding="utf-8"))
                psd = PSDImage.open(payload["psd_path"])
                self.assertEqual(psd.size, (16, 12))
                # RGB PSD stores PNG alpha as a layer mask; composite applies that mask.
                exported = [{"bbox": layer.bbox, "image": layer.composite()} for layer in psd]
                self.assertEqual(manifest["layerExtraction"]["prompt"], worker.LAYER_DECOMPOSITION_PROMPT)
            return code, payload, manifest, exported

    @staticmethod
    def foreground(index: int = 1) -> dict:
        return {
            "name": f"element-{index}", "z_index": index,
            "bounding_box": {"absolute": [3, 2, 8, 6]},
            "bytes": png_bytes((5, 4), (255, 0, 0, 255)),
        }

    def test_one_or_two_elements_without_background_export_at_original_positions(self):
        for count in (1, 2):
            with self.subTest(count=count):
                code, payload, manifest, exported = self.run_worker([self.foreground(i) for i in range(1, count + 1)])
                self.assertEqual(code, 0)
                self.assertEqual(payload["background_status"], "not-returned")
                self.assertNotIn("completedPath", manifest["background"])
                self.assertEqual(len(manifest["layers"]), count)
                self.assertEqual([layer["bbox"] for layer in exported], [(3, 2, 8, 6)] * count)

    def test_single_full_canvas_transparent_element_keeps_alpha(self):
        image = Image.new("RGBA", (16, 12), (0, 0, 0, 0))
        image.paste((255, 0, 0, 255), (3, 2, 8, 6))
        raw = io.BytesIO()
        image.save(raw, format="PNG")
        code, _, manifest, exported = self.run_worker([{"z_index": 0, "bytes": raw.getvalue()}])
        self.assertEqual(code, 0)
        self.assertEqual(manifest["background"]["status"], "not-returned")
        self.assertEqual(len(exported), 1)
        self.assertEqual(exported[0]["bbox"], (3, 2, 8, 6))

    def test_full_canvas_semitransparent_layer_is_not_flattened_into_source(self):
        code, _, manifest, exported = self.run_worker([
            {"z_index": 0, "bytes": png_bytes((16, 12), (255, 0, 0, 128))}
        ])
        self.assertEqual(code, 0)
        self.assertEqual(manifest["background"]["status"], "not-returned")
        self.assertEqual(exported[0]["image"].getchannel("A").getextrema(), (128, 128))

    def test_background_and_subject_still_export_in_order(self):
        background = {"name": "background", "z_index": 0, "bytes": png_bytes((16, 12), "white")}
        code, payload, _, exported = self.run_worker([background, self.foreground()])
        self.assertEqual(code, 0)
        self.assertEqual(payload["background_status"], "ready")
        self.assertEqual([layer["bbox"] for layer in exported], [(0, 0, 16, 12), (3, 2, 8, 6)])

    def test_55_independently_sized_layer_uses_base_coordinates_and_keeps_ocr(self):
        code, _, manifest, exported = self.run_worker([
            {"z_index": 0, "bytes": png_bytes((32, 24), "white")},
            {"z_index": 1, "bytes": png_bytes((40, 32), "red"),
             "bounding_box": {"absolute": [6, 4, 16, 12]}, "text_recognition": {"text": "Sale"}},
        ])
        self.assertEqual(code, 0)
        self.assertEqual(exported[1]["bbox"], (3, 2, 8, 6))
        self.assertEqual(manifest["layers"][1]["text_recognition"], {"text": "Sale"})

    def test_all_returned_layers_are_kept_including_last_subject(self):
        for include_background in (False, True):
            with self.subTest(include_background=include_background):
                layers = [self.foreground(i) for i in range(1, 10)]
                if include_background:
                    layers.insert(0, {"name": "background", "z_index": 0, "bytes": png_bytes((16, 12), "white")})
                code, _, manifest, exported = self.run_worker(layers)
                self.assertEqual(code, 0)
                self.assertEqual(len(manifest["layers"]), len(layers))
                self.assertEqual(len(exported), len(layers))

    def test_empty_result_is_a_failure_and_does_not_resubmit(self):
        code, payload, _, exported = self.run_worker([])
        self.assertNotEqual(code, 0)
        self.assertFalse(payload["ok"])
        self.assertEqual(payload["task_id"], "task-1")
        self.assertEqual(exported, [])


if __name__ == "__main__":
    unittest.main()
