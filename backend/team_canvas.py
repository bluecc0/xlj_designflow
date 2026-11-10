"""团队画布：把个人画布中的一页分享给全员或指定成员共同编辑。

共享画布单独存一份 V2 文档（只含一页），有权限的人（包括分享者）都编辑这一份；
member_ids 为 NULL 表示全团队可见，否则是 JSON 成员 id 列表，分享者和 admin 账号始终可见；
保存沿用个人画布的 revision 乐观锁，冲突由前端按元素三方合并后重试。
每次保存由服务端对比新旧文档，自动记录新增/生成/删除/改名等动态，删除记录保留原始元素以便恢复。
"""
from __future__ import annotations

import asyncio
import json
import re
import shutil
import threading
import time
import uuid
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit

from fastapi import APIRouter, HTTPException, Request

from .config import settings
from .job_store import (
    _connect,
    _legacy_compatible_editor_snapshot,
    _lock,
    load_editor_snapshot,
    load_job,
    load_job_owner_id,
    log_operation,
    save_editor_snapshot,
)
from .output_access import is_output_asset_owner, output_asset_parts
from .user_profile import avatar_url, avatar_url_for_user_id, real_name

router = APIRouter(prefix="/team-canvases")

_VERSION_INTERVAL_SECONDS = 10 * 60
_VERSION_KEEP = 60
_PRESENCE_TTL_SECONDS = 15
_RECORD_KEYS = ("frames", "images", "texts")
_RECORD_ID_PREFIXES = {"frames": "frame-", "images": "img-", "texts": "txt-"}

_presence: dict[str, dict[str, tuple[str, float, str]]] = {}
_presence_lock = threading.Lock()
# 图片路径 -> 可访问的用户 id；None 表示全团队
_asset_index: dict[str, set[str] | None] | None = None
# 同样的结构，记录动态里出现过的图片（包括已从画布删除的），只用于查看
_activity_asset_index: dict[str, set[str] | None] = {}
_asset_index_lock = threading.Lock()


def init_team_canvas_tables() -> None:
    with _connect() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS team_canvases (
                id              TEXT PRIMARY KEY,
                owner_id        TEXT NOT NULL,
                owner_name      TEXT NOT NULL,
                page_id         TEXT NOT NULL,
                doc_json        TEXT NOT NULL,
                revision        INTEGER NOT NULL DEFAULT 1,
                status          TEXT NOT NULL DEFAULT 'active',
                created_at      REAL NOT NULL,
                updated_at      REAL NOT NULL,
                updated_by_name TEXT NOT NULL DEFAULT '',
                unshared_at     REAL
            )
        """)
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(team_canvases)").fetchall()}
        if "member_ids" not in columns:
            conn.execute("ALTER TABLE team_canvases ADD COLUMN member_ids TEXT")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS team_canvas_activity (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                canvas_id   TEXT NOT NULL,
                user_id     TEXT NOT NULL,
                username    TEXT NOT NULL,
                action      TEXT NOT NULL,
                summary     TEXT NOT NULL DEFAULT '',
                payload     TEXT NOT NULL DEFAULT '',
                created_at  REAL NOT NULL
            )
        """)
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_team_activity_canvas ON team_canvas_activity(canvas_id, created_at)"
        )
        conn.execute("""
            CREATE TABLE IF NOT EXISTS team_canvas_versions (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                canvas_id       TEXT NOT NULL,
                revision        INTEGER NOT NULL,
                doc_json        TEXT NOT NULL,
                reason          TEXT NOT NULL DEFAULT '',
                created_by_name TEXT NOT NULL DEFAULT '',
                created_at      REAL NOT NULL
            )
        """)
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_team_versions_canvas ON team_canvas_versions(canvas_id, created_at)"
        )
        conn.commit()


# ─── 文档工具 ──────────────────────────────────────────────────────────────────

def _user_name(user: dict) -> str:
    # 给其他成员看的名字用后台真实姓名；昵称只在用户自己的界面显示
    return real_name(user)


def _canonical_asset_path(path: str) -> str:
    """/output/ai-images/... 和 /ai-images/... 是同一批文件，归属、共享索引和复制都按后者判断。"""
    return path[len("/output"):] if path.startswith("/output/ai-images/") else path


def _asset_path(raw_url: object) -> str:
    value = str(raw_url or "").strip()
    if not value:
        return ""
    try:
        path = urlsplit(value).path if "://" in value else value.split("?", 1)[0]
        return _canonical_asset_path(unquote(path))
    except Exception:
        return value


def _asset_owner(path: str) -> str:
    if not path.startswith("/ai-images/"):
        return ""
    rest = path[len("/ai-images/"):]
    return rest.split("/", 1)[0] if "/" in rest else ""


def is_foreign_asset(path: str, user_id: str) -> bool:
    """这个地址是否指向别人的站内文件。画布里的图片会放行给所有成员，所以合成图、上传文件也要算归属。"""
    path = _canonical_asset_path(path)
    owner = _asset_owner(path)
    if owner:
        return owner != user_id
    job_route = re.fullmatch(r"/(?:export/grid|compose)/([^/]+)/.+", path)
    if job_route:
        return load_job_owner_id(job_route.group(1)) != user_id
    parts = output_asset_parts(path)
    return parts is not None and not is_output_asset_owner(parts, user_id)


