"""角色卡：保存人物的名字、参考图和描述，生图时按 ID 选用。

卡片默认只有创建者可见，打开共享后全团队都能看到和选用，但只有创建者和 admin 账号能修改。
前端只传卡片 ID，图片和描述一律由后端读取，这里同时负责校验、参考图加载和人物提示词。
人物提示词只锁定“这个人是谁”：长相跟参考图走，服装、姿势、场景、画风都跟本次需求走。
"""
from __future__ import annotations

import contextlib
import io
import json
import re
import shutil
import time
import uuid
from pathlib import Path
from typing import Sequence

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from PIL import Image, ImageOps

from .ai_image import _safe_user_id
from .config import settings
from .job_store import _connect
from .team_canvas import is_super_admin
from .user_profile import real_name

router = APIRouter(prefix="/character-cards")

MAX_CARDS_PER_USER = 50
MAX_IMAGES_PER_CARD = 4
MAX_CARDS_PER_REQUEST = 3
MAX_NAME_CHARS = 30
MAX_DESCRIPTION_CHARS = 500
MAX_UPLOAD_BYTES = 20 * 1024 * 1024
MAX_IMAGE_EDGE = 2048
MAX_STORED_BYTES = 5 * 1024 * 1024  # 与单张参考图上限一致
MAX_AVATAR_EDGE = 512
STALE_CARD_MESSAGE = "这个角色刚被修改过，已为你刷新，请重新打开后再操作"
GENDER_LABELS = {"adult_male": "成年男性", "adult_female": "成年女性", "boy": "男童", "girl": "女童"}


