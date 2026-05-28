"""
Penpot API 客户端

封装所有与 penpot 本地实例的交互：
- Transit+JSON 编解码
- 认证（access token + session cookie）
- 文件结构读取
- 图片上传
- 图层写入
- PNG 导出
"""
from __future__ import annotations

import json
import re
import uuid
from typing import Any, Optional
from uuid import UUID

import requests


# ─── Transit+JSON 编解码 ──────────────────────────────────────────────────────

_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
)


class Keyword:
    """Transit keyword，序列化为 ~:name"""

    def __init__(self, name: str) -> None:
        self.name = name

    def __repr__(self) -> str:
        return f"kw({self.name!r})"


def kw(name: str) -> Keyword:
    return Keyword(name)


def to_transit(data: Any) -> Any:
    """将 Python 数据结构编码为 Transit+JSON（list 表示的 map）"""
    if isinstance(data, Keyword):
        return f"~:{data.name}"
    if isinstance(data, UUID):
        return f"~u{data}"
    if isinstance(data, dict):
        result: list[Any] = ["^ "]
        for k, v in data.items():
            if isinstance(k, str):
                result.append(f"~:{k}")
            elif isinstance(k, Keyword):
                result.append(f"~:{k.name}")
            else:
                result.append(k)
            result.append(to_transit(v))
        return result
    if isinstance(data, list):
        return [to_transit(item) for item in data]
    if isinstance(data, str) and _UUID_RE.match(data):
        return f"~u{data}"
    return data


def from_transit(data: Any) -> Any:
    """将 Transit+JSON 解码回普通 Python 结构"""
    if isinstance(data, list):
        if data and data[0] == "^ ":
            result: dict[str, Any] = {}
            items = data[1:]
            for i in range(0, len(items) - 1, 2):
                k = items[i]
                v = items[i + 1]
                if isinstance(k, str) and k.startswith("~:"):
                    k = k[2:]
                result[k] = from_transit(v)
            return result
        return [from_transit(item) for item in data]
    if isinstance(data, str):
        if data.startswith("~u"):
            return data[2:]  # UUID string
        if data.startswith("~:"):
            return data[2:]  # keyword string
        if data.startswith("~m"):
            return int(data[2:])  # timestamp
    if isinstance(data, dict):
        return {k: from_transit(v) for k, v in data.items()}
    return data


# ─── Penpot 客户端 ────────────────────────────────────────────────────────────


