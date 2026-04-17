"""
penpot API 最小可行性验证脚本
验证：认证 → 读文件结构 → 上传图片 → 修改图层 → 导出PNG
"""

import requests
import json
import os
import sys
import uuid
import re

# ─── Transit+JSON 简单编码器 ──────────────────────────────
_UUID_RE = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')

class Keyword:
    """Transit keyword，编码为 ~:name"""
    def __init__(self, name):
        self.name = name

def kw(name):
    return Keyword(name)

def to_transit(data):
    """将 Python 数据编码为 Transit+JSON 格式"""
    if isinstance(data, Keyword):
        return f"~:{data.name}"
    elif isinstance(data, dict):
        result = ["^ "]
        for k, v in data.items():
            result.append(f"~:{k}" if isinstance(k, str) else k)
            result.append(to_transit(v))
        return result
    elif isinstance(data, list):
        return [to_transit(item) for item in data]
    elif isinstance(data, str) and _UUID_RE.match(data):
        return f"~u{data}"  # UUID 编码
    else:
        return data

# Windows 控制台编码修复
if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

# ─── 配置 ───────────────────────────────────────────────
PENPOT_BASE = "http://localhost:9001"
ACCESS_TOKEN = "eyJhbGciOiJBMjU2S1ciLCJlbmMiOiJBMjU2R0NNIn0.AZxM9dn70wpaq9eD5JCzwypG9bbBYPpW1J4au9_dL5-DbXJnPnS9HQ.QEk1vlMrTajk9SJD.594JKc-Nb0xJOjyRnWaI5OFaSsDmfvPQUM-YgjxOscr_G1Psf9eHbUZocwOCtSs64ikmLGOMQpdPH4EK-FR2i_yUeS3mqMPeRBtespUEWa0byTByoxczQ3TGRlM3R7Kf4TRjZSGxQFRTYm9j3TBkxKdakkDo5J3s9Snh1oprmkzwKi6VnAp2BTEt5sepRi_u3rHKCey93ynF.rfXZUKrG5U_LFiDKKlAs1g"
FILE_ID = "d984a0f4-116a-805b-8007-df5d48103c43"

HEADERS = {
    "Authorization": f"Token {ACCESS_TOKEN}",
    "Content-Type": "application/json",
    "Accept": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Origin": PENPOT_BASE,
    "Referer": f"{PENPOT_BASE}/",
}

API = f"{PENPOT_BASE}/api/rpc/command"

# ─── 工具函数 ────────────────────────────────────────────

def parse_transit(data):
    """
    简单解析 penpot 返回的 Transit+JSON 格式
    Transit map 格式: ["^ ", key1, val1, key2, val2, ...]
    Transit UUID:  "~uXXXX"  → 取后面的字符串
    Transit keyword: "~:foo" → "foo"
    """
    if not isinstance(data, list) or not data or data[0] != "^ ":
        return data
    result = {}
    items = data[1:]
    for i in range(0, len(items) - 1, 2):
        k = items[i]
        v = items[i + 1]
        # 清理 key
        if isinstance(k, str) and k.startswith("~:"):
            k = k[2:]
        # 清理 value
        if isinstance(v, str):
            if v.startswith("~u"):  # UUID
                v = v[2:]
            elif v.startswith("~:"):  # keyword
                v = v[2:]
            elif v.startswith("~m"):  # timestamp
                v = int(v[2:])
        result[k] = v
    return result


def rpc(command, params=None, files=None):
    """调用 penpot RPC 接口"""
    url = f"{API}/{command}"
    if files:
        # 文件上传用 multipart，加上 Accept 头让服务端返回 JSON
        headers = {
            "Authorization": f"Token {ACCESS_TOKEN}",
            "Accept": "application/json",
        }
        resp = requests.post(url, headers=headers, data=params or {}, files=files)
    else:
        resp = requests.post(url, headers=HEADERS, json=params or {})

    if resp.status_code != 200:
        print(f"  [错误] {command} → HTTP {resp.status_code}")
        print(f"  响应: {resp.text[:300]}")
        return None

    # 尝试解析 JSON（可能是普通 JSON 或 Transit+JSON）
    try:
        data = resp.json()
        if isinstance(data, list) and data and data[0] == "^ ":
            return parse_transit(data)
        return data
    except Exception:
        return resp.content  # 二进制内容（如导出图片）