def init_character_card_tables() -> None:
    with _connect() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS character_cards (
                id          TEXT PRIMARY KEY,
                owner_id    TEXT NOT NULL,
                owner_name  TEXT NOT NULL,
                name        TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                images_json TEXT NOT NULL,
                is_shared   INTEGER NOT NULL DEFAULT 0,
                created_at  REAL NOT NULL,
                updated_at  REAL NOT NULL
            )
        """)
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(character_cards)").fetchall()}
        if "gender" not in columns:
            conn.execute("ALTER TABLE character_cards ADD COLUMN gender TEXT NOT NULL DEFAULT ''")
        if "avatar_file" not in columns:
            conn.execute("ALTER TABLE character_cards ADD COLUMN avatar_file TEXT NOT NULL DEFAULT ''")
        if "version" not in columns:
            conn.execute("ALTER TABLE character_cards ADD COLUMN version INTEGER NOT NULL DEFAULT 1")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_character_cards_owner ON character_cards(owner_id, updated_at)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_character_cards_shared ON character_cards(is_shared, updated_at)")


def _user_name(user: dict) -> str:
    # 共享角色卡上给别人看的名字用后台真实姓名；昵称只在用户自己的界面显示
    return real_name(user)


def _card_dir(owner_id: str, card_id: str) -> Path:
    return settings.output_path / "ai-images" / _safe_user_id(owner_id) / "characters" / card_id


def _image_path(card: dict, image: dict) -> Path:
    return _card_dir(card["owner_id"], card["id"]) / image["file"]


def _row_to_card(row) -> dict:
    card = dict(row)
    card["images"] = json.loads(card.pop("images_json") or "[]")
    card["is_shared"] = bool(card["is_shared"])
    return card


def _public_card(card: dict, user: dict) -> dict:
    base_url = f"/ai-images/{_safe_user_id(card['owner_id'])}/characters/{card['id']}"
    images = [{"id": image["id"], "url": f"{base_url}/{image['file']}"} for image in card["images"]]
    return {
        "id": card["id"],
        "name": card["name"],
        "gender": card["gender"],
        "description": card["description"],
        # 没传头像时用第一张参考图代替，has_avatar 让编辑弹窗区分这两种情况
        "avatar_url": f"{base_url}/{card['avatar_file']}" if card["avatar_file"] else images[0]["url"] if images else "",
        "has_avatar": bool(card["avatar_file"]),
        "is_shared": card["is_shared"],
        "owner_name": card["owner_name"],
        "can_edit": _can_edit(card, user),
        "images": images,
        "updated_at": card["updated_at"],
        "version": card["version"],
    }


def _can_edit(card: dict, user: dict) -> bool:
    return card["owner_id"] == str(user["id"]) or is_super_admin(user)


def _can_use(card: dict, user: dict) -> bool:
    return card["is_shared"] or _can_edit(card, user)


def _load_card(card_id: str) -> dict | None:
    with _connect() as conn:
        row = conn.execute("SELECT * FROM character_cards WHERE id = ?", (card_id,)).fetchone()
    return _row_to_card(row) if row else None


def _clean_gender(gender: str) -> str:
    clean_gender = str(gender or "").strip()
    if clean_gender and clean_gender not in GENDER_LABELS:
        raise HTTPException(400, "性别选项不正确")
    return clean_gender


def _clean_fields(name: str, description: str) -> tuple[str, str]:
    clean_name = str(name or "").strip()
    clean_description = str(description or "").strip()
    if not clean_name:
        raise HTTPException(400, "角色名称不能为空")
    if len(clean_name) > MAX_NAME_CHARS:
        raise HTTPException(400, f"角色名称不能超过 {MAX_NAME_CHARS} 个字")
    if len(clean_description) > MAX_DESCRIPTION_CHARS:
        raise HTTPException(400, f"角色简介不能超过 {MAX_DESCRIPTION_CHARS} 个字")
    return clean_name, clean_description


def _normalize_image(data: bytes, filename: str, max_edge: int = MAX_IMAGE_EDGE) -> tuple[bytes, str]:
    """转正方向、限制尺寸并压到参考图上限内；有透明通道的存 PNG，其余存 JPEG。"""
    try:
        with Image.open(io.BytesIO(data)) as source:
            image = ImageOps.exif_transpose(source)
            image.load()
    except Exception as exc:
        raise HTTPException(400, f"{filename or '文件'} 不是有效的图片") from exc
    image.thumbnail((max_edge, max_edge))
    output = io.BytesIO()
    if image.mode in ("RGBA", "LA") or "transparency" in image.info:
        image.convert("RGBA").save(output, format="PNG", optimize=True)
        if output.tell() <= MAX_STORED_BYTES:
            return output.getvalue(), ".png"
        flattened = Image.new("RGB", image.size, "white")
        flattened.paste(image.convert("RGBA"), mask=image.convert("RGBA").getchannel("A"))
        image = flattened
        output = io.BytesIO()
    image.convert("RGB").save(output, format="JPEG", quality=92)
    if output.tell() > MAX_STORED_BYTES:
        raise HTTPException(400, f"{filename or '图片'} 压缩后仍超过 5MB")
    return output.getvalue(), ".jpg"


async def _read_uploads(uploads: Sequence[UploadFile]) -> list[tuple[bytes, str]]:
    prepared = []
    for upload in uploads or []:
        data = await upload.read(MAX_UPLOAD_BYTES + 1)
        if not data:
            continue
        if len(data) > MAX_UPLOAD_BYTES:
            raise HTTPException(400, f"{upload.filename or '图片'} 不能超过 20MB")
        prepared.append(_normalize_image(data, upload.filename or ""))
    return prepared


async def _read_avatar(upload: UploadFile | None) -> tuple[bytes, str] | None:
    data = await upload.read(MAX_UPLOAD_BYTES + 1) if upload else b""
    if not data:
        return None
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(400, "头像不能超过 20MB")
    return _normalize_image(data, upload.filename or "头像", MAX_AVATAR_EDGE)


def _save_avatar(card: dict, prepared: tuple[bytes, str]) -> str:
    data, suffix = prepared
    folder = _card_dir(card["owner_id"], card["id"])
    folder.mkdir(parents=True, exist_ok=True)
    file_name = f"avatar_{uuid.uuid4().hex[:12]}{suffix}"
    (folder / file_name).write_bytes(data)
    return file_name


def _remove_files(card: dict, file_names: Sequence[str]) -> None:
    """删掉不再需要的文件；卡片已被删除时目录也一起收掉。"""
    folder = _card_dir(card["owner_id"], card["id"])
    for file_name in file_names:
        (folder / file_name).unlink(missing_ok=True)
    if file_names and not _load_card(card["id"]):
        with contextlib.suppress(OSError):
            folder.rmdir()


def _save_images(card: dict, prepared: list[tuple[bytes, str]]) -> list[dict]:
    folder = _card_dir(card["owner_id"], card["id"])
    folder.mkdir(parents=True, exist_ok=True)
    saved = []
    for data, suffix in prepared:
        image_id = uuid.uuid4().hex[:12]
        file_name = image_id + suffix
        (folder / file_name).write_bytes(data)
        saved.append({"id": image_id, "file": file_name})
    return saved


def list_cards(user: dict) -> list[dict]:
    """自己的卡片在前，然后是同事共享的卡片。"""
    uid = str(user["id"])
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM character_cards WHERE owner_id = ? OR is_shared = 1 "
            "ORDER BY CASE WHEN owner_id = ? THEN 0 ELSE 1 END, updated_at DESC",
            (uid, uid),
        ).fetchall()
    return [_public_card(_row_to_card(row), user) for row in rows]


def is_shared_character_asset(parts: Sequence[str]) -> bool:
    """parts 是 ai-images 目录下的相对路径。只放行共享卡片当前在用的图，所有段都按精确匹配比较。"""
    if len(parts) != 4 or parts[1] != "characters":
        return False
    card = _load_card(parts[2])
    return bool(card) and card["is_shared"] and _safe_user_id(card["owner_id"]) == parts[0] \
        and (parts[3] == card["avatar_file"] or any(image["file"] == parts[3] for image in card["images"]))


# ─── 生图时选用 ───────────────────────────────────────────────────────────────

def parse_character_ids(raw: object) -> list[str]:
    """character_ids 是表单里的 JSON 数组。保持选择顺序并去重。"""
    if not isinstance(raw, str) or not raw.strip():
        return []
    try:
        values = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(400, "character_ids 格式不正确") from exc
    if not isinstance(values, list):
        raise HTTPException(400, "character_ids 格式不正确")
    return list(dict.fromkeys(str(value).strip() for value in values if str(value).strip()))


def resolve_cards(user: dict, raw_ids: object) -> list[dict]:
    """校验这次选用的角色。选了却用不了时直接报错，不能悄悄换成没有角色的图。"""
    card_ids = parse_character_ids(raw_ids)
    if len(card_ids) > MAX_CARDS_PER_REQUEST:
        raise HTTPException(400, f"一次最多选 {MAX_CARDS_PER_REQUEST} 个角色")
    cards = []
    for card_id in card_ids:
        card = _load_card(card_id)
        if not card or not _can_use(card, user):
            raise HTTPException(400, "所选角色已被删除或取消共享，请重新选择")
        cards.append(card)
    return cards


def load_card_refs(cards: Sequence[dict]) -> list[tuple[bytes, str]]:
    refs = []
    for card in cards:
        for image in card["images"]:
            path = _image_path(card, image)
            if not path.is_file():
                raise HTTPException(409, f"角色“{card['name']}”的参考图文件已不存在，请编辑角色后重试")
            refs.append((path.read_bytes(), path.name))
    return refs


def card_snapshot(cards: Sequence[dict]) -> list[dict]:
    """写进消息和任务元数据的快照：卡片之后被修改或删除时，历史记录仍能显示当时选的是谁。"""
    return [{"id": card["id"], "name": card["name"]} for card in cards]


def _person_label(card: dict) -> str:
    """名字带上性别和年龄段，帮助模型认人；没选时不写。"""
    return f"{card['name']}（{GENDER_LABELS[card['gender']]}）" if card["gender"] in GENDER_LABELS else card["name"]


def people_from_cards(cards: Sequence[dict], start_index: int) -> list[dict]:
    """角色图在参考图里连续排列时，算出每个人对应的序号（从 1 开始）。"""
    people = []
    index = start_index
    for card in cards:
        count = len(card["images"])
        people.append({"name": card["name"], "gender": card["gender"], "description": card["description"],
                       "indexes": list(range(index, index + count))})
        index += count
    return people


def _image_tags(indexes: Sequence[int]) -> str:
    return "、".join(f"[image {index}]" for index in indexes)


def build_character_prompt(people: Sequence[dict], other_indexes: Sequence[int] = ()) -> str:
    """生成追加在最终提示词后面的人物段。普通生图和 Agent 共用，序号必须和这一张实际发送的参考图顺序一致。"""
    lines = []
    for person in people:
        line = f"- “{_person_label(person)}”：长相以 {_image_tags(person['indexes'])} 为准"
        if person["description"]:
            line += f"；人物简介：{person['description']}"
        lines.append(line)
    subject = ("画面中的人物必须是下面这个人本人，不能换成相似的人。" if len(people) == 1
               else "画面中要同时出现下面这些人，每个人都必须是本人，不能换成相似的人，也不要混合彼此的长相。")
    rules = [
        "人物参考图只用来确定这个人的长相：五官、脸型、肤色、发色和身材比例。换成插画等其他画风时，也要一眼认得出是同一个人。",
        "服装、发型、妆容、姿势、表情、场景、构图、光线和画风都按上面的需求来；需求没提到的自行搭配，不必照搬人物参考图和简介。",
        "需求明确要改某个特征时（比如换发色）按需求改，其余长相保持不变。",
    ]
    if other_indexes:
        rules.append(f"{_image_tags(other_indexes)} 是其他参考图，按上面的需求使用；图里如果有别的人，不要用他们的长相替换指定人物。")
    return "\n".join(["【指定人物】" + subject, *lines, *rules])


def build_planner_note(cards: Sequence[dict]) -> str:
    """告诉技能规划器人物已经定了：系统会附上人物参考图，规划时只管画面，不要另外编一个人。"""
    if not cards:
        return ""
    people = "；".join(_person_label(card) + (f"：{card['description']}" if card["description"] else "") for card in cards)
    return (f"\n\n[用户指定了人物：{people}。系统会自动附上人物参考图，final_prompt 里用名字指代这个人，"
            "不要编写或改动五官、脸型等长相，也不要另外设定模特；服装、姿势和场景照常规划。]")


def build_agent_note(people: Sequence[dict]) -> str:
    """附在 Agent 本轮用户消息后面的说明。people 由 service.register_characters 生成，带每个人登记后的图片 ID。"""
    names = []
    for person in people:
        name = f"{_person_label(person)}（参考图：{'、'.join(person['artifact_ids'])}"
        if person["description"]:
            name += f"；简介：{person['description']}"
        names.append(name + "）")
    return ("\n\n[用户指定了人物：" + "，".join(names) + "。这轮每次 generate_image 都要把这些参考图全部放进 reference_image_ids；"
            "只有用户明确说某张不要人物时，才给那一项设 no_character=true。系统会自动在提示词末尾写明这些图是谁、只用来确定长相，"
            "你的 prompt 只写画面需求，不要再写参考图的用途，也不要描述这个人的长相。]")


# ─── 路由 ─────────────────────────────────────────────────────────────────────

def _user(request: Request) -> dict:
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(401, "请先输入名字进入系统")
    return user


def _check_version(card: dict, version: int) -> None:
    if card["version"] != version:
        raise HTTPException(409, STALE_CARD_MESSAGE)


def _editable_card(card_id: str, user: dict) -> dict:
    card = _load_card(card_id)
    if not card or not _can_use(card, user):
        raise HTTPException(404, "角色不存在")
    if not _can_edit(card, user):
        raise HTTPException(403, "只有创建者可以修改这个角色")
    return card


@router.get("")
def api_list(request: Request):
    return {"cards": list_cards(_user(request)), "limits": {
        "max_images_per_card": MAX_IMAGES_PER_CARD, "max_cards_per_request": MAX_CARDS_PER_REQUEST}}


@router.post("")
async def api_create(request: Request, name: str = Form(...), description: str = Form(""), gender: str = Form(""),
                     is_shared: bool = Form(False), images: list[UploadFile] = File(default=[]),
                     avatar: UploadFile | None = File(default=None)):
    user = _user(request)
    clean_name, clean_description = _clean_fields(name, description)
    clean_gender = _clean_gender(gender)
    prepared = await _read_uploads(images)
    prepared_avatar = await _read_avatar(avatar)
    if not prepared:
        raise HTTPException(400, "请至少上传 1 张人物参考图")
    if len(prepared) > MAX_IMAGES_PER_CARD:
        raise HTTPException(400, f"每个角色最多 {MAX_IMAGES_PER_CARD} 张参考图")
    uid = str(user["id"])
    with _connect() as conn:
        count = conn.execute("SELECT COUNT(*) FROM character_cards WHERE owner_id = ?", (uid,)).fetchone()[0]
    if count >= MAX_CARDS_PER_USER:
        raise HTTPException(400, f"每人最多创建 {MAX_CARDS_PER_USER} 个角色，请先删除不用的角色")
    now = time.time()
    card = {"id": "char_" + uuid.uuid4().hex[:12], "owner_id": uid, "owner_name": _user_name(user),
            "name": clean_name, "description": clean_description, "gender": clean_gender, "is_shared": bool(is_shared),
            "created_at": now, "updated_at": now, "version": 1}
    card["images"] = _save_images(card, prepared)
    card["avatar_file"] = _save_avatar(card, prepared_avatar) if prepared_avatar else ""
    with _connect() as conn:
        conn.execute(
            "INSERT INTO character_cards (id, owner_id, owner_name, name, description, gender, avatar_file, images_json, is_shared, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (card["id"], uid, card["owner_name"], clean_name, clean_description, clean_gender, card["avatar_file"],
             json.dumps(card["images"]), int(card["is_shared"]), now, now),
        )
    return {"card": _public_card(card, user)}


@router.put("/{card_id}")
async def api_update(request: Request, card_id: str, version: int = Form(...), name: str = Form(...), description: str = Form(""),
                     gender: str = Form(""), is_shared: bool = Form(False), keep_image_ids: str = Form("[]"),
                     images: list[UploadFile] = File(default=[]), avatar: UploadFile | None = File(default=None),
                     remove_avatar: bool = Form(False)):
    """keep_image_ids 是要保留的旧图 ID（决定顺序），新上传的图排在后面。头像不传也不要求移除时保持原样。
    version 是打开编辑时的卡片版本，已被别处保存过就拒绝，只有赢得条件更新的请求才能清理旧文件。"""
    user = _user(request)
    _check_version(_editable_card(card_id, user), version)
    clean_name, clean_description = _clean_fields(name, description)
    clean_gender = _clean_gender(gender)
    try:
        keep_ids = json.loads(keep_image_ids or "[]")
    except json.JSONDecodeError as exc:
        raise HTTPException(400, "keep_image_ids 格式不正确") from exc
    prepared = await _read_uploads(images)
    prepared_avatar = await _read_avatar(avatar)
    # 读上传时可能已有别的请求改过或删过，后面都以这次读到的为准
    card = _editable_card(card_id, user)
    _check_version(card, version)
    by_id = {image["id"]: image for image in card["images"]}
    kept = [by_id[image_id] for image_id in dict.fromkeys(keep_ids) if image_id in by_id]
    if not kept and not prepared:
        raise HTTPException(400, "请至少保留 1 张人物参考图")
    if len(kept) + len(prepared) > MAX_IMAGES_PER_CARD:
        raise HTTPException(400, f"每个角色最多 {MAX_IMAGES_PER_CARD} 张参考图")
    new_images = _save_images(card, prepared)
    old_avatar = card["avatar_file"]
    new_avatar = _save_avatar(card, prepared_avatar) if prepared_avatar else ""
    next_images = kept + new_images
    next_avatar = new_avatar or ("" if remove_avatar else old_avatar)
    now = time.time()
    with _connect() as conn:
        updated = conn.execute(
            "UPDATE character_cards SET name = ?, description = ?, gender = ?, avatar_file = ?, images_json = ?, is_shared = ?, "
            "updated_at = ?, version = version + 1 WHERE id = ? AND version = ?",
            (clean_name, clean_description, clean_gender, next_avatar, json.dumps(next_images), int(is_shared), now, card_id, version),
        ).rowcount
    if not updated:
        _remove_files(card, [image["file"] for image in new_images] + ([new_avatar] if new_avatar else []))
        raise HTTPException(409, STALE_CARD_MESSAGE)
    # 条件更新成功，说明 card 就是被替换的那个版本，这些旧文件不会再被任何记录引用
    kept_files = {image["file"] for image in next_images}
    dropped = [image["file"] for image in card["images"] if image["file"] not in kept_files]
    if old_avatar and old_avatar != next_avatar:
        dropped.append(old_avatar)
    _remove_files(card, dropped)
    card.update(name=clean_name, description=clean_description, gender=clean_gender, avatar_file=next_avatar,
                images=next_images, is_shared=bool(is_shared), updated_at=now, version=version + 1)
    return {"card": _public_card(card, user)}


@router.delete("/{card_id}")
def api_delete(request: Request, card_id: str, version: int):
    card = _editable_card(card_id, _user(request))
    _check_version(card, version)
    with _connect() as conn:
        deleted = conn.execute("DELETE FROM character_cards WHERE id = ? AND version = ?", (card_id, version)).rowcount
    if not deleted:
        raise HTTPException(409, STALE_CARD_MESSAGE)
    # 已提交任务的参考图各存一份，这里删除不影响它们重试
    shutil.rmtree(_card_dir(card["owner_id"], card_id), ignore_errors=True)
    return {"ok": True}
