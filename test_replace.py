"""
测试：替换 penpot 模板中的图片和文字，导出 PNG
"""
import sys, io, re, json, requests, os

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

# ─── 配置 ────────────────────────────────────────────────
BASE       = "http://localhost:9001"
EMAIL      = "fir_xc@163.com"
PASSWORD   = "xc8087.com"
FILE_ID    = "d984a0f4-116a-805b-8007-df5d48103c43"
PAGE_ID    = "d984a0f4-116a-805b-8007-df5d48103c44"

# 从上一步已知的图层 ID
FRAME_ID   = "f8ef14ce-741e-80d3-8007-df5d52c53807"  # Board
TEXT_ID    = "f8ef14ce-741e-80d3-8007-df5d58e1b233"  # slot/product_1/name
IMAGE_ID   = "f8ef14ce-741e-80d3-8007-df5d782bcf27"  # slot/product_1/image

# 要写入的内容
NEW_TEXT   = "李宁跑步鞋 X-Flow | ¥399"
IMAGE_FILE = "./product-library/test_product.png"

# ─── Transit 工具 ────────────────────────────────────────
_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")

class Keyword:
    def __init__(self, n): self.name = n

def kw(n): return Keyword(n)

def to_transit(data):
    if isinstance(data, Keyword): return f"~:{data.name}"
    if isinstance(data, dict):
        r = ["^ "]
        for k, v in data.items():
            r.append(f"~:{k}" if isinstance(k, str) else k)
            r.append(to_transit(v))
        return r
    if isinstance(data, list): return [to_transit(i) for i in data]
    if isinstance(data, str) and _UUID_RE.match(data): return f"~u{data}"
    return data

# ─── API 封装 ────────────────────────────────────────────
session = requests.Session()
access_token = None
profile_id = None

def login():
    global access_token, profile_id
    r = session.post(f"{BASE}/api/rpc/command/login-with-password",
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        json={"email": EMAIL, "password": PASSWORD})
    r.raise_for_status()
    data = r.json()
    profile_id = data["id"]
    access_token = session.cookies.get("auth-token")
    print(f"  ✓ 登录成功: {data['fullname']} (id: {profile_id[:8]}...)")
    print(f"  session token: {access_token[:30]}...")

def api(cmd, params=None, files=None, transit=False):
    headers = {"Authorization": f"Token {access_token}", "Accept": "application/json"}
    if files:
        r = session.post(f"{BASE}/api/rpc/command/{cmd}", headers=headers,
                         data=params or {}, files=files)
    elif transit:
        headers["Content-Type"] = "application/transit+json"
        body = json.dumps(to_transit(params or {}))
        r = session.post(f"{BASE}/api/rpc/command/{cmd}", headers=headers, data=body)
    else:
        headers["Content-Type"] = "application/json"
        r = session.post(f"{BASE}/api/rpc/command/{cmd}", headers=headers,
                         json=params or {})
    if not r.ok:
        print(f"  [错误] {cmd} HTTP {r.status_code}: {r.text[:200]}")
        return None
    data = r.json()
    return data

def sep(title):
    print(f"\n{'='*52}\n  {title}\n{'='*52}")

# ─── 步骤1：登录 ──────────────────────────────────────────
sep("步骤1：登录获取 session")
login()

# ─── 步骤2：上传产品图片 ──────────────────────────────────
sep("步骤2：上传产品图片")

if not os.path.exists(IMAGE_FILE):
    print(f"  ✗ 图片不存在: {IMAGE_FILE}")
    sys.exit(1)

with open(IMAGE_FILE, "rb") as f:
    img_bytes = f.read()

img_name = os.path.splitext(os.path.basename(IMAGE_FILE))[0]
result = api("upload-file-media-object",
    params={"file-id": FILE_ID, "is-local": "true", "name": img_name},
    files={"content": (os.path.basename(IMAGE_FILE), img_bytes, "image/png")})

# 解析 Transit 响应
if isinstance(result, list) and result[0] == "^ ":
    items = result[1:]
    result = {items[i].lstrip("~:"): items[i+1] for i in range(0, len(items)-1, 2)}

media_id   = result.get("id", result.get("~:id", "")).lstrip("~u")
img_width  = result.get("width", 800)
img_height = result.get("height", 800)

print(f"  ✓ 图片上传成功")
print(f"  media_id: {media_id}")
print(f"  尺寸: {img_width} x {img_height}")

# ─── 步骤3：获取文件版本号 ────────────────────────────────
sep("步骤3：获取文件当前版本")
file_data = api("get-file", {"id": FILE_ID})
revn = file_data.get("revn", 0)
vern = file_data.get("vern", 0)
print(f"  revn={revn}, vern={vern}")