def sep(title):
    print(f"\n{'='*50}")
    print(f"  {title}")
    print('='*50)

# ─── 步骤1：认证验证 ──────────────────────────────────────

def step1_auth():
    sep("步骤1：验证认证")
    result = rpc("get-profile")
    if result:
        print(f"  ✓ 认证成功")
        print(f"  用户: {result.get('fullname', result.get('email', '未知'))}")
        print(f"  ID:   {result.get('id')}")
        return True
    else:
        print("  ✗ 认证失败，检查 ACCESS_TOKEN 是否正确")
        return False

# ─── 步骤2：读取文件结构 ──────────────────────────────────

def step2_read_file():
    sep("步骤2：读取文件结构")
    if not FILE_ID:
        print("  ⚠ 未设置 FILE_ID，跳过此步骤")
        print("  → 请在 penpot 中打开一个文件，URL 中的 file-id 参数就是 FILE_ID")
        return None

    result = rpc("get-file", {"id": FILE_ID})
    if not result:
        return None

    print(f"  ✓ 文件读取成功: {result.get('name', '未知')}")

    # 找出所有 slot/ 开头的图层
    data = result.get("data", {})
    # 兼容 pagesIndex 和 pages-index 两种 key
    pages = data.get("pagesIndex") or data.get("pages-index", {})
    slots = []

    for page_id, page in pages.items():
        objects = page.get("objects", {})
        for obj_id, obj in objects.items():
            name = obj.get("name", "")
            # 兼容 "slot/..." 和 "slot / ..." 两种写法
            normalized = name.replace(" ", "")
            if normalized.startswith("slot/"):
                slots.append({
                    "id": obj_id,
                    "name": name,
                    "type": obj.get("type"),
                    "page_id": page_id,
                })

    if slots:
        print(f"\n  找到 {len(slots)} 个 slot 图层:")
        for s in slots:
            print(f"    [{s['type']:10}] {s['name']}  (id: {s['id'][:8]}...)")
    else:
        print("\n  ⚠ 未找到 slot/ 图层，请在 penpot 中按命名规范创建图层")
        print("  → 图层命名示例: slot/product_1/name, slot/product_1/image")

    return result, slots

# ─── 步骤3：上传测试图片 ──────────────────────────────────

def step3_upload_image():
    sep("步骤3：上传测试图片")
    if not FILE_ID:
        print("  ⚠ 未设置 FILE_ID，跳过")
        return None

    # 找本地测试图片
    test_img = "./product-library/test_product.png"
    if not os.path.exists(test_img):
        print(f"  ⚠ 测试图片不存在: {test_img}")
        print("  → 请在 product-library/ 目录放一张 test_product.png")
        return None

    with open(test_img, "rb") as f:
        img_data = f.read()

    result = rpc(
        "upload-file-media-object",
        params={"file-id": FILE_ID, "is-local": "true", "name": "test_product"},
        files={"content": ("test_product.png", img_data, "image/png")}
    )

    # 返回值可能是 dict 或 list
    if isinstance(result, list):
        result = result[0] if result else None
    if result and isinstance(result, dict) and result.get("id"):
        print(f"  ✓ 图片上传成功")
        print(f"  媒体 ID: {result['id']}")
        return result["id"]
    else:
        print("  ✗ 图片上传失败")
        print(f"  响应: {result}")
        return None

# ─── 步骤4：修改文字图层 ──────────────────────────────────