def _personal_v2(stored_json: str | None) -> dict | None:
    if not stored_json:
        return None
    try:
        snapshot = json.loads(stored_json)
    except Exception:
        return None
    if isinstance(snapshot, dict) and isinstance(snapshot.get("designflowCanvasDocument"), dict):
        snapshot = snapshot["designflowCanvasDocument"]
    if isinstance(snapshot, dict) and snapshot.get("version") == 2 and isinstance(snapshot.get("pages"), list):
        return snapshot
    return None


def _normalize_team_doc(doc: dict, page: dict) -> dict:
    """共享文档固定只有一页；任何指向其他页面的元素都归到这一页。"""
    page_id = page["id"]
    normalized = {
        "version": 2,
        "pages": [{**page, "groupId": None, "archived": False, "order": 0}],
        "groups": [],
        "activePageId": page_id,
    }
    for key in _RECORD_KEYS:
        records = doc.get(key) if isinstance(doc.get(key), list) else []
        normalized[key] = [
            {**r, "pageId": page_id} for r in records if isinstance(r, dict) and r.get("id")
        ]
    return normalized


def _records_by_id(doc: dict, key: str) -> dict[str, dict]:
    return {str(r["id"]): r for r in (doc.get(key) or []) if isinstance(r, dict) and r.get("id")}


def _shape_count(doc: dict) -> int:
    return sum(len(doc.get(key) or []) for key in _RECORD_KEYS)


# 画布内 AI 操作的结果图会在 meta.operation 标明来源
_OPERATION_LABELS = {
    "outpainting": "扩图",
    "matting": "抠图",
    "upscale": "高清放大",
    "vectorize": "矢量化",
    "quick-edit": "快捷编辑",
    "outfit-change": "AI 换装",
    "view-angle": "切换视角",
}


def _image_operation(image: dict) -> str:
    """返回新增图片的来源：画布内 AI 操作名、generate（生图）或空字符串（普通导入）。"""
    meta = image.get("meta") if isinstance(image.get("meta"), dict) else {}
    operation = str(meta.get("operation") or "")
    if operation in _OPERATION_LABELS:
        return operation
    return "generate" if meta.get("model") or meta.get("jobId") or meta.get("prompt") else ""


def _image_brief(image: dict) -> dict:
    meta = image.get("meta") if isinstance(image.get("meta"), dict) else {}
    return {
        "id": image.get("id"),
        "name": image.get("name") or "",
        "url": image.get("url") or "",
        "model": meta.get("model") or "",
        "prompt": str(meta.get("prompt") or meta.get("originalPrompt") or meta.get("resolvedPrompt") or "")[:300],
        "operation": _image_operation(image),
    }


def diff_activity(old: dict, new: dict) -> list[tuple[str, str, dict]]:
    """对比两版共享文档，返回 (action, summary, payload) 列表；移动、缩放等普通编辑不记录。"""
    entries: list[tuple[str, str, dict]] = []
    old_images, new_images = _records_by_id(old, "images"), _records_by_id(new, "images")
    added = [new_images[i] for i in new_images if i not in old_images]
    generated = [im for im in added if _image_operation(im) == "generate"]
    imported = [im for im in added if not _image_operation(im)]
    if generated:
        models = sorted({_image_brief(im)["model"] for im in generated if _image_brief(im)["model"]})
        summary = f"生成了 {len(generated)} 张图片" + (f"（{'、'.join(models)}）" if models else "")
        entries.append(("generate", summary, {"images": [_image_brief(im) for im in generated]}))
    for operation, label in _OPERATION_LABELS.items():
        results = [im for im in added if _image_operation(im) == operation]
        if results:
            entries.append(("generate", f"用{label}生成了 {len(results)} 张图片",
                            {"operation": operation, "images": [_image_brief(im) for im in results]}))
    if imported:
        entries.append(("add", f"添加了 {len(imported)} 张图片", {"images": [_image_brief(im) for im in imported]}))

    deleted: dict[str, list[dict]] = {}
    for key in _RECORD_KEYS:
        before, after = _records_by_id(old, key), _records_by_id(new, key)
        removed = [before[i] for i in before if i not in after]
        if removed:
            deleted[key] = removed
    if deleted:
        labels = {"images": "张图片", "texts": "个文字", "frames": "个画板"}
        parts = [f"{len(deleted[key])} {labels[key]}" for key in _RECORD_KEYS if key in deleted]
        entries.append(("delete", "删除了 " + "、".join(parts), deleted))

    old_name = (old.get("pages") or [{}])[0].get("name")
    new_name = (new.get("pages") or [{}])[0].get("name")
    if old_name and new_name and old_name != new_name:
        entries.append(("rename", f"把画布名称从「{old_name}」改为「{new_name}」", {"from": old_name, "to": new_name}))
    return entries


