# Sub2API 图像生成 API 接入文档

本文档基于当前部署和实测结果整理，用于把 Sub2API 接入第三方 chatbot、工作流系统或自定义后端。

## 1. Base URL

### 本机局域网地址

如果 chatbot 和这台 Mac 在同一个局域网内，可以使用：

```text
http://192.168.151.34:8080
```

健康检查：

```bash
curl http://192.168.151.34:8080/health
```

成功返回：

```json
{"status":"ok"}
```


## 2. 认证方式

所有 API 请求都需要带上 API Key。

请求头：

```http
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json
```

示例：

```bash
-H "Authorization: Bearer sk-xxxx"
```

不要把 API Key 写死在前端代码里。从.env里读取

## 3. 推荐调用端点

实测最稳定的图像生成方式是：

```text
POST /responses
```

完整 URL 示例：

```text
http://192.168.151.34:8080/responses
```

注意：这里是 `/responses`，不是 `/v1/responses`。

## 4. 重要模型说明

请求里会出现两个模型字段：

```json
"model": "gpt-5.4-mini"
```

以及：

```json
"tools": [
  {
    "type": "image_generation",
    "model": "gpt-image-2"
  }
]
```

这不是写错。

实测 Sub2API 后台会把主模型显示成：

```text
gpt-5.4-mini
```

但真正执行生图的是工具模型：

```text
gpt-image-2
```

所以接入时应保持这个结构。

## 5. 文生图请求示例

### curl 示例

```bash
curl -N http://192.168.151.34:8080/responses \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{
    "stream": true,
    "model": "gpt-5.4-mini",
    "store": false,
    "tool_choice": {
      "type": "image_generation"
    },
    "input": [
      {
        "role": "user",
        "content": [
          {
            "type": "input_text",
            "text": "A cute orange cat astronaut sticker, centered composition, chibi style, big sparkling eyes, tiny paws, wearing a white space helmet, pastel background, no text."
          }
        ]
      }
    ],
    "tools": [
      {
        "type": "image_generation",
        "action": "generate",
        "model": "gpt-image-2",
        "size": "1024x1024",
        "quality": "medium",
        "output_format": "png"
      }
    ]
  }'
```

## 6. 图生图请求示例

如果需要传入参考图，可以在 `input` 里加入 `input_image`。

```bash
curl -N http://192.168.151.34:8080/responses \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{
    "stream": true,
    "model": "gpt-5.4-mini",
    "store": false,
    "tool_choice": {
      "type": "image_generation"
    },
    "input": [
      {
        "role": "user",
        "content": [
          {
            "type": "input_text",
            "text": "参考这张图，生成一张高清写实运动场景图，保持鞋子细节，5:4 构图。"
          },
          {
            "type": "input_image",
            "image_url": "https://example.com/reference.jpg"
          }
        ]
      }
    ],
    "tools": [
      {
        "type": "image_generation",
        "action": "edit",
        "model": "gpt-image-2",
        "size": "5:4",
        "quality": "medium",
        "output_format": "png"
      }
    ]
  }'
```

## 7. size 参数

实测可用的比例参数：

```text
1:1
3:4
4:3
5:4
4:5
16:9
9:16
```

也可以传具体尺寸：

```text
1024x1024
1536x1024
1024x1536
2048x2048
2048x1152
2000x1600
```

但是注意：实测 `2K` 或 `2048x2048` 不一定真的返回 2048 尺寸。

当前实测结果：

| 请求 size | 实际输出 |
|---|---|
| `1:1` | `1254x1254` |
| `3:4` | `1086x1448` |
| `4:3` | `1448x1086` |
| `5:4` | `1402x1122` |
| `16:9` | `1672x941` |
| `2048x2048` | 不稳定，常见不是 2048 |

结论：

如果你只需要控制画面比例，用 `1:1`、`3:4`、`5:4` 这类比例值更合适。不要依赖它返回严格的 2K 像素尺寸。

## 8. quality 参数

可传：

```text
low
medium
high
```

示例：

```json
"quality": "medium"
```

实测发现：即使请求 `medium`，返回 metadata 里有时会显示 `high`；这更像是上游模型或 Sub2API 对 quality 做了自动调整。建议默认使用：

```json
"quality": "medium"
```

## 9. 返回格式说明

`/responses` 是流式 SSE 返回，不是普通 JSON 一次性返回。

请求头建议带：

```http
Accept: text/event-stream
```

返回中需要监听事件，最终图片通常会出现在 image generation 工具结果里。

实际响应中会包含类似信息：

```json
{
  "size": "1254x1254",
  "quality": "medium",
  "output_format": "png",
  "background": "opaque"
}
```

