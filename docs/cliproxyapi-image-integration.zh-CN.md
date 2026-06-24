# CLIProxyAPI 生图接口接入文档

本文档面向需要接入当前生图服务的后端、前端、自动化脚本和第三方业务系统。接口整体按 OpenAI Images API 兼容格式调用，实际请求会经过 CLIProxyAPI 转发到后端账号池。

## 1. 接入信息

### 1.1 Base URL

生产接口地址：

```text
http://107.175.132.28:8317/v1
```

完整生图接口：

```text
POST http://107.175.132.28:8317/v1/images/generations
```

完整图片编辑接口：

```text
POST http://107.175.132.28:8317/v1/images/edits
```

### 1.2 鉴权

使用 Bearer Token：

```http
Authorization: Bearer <CPA_API_KEY>
```

`<CPA_API_KEY>` 由服务维护方分配。不要把真实 key 写进前端源码、Git 仓库、日志或公开配置文件。

### 1.3 推荐公共请求头

```http
Authorization: Bearer <CPA_API_KEY>
Accept: application/json
User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36
Accept-Language: en,zh;q=0.9,zh-CN;q=0.8
```

JSON 生图请求还需要：

```http
Content-Type: application/json
```

图片编辑请求使用 `multipart/form-data`，由 HTTP 客户端自动生成 `Content-Type` 和 boundary。

## 2. 核心模型

当前默认图像模型：

```text
gpt-image-2
```

第三方程序应显式传入：

```json
{
  "model": "gpt-image-2"
}
```

不要依赖服务端默认值。后续如果切换模型，调用方只需要改配置。

## 3. 文生图接口

### 3.1 请求

```http
POST /v1/images/generations
Content-Type: application/json
Authorization: Bearer <CPA_API_KEY>
```

### 3.2 参数

| 参数 | 类型 | 必填 | 推荐值 | 说明 |
| --- | --- | --- | --- | --- |
| `model` | string | 是 | `gpt-image-2` | 图像模型 |
| `prompt` | string | 是 | - | 生图提示词 |
| `size` | string | 是 | `1024x1024` / `2048x1152` | 输出尺寸 |
| `n` | integer | 否 | `1` | 生成数量。生产建议单请求 `n=1`，多图用应用层并发 |
| `quality` | string | 否 | `auto` | 可用 `auto`、`low`、`medium`、`high`，建议默认 `auto` |
| `output_format` | string | 否 | `png` | 可用 `png`、`jpeg`、`webp` |
| `moderation` | string | 否 | `auto` | 审核策略，建议 `auto` |
| `background` | string/null | 否 | 不传 | 透明背景等能力由模型和代理支持情况决定 |
| `output_compression` | integer | 否 | 不传 | 输出压缩，通常用于 jpeg/webp |

### 3.3 最小 curl 示例

```bash
curl -X POST 'http://107.175.132.28:8317/v1/images/generations' \
  -H 'Authorization: Bearer <CPA_API_KEY>' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json' \
  --max-time 1800 \
  -d '{
    "model": "gpt-image-2",
    "prompt": "wide establishing shot of a quiet futuristic studio, warm morning light, layered depth, realistic architecture, cinematic atmosphere",
    "size": "2048x1152",
    "n": 1,
    "quality": "auto",
    "output_format": "png",
    "moderation": "auto"
  }'
```

### 3.4 Node.js 示例

```js
import fs from "node:fs/promises";

const BASE_URL = "http://107.175.132.28:8317/v1";
const API_KEY = process.env.CPA_API_KEY;

if (!API_KEY) {
  throw new Error("CPA_API_KEY is required");
}

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 30 * 60 * 1000);

try {
  const response = await fetch(`${BASE_URL}/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
      "Accept-Language": "en,zh;q=0.9,zh-CN;q=0.8",
    },
    body: JSON.stringify({
      model: "gpt-image-2",
      prompt: "a cinematic portrait of a futuristic studio, warm morning light",
      size: "1024x1024",
      n: 1,
      quality: "auto",
      output_format: "png",
      moderation: "auto",
    }),
    signal: controller.signal,
  });

  const json = await response.json();
  if (!response.ok || json.error) {
    throw new Error(JSON.stringify(json.error || json));
  }

  const item = json.data?.[0];
  if (!item) {
    throw new Error("No image returned");
  }

  if (item.b64_json) {
    await fs.writeFile("output.png", Buffer.from(item.b64_json, "base64"));
  } else if (item.url) {
    const imageResponse = await fetch(item.url);
    if (!imageResponse.ok) {
      throw new Error(`Image download failed: ${imageResponse.status}`);
    }
    await fs.writeFile("output.png", Buffer.from(await imageResponse.arrayBuffer()));
  } else {
    throw new Error("Image response has neither b64_json nor url");
  }
} finally {
  clearTimeout(timeout);
}
```

### 3.5 Python 示例

```python
import base64
import os
import requests