def _insert_activity(conn, canvas_id: str, user: dict, action: str, summary: str, payload: dict | None = None) -> None:
    conn.execute(
        "INSERT INTO team_canvas_activity (canvas_id, user_id, username, action, summary, payload, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (canvas_id, str(user.get("id") or ""), _user_name(user), action, summary,
         json.dumps(payload or {}, ensure_ascii=False), time.time()),
    )


def _insert_version(conn, canvas_id: str, revision: int, doc_json: str, reason: str, user: dict) -> None:
    conn.execute(
        "INSERT INTO team_canvas_versions (canvas_id, revision, doc_json, reason, created_by_name, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (canvas_id, revision, doc_json, reason, _user_name(user), time.time()),
    )
    conn.execute(
        "DELETE FROM team_canvas_versions WHERE canvas_id = ? AND id NOT IN "
        "(SELECT id FROM team_canvas_versions WHERE canvas_id = ? ORDER BY id DESC LIMIT ?)",
        (canvas_id, canvas_id, _VERSION_KEEP),
    )


def _write_personal(conn, user_id: str, old_json: str, doc: dict, old_revision: int) -> int:
    new_json = json.dumps(doc, ensure_ascii=False)
    stored = _legacy_compatible_editor_snapshot(new_json, old_json)
    revision = old_revision + 1
    conn.execute(
        "UPDATE editor_snapshots SET snapshot_json = ?, updated_at = ?, revision = ? WHERE user_id = ?",
        (stored, time.time(), revision, user_id),
    )
    return revision


# ─── 共享图片访问索引 ──────────────────────────────────────────────────────────

def _invalidate_asset_index() -> None:
    global _asset_index
    with _asset_index_lock:
        _asset_index = None


def _add_asset_viewers(index: dict[str, set[str] | None], raw_url: object, viewers: set[str] | None) -> None:
    path = _asset_path(raw_url)
    if not path:
        return
    if path not in index:
        index[path] = None if viewers is None else set(viewers)
    elif viewers is None or index[path] is None:
        index[path] = None
    else:
        index[path] |= viewers


def _load_asset_indexes() -> None:
    global _asset_index, _activity_asset_index
    shared: dict[str, set[str] | None] = {}
    activity: dict[str, set[str] | None] = {}
    canvas_viewers: dict[str, set[str] | None] = {}
    try:
        with _connect() as conn:
            rows = conn.execute(
                "SELECT id, owner_id, member_ids, doc_json FROM team_canvases WHERE status = 'active'"
            ).fetchall()
            activity_rows = conn.execute(
                "SELECT canvas_id, payload FROM team_canvas_activity WHERE action IN ('generate', 'delete')"
            ).fetchall()
    except Exception:
        rows, activity_rows = [], []
    for row in rows:
        member_ids = _member_ids(row)
        viewers = None if member_ids is None else {row["owner_id"], *member_ids}
        canvas_viewers[row["id"]] = viewers
        try:
            doc = json.loads(row["doc_json"])
        except Exception:
            continue
        for image in doc.get("images") or []:
            if isinstance(image, dict):
                _add_asset_viewers(shared, image.get("url"), viewers)
    for row in activity_rows:
        if row["canvas_id"] not in canvas_viewers:
            continue
        try:
            images = json.loads(row["payload"] or "{}").get("images") or []
        except Exception:
            continue
        for image in images:
            if isinstance(image, dict):
                _add_asset_viewers(activity, image.get("url"), canvas_viewers[row["canvas_id"]])
    _asset_index, _activity_asset_index = shared, activity


def _asset_allowed(index: dict[str, set[str] | None], path: str, user: dict) -> bool:
    if path not in index:
        return False
    allowed = index[path]
    return allowed is None or is_super_admin(user) or str(user.get("id")) in allowed


def is_shared_canvas_asset(raw_url: object, user: dict) -> bool:
    """图片出现在该用户能访问的任一共享画布里时，该用户可以查看和用作参考图。"""
    path = _asset_path(raw_url)
    if not path:
        return False
    with _asset_index_lock:
        if _asset_index is None:
            _load_asset_indexes()
        return _asset_allowed(_asset_index, path, user)


def can_view_shared_asset(raw_url: object, user: dict) -> bool:
    """比 is_shared_canvas_asset 多放行动态里的图片，让成员能看到已删除图片的缩略图并恢复，但不能拿去复用。"""
    if is_shared_canvas_asset(raw_url, user):
        return True
    with _asset_index_lock:
        return _asset_allowed(_activity_asset_index, _asset_path(raw_url), user)


def _asset_source(path: str) -> tuple[Path, str] | None:
    """站内文件的磁盘位置，以及复制到 team-imports 后的相对路径。"""
    output = settings.output_path.resolve()
    if path.startswith("/ai-images/"):
        rel = path[len("/ai-images/"):]
        source = (output / "ai-images" / rel).resolve()
        return (source, rel) if output / "ai-images" in source.parents else None
    compose = re.fullmatch(r"/compose/([^/]+)/image/?", path)
    grid = re.fullmatch(r"/export/grid/([^/]+)/(\d+)/?", path)
    if compose:
        job = load_job(compose.group(1))
        if not job or not job.result_path:
            return None
        source = Path(job.result_path).resolve()
        rel = source.name
    elif grid:
        rel = f"{grid.group(1)}_grid_{int(grid.group(2)):02d}.png"
        source = (output / rel).resolve()
    else:
        parts = output_asset_parts(path)
        if not parts:
            return None
        rel = "/".join(parts)
        source = (output / rel).resolve()
    return (source, rel) if output in source.parents else None