不同客户端需要根据 SSE 事件逐步解析。

## 10. Node.js 调用示例

```js
const BASE_URL = "http://192.168.151.34:8080";
const API_KEY = process.env.SUB2API_KEY;

async function generateImage(prompt) {
  const res = await fetch(`${BASE_URL}/responses`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      "Accept": "text/event-stream"
    },
    body: JSON.stringify({
      stream: true,
      model: "gpt-5.4-mini",
      store: false,
      tool_choice: {
        type: "image_generation"
      },
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: prompt
            }
          ]
        }
      ],
      tools: [
        {
          type: "image_generation",
          action: "generate",
          model: "gpt-image-2",
          size: "1:1",
          quality: "medium",
          output_format: "png"
        }
      ]
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sub2API error ${res.status}: ${text}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let fullText = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    fullText += chunk;
    console.log(chunk);
  }

  return fullText;
}

generateImage("A cute orange cat astronaut sticker, chibi style, pastel background, no text.")
  .then(console.log)
  .catch(console.error);
```

## 11. Python 调用示例

```python
import os
import requests

BASE_URL = "http://192.168.151.34:8080"
API_KEY = os.environ["SUB2API_KEY"]

payload = {
    "stream": True,
    "model": "gpt-5.4-mini",
    "store": False,
    "tool_choice": {
        "type": "image_generation"
    },
    "input": [
        {
            "role": "user",
            "content": [
                {
                    "type": "input_text",
                    "text": "A cute orange cat astronaut sticker, chibi style, pastel background, no text."
                }
            ]
        }
    ],
    "tools": [
        {
            "type": "image_generation",
            "action": "generate",
            "model": "gpt-image-2",
            "size": "1:1",
            "quality": "medium",
            "output_format": "png"
        }
    ]
}

with requests.post(
    f"{BASE_URL}/responses",
    headers={
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
    },
    json=payload,
    stream=True,
    timeout=600,
) as response:
    response.raise_for_status()

    for line in response.iter_lines(decode_unicode=True):
        if line:
            print(line)
```

## 12. 并发能力

当前实测：

### 本机部署

10 并发成功：

```text
10/10 success
```

耗时大约：

```text
25s - 85s
```


## 13. 常见错误

### 1. 没有可用账号

```json
{
  "error": {
    "message": "No available accounts"
  }
}
```

原因通常是后台 OpenAI OAuth 账号没有绑定到当前分组，或者账号不可调度。

### 2. 当前分组未开启生图

```json
{
  "error": {
    "message": "Image generation is not enabled for this group"
  }
}
```

需要在后台分组里开启 image generation。

### 3. Images API 不支持

```json
{
  "error": {
    "message": "Images API is not supported for this platform"
  }
}
```

建议不要优先用 `/v1/images/generations`，改用 `/responses` + `image_generation` tool。

### 4. 并发超限

```json
{
  "error": {
    "message": "Concurrency limit exceeded for user"
  }
}
```

需要调高用户并发、账号并发，或者在客户端做队列。

## 14. 推荐接入配置

给 chatbot 使用时，建议配置如下：

```json
{
  "base_url": "http://192.168.151.34:8080",
  "endpoint": "/responses",
  "api_key": "YOUR_API_KEY",
  "main_model": "gpt-5.4-mini",
  "image_model": "gpt-image-2",
  "stream": true,
  "size": "1:1",
  "quality": "medium",
  "output_format": "png",
  "timeout_seconds": 600
}
```

如果部署在公网服务器：

```json
{
  "base_url": "http://43.162.82.100:8080",
  "endpoint": "/responses"
}
```

## 15. 最小可用请求体

```json
{
  "stream": true,
  "model": "gpt-5.4-mini",
  "store": false,
  "tool_choice": {
    "type": "image_generation"
  },
  "input": [
    {
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": "A cute orange cat astronaut sticker, chibi style, pastel background, no text."
        }
      ]
    }
  ],
  "tools": [
    {
      "type": "image_generation",
      "action": "generate",
      "model": "gpt-image-2",
      "size": "1:1",
      "quality": "medium",
      "output_format": "png"
    }
  ]
}
```

## 16. 结论

当前最推荐的接入方式是：

```text
POST /responses
```

主模型：

```text
gpt-5.4-mini
```

生图工具模型：

```text
gpt-image-2
```

推荐默认参数：

```json
{
  "size": "1:1",
  "quality": "medium",
  "output_format": "png"
}
```

不要强依赖 2K 精确尺寸。

如果需要控制构图，优先使用比例参数，例如 `1:1`、`3:4`、`5:4`。
