import io
import json
import unittest

import httpx
from PIL import Image

from backend import ai_image


class ReferenceUploadUrlTest(unittest.IsolatedAsyncioTestCase):
    async def test_safe_upload_name_and_encoded_generation_url(self):
        image = io.BytesIO()
        Image.new("RGB", (8, 8), "white").save(image, format="PNG")
        cases = [
            ("https://cdn.test/a b.png", "https://cdn.test/a%20b.png"),
            ("https://cdn.test/\u767d.png", "https://cdn.test/%E7%99%BD.png"),
            ("https://cdn.test/a%20b.png?sig=x%2Fy%3D&expires=123",
             "https://cdn.test/a%20b.png?sig=x%2Fy%3D&expires=123"),
        ]
        for returned, expected in cases:
            with self.subTest(url=returned):
                requests = []

                def respond(request):
                    requests.append(request)
                    if request.url.path == "/v1/uploads/images":
                        return httpx.Response(200, json={"url": returned})
                    return httpx.Response(200, json={"data": [{"task_id": "task-test"}]})

                async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
                    headers = {"Authorization": "Bearer test"}
                    url = await ai_image._upload_reference_image(
                        client, "https://api.test", headers, image.getvalue(), "product (white).png")
                    task_id = await ai_image._submit_generation_task(
                        client, base_url="https://api.test", headers=headers,
                        model="gemini-3-pro-image-preview", prompt="test", size="3:4", reference_urls=[url])
                self.assertEqual(url, expected)
                self.assertEqual(task_id, "task-test")
                self.assertEqual(json.loads(requests[1].content)["image_urls"], [expected])
                self.assertIn(b'filename="reference_', requests[0].content)
                self.assertNotIn(b'filename="product (white).png"', requests[0].content)
                self.assertIn(image.getvalue(), requests[0].content)