def copy_asset_to_user(raw_url: object, user_id: str) -> str | None:
    """把他人的站内文件复制到 user_id 自己的 team-imports 目录，返回新地址；不是他人文件或文件不存在时返回 None。"""
    path = _asset_path(raw_url)
    if not is_foreign_asset(path, user_id):
        return None
    located = _asset_source(path)
    root = (settings.output_path / "ai-images").resolve()
    safe_user = "".join(ch for ch in user_id if ch.isalnum() or ch in "-_")
    if not located or not safe_user or not located[0].is_file():
        return None
    source, rel = located
    dest = (root / safe_user / "team-imports" / rel).resolve()
    if (root / safe_user) not in dest.parents:
        return None
    if not dest.exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, dest)
    return "/ai-images/" + quote(str(dest.relative_to(root)).replace("\\", "/"))


def _copy_foreign_assets(doc: dict, owner_id: str) -> None:
    """取消分享时把其他人贡献的图片复制到分享者目录，回到个人画布后不依赖别人的文件。"""
    for image in doc.get("images") or []:
        new_url = copy_asset_to_user(image.get("url"), owner_id)
        if new_url:
            image["url"] = new_url


def _records_for_new_page(doc: dict, page_id: str) -> dict[str, list[dict]]:
    """给复制出的图层换新 id 并改写相互引用，避免分享者取消分享时与原图层 id 相撞被丢弃。"""
    id_maps = {
        key: {str(r["id"]): _RECORD_ID_PREFIXES[key] + uuid.uuid4().hex[:8] for r in doc.get(key) or []}
        for key in _RECORD_KEYS
    }
    records: dict[str, list[dict]] = {}
    for key in _RECORD_KEYS:
        records[key] = []
        for record in doc.get(key) or []:
            copied = {**record, "id": id_maps[key][str(record["id"])], "pageId": page_id}
            if record.get("frameId"):
                copied["frameId"] = id_maps["frames"].get(str(record["frameId"]))
            meta = record.get("meta")
            if isinstance(meta, dict) and meta.get("sourceImageId"):
                copied["meta"] = {**meta, "sourceImageId": id_maps["images"].get(str(meta["sourceImageId"]))}
            records[key].append(copied)
    return records


def _copy_page_name(name: str, pages: list[dict]) -> str:
    taken = {p.get("name") for p in pages}
    candidate = f"{name} 副本"
    index = 2
    while candidate in taken:
        candidate = f"{name} 副本 {index}"
        index += 1
    return candidate


# ─── 业务操作 ──────────────────────────────────────────────────────────────────

def _member_ids(row) -> list[str] | None:
    raw = row["member_ids"]
    if raw is None:
        return None
    try:
        parsed = json.loads(raw)
    except Exception:
        return []
    return [str(item) for item in parsed] if isinstance(parsed, list) else []


def is_super_admin(user: dict) -> bool:
    """只有 admin 这个账号能看到和管理全部画布，其他管理员账号和普通用户一样按名单。"""
    return user.get("id") == "admin" and user.get("role") == "admin"


def _can_access(row, user: dict) -> bool:
    if is_super_admin(user) or row["owner_id"] == str(user["id"]):
        return True
    member_ids = _member_ids(row)
    return member_ids is None or str(user["id"]) in member_ids


def list_share_targets() -> list[dict]:
    """可以被指定的同事：以 login_users.json 为准，排除测试账号；名字优先用登录后实际显示的名字。"""
    with _connect() as conn:
        db_names = {row["id"]: row["username"] for row in conn.execute("SELECT id, username FROM users").fetchall()}
    return [
        {"id": u["id"], "name": u.get("display_name") or db_names.get(u["id"]) or u["username"]}
        for u in settings.allowed_login_users
        if not u.get("is_test")
    ]


def _clean_member_ids(raw: object, owner_id: str) -> list[str] | None:
    """None 表示全团队；否则校验成员并去掉分享者本人，至少要留一位。"""
    if raw is None:
        return None
    if not isinstance(raw, list):
        raise HTTPException(400, "成员名单格式不正确")
    known = {t["id"] for t in list_share_targets()}
    member_ids = sorted({str(item) for item in raw} - {owner_id})
    if any(item not in known for item in member_ids):
        raise HTTPException(400, "所选成员不存在，请刷新后重试")
    if not member_ids:
        raise HTTPException(400, "请至少选择一位成员")
    return member_ids