BASE_URL = "http://107.175.132.28:8317/v1"
API_KEY = os.environ["CPA_API_KEY"]

payload = {
    "model": "gpt-image-2",
    "prompt": "a cinematic portrait of a futuristic studio, warm morning light",
    "size": "1024x1024",
    "n": 1,
    "quality": "auto",
    "output_format": "png",
    "moderation": "auto",
}

response = requests.post(
    f"{BASE_URL}/images/generations",
    headers={
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
        "Accept-Language": "en,zh;q=0.9,zh-CN;q=0.8",
    },
    json=payload,
    timeout=1800,
)

data = response.json()
if not response.ok or "error" in data:
    raise RuntimeError(data.get("error", data))

item = data["data"][0]
if "b64_json" in item:
    image_bytes = base64.b64decode(item["b64_json"])
elif "url" in item:
    image_bytes = requests.get(item["url"], timeout=300).content
else:
    raise RuntimeError("Image response has neither b64_json nor url")

with open("output.png", "wb") as f:
    f.write(image_bytes)
```

## 4. 图生图 / 图片编辑接口

带参考图、改图、局部编辑时，使用：

```text
POST /v1/images/edits
```

请求体必须是 `multipart/form-data`。

### 4.1 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `model` | string | 是 | `gpt-image-2` |
| `prompt` | string | 是 | 编辑要求 |
| `image` | file | 是 | 参考图或待编辑图。多个参考图时重复传 `image` 字段 |
| `mask` | file | 否 | 蒙版图，局部编辑时使用 |
| `size` | string | 否 | 输出尺寸 |
| `n` | integer | 否 | 推荐 `1` |
| `quality` | string | 否 | 推荐 `auto` |
| `output_format` | string | 否 | 推荐 `png` |
| `moderation` | string | 否 | 推荐 `auto` |

### 4.2 curl 示例

```bash
curl -X POST 'http://107.175.132.28:8317/v1/images/edits' \
  -H 'Authorization: Bearer <CPA_API_KEY>' \
  -H 'Accept: application/json' \
  --max-time 1800 \
  -F 'model=gpt-image-2' \
  -F 'prompt=把人物头发改成红色，保持脸部身份和姿势不变' \
  -F 'size=1024x1536' \
  -F 'n=1' \
  -F 'quality=auto' \
  -F 'output_format=png' \
  -F 'moderation=auto' \
  -F 'image=@/absolute/path/reference.png'
```

### 4.3 Node.js 示例

```js
import fs from "node:fs";

const BASE_URL = "http://107.175.132.28:8317/v1";
const API_KEY = process.env.CPA_API_KEY;

const form = new FormData();
form.append("model", "gpt-image-2");
form.append("prompt", "把人物头发改成红色，保持脸部身份和姿势不变");
form.append("size", "1024x1536");
form.append("n", "1");
form.append("quality", "auto");
form.append("output_format", "png");
form.append("moderation", "auto");
form.append("image", new Blob([fs.readFileSync("/absolute/path/reference.png")], { type: "image/png" }), "reference.png");

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 30 * 60 * 1000);