# ─── 步骤4：写入文字 + 替换图片 ──────────────────────────
sep("步骤4：写入内容到图层")

import uuid as _uuid

changes = [
    # 修改文字内容
    {
        "type": "mod-obj",
        "id": TEXT_ID,
        "page-id": PAGE_ID,
        "operations": [{
            "type": "set",
            "attr": "content",
            "val": {
                "type": "root",
                "children": [{
                    "type": "paragraph-set",
                    "children": [{
                        "type": "paragraph",
                        "children": [{"text": NEW_TEXT}]
                    }]
                }]
            }
        }]
    },
    # 替换图片：设置 fills[0].fill-image
    {
        "type": "mod-obj",
        "id": IMAGE_ID,
        "page-id": PAGE_ID,
        "operations": [{
            "type": "set",
            "attr": "fills",
            "val": [{
                "fill-image": {
                    "id": media_id,
                    "width": img_width,
                    "height": img_height,
                    "mtype": "image/png",
                    "name": img_name,
                    "keep-aspect-ratio": False
                }
            }]
        }]
    }
]

# 用 Transit 发送，让 UUID 和 keyword 被正确识别
transit_changes = [
    {
        "type": kw("mod-obj"),
        "id": TEXT_ID,
        "page-id": PAGE_ID,
        "operations": [{
            "type": kw("set"),
            "attr": kw("content"),
            "val": {
                "type": "root",
                "children": [{
                    "type": "paragraph-set",
                    "children": [{
                        "type": "paragraph",
                        "children": [{"text": NEW_TEXT}]
                    }]
                }]
            }
        }]
    },
    {
        "type": kw("mod-obj"),
        "id": IMAGE_ID,
        "page-id": PAGE_ID,
        "operations": [{
            "type": kw("set"),
            "attr": kw("fills"),
            "val": [{
                "fill-image": {
                    "id": media_id,
                    "width": img_width,
                    "height": img_height,
                    "mtype": "image/png",
                    "name": img_name,
                    "keep-aspect-ratio": False
                }
            }]
        }]
    }
]

result = api("update-file", {
    "id": FILE_ID,
    "revn": revn,
    "vern": vern,
    "changes": transit_changes,
    "session-id": str(_uuid.uuid4())
}, transit=True)

if result is not None:
    print(f"  ✓ 文字写入: 「{NEW_TEXT}」")
    print(f"  ✓ 图片替换: media_id={media_id[:8]}...")
else:
    print("  ✗ 写入失败")
    sys.exit(1)

# ─── 步骤5：导出 PNG ──────────────────────────────────────
sep("步骤5：导出 PNG")

import time
time.sleep(1)  # 等待变更生效

payload = {
    "cmd": kw("export-shapes"),
    "exports": [{
        "page-id": PAGE_ID,
        "file-id": FILE_ID,
        "object-id": FRAME_ID,
        "type": kw("png"),
        "suffix": "",
        "scale": 2.0,
        "name": "Board"
    }],
    "profile-id": profile_id,
    "wait": True
}

body = json.dumps(to_transit(payload))
r = session.post(f"{BASE}/api/export",
    headers={"Content-Type": "application/transit+json"},
    data=body, timeout=90)

if not r.ok:
    print(f"  ✗ 导出请求失败 HTTP {r.status_code}: {r.text[:300]}")
    sys.exit(1)

print(f"  原始响应: {r.text[:200]}")
export_data = r.json()
# 解析返回的存储 URI（Transit map 格式 {"~:key": val}）
if isinstance(export_data, dict):
    # 已经是 JSON 对象，key 可能带 ~: 前缀
    export_data = {k.lstrip("~:"): v for k, v in export_data.items()}

uri_raw = export_data.get("uri", "")
# Transit uri 格式: {"~#uri": "http://..."}
if isinstance(uri_raw, dict):
    uri = uri_raw.get("~#uri", "")
else:
    uri = str(uri_raw)
print(f"  解析到 URI: {uri}")

print(f"  图片 URI: {uri}")

# 下载图片
img_r = session.get(uri)
if img_r.ok and len(img_r.content) > 500:
    os.makedirs("./output", exist_ok=True)
    out = "./output/result.png"
    with open(out, "wb") as f:
        f.write(img_r.content)
    print(f"  ✓ 导出成功: {out} ({len(img_r.content)//1024} KB)")
else:
    print(f"  ✗ 下载失败: {img_r.status_code}")
    sys.exit(1)

sep("完成")
print(f"  文字: 「{NEW_TEXT}」")
print(f"  图片: {img_name}")
print(f"  输出: ./output/result.png")