def _canvas_meta(row) -> dict:
    try:
        doc = json.loads(row["doc_json"])
    except Exception:
        doc = {}
    page = (doc.get("pages") or [{}])[0]
    return {
        "id": row["id"],
        "name": page.get("name") or "未命名画布",
        "page_id": row["page_id"],
        "owner_id": row["owner_id"],
        "owner_name": row["owner_name"],
        "revision": int(row["revision"]),
        "updated_at": row["updated_at"],
        "updated_by_name": row["updated_by_name"],
        "image_count": len(doc.get("images") or []),
        "member_ids": _member_ids(row),
    }


def _active_row(conn, canvas_id: str, user: dict):
    row = conn.execute(
        "SELECT * FROM team_canvases WHERE id = ? AND status = 'active'", (canvas_id,)
    ).fetchone()
    # 没有权限也回 404，不暴露画布是否存在；打开中被移出名单时前端按画布已失效处理
    if not row or not _can_access(row, user):
        raise HTTPException(404, "该团队画布已取消分享或不存在")
    return row


def list_canvases(user: dict) -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM team_canvases WHERE status = 'active' ORDER BY created_at ASC"
        ).fetchall()
    return [_canvas_meta(row) for row in rows if _can_access(row, user)]


def share_page(user: dict, page_id: str, member_ids: object = None) -> dict:
    user_id = str(user["id"])
    clean_members = _clean_member_ids(member_ids, user_id)
    with _lock, _connect() as conn:
        personal = conn.execute(
            "SELECT snapshot_json, revision FROM editor_snapshots WHERE user_id = ?", (user_id,)
        ).fetchone()
        doc = _personal_v2(personal["snapshot_json"]) if personal else None
        if doc is None:
            raise HTTPException(409, "画布尚未保存，请稍后再试")
        page = next((p for p in doc["pages"] if isinstance(p, dict) and p.get("id") == page_id), None)
        if not page or page.get("archived"):
            raise HTTPException(404, "没有找到这个画布，请刷新后重试")

        team_doc = _normalize_team_doc(
            {key: [r for r in doc.get(key) or [] if isinstance(r, dict) and r.get("pageId") == page_id]
             for key in _RECORD_KEYS},
            page,
        )
        # ai-images 在保存个人画布时已校验；其他站内文件在这里挡住，避免分享后放行给成员
        for image in team_doc["images"]:
            path = _asset_path(image.get("url"))
            if not _asset_owner(path) and is_foreign_asset(path, user_id) and not is_shared_canvas_asset(path, user):
                raise HTTPException(409, "画布包含其他用户的文件，无法分享，请先移除后重试")
        remaining_pages = [p for p in doc["pages"] if p.get("id") != page_id]
        if not any(not p.get("archived") for p in remaining_pages):
            remaining_pages.append({"id": "page-" + uuid.uuid4().hex[:7], "name": "画布 1",
                                    "order": len(remaining_pages), "archived": False, "groupId": None})
        doc["pages"] = remaining_pages
        for key in _RECORD_KEYS:
            doc[key] = [r for r in doc.get(key) or [] if not (isinstance(r, dict) and r.get("pageId") == page_id)]
        if doc.get("activePageId") == page_id:
            doc["activePageId"] = next(p["id"] for p in remaining_pages if not p.get("archived"))
        personal_revision = _write_personal(
            conn, user_id, personal["snapshot_json"], doc, int(personal["revision"] or 1)
        )

        canvas_id = "team-" + uuid.uuid4().hex[:12]
        now = time.time()
        conn.execute(
            "INSERT INTO team_canvases (id, owner_id, owner_name, page_id, doc_json, revision, status, "
            "created_at, updated_at, updated_by_name, member_ids) VALUES (?, ?, ?, ?, ?, 1, 'active', ?, ?, ?, ?)",
            (canvas_id, user_id, _user_name(user), page_id, json.dumps(team_doc, ensure_ascii=False),
             now, now, _user_name(user), None if clean_members is None else json.dumps(clean_members)),
        )
        scope_text = "分享到团队" if clean_members is None else f"分享给 {len(clean_members)} 位成员"
        _insert_activity(conn, canvas_id, user, "share", f"把「{page.get('name') or '画布'}」{scope_text}")
        conn.commit()
        row = conn.execute("SELECT * FROM team_canvases WHERE id = ?", (canvas_id,)).fetchone()
    _invalidate_asset_index()
    log_operation(user_id=user_id, username=_user_name(user), action="team_canvas_share",
                  detail=page.get("name") or "", payload=json.dumps({"canvas_id": canvas_id}, ensure_ascii=False))
    return {"canvas": _canvas_meta(row), "personal_revision": personal_revision}


def set_members(user: dict, canvas_id: str, member_ids: object) -> dict:
    """修改共享范围；被移出的人下一次心跳或保存时收到 404，由前端退回个人画布。"""
    with _lock, _connect() as conn:
        row = _active_row(conn, canvas_id, user)
        if row["owner_id"] != str(user["id"]) and not is_super_admin(user):
            raise HTTPException(403, "只有分享者可以修改成员")
        clean_members = _clean_member_ids(member_ids, row["owner_id"])
        conn.execute(
            "UPDATE team_canvases SET member_ids = ? WHERE id = ?",
            (None if clean_members is None else json.dumps(clean_members), canvas_id),
        )
        scope_text = "全团队" if clean_members is None else f"{len(clean_members)} 位成员"
        _insert_activity(conn, canvas_id, user, "members", f"把共享范围改为{scope_text}", {"member_ids": clean_members})
        conn.commit()
        row = conn.execute("SELECT * FROM team_canvases WHERE id = ?", (canvas_id,)).fetchone()
    _invalidate_asset_index()
    log_operation(user_id=str(user["id"]), username=_user_name(user), action="team_canvas_members",
                  detail=scope_text, payload=json.dumps({"canvas_id": canvas_id}, ensure_ascii=False))
    return {"canvas": _canvas_meta(row)}