try {
  const response = await fetch(`${BASE_URL}/images/edits`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      Accept: "application/json",
    },
    body: form,
    signal: controller.signal,
  });

  const json = await response.json();
  if (!response.ok || json.error) {
    throw new Error(JSON.stringify(json.error || json));
  }
  console.log(json);
} finally {
  clearTimeout(timeout);
}
```

## 5. 尺寸规范

当前 WebUI 对 `gpt-image-2` 使用以下尺寸预设。第三方调用可以直接传 `size`。

### 5.1 标准尺寸

| 比例 | size |
| --- | --- |
| 1:1 | `1024x1024` |
| 4:5 | `1024x1280` |
| 5:4 | `1280x1024` |
| 3:4 | `1152x1536` |
| 4:3 | `1536x1152` |
| 2:3 | `1024x1536` |
| 3:2 | `1536x1024` |
| 9:16 | `864x1536` |
| 16:9 | `1536x864` |
| 9:21 | `672x1568` |
| 21:9 | `1568x672` |

### 5.2 2K 尺寸

| 比例 | size |
| --- | --- |
| 1:1 | `2048x2048` |
| 4:5 | `1600x2000` |
| 5:4 | `2000x1600` |
| 3:4 | `1536x2048` |
| 4:3 | `2048x1536` |
| 2:3 | `1344x2016` |
| 3:2 | `2016x1344` |
| 9:16 | `1152x2048` |
| 16:9 | `2048x1152` |
| 9:21 | `1152x2688` |
| 21:9 | `2688x1152` |

### 5.3 4K 尺寸

| 比例 | size |
| --- | --- |
| 1:1 | `2880x2880` |
| 4:5 | `2560x3200` |
| 5:4 | `3200x2560` |
| 3:4 | `2448x3264` |
| 4:3 | `3264x2448` |
| 2:3 | `2336x3504` |
| 3:2 | `3504x2336` |
| 9:16 | `2160x3840` |
| 16:9 | `3840x2160` |
| 9:21 | `1632x3808` |
| 21:9 | `3808x1632` |

### 5.4 自定义尺寸建议

如果业务方自行传自定义 `size`，建议遵守：

- 像素总数不低于 `655360`
- 像素总数不高于 `8294400`
- 长边与短边比例不超过 `3:1`
- 生产环境优先使用上面的预设尺寸，减少模型拒绝或代理兼容问题

## 6. 返回格式

成功响应通常是 OpenAI Images 风格：

```json
{
  "created": 1710000000,
  "data": [
    {
      "b64_json": "<base64 image>",
      "revised_prompt": "...",
      "size": "1024x1024",
      "quality": "high",
      "output_format": "png"
    }
  ],
  "usage": {
    "input_tokens": 100,
    "output_tokens": 1000,
    "total_tokens": 1100
  }
}
```

也可能返回 URL：

```json
{
  "data": [
    {
      "url": "https://..."
    }
  ]
}
```

调用方必须同时支持两种情况：

1. `data[i].b64_json`：直接 base64 解码保存。
2. `data[i].url`：再次 GET 下载图片。

不要假设一定返回 base64，也不要假设一定返回 URL。

## 7. 并发与超时

### 7.1 推荐策略

生产推荐：

- 单请求 `n=1`
- 应用层并发控制在 `1-4`
- 客户端总超时设置为 `1800s`
- 下载图片 URL 的超时设置为 `300s`
- 失败后按任务粒度重试，不要盲目无限重试

原因：

1. 2K/4K 图片耗时可能超过 60 秒，甚至接近或超过 10 分钟。
2. CLIProxyAPI 后台可能最终返回 `200`，但如果调用方客户端提前超时，业务侧仍然拿不到图片。
3. 多图请求使用 `n>1` 时，一个慢图可能拖住整个请求。应用层用多个 `n=1` 请求更容易做重试、进度显示和部分成功保存。

### 7.2 重要超时经验

不要使用 60 秒超时。之前已经观察到接近 60 秒的请求容易被客户端或中间层误判取消。

不要使用 600 秒作为硬超时上限。2K/4K 并发时出现过 CLIProxyAPI 后台最终为 `200`，但 WebUI 本地 600 秒超时导致未接收保存的情况。

建议：

```text
connect timeout: 30s
read/request timeout: 1800s
```

如果框架不区分 connect/read timeout，就直接把请求总超时设为 1800 秒。

### 7.3 是否使用 stream

不要给 `/v1/images/generations` 或 `/v1/images/edits` 加 `stream: true`。

当前接入路径按非流式 OpenAI Images 兼容响应处理。此前测试 `stream: true` 可能出现代理层显示成功但业务侧拿不到标准图片数据的情况。

## 8. 错误处理

### 8.1 标准错误体

错误通常类似：

```json
{
  "error": {
    "message": "context canceled",
    "type": "server_error",
    "code": "internal_server_error"
  }
}
```

调用方应读取：

- HTTP status
- `error.message`
- `error.type`
- `error.code`
- 请求耗时
- 请求参数摘要

### 8.2 常见错误和处理建议

| 情况 | 可能原因 | 建议 |
| --- | --- | --- |
| HTTP 401/403 | key 不正确、账号不可用、鉴权失败 | 检查 Bearer Token，不要重试太多次 |
| HTTP 500 + `context canceled` | 客户端/代理/上游链路取消，或超时断开 | 使用 1800s 超时，降低并发后重试 |
| 客户端超时但 CLIProxyAPI 后台 200 | 调用方先放弃等待，代理后来成功 | 提高客户端超时；业务侧以本地是否拿到图片为准 |
| HTTP 200 但 `data` 为空 | 代理兼容异常或非标准响应 | 按失败处理，记录完整响应体 |
| 图片 URL 下载 401/403 | 图片 URL 需要鉴权或过期 | 下载时带 Authorization 重试一次 |
| 单批多图部分失败 | 某个槽位超时或上游失败 | 推荐应用层拆成多个 `n=1` 请求 |

### 8.3 成功判定

业务侧不要只看 CLIProxyAPI 后台状态码，也不要只看 HTTP 200。真正成功必须满足：

1. HTTP status 是 2xx。
2. 响应体没有 `error`。
3. `data` 是非空数组。
4. 每个目标图片都有 `b64_json` 或可下载的 `url`。
5. 图片内容已经成功保存到本地或对象存储。

如果第 5 步没完成，在业务上就不算成功。

## 9. 重试策略

推荐重试：

- 只对网络错误、超时、HTTP 5xx、`context canceled` 做有限重试。
- 401/403 不建议自动重试，除非已确认是临时账号切换。
- 内容审核或参数错误不应自动重试同一请求。

建议参数：

```text
max_attempts: 2-3
initial_backoff: 5s
max_backoff: 60s
jitter: 20%-40%
```

多图任务建议每张图独立请求，失败只重试失败的那一张。

## 10. 生产接入建议

### 10.1 服务端转发，不要浏览器直连

不建议 Web 前端直接调用 CLIProxyAPI，因为会暴露 API Key。推荐结构：

```text
Browser/App -> Your Backend -> CLIProxyAPI -> Upstream image model
```

你的后端负责：

- 保存 API Key
- 参数校验
- 超时和重试
- 并发限制
- 图片落盘或上传对象存储
- 任务状态查询
- 审计日志

### 10.2 日志字段

每次请求建议记录：

```text
request_id
user_id / tenant_id
endpoint
model
size
n
quality
output_format
prompt_hash
prompt_length
started_at
finished_at
duration_ms
http_status
error_code
error_message
output_count
saved_file_urls
```

不要把完整 prompt 和 API Key 默认打到普通日志。完整 prompt 可进加密审计日志或仅在调试开关打开时记录。

### 10.3 图片保存

推荐保存：

```text
/{yyyy-mm-dd}/{request_id}-{index}.png
```

保存成功后再把任务标成 completed。不要在 HTTP 200 后立即标 completed。

## 11. 接入验收用例

### 11.1 1K 方图

```json
{
  "model": "gpt-image-2",
  "prompt": "a quiet futuristic studio, warm morning light, realistic architecture",
  "size": "1024x1024",
  "n": 1,
  "quality": "auto",
  "output_format": "png"
}
```

预期：180 秒内大概率完成。

### 11.2 2K 横图

```json
{
  "model": "gpt-image-2",
  "prompt": "wide establishing shot of a quiet futuristic studio, warm morning light, layered depth, realistic architecture, cinematic atmosphere",
  "size": "2048x1152",
  "n": 1,
  "quality": "auto",
  "output_format": "png"
}
```

预期：可能超过 60 秒，客户端不得提前断开。

### 11.3 4K 竖图

```json
{
  "model": "gpt-image-2",
  "prompt": "high fashion editorial portrait, cinematic soft light, detailed fabric, luxury magazine style",
  "size": "2160x3840",
  "n": 1,
  "quality": "auto",
  "output_format": "png"
}
```

预期：耗时显著更长，应使用 1800 秒请求超时。

### 11.4 图片编辑

使用 `/v1/images/edits`，上传一张 PNG 或 JPEG：

```bash
curl -X POST 'http://107.175.132.28:8317/v1/images/edits' \
  -H 'Authorization: Bearer <CPA_API_KEY>' \
  --max-time 1800 \
  -F 'model=gpt-image-2' \
  -F 'prompt=保持人物身份不变，将头发改成红色' \
  -F 'size=1024x1536' \
  -F 'n=1' \
  -F 'output_format=png' \
  -F 'image=@reference.png'
```

预期：返回 `data[0].b64_json` 或 `data[0].url`。

## 12. 最小接入检查清单

上线前确认：

- [ ] Base URL 是 `http://107.175.132.28:8317/v1`
- [ ] 所有请求都带 `Authorization: Bearer <CPA_API_KEY>`
- [ ] 文生图使用 `/images/generations`
- [ ] 图生图/编辑使用 `/images/edits`
- [ ] 客户端超时不低于 `1800s`
- [ ] 单请求推荐 `n=1`
- [ ] 应用层并发不超过 `4`
- [ ] 支持 `b64_json` 和 `url` 两种返回
- [ ] 图片保存成功后才标记任务成功
- [ ] HTTP 200 但无图片数据时按失败处理
- [ ] 日志不泄露 API Key

## 13. 推荐默认配置

```json
{
  "base_url": "http://107.175.132.28:8317/v1",
  "model": "gpt-image-2",
  "quality": "auto",
  "output_format": "png",
  "moderation": "auto",
  "n": 1,
  "request_timeout_seconds": 1800,
  "image_download_timeout_seconds": 300,
  "max_concurrency": 4,
  "max_attempts": 2
}
```

这套配置是目前最稳的生产默认值。
