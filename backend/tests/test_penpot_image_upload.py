import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from backend.penpot_client import PenpotClient


class ImageUploadTest(unittest.TestCase):
    def test_actual_format_controls_upload(self):
        client = PenpotClient('http://unused', '')
        for actual, extension, mode in [('WEBP', '.jpg', 'RGBA'), ('WEBP', '.webp', 'RGB'),
                                         ('PNG', '.jpg', 'RGBA'), ('JPEG', '.png', 'RGB')]:
            with self.subTest(actual=actual, extension=extension), tempfile.TemporaryDirectory() as tmp:
                path = Path(tmp) / ('asset' + extension)
                Image.new(mode, (16, 12)).save(path, format=actual)
                original = path.read_bytes()
                with patch.object(client, '_rpc', return_value={'id': 'test', 'width': 16, 'height': 12}) as rpc:
                    result = client.upload_image('file', str(path))
                name, data, mime = rpc.call_args.kwargs['files']['content']
                expected = 'JPEG' if actual == 'JPEG' else 'PNG'
                with Image.open(io.BytesIO(data)) as image:
                    self.assertEqual(image.format, expected)
                    self.assertEqual(image.size, (16, 12))
                    if mode == 'RGBA':
                        self.assertEqual(image.getpixel((0, 0))[3], 0)
                self.assertEqual(mime, 'image/jpeg' if expected == 'JPEG' else 'image/png')
                self.assertEqual(result['mtype'], mime)
                self.assertTrue(name.endswith('.jpg' if expected == 'JPEG' else '.png'))
                self.assertEqual(path.read_bytes(), original)

    def test_invalid_image_is_not_uploaded(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'broken.jpg'
            path.write_bytes(b'not an image')
            client = PenpotClient('http://unused', '')
            with patch.object(client, '_rpc') as rpc:
                with self.assertRaisesRegex(ValueError, '素材图片无法读取'):
                    client.upload_image('file', str(path))
                rpc.assert_not_called()