def unshare_canvas(user: dict, canvas_id: str) -> dict:
    user_id = str(user["id"])
    with _lock, _connect() as conn:
        row = _active_row(conn, canvas_id, user)
        if row["owner_id"] != user_id and not is_super_admin(user):
            raise HTTPException(403, "只有分享者可以取消分享")
        owner_id = row["owner_id"]
        team_doc = json.loads(row["doc_json"])
        _copy_foreign_assets(team_doc, owner_id)
        personal = conn.execute(
            "SELECT snapshot_json, revision FROM editor_snapshots WHERE user_id = ?", (owner_id,)
        ).fetchone()
        doc = _personal_v2(personal["snapshot_json"]) if personal else None
        if doc is None:
            raise HTTPException(409, "分享者的个人画布暂时无法读取，请稍后再试")
        page = {**team_doc["pages"][0], "order": len(doc["pages"]), "groupId": None, "archived": False}
        doc["pages"] = [p for p in doc["pages"] if p.get("id") != page["id"]] + [page]
        for key in _RECORD_KEYS:
            existing = {r.get("id") for r in doc.get(key) or [] if isinstance(r, dict)}
            doc[key] = list(doc.get(key) or []) + [r for r in team_doc.get(key) or [] if r.get("id") not in existing]
        personal_revision = _write_personal(
            conn, owner_id, personal["snapshot_json"], doc, int(personal["revision"] or 1)
        )
        conn.execute(
            "UPDATE team_canvases SET status = 'unshared', unshared_at = ? WHERE id = ?", (time.time(), canvas_id)
        )
        _insert_activity(conn, canvas_id, user, "unshare", f"取消分享「{page.get('name') or '画布'}」")
        conn.commit()
    _invalidate_asset_index()
    with _presence_lock:
        _presence.pop(canvas_id, None)
    log_operation(user_id=user_id, username=_user_name(user), action="team_canvas_unshare",
                  detail=page.get("name") or "", payload=json.dumps({"canvas_id": canvas_id}, ensure_ascii=False))
    return {"page_id": page["id"], "personal_revision": personal_revision if owner_id == user_id else None}


def copy_to_personal(user: dict, canvas_id: str) -> dict:
    """把团队画布复制成自己的一页个人画布；副本与原画布完全独立，图片也复制到自己的目录。"""
    user_id = str(user["id"])
    with _connect() as conn:
        row = _active_row(conn, canvas_id, user)
    team_doc = json.loads(row["doc_json"])
    # 复制文件可能较慢，放在写库锁之外
    _copy_foreign_assets(team_doc, user_id)
    page_id = "page-" + uuid.uuid4().hex[:7]
    records = _records_for_new_page(team_doc, page_id)
    # 还没保存过个人画布的成员，先建一份空文档
    if load_editor_snapshot(user_id)[0] is None:
        save_editor_snapshot(user_id, json.dumps(
            {"version": 2, "pages": [], "groups": [], "activePageId": page_id, "frames": [], "images": [], "texts": []}
        ))
    with _lock, _connect() as conn:
        personal = conn.execute(
            "SELECT snapshot_json, revision FROM editor_snapshots WHERE user_id = ?", (user_id,)
        ).fetchone()
        doc = _personal_v2(personal["snapshot_json"]) if personal else None
        if doc is None:
            raise HTTPException(409, "个人画布暂时无法读取，请稍后再试")
        name = team_doc["pages"][0].get("name") or "未命名画布"
        page = {"id": page_id, "name": _copy_page_name(name, doc["pages"]),
                "order": len(doc["pages"]), "groupId": None, "archived": False}
        doc["pages"] = doc["pages"] + [page]
        for key in _RECORD_KEYS:
            doc[key] = list(doc.get(key) or []) + records[key]
        personal_revision = _write_personal(
            conn, user_id, personal["snapshot_json"], doc, int(personal["revision"] or 1)
        )
        conn.commit()
    log_operation(user_id=user_id, username=_user_name(user), action="team_canvas_copy",
                  detail=page["name"], payload=json.dumps({"canvas_id": canvas_id}, ensure_ascii=False))
    return {"page": page, "personal_revision": personal_revision}


def load_canvas(user: dict, canvas_id: str) -> dict:
    with _connect() as conn:
        row = _active_row(conn, canvas_id, user)
    return {"canvas": _canvas_meta(row), "snapshot": json.loads(row["doc_json"]), "revision": int(row["revision"])}