class PenpotClient:
    """
    Penpot 本地实例 API 客户端。

    认证策略：
    - 普通 RPC 调用：Authorization: Token <access_token>
    - 导出接口：auth-token cookie（通过 login() 获取）
    """

    def __init__(self, base_url: str, access_token: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.access_token = access_token
        self._session = requests.Session()
        self._session.trust_env = False  # ignore system proxy; Penpot is always local
        self._profile_id: Optional[str] = None
        # 保存登录凭据以便 token 过期时自动刷新
        self._email: Optional[str] = None
        self._password: Optional[str] = None

    # ── 认证 ──────────────────────────────────────────────────────────────────

    def login(self, email: str, password: str) -> str:
        """
        用账号密码登录，获取 session cookie（导出时需要）。
        同时保存凭据，以便 token 过期后自动刷新。
        返回 profile_id。
        """
        self._email = email
        self._password = password
        resp = self._session.post(
            f"{self.base_url}/api/rpc/command/login-with-password",
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            json={"email": email, "password": password},
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
        self._profile_id = data["id"]
        # auth-token cookie 由 session 自动保存
        return self._profile_id

    @property
    def profile_id(self) -> str:
        if self._profile_id is None:
            raise RuntimeError("需要先调用 login() 获取 profile_id")
        return self._profile_id

    # ── 内部 HTTP 工具 ────────────────────────────────────────────────────────

    def _rpc(
        self,
        command: str,
        params: Optional[dict] = None,
        files: Optional[dict] = None,
        transit: bool = False,
        _retry: bool = True,
    ) -> Any:
        """
        调用 penpot RPC 接口。
        - files: multipart 上传
        - transit: 用 Transit+JSON 编码 body
        - 遇到 401 时自动用邮密重新登录并重试一次（需先调用过 login()）
        """
        url = f"{self.base_url}/api/rpc/command/{command}"
        headers: dict[str, str] = {
            "Authorization": f"Token {self.access_token}",
            "Accept": "application/json",
        }

        if files:
            resp = self._session.post(
                url, headers=headers, data=params or {}, files=files, timeout=60
            )
        elif transit:
            headers["Content-Type"] = "application/transit+json"
            encoded = to_transit(params or {})
            body = json.dumps(encoded)
            if command == "update-file":
                with open("backend/debug_transit.txt", "a", encoding="utf-8") as _f:
                    _f.write("\n--- CALL ---\n" + body[:3000])
            resp = self._session.post(url, headers=headers, data=body, timeout=60)
        else:
            headers["Content-Type"] = "application/json"
            resp = self._session.post(url, headers=headers, json=params or {}, timeout=60)

        # ── Token 过期自动刷新 ───────────────────────────────────────────────
        if resp.status_code == 401 and _retry and self._email and self._password:
            self._refresh_token()
            return self._rpc(command, params, files, transit, _retry=False)

        if resp.status_code == 401 and _retry and self._email and self._password:
            self._refresh_token()
            return self.export_frame(
                file_id=file_id,
                page_id=page_id,
                frame_id=frame_id,
                scale=scale,
                name=name,
                wait_secs=0,
                background=background,
                _retry=False,
            )

        if not resp.ok:
            raise PenpotError(
                f"{command} HTTP {resp.status_code}: {resp.text}"
            )

        try:
            raw = resp.json()
        except Exception:
            return resp.content

        return from_transit(raw) if isinstance(raw, list) and raw and raw[0] == "^ " else raw

    def _refresh_token(self) -> None:
        """用保存的邮密重新登录，更新 access_token 和 session cookie"""
        if not (self._email and self._password):
            raise PenpotError("Token 已过期，且未保存邮密，无法自动刷新")
        self.login(self._email, self._password)

    def _ensure_export_login(self) -> None:
        """确保导出前已有 profile_id 和登录 cookie。"""
        if self._profile_id is not None:
            return
        if self._email and self._password:
            self.login(self._email, self._password)
            return
        raise PenpotError("需要先调用 login() 获取 profile_id")

    # ── 文件结构 ──────────────────────────────────────────────────────────────

    def get_file(self, file_id: str) -> dict:
        """获取文件完整结构，含 revn / vern 版本号和所有图层"""
        return self._rpc("get-file", {"id": file_id})

    def get_internal_thumbnail(self, file_id: str, page_id: str, frame_id: str) -> Optional[bytes]:
        """
        获取 Penpot 内部缩略图（与编辑器里显示的完全一致，字体正确）。

        原理：
          1. 调用 get-file-object-thumbnails API，获取 {file/page/frame/frame: media_uuid} 映射
          2. 用 /assets/by-id/{uuid} 直接下载 PNG

        返回 bytes，若该 frame 没有内部缩略图则返回 None。
        """
        import re as _re

        resp = self._session.get(
            f"{self.base_url}/api/rpc/command/get-file-object-thumbnails",
            params={"file-id": file_id},
            timeout=20,
        )
        if not resp.ok:
            return None

        # 响应是 Transit JSON，形如：
        # ["^ ", "file/page/frame/frame", "~uMEDIA_UUID", ...]
        raw = resp.text
        # 构造期望的 key
        expected_key = f"{file_id}/{page_id}/{frame_id}/frame"
        # 从 Transit 文本中找 key 后面紧跟的 ~uUUID
        pattern = _re.escape(expected_key) + r'","~u([0-9a-f-]{36})'
        m = _re.search(pattern, raw)
        if not m:
            return None

        media_id = m.group(1)
        img_resp = self._session.get(
            f"{self.base_url}/assets/by-id/{media_id}",
            timeout=30,
        )
        if not img_resp.ok or len(img_resp.content) < 500:
            return None

        return img_resp.content

    def get_file_thumbnail(self, file_id: str, page_id: str, frame_id: str) -> bytes:
        """
        获取某个 frame 的缩略图（PNG 字节）。
        优先用内部缩略图，降级到 export。
        """
        internal = self.get_internal_thumbnail(file_id, page_id, frame_id)
        if internal:
            return internal
        return self.export_frame(file_id, page_id, frame_id, scale=1.0)

    # ── 解析 slot 图层 ────────────────────────────────────────────────────────

    def parse_slots(self, file_data: dict) -> list[dict]:
        """
        从 get_file 返回的结构中提取所有 slot/ 开头的图层。
        返回列表，每项包含 id / name / type / page_id / frame_id / x / y / width / height。
        文字图层额外包含 text_style 字段（font_size / font_weight / font_family / fill_color / text_align）。
        frame_id 用于将 slot 归属到具体模板 frame，避免同一 page 上的多个模板混用 slot。

        图片 slot 命名约定（特殊品扩展）：
          slot/product_1/image           → 普通图片 slot，不限类型
          slot/product_1/image_white     → 明确指定从 white 类型文件夹取图
          slot/product_1/image_png       → 明确指定从 png 类型文件夹取图
        解析时将 image_type 字段附加在 slot dict 上，供 compose 层使用。

        文字分段 slot 命名约定：
          slot/product_1/name_1          → name 字段的第 1 段（按最后空格切割）
          slot/product_1/name_2          → name 字段的第 2 段
        解析时附加 split_field / split_index 字段，供 compose 层使用。
        """
        slots: list[dict] = []
        data = file_data.get("data", {})
        pages_index = data.get("pagesIndex") or data.get("pages-index", {})

        for page_id, page in pages_index.items():
            objects = page.get("objects", {})

            # 构建 parent-id 索引，用于向上追溯祖先 frame
            parent_index: dict[str, str] = {}
            for obj_id, obj in objects.items():
                parent_id = obj.get("parentId") or obj.get("parent-id", "")
                if parent_id:
                    parent_index[obj_id] = parent_id

            # 顶层画板集合（Root Frame 的直接子级），用于区分顶层 frame 和弹性布局子 frame
            page_root_shapes: Optional[set] = None
            for obj_id, obj in objects.items():
                if obj.get("name") == "Root Frame" and obj.get("type") == "frame":
                    page_root_shapes = set(obj.get("shapes", []))
                    break

            def find_frame_ancestor(obj_id: str) -> str:
                """向上追溯，返回所属的顶层画板 id（Root Frame 直接子级），找不到返回空串"""
                visited = set()
                cur = parent_index.get(obj_id, "")
                while cur and cur not in visited:
                    visited.add(cur)
                    obj = objects.get(cur, {})
                    if obj.get("type") == "frame":
                        # 如果已知顶层集合，必须是其中成员才算顶层画板
                        if page_root_shapes is not None:
                            if cur in page_root_shapes:
                                return cur
                            # 否则是弹性布局子 frame，继续向上
                        else:
                            # 没有 root_shapes 信息时，返回第一个非 Root frame
                            if cur != "00000000-0000-0000-0000-000000000000":
                                return cur
                    cur = parent_index.get(cur, "")
                return ""

            for obj_id, obj in objects.items():
                name: str = obj.get("name", "")
                if name.replace(" ", "").startswith("slot/"):
                    frame_id = find_frame_ancestor(obj_id)
                    canonical_name = name.replace(" ", "")
                    slot: dict = {
                        "id": obj_id,
                        "name": canonical_name,
                        "type": obj.get("type"),
                        "page_id": page_id,
                        "frame_id": frame_id,
                        "x": obj.get("x", 0),
                        "y": obj.get("y", 0),
                        "width": obj.get("width", 200),
                        "height": obj.get("height", 200),
                    }

                    # ── 图片 slot：解析 image_type ────────────────────────────
                    # slot/product_N/image_XXX → image_type = "XXX"
                    # slot/product_N/image     → image_type = None（不限定）
                    parts = canonical_name.split("/")  # ['slot', 'product_1', 'image_white']
                    # 直接命名的场景图类型（不带 image_ 前缀）
                    _SCENE_IMAGE_TYPES = {"banner", "poster"}

                    if len(parts) >= 3:
                        field_part = parts[2]  # e.g. "image_white" or "image" or "name_1"
                        if field_part == "image":
                            slot["image_type"] = None
                        elif field_part.startswith("image_"):
                            # 去掉 image_ 前缀，剩余部分作为 image_type key
                            slot["image_type"] = field_part[len("image_"):]
                        elif field_part in _SCENE_IMAGE_TYPES:
                            # slot/product_1/banner → image_type = "banner"
                            slot["image_type"] = field_part
                        elif "_" in field_part:
                            # 检测文字分段：name_1 / name_2 / time_1 等
                            base, _, idx_str = field_part.rpartition("_")
                            if idx_str.isdigit() and base:
                                slot["split_field"] = base
                                slot["split_index"] = int(idx_str)

                    # 文字图层：保存原始 content 结构（用于写入时只替换 text，保留所有样式）
                    if obj.get("type") == "text":
                        slot["text_style"] = self.parse_text_style(obj)
                        slot["raw_content"] = obj.get("content")  # 原始 content，含对齐/字体/颜色
                        # 保留原始 grow-type（fixed / auto-height / auto-width 等）
                        _gt = obj.get("growType") or obj.get("grow-type") or "auto-height"
                        if isinstance(_gt, Keyword):
                            _gt = _gt.name
                        elif isinstance(_gt, str) and _gt.startswith("~:"):
                            _gt = _gt[2:]
                        slot["grow_type"] = _gt
                        # 保留垂直对齐（top / center / bottom），fixed 框体导出时需要
                        _va = obj.get("verticalAlign") or obj.get("vertical-align") or "top"
                        if isinstance(_va, Keyword):
                            _va = _va.name
                        elif isinstance(_va, str) and _va.startswith("~:"):
                            _va = _va[2:]
                        slot["vertical_align"] = _va
                    slots.append(slot)
        return slots

    def parse_text_style(self, layer: dict) -> dict:
        """
        从文字图层的 content 树中提取排版样式。
        penpot 内部键名在 Transit 解码后可能为 camelCase 或 kebab-case，
        两种格式都兼容。
        返回包含以下键的 dict：
          font_size, font_weight, font_family, font_id, font_variant_id, fill_color, text_align

        注意：font_id 是 Penpot 内部标识（如 "custom-xxxx" 或 "sourcesanspro"），
              font_family 是显示名（如 "MiSans"）。两者不同，必须分别保留。
        """
        default: dict = {
            "font_size": 14.0,
            "font_weight": "400",
            "font_family": "sourcesanspro",
            "font_id": "sourcesanspro",         # ← 新增：Penpot 内部 font-id
            "font_variant_id": "regular",        # ← 新增：variant id
            "fill_color": "#000000",
            "text_align": "center",
        }

        content = layer.get("content")
        if not isinstance(content, dict):
            return default

        style = dict(default)

        try:
            # root → paragraph-set → paragraph
            para_set = (content.get("children") or [{}])[0]
            paragraph = (para_set.get("children") or [{}])[0]
            # text run (first leaf)
            text_run = (paragraph.get("children") or [{}])[0]
        except (IndexError, TypeError):
            return default

        # ── text-align（段落级）────────────────────────────────────────────────
        for key in ("textAlign", "text-align"):
            val = paragraph.get(key)
            if val:
                # 规范化：Keyword对象取 .name，"~:center" 去掉前缀，否则直接用
                if isinstance(val, Keyword):
                    style["text_align"] = val.name
                elif isinstance(val, str) and val.startswith("~:"):
                    style["text_align"] = val[2:]
                else:
                    style["text_align"] = str(val)
                break

        # ── font-size ──────────────────────────────────────────────────────────
        for key in ("fontSize", "font-size"):
            val = text_run.get(key) or paragraph.get(key)
            if val is not None:
                try:
                    style["font_size"] = float(val)
                except (TypeError, ValueError):
                    pass
                break

        # ── font-weight ────────────────────────────────────────────────────────
        for key in ("fontWeight", "font-weight"):
            val = text_run.get(key) or paragraph.get(key)
            if val is not None:
                style["font_weight"] = str(val)
                break

        # ── font-family ────────────────────────────────────────────────────────
        for key in ("fontFamily", "font-family"):
            val = text_run.get(key) or paragraph.get(key)
            if val:
                style["font_family"] = val
                break

        # ── font-id（Penpot 内部标识，custom font 与 font-family 不同）──────────
        for key in ("fontId", "font-id"):
            val = text_run.get(key) or paragraph.get(key)
            if val:
                style["font_id"] = val
                break

        # ── font-variant-id ────────────────────────────────────────────────────
        for key in ("fontVariantId", "font-variant-id"):
            val = text_run.get(key) or paragraph.get(key)
            if val:
                style["font_variant_id"] = val
                break

        # ── fill-color（取第一个 fill）─────────────────────────────────────────
        fills = text_run.get("fills") or []
        if isinstance(fills, list) and fills:
            f0 = fills[0] or {}
            for key in ("fillColor", "fill-color"):
                val = f0.get(key)
                if val:
                    style["fill_color"] = val
                    break

        return style

    def parse_frames(self, file_data: dict) -> list[dict]:
        """
        提取顶层 frame（画板），排除 Root Frame / Component 等系统 frame。
        用于模板列表和导出目标。

        分组约定（特殊品多画板支持）：
          画板名称含 "/" 时，左边是组名，右边是变体名。
          例如 "特殊品/白底"、"特殊品/PNG" 属于同一个组 "特殊品"。
          不含 "/" 的画板（普通模板）group_name = name，不影响原有逻辑。

        每个 frame dict 附加：
          group_name  —— 所属分组名（用于前端聚合）
          variant     —— 变体名（如 "白底"，普通模板为空字符串）
        """
        frames: list[dict] = []
        data = file_data.get("data", {})
        pages_index = data.get("pagesIndex") or data.get("pages-index", {})

        for page_id, page in pages_index.items():
            page_name: str = page.get("name", "").strip()
            objects = page.get("objects", {})

            # 用 Root Frame 的 shapes 列表（权威直接子级列表）来过滤顶层画板
            root_shapes: Optional[set] = None
            for obj_id, obj in objects.items():
                if obj.get("name") == "Root Frame" and obj.get("type") == "frame":
                    root_shapes = set(obj.get("shapes", []))
                    break

            for obj_id, obj in objects.items():
                if obj.get("type") != "frame":
                    continue
                raw_name: str = obj.get("name", "")
                if raw_name == "Root Frame":
                    continue

                # 只取 Root Frame 的直接子级，跳过嵌套在画板内的 frame（弹性布局等）
                if root_shapes is not None and obj_id not in root_shapes:
                    continue

                # 分组逻辑：优先以 page_name 为组名
                if "/" in raw_name:
                    group_name, variant = raw_name.split("/", 1)
                    group_name = group_name.strip()
                    variant = variant.strip()
                else:
                    group_name = page_name if page_name else raw_name
                    variant = raw_name if page_name and page_name != raw_name else ""

                frames.append(
                    {
                        "id": obj_id,
                        "name": raw_name,
                        "page_name": page_name,
                        "group_name": group_name,
                        "variant": variant,
                        "page_id": page_id,
                        "x": obj.get("x", 0),
                        "y": obj.get("y", 0),
                        "width": obj.get("width", 400),
                        "height": obj.get("height", 400),
                    }
                )
        return frames

    # ── 媒体上传 ──────────────────────────────────────────────────────────────

    def upload_image(
        self, file_id: str, image_path: str, name: Optional[str] = None
    ) -> dict:
        """
        上传图片到 penpot 媒体库。
        返回包含 id / width / height 的 dict。
        """
        import os

        if name is None:
            name = os.path.splitext(os.path.basename(image_path))[0]

        with open(image_path, "rb") as f:
            img_bytes = f.read()

        ext = os.path.splitext(image_path)[1].lower()
        mime = "image/png" if ext == ".png" else "image/jpeg"

        raw = self._rpc(
            "upload-file-media-object",
            params={"file-id": file_id, "is-local": "true", "name": name},
            files={"content": (os.path.basename(image_path), img_bytes, mime)},
        )
        # 处理 Transit list 格式（有时返回 list 而非 dict）
        if isinstance(raw, list) and raw:
            raw = raw[0]

        media_id = raw.get("id", "").lstrip("~u")
        return {
            "id": media_id,
            "width": raw.get("width", 800),
            "height": raw.get("height", 800),
            "name": name,
            "mtype": mime,
        }

    def upload_image_bytes(
        self,
        file_id: str,
        img_bytes: bytes,
        name: str,
        mime: str = "image/png",
    ) -> dict:
        """上传图片字节流到 penpot 媒体库"""
        ext = ".png" if mime == "image/png" else ".jpg"
        raw = self._rpc(
            "upload-file-media-object",
            params={"file-id": file_id, "is-local": "true", "name": name},
            files={"content": (f"{name}{ext}", img_bytes, mime)},
        )
        if isinstance(raw, list) and raw:
            raw = raw[0]
        media_id = raw.get("id", "").lstrip("~u")
        return {
            "id": media_id,
            "width": raw.get("width", 800),
            "height": raw.get("height", 800),
            "name": name,
            "mtype": mime,
        }

    # ── 图层写入 ──────────────────────────────────────────────────────────────

    def update_file(self, file_id: str, changes: list[dict]) -> dict:
        """
        写入图层变更。自动获取最新 revn / vern，发送 Transit+JSON。
        changes 中的 dict key 用普通 str（内部会转换为 Transit keyword）。
        """
        file_data = self.get_file(file_id)
        revn = file_data.get("revn", 0)
        vern = file_data.get("vern", 0)

        return self._rpc(
            "update-file",
            {
                "id": file_id,
                "revn": revn,
                "vern": vern,
                "changes": changes,
                "session-id": str(uuid.uuid4()),
            },
            transit=True,
        )

    def set_image_fill(
        self,
        layer_id: str,
        page_id: str,
        media: dict,
        keep_aspect_ratio: bool = False,
    ) -> dict:
        """
        构造替换 rect 图层图片的 change dict（未提交）。
        返回一个 change 操作，需要加入 changes 列表再调用 update_file。
        """
        return {
            "type": kw("mod-obj"),
            "id": layer_id,
            "page-id": page_id,
            "operations": [
                {
                    "type": kw("set"),
                    "attr": kw("fills"),
                    "val": [
                        {
                            "fill-image": {
                                "id": media["id"],
                                "width": media["width"],
                                "height": media["height"],
                                "mtype": media.get("mtype", "image/png"),
                                "name": media.get("name", "image"),
                                "keep-aspect-ratio": keep_aspect_ratio,
                            }
                        }
                    ],
                }
            ],
        }

    def set_text_content(
        self,
        layer_id: str,
        page_id: str,
        text: str,
        frame_x: float,
        frame_w: float,
        layer_x: float,
        layer_y: float,
        layer_w: float,
        font_size: float = 14,
        font_weight: str = "400",
        font_family: str = "sourcesanspro",
        fill_color: str = "#000000",
        text_align: str = "center",
        raw_content: Optional[dict] = None,
        grow_type: str = "auto-height",
        vertical_align: str = "top",
    ) -> list[dict]:
        """
        替换文字图层内容，完整保留原始样式（对齐、字体、颜色等）。

        策略：
        1. 有 raw_content 时：直接在模板原始结构上替换文字字符串，其余所有属性
           （text-align / font / color / line-height 等）原封不动保留，不重建。
           再把 from_transit 解码过的纯字符串关键字（"center"）还原为 Transit keyword
           对象（kw("center")），以便 to_transit 正确序列化为 "~:center"。
        2. 无 raw_content 时：用参数手动构建 content（兜底路径）。
        3. 两种路径均通过 mod-obj 操作清除 position-data 并重设 grow-type /
           vertical-align，确保 Penpot 以新内容重新排版。
        """
        if raw_content is not None:
            # 直接复用模板 content：只换文字，完整保留 text-align / font 等
            new_content = self._replace_text_in_content(raw_content, text)
            # _replace_text_in_content 已把 key 转为 kebab-case；
            # 但 from_transit 把 keyword 值解码为普通字符串（"center"），
            # 必须转回 Keyword 对象，否则 to_transit 会发送普通字符串，
            # Penpot 服务端将其当作非法值并静默忽略，导致 text-align 丢失。
            new_content = self._fix_keyword_values(new_content)
        else:
            # 无模板内容时，按参数从零构建（兜底）
            font_id = font_family
            font_variant_id = "regular"
            fs = str(int(font_size)) if font_size == int(font_size) else str(font_size)
            fw = str(font_weight)
            fill = {"fill-color": fill_color, "fill-opacity": 1}
            text_run = {
                "text": text,
                "font-family": font_family,
                "font-id": font_id,
                "font-variant-id": font_variant_id,
                "font-size": fs,
                "font-weight": fw,
                "font-style": "normal",
                "text-decoration": "none",
                "text-transform": "none",
                "letter-spacing": "0",
                "line-height": "1",
                "text-direction": kw("ltr"),
                "text-align": kw(text_align),
                "fills": [fill],
            }
            paragraph = {
                "type": "paragraph",
                "key": str(uuid.uuid4())[:8],
                "font-family": font_family,
                "font-id": font_id,
                "font-variant-id": font_variant_id,
                "font-size": fs,
                "font-weight": fw,
                "font-style": "normal",
                "text-decoration": "none",
                "text-transform": "none",
                "letter-spacing": "0",
                "line-height": "1",
                "text-direction": kw("ltr"),
                "text-align": kw(text_align),
                "fills": [fill],
                "children": [text_run],
            }
            new_content = {
                "type": "root",
                "children": [{"type": "paragraph-set", "children": [paragraph]}],
            }

        return [{
            "type": kw("mod-obj"),
            "id": layer_id,
            "page-id": page_id,
            "operations": [
                {"type": kw("set"), "attr": kw("content"), "val": new_content},
                # 清除 position-data 缓存，让 Penpot 用 content 重新布局
                {
                    "type": kw("set"),
                    "attr": kw("position-data"),
                    "val": None,
                },
                # 保留模板原始 grow-type（fixed / auto-height / auto-width）
                {"type": kw("set"), "attr": kw("grow-type"), "val": kw(grow_type)},
                # 保留垂直对齐，fixed 框体导出器需要此属性定位文字
                {"type": kw("set"), "attr": kw("vertical-align"), "val": kw(vertical_align)},
            ],
        }]

    # Penpot GET 返回的 content 结构用 camelCase，但 update-file 要求全部 kebab-case
    _CONTENT_KEY_MAP = {
        # fills 相关
        "fillColor":          "fill-color",
        "fillOpacity":        "fill-opacity",
        "fillColorGradient":  "fill-color-gradient",
        "fillColorRefFile":   "fill-color-ref-file",
        "fillColorRefId":     "fill-color-ref-id",
        "fillImage":          "fill-image",
        # 文字排版
        "fontSize":           "font-size",
        "fontFamily":         "font-family",
        "fontId":             "font-id",
        "fontWeight":         "font-weight",
        "fontStyle":          "font-style",
        "fontVariantId":      "font-variant-id",
        "textAlign":          "text-align",
        "textDecoration":     "text-decoration",
        "textTransform":      "text-transform",
        "textDirection":      "text-direction",
        "letterSpacing":      "letter-spacing",
        "lineHeight":         "line-height",
        # 段落
        "paragraphSet":       "paragraph-set",
        # 位置/布局（content 节点内偶尔携带）
        "positionData":       "position-data",
        "growType":           "grow-type",
    }

    @classmethod
    def _camel_to_kebab(cls, key: str) -> str:
        """
        先查 _CONTENT_KEY_MAP 精确映射；
        找不到则用正则把 camelCase 自动转为 kebab-case（如 lineHeight → line-height）。
        已经是 kebab-case（含连字符）或纯小写的键原样返回。
        """
        if key in cls._CONTENT_KEY_MAP:
            return cls._CONTENT_KEY_MAP[key]
        # 自动转换：在大写字母前插入连字符并转小写
        import re
        converted = re.sub(r'([A-Z])', lambda m: '-' + m.group(1).lower(), key)
        return converted

    def _normalize_content_node(self, node: dict) -> dict:
        """
        递归把 content 树的每个节点的键名转为 kebab-case。
        同时对 fills 数组里的每个 fill dict 也做同样转换。
        返回新 dict（浅层新建，值本身原地复用）。
        """
        new_node: dict = {}
        for k, v in node.items():
            new_k = self._camel_to_kebab(k)
            if k == "fills" and isinstance(v, list):
                new_node[new_k] = [
                    {self._camel_to_kebab(fk): fv for fk, fv in fill.items()}
                    if isinstance(fill, dict) else fill
                    for fill in v
                ]
            elif k == "children" and isinstance(v, list):
                new_node[new_k] = [
                    self._normalize_content_node(child)
                    if isinstance(child, dict) else child
                    for child in v
                ]
            else:
                new_node[new_k] = v
        return new_node

    def _replace_text_in_content(self, content: dict, new_text: str) -> dict:
        """
        深拷贝 content 结构，把所有键名转为 kebab-case（GET 返回 camelCase，
        update-file 要求全部 kebab-case），然后把第一个 text-run 的 text 替换为
        new_text，并丢弃其余 run（避免多段残留）。
        """
        import copy
        content = copy.deepcopy(content)
        # 把整棵 content 树的键名统一转为 kebab-case
        content = self._normalize_content_node(content)
        try:
            para_set = content["children"][0]          # paragraph-set
            paragraph = para_set["children"][0]        # paragraph
            children = paragraph.get("children", [])
            if children:
                run = children[0]
                run["text"] = new_text
                # text-run 的 text-align 必须和 paragraph 一致
                # Penpot 渲染时 run 级优先级更高，run 是 left 则即使 paragraph 是 center 也显示居左
                para_align = paragraph.get("text-align")
                if para_align:
                    run["text-align"] = para_align
                paragraph["children"] = [run]
        except (KeyError, IndexError, TypeError):
            pass
        return content

    # Transit 协议中必须序列化为 keyword（~:xxx）的字段
    _TRANSIT_KEYWORD_FIELDS = {"text-align", "text-direction"}

    def _fix_keyword_values(self, node: Any) -> Any:
        """
        递归遍历 content 树，把已知的 Transit keyword 字段的值从普通字符串
        转回 Keyword 对象，确保 to_transit 能正确序列化为 "~:center" 等形式。

        背景：get-file 响应经 from_transit 解码后，keyword 值（如 "~:center"）
        变为普通字符串 "center"。若直接将其写回 update-file，to_transit 会把
        "center" 序列化为普通 JSON 字符串，Penpot 服务端静默丢弃，导致
        text-align 等属性丢失。
        """
        if isinstance(node, dict):
            result: dict = {}
            for k, v in node.items():
                if k in self._TRANSIT_KEYWORD_FIELDS and isinstance(v, str) and v:
                    # 兼容 "center" 和 "~:center" 两种来源
                    result[k] = kw(v[2:] if v.startswith("~:") else v)
                elif k == "children" and isinstance(v, list):
                    result[k] = [self._fix_keyword_values(c) for c in v]
                else:
                    result[k] = v
            return result
        return node

    def set_layer_hidden(self, layer_id: str, page_id: str, hidden: bool) -> dict:
        """构造设置图层可见性的 change dict（未提交）"""
        return {
            "type": kw("mod-obj"),
            "id": layer_id,
            "page-id": page_id,
            "operations": [
                {"type": kw("set"), "attr": kw("hidden"), "val": hidden}
            ],
        }

    def hide_layer(self, layer_id: str, page_id: str) -> dict:
        return self.set_layer_hidden(layer_id, page_id, True)

    def show_layer(self, layer_id: str, page_id: str) -> dict:
        return self.set_layer_hidden(layer_id, page_id, False)

    # ── 文件管理 ──────────────────────────────────────────────────────────────

    def duplicate_file(self, file_id: str, name: str) -> dict:
        """
        复制一个 penpot 文件，返回新文件信息（含 id、project-id、team-id）。
        用于每次合成前先克隆模板，保持原模板干净，同时给用户一个可长期编辑的副本。
        """
        # 先获取原文件的 project-id
        file_data = self.get_file(file_id)
        project_id = file_data.get("projectId") or file_data.get("project-id", "")

        result = self._rpc(
            "duplicate-file",
            {
                "file-id": file_id,
                "project-id": project_id,
                "name": name,
            },
            transit=True,
        )
        return result

    def get_file_project_team(self, file_id: str) -> tuple[str, str]:
        """返回 (project_id, team_id)，用于拼接 penpot 编辑链接。"""
        file_data = self.get_file(file_id)
        project_id = file_data.get("projectId") or file_data.get("project-id", "")
        team_id = file_data.get("teamId") or file_data.get("team-id", "")
        return project_id, team_id

    def get_project_files(self, project_id: str) -> list[dict]:
        """
        返回指定 project 下的所有文件列表。
        每项包含 id / name 等字段。
        """
        result = self._rpc("get-project-files", {"project-id": project_id})
        if isinstance(result, list):
            return result
        return []

    def get_team_projects(self, team_id: str) -> list[dict]:
        """
        返回指定团队下的所有 project 列表。
        每项包含 id / name 等字段。
        """
        result = self._rpc("get-projects", {"team-id": team_id})
        if isinstance(result, list):
            return result
        return []

    def get_team_id_from_file(self, file_id: str) -> tuple[str, str]:
        """
        从文件 ID 逐步获取 project_id 和 team_id。
        返回 (project_id, team_id)，任一获取失败时返回空字符串。
        """
        try:
            file_data = self.get_file(file_id)
            project_id = file_data.get("projectId") or file_data.get("project-id", "")
            team_id = file_data.get("teamId") or file_data.get("team-id", "")
            if project_id and not team_id:
                proj = self._rpc("get-project", {"id": project_id})
                team_id = proj.get("teamId") or proj.get("team-id", "")
            return project_id, team_id
        except Exception:
            return "", ""

    # ── 导出 ──────────────────────────────────────────────────────────────────

    def export_frame(
        self,
        file_id: str,
        page_id: str,
        frame_id: str,
        scale: float = 1.0,
        name: str = "export",
        wait_secs: float = 3.0,
        background: bool = True,
        _retry: bool = True,
    ) -> bytes:
        """
        通过 /api/export 导出指定 frame 为 PNG 字节。
        需要提前调用 login() 获取 session cookie。
        wait_secs: 调用前等待秒数，让 Penpot backend 完成写入广播。
                   连续导出多帧时第二帧起可传 0 跳过等待。
        background: 是否包含背景（True=白色背景，False=透明PNG）。
        """
        import time

        if wait_secs > 0:
            time.sleep(wait_secs)  # 等待 Penpot backend 写入并广播到 exporter


        self._ensure_export_login()
        payload = {
            "cmd": kw("export-shapes"),
            "exports": [
                {
                    "page-id": page_id,
                    "file-id": file_id,
                    "object-id": frame_id,
                    "type": kw("png"),
                    "suffix": "",
                    "scale": scale,
                    "name": name,
                    "background": background,
                }
            ],
            "profile-id": self.profile_id,
            "wait": True,
        }

        body = json.dumps(to_transit(payload))
        resp = self._session.post(
            f"{self.base_url}/api/export",
            headers={"Content-Type": "application/transit+json"},
            data=body,
            timeout=120,
        )

        if not resp.ok:
            raise PenpotError(
                f"export HTTP {resp.status_code}: {resp.text[:300]}"
            )

        # 解析返回的 URI
        try:
            export_data = resp.json()
        except Exception:
            raise PenpotError("导出接口返回非 JSON 数据")

        if isinstance(export_data, dict):
            export_data = {k.lstrip("~:"): v for k, v in export_data.items()}

        uri_raw = export_data.get("uri", "")
        if isinstance(uri_raw, dict):
            uri = uri_raw.get("~#uri", "")
        else:
            uri = str(uri_raw)

        if not uri:
            raise PenpotError(f"导出接口未返回 URI: {export_data}")

        # 下载图片
        img_resp = self._session.get(uri, timeout=60)
        if not img_resp.ok or len(img_resp.content) < 500:
            raise PenpotError(
                f"下载导出图片失败 HTTP {img_resp.status_code}"
            )

        return img_resp.content


# ─── 错误类 ───────────────────────────────────────────────────────────────────


class PenpotError(Exception):
    pass
