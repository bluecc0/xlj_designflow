import json
import tempfile
import unittest
from pathlib import Path

from PIL import Image
from psd_tools import PSDImage

from backend.layer_psd import export_psd


class LayerPsdExportTest(unittest.TestCase):
    def test_exports_background_and_positioned_kie_layer(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            Image.new("RGB", (16, 12), (240, 240, 240)).save(root / "background.png")
            Image.new("RGBA", (5, 4), (255, 0, 0, 255)).save(root / "foreground.png")
            manifest = {
                "jobId": "psd-test",
                "source": {"width": 16, "height": 12},
                "background": {"completedPath": "background.png"},
                "layers": [
                    {
                        "index": 0,
                        "name": "背景",
                        "kind": "kie-background",
                        "path": "background.png",
                        "is_background": True,
                    },
                    {
                        "index": 1,
                        "name": "主图",
                        "kind": "kie-layer",
                        "path": "foreground.png",
                        "x": 3,
                        "y": 2,
                        "width": 5,
                        "height": 4,
                    }
                ],
            }
            manifest_path = root / "manifest.json"
            manifest_path.write_text(
                json.dumps(manifest, ensure_ascii=False),
                encoding="utf-8",
            )

            psd_path = export_psd(manifest_path)
            psd = PSDImage.open(psd_path)

            self.assertEqual(psd.size, (16, 12))
            self.assertEqual(len(psd), 2)
            self.assertEqual(psd[0].bbox, (0, 0, 16, 12))
            self.assertEqual(psd[1].bbox, (3, 2, 8, 6))
            # PSD's legacy Pascal layer name field cannot safely encode Chinese.
            self.assertEqual(psd[1].name, "01 kie-layer")


if __name__ == "__main__":
    unittest.main()