def save_canvas(
    user: dict, canvas_id: str, snapshot: dict, base_revision: object, intent: str | None,
) -> tuple[bool, int, str | None]:
    with _lock, _connect() as conn:
        row = _active_row(conn, canvas_id, user)
        old_revision = int(row["revision"])
        if base_revision is None or int(base_revision) != old_revision:
            return False, old_revision, "stale_revision"
        old_doc = json.loads(row["doc_json"])
        new_doc = _normalize_team_doc(snapshot, {**old_doc["pages"][0], **_first_page(snapshot, row["page_id"])})

        # 新增的图片只能是自己的、或已经在某个共享画布里的，避免借共享画布读取任意他人素材
        old_urls = {_asset_path(im.get("url")) for im in old_doc.get("images") or []}
        history_urls: set[str] | None = None
        for image in new_doc["images"]:
            path = _asset_path(image.get("url"))
            if not is_foreign_asset(path, str(user["id"])) or path in old_urls or is_shared_canvas_asset(path, user):
                continue
            # 从动态里“恢复”被删的图片：该画布自己曾经有过的图片记录也认可
            if history_urls is None:
                history_urls = _canvas_history_image_paths(conn, canvas_id)
            if path not in history_urls:
                return False, old_revision, "foreign_asset_rejected"

        if _shape_count(old_doc) >= 3 and _shape_count(new_doc) == 0 and intent != "user_delete":
            return False, old_revision, "uninitialized_overwrite_rejected"

        activity = diff_activity(old_doc, new_doc)
        last_version = conn.execute(
            "SELECT created_at FROM team_canvas_versions WHERE canvas_id = ? ORDER BY id DESC LIMIT 1",
            (canvas_id,),
        ).fetchone()
        has_delete = any(action == "delete" for action, _, _ in activity)
        if has_delete or not last_version or time.time() - last_version["created_at"] >= _VERSION_INTERVAL_SECONDS:
            _insert_version(conn, canvas_id, old_revision, row["doc_json"], "删除前自动备份" if has_delete else "定时备份", user)

        new_revision = old_revision + 1
        conn.execute(
            "UPDATE team_canvases SET doc_json = ?, revision = ?, updated_at = ?, updated_by_name = ? WHERE id = ?",
            (json.dumps(new_doc, ensure_ascii=False), new_revision, time.time(), _user_name(user), canvas_id),
        )
        for action, summary, payload in activity:
            _insert_activity(conn, canvas_id, user, action, summary, payload)
        conn.commit()
    if any(action in {"generate", "add", "delete"} for action, _, _ in activity):
        _invalidate_asset_index()
    return True, new_revision, None


def _canvas_history_image_paths(conn, canvas_id: str) -> set[str]:
    """该画布删除记录和历史版本中出现过的图片记录地址（只读图片记录，不读文字等字段）。"""
    paths: set[str] = set()
    rows = conn.execute(
        "SELECT payload FROM team_canvas_activity WHERE canvas_id = ? AND action = 'delete'", (canvas_id,)
    ).fetchall()
    for row in rows:
        try:
            images = json.loads(row["payload"] or "{}").get("images") or []
        except Exception:
            continue
        paths.update(_asset_path(im.get("url")) for im in images if isinstance(im, dict))
    for row in conn.execute("SELECT doc_json FROM team_canvas_versions WHERE canvas_id = ?", (canvas_id,)).fetchall():
        try:
            images = json.loads(row["doc_json"]).get("images") or []
        except Exception:
            continue
        paths.update(_asset_path(im.get("url")) for im in images if isinstance(im, dict))
    paths.discard("")
    return paths


def _first_page(snapshot: dict, page_id: str) -> dict:
    pages = snapshot.get("pages") if isinstance(snapshot.get("pages"), list) else []
    page = next((p for p in pages if isinstance(p, dict) and p.get("id") == page_id), None)
    return {"name": page.get("name")} if page and page.get("name") else {}


def heartbeat(user: dict, canvas_id: str) -> dict:
    with _connect() as conn:
        row = _active_row(conn, canvas_id, user)
    now = time.time()
    with _presence_lock:
        viewers = _presence.setdefault(canvas_id, {})
        viewers[str(user["id"])] = (_user_name(user), now, avatar_url(str(user.get("username") or "")))
        for uid in [uid for uid, (_, seen, _) in viewers.items() if now - seen > _PRESENCE_TTL_SECONDS]:
            viewers.pop(uid, None)
        viewer_list = [{"id": uid, "name": name, "avatar_url": avatar} for uid, (name, _, avatar) in viewers.items()]
    return {"revision": int(row["revision"]), "canvas": _canvas_meta(row), "viewers": viewer_list}