def step4_update_text(slots, file_data):
    sep("步骤4：修改文字图层内容")
    if not slots:
        print("  ⚠ 无可用 slot，跳过")
        return False

    # 找第一个文字类型的 slot
    text_slot = next((s for s in slots if s["type"] == "text"), None)
    if not text_slot:
        print("  ⚠ 未找到文字类型的 slot 图层")
        return False

    print(f"  目标图层: {text_slot['name']} (id: {text_slot['id'][:8]}...)")

    # 构造修改操作
    # penpot 文字修改需要设置 content 结构
    change = {
        "type": "mod-obj",
        "id": text_slot["id"],
        "page-id": text_slot["page_id"],
        "operations": [
            {
                "type": "set",
                "attr": "content",
                "val": {
                    "type": "root",
                    "children": [{
                        "type": "paragraph-set",
                        "children": [{
                            "type": "paragraph",
                            "children": [{
                                "text": "测试写入文字 ✓"
                            }]
                        }]
                    }]
                }
            }
        ]
    }

    result = rpc("update-file", {
        "id": FILE_ID,
        "revn": file_data.get("revn", 0),
        "vern": file_data.get("vern", 0),
        "changes": [change],
        "session-id": str(uuid.uuid4())
    })

    if result is not None:
        print(f"  ✓ 文字修改成功")
        return True
    else:
        print(f"  ✗ 文字修改失败")
        return False

# ─── 步骤5：导出 PNG ──────────────────────────────────────

def step5_export_png(slots, file_data):
    sep("步骤5：导出 PNG")
    if not FILE_ID:
        print("  ⚠ 未设置 FILE_ID，跳过")
        return

    # 找第一个 frame（整体画板）
    data = file_data.get("data", {})
    pages = data.get("pagesIndex") or data.get("pages-index", {})
    frame_id = None
    page_id = None

    for pg_id, page in pages.items():
        objects = page.get("objects", {})
        for obj_id, obj in objects.items():
            if obj.get("type") == "frame" and obj.get("name") not in ("Root Frame", "Component"):
                frame_id = obj_id
                page_id = pg_id
                print(f"  目标画板: {obj.get('name')} (id: {obj_id[:8]}...)")
                break
        if frame_id:
            break

    if not frame_id:
        print("  ⚠ 未找到画板(frame)")
        return

    # 导出：通过 /api/export 走 exporter 服务
    export_url = f"{PENPOT_BASE}/api/export"
    # 获取 profile-id
    profile = rpc("get-profile") or {}
    profile_id = profile.get("id", "")

    export_payload = {
        "exports": [{
            "page-id": page_id,
            "file-id": FILE_ID,
            "object-id": frame_id,
            "type": kw("png"),
            "suffix": "",
            "scale": 2.0,
            "name": "Board"
        }],
        "profile-id": profile_id,
        "wait": True
    }
    headers = {
        "Authorization": f"Token {ACCESS_TOKEN}",
        "Content-Type": "application/transit+json",
        "Accept": "application/transit+json",
    }
    # exporter 只接受 Transit+JSON 格式
    transit_body = json.dumps(to_transit(export_payload))
    resp = requests.post(export_url, headers=headers, data=transit_body, timeout=60)
    print(f"  导出响应状态: {resp.status_code}")
    print(f"  Content-Type: {resp.headers.get('content-type','')}")

    if resp.status_code == 200 and resp.content and len(resp.content) > 1000:
        os.makedirs("./output", exist_ok=True)
        out_path = "./output/poc_export.png"
        with open(out_path, "wb") as f:
            f.write(resp.content)
        print(f"  ✓ 导出成功: {out_path} ({len(resp.content)//1024} KB)")
    else:
        print(f"  ✗ 导出失败")
        print(f"  响应内容: {resp.text[:300]}")

# ─── 主流程 ──────────────────────────────────────────────

def main():
    if not ACCESS_TOKEN:
        print("❌ 请先设置 ACCESS_TOKEN")
        sys.exit(1)

    print("\npenpot API 可行性验证")
    print(f"目标: {PENPOT_BASE}")

    # 步骤1：认证
    if not step1_auth():
        sys.exit(1)

    # 步骤2：读文件
    file_result = step2_read_file()
    file_data, slots = file_result if file_result else (None, [])

    # 步骤3：上传图片
    media_id = step3_upload_image()

    # 步骤4：修改文字
    if file_data:
        step4_update_text(slots, file_data)

    # 步骤5：导出 PNG
    if file_data:
        step5_export_png(slots, file_data)

    sep("验证完成")
    print("  根据以上结果判断各环节可行性")

if __name__ == "__main__":
    main()