def list_activity(user: dict, canvas_id: str, limit: int = 100) -> list[dict]:
    with _connect() as conn:
        _active_row(conn, canvas_id, user)
        rows = conn.execute(
            "SELECT * FROM team_canvas_activity WHERE canvas_id = ? ORDER BY id DESC LIMIT ?",
            (canvas_id, max(1, min(300, limit))),
        ).fetchall()
    items = []
    avatars: dict[str, str] = {}
    for row in rows:
        try:
            payload = json.loads(row["payload"] or "{}")
        except Exception:
            payload = {}
        if row["user_id"] not in avatars:
            avatars[row["user_id"]] = avatar_url_for_user_id(row["user_id"])
        items.append({
            "id": row["id"], "user_id": row["user_id"], "username": row["username"], "action": row["action"],
            "summary": row["summary"], "payload": payload, "created_at": row["created_at"],
            "avatar_url": avatars[row["user_id"]],
        })
    return items


def list_versions(user: dict, canvas_id: str) -> list[dict]:
    with _connect() as conn:
        _active_row(conn, canvas_id, user)
        rows = conn.execute(
            "SELECT * FROM team_canvas_versions WHERE canvas_id = ? ORDER BY id DESC", (canvas_id,)
        ).fetchall()
    items = []
    for row in rows:
        try:
            doc = json.loads(row["doc_json"])
        except Exception:
            doc = {}
        items.append({
            "id": row["id"], "revision": row["revision"], "reason": row["reason"],
            "created_by_name": row["created_by_name"], "created_at": row["created_at"],
            "image_count": len(doc.get("images") or []), "shape_count": _shape_count(doc),
        })
    return items


def restore_version(user: dict, canvas_id: str, version_id: int) -> int:
    with _lock, _connect() as conn:
        row = _active_row(conn, canvas_id, user)
        version = conn.execute(
            "SELECT * FROM team_canvas_versions WHERE id = ? AND canvas_id = ?", (version_id, canvas_id)
        ).fetchone()
        if not version:
            raise HTTPException(404, "没有找到这个历史版本")
        old_revision = int(row["revision"])
        _insert_version(conn, canvas_id, old_revision, row["doc_json"], "恢复历史版本前自动备份", user)
        new_revision = old_revision + 1
        conn.execute(
            "UPDATE team_canvases SET doc_json = ?, revision = ?, updated_at = ?, updated_by_name = ? WHERE id = ?",
            (version["doc_json"], new_revision, time.time(), _user_name(user), canvas_id),
        )
        when = time.strftime("%m-%d %H:%M", time.localtime(version["created_at"]))
        _insert_activity(conn, canvas_id, user, "restore_version", f"把画布恢复到 {when} 的版本",
                         {"version_id": version_id})
        conn.commit()
    _invalidate_asset_index()
    return new_revision


# ─── 路由 ─────────────────────────────────────────────────────────────────────

def _user(request: Request) -> dict:
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(401, "请先输入名字进入系统")
    return user


@router.get("")
def api_list(request: Request):
    return {"canvases": list_canvases(_user(request))}


@router.get("/share-targets")
def api_share_targets(request: Request):
    _user(request)
    return {"users": list_share_targets()}


@router.post("")
async def api_share(request: Request):
    user = _user(request)
    body = await request.json()
    page_id = str((body or {}).get("page_id") or "").strip()
    if not page_id:
        raise HTTPException(400, "缺少要分享的画布")
    return share_page(user, page_id, body.get("member_ids"))


@router.get("/{canvas_id}")
def api_load(canvas_id: str, request: Request):
    return load_canvas(_user(request), canvas_id)


@router.post("/{canvas_id}/snapshot")
async def api_save(canvas_id: str, request: Request):
    user = _user(request)
    body = await request.json()
    raw = body.get("snapshot") if isinstance(body, dict) else None
    try:
        snapshot = json.loads(raw) if isinstance(raw, str) else raw
    except Exception:
        snapshot = None
    if not isinstance(snapshot, dict):
        raise HTTPException(400, "snapshot 不能为空")
    ok, revision, reason = await asyncio.to_thread(
        save_canvas, user, canvas_id, snapshot, body.get("base_revision"), body.get("intent"),
    )
    if not ok:
        raise HTTPException(409, {"saved": False, "reason": reason, "current_revision": revision})
    return {"saved": True, "revision": revision}


@router.post("/{canvas_id}/unshare")
def api_unshare(canvas_id: str, request: Request):
    return unshare_canvas(_user(request), canvas_id)


@router.post("/{canvas_id}/members")
async def api_members(canvas_id: str, request: Request):
    body = await request.json()
    return set_members(_user(request), canvas_id, (body or {}).get("member_ids"))


@router.post("/{canvas_id}/copy")
def api_copy(canvas_id: str, request: Request):
    return copy_to_personal(_user(request), canvas_id)


@router.post("/{canvas_id}/heartbeat")
def api_heartbeat(canvas_id: str, request: Request):
    return heartbeat(_user(request), canvas_id)


@router.get("/{canvas_id}/activity")
def api_activity(canvas_id: str, request: Request):
    return {"items": list_activity(_user(request), canvas_id)}


@router.get("/{canvas_id}/versions")
def api_versions(canvas_id: str, request: Request):
    return {"items": list_versions(_user(request), canvas_id)}


@router.post("/{canvas_id}/versions/{version_id}/restore")
def api_restore(canvas_id: str, version_id: int, request: Request):
    return {"revision": restore_version(_user(request), canvas_id, version_id)}
