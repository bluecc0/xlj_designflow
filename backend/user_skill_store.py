"""用户上传 Skill：校验压缩包 / SKILL.md，按用户目录安装和删除。

只要符合标准 Skill 协议（一个带 name / description 的 SKILL.md）就放行。
只保存 .md / .txt 文本并统一转存为 UTF-8，脚本等其它文件跳过不存、从不执行；
安装先写临时目录、校验通过后再整体替换，避免出现半个 Skill。
每个 Skill 目录里的 .designflow.json 记录上传人、时间和提示，供管理员排查。
"""
from __future__ import annotations

import hashlib
import io
import json
import re
import shutil
import time
import uuid
import zipfile
from pathlib import Path, PurePosixPath, PureWindowsPath

from .agent_skill_loader import SKILL_CONTEXT_MAX_CHARS, _SAFE_NAME_RE, parse_frontmatter


MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_EXTRACTED_BYTES = 30 * 1024 * 1024
MAX_ARCHIVE_ENTRIES = 500
MAX_FILES = 50
MANIFEST_NAME = ".designflow.json"
MAX_SKILLS_PER_USER = 20
ALLOWED_SUFFIXES = {".md", ".txt"}
_JUNK_NAMES = {".DS_Store", "Thumbs.db", "desktop.ini"}
_SCRIPT_HINT_RE = re.compile(r"scripts?/|\.py\b|\.sh\b|```(?:bash|sh|shell|python|zsh)", re.I)


class SkillUploadError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


def _safe_segment(value: str) -> str:
    value = str(value or "").strip()
    if _SAFE_NAME_RE.match(value):
        return value
    return "u-" + hashlib.sha1(value.encode("utf-8")).hexdigest()[:12]


def user_skill_dir(base_dir: Path, user_id: str) -> Path:
    return base_dir / _safe_segment(user_id)


def skill_dir_name(raw_name: str) -> str:
    """与 loader 一致：合法 name 直接用，含中文等字符时用哈希作目录名。"""
    raw_name = str(raw_name or "").strip()
    if _SAFE_NAME_RE.match(raw_name):
        return raw_name
    return "skill-" + hashlib.sha1(raw_name.encode("utf-8")).hexdigest()[:8]


def _decode_text(data: bytes, rel: str) -> str:
    for encoding in ("utf-8-sig", "gbk"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise SkillUploadError(f"{rel} 不是 UTF-8 或 GBK 编码的文本")


def _is_junk(parts: tuple[str, ...]) -> bool:
    return "__MACOSX" in parts or parts[-1] in _JUNK_NAMES or parts[-1].startswith("._")


def _read_zip(data: bytes) -> tuple[dict[str, bytes], list[str]]:
    """返回 (要保存的文本文件, 跳过的文件)。"""
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise SkillUploadError("压缩包已损坏或不是 zip 格式") from exc
    entries: list[tuple[tuple[str, ...], zipfile.ZipInfo]] = []
    total = 0
    for info in archive.infolist():
        if info.is_dir():
            continue
        name = info.filename.replace("\\", "/")
        path = PurePosixPath(name)
        # 正式机是 Windows：C:/x、C:x 这类盘符路径在 PurePosixPath 下看似相对，拼接后却会写到暂存目录外
        if (path.is_absolute() or ".." in path.parts or not path.parts
                or PureWindowsPath(name).anchor or any(":" in part for part in path.parts)):
            raise SkillUploadError(f"压缩包里有不安全的路径：{info.filename}")
        if (info.external_attr >> 16) & 0o170000 == 0o120000:
            raise SkillUploadError(f"压缩包里不能包含符号链接：{info.filename}")
        if _is_junk(path.parts):
            continue
        total += info.file_size
        entries.append((path.parts, info))
    if len(entries) > MAX_ARCHIVE_ENTRIES:
        raise SkillUploadError(f"压缩包里文件太多（{len(entries)} 个），最多 {MAX_ARCHIVE_ENTRIES} 个")
    if total > MAX_EXTRACTED_BYTES:
        raise SkillUploadError(f"解压后超过 {MAX_EXTRACTED_BYTES // 1024 // 1024}MB")

    skill_files = [parts for parts, _ in entries if parts[-1].lower() == "skill.md"]
    if not skill_files:
        raise SkillUploadError("压缩包里没有找到 SKILL.md")
    depth = min(len(parts) for parts in skill_files)
    if sum(1 for parts in skill_files if len(parts) == depth) > 1:
        raise SkillUploadError("一次只能上传一个技能，压缩包里有多个 SKILL.md")
    root = next(parts for parts in skill_files if len(parts) == depth)[:-1]

    in_root = [(parts[len(root):], info) for parts, info in entries if parts[:len(root)] == root]
    kept = [(rel, info) for rel, info in in_root if PurePosixPath(rel[-1]).suffix.lower() in ALLOWED_SUFFIXES]
    skipped = sorted("/".join(rel) for rel, info in in_root if PurePosixPath(rel[-1]).suffix.lower() not in ALLOWED_SUFFIXES)
    if len(kept) > MAX_FILES:
        raise SkillUploadError(f"文本文件太多（{len(kept)} 个），最多 {MAX_FILES} 个")
    files: dict[str, bytes] = {}
    for rel, info in kept:
        key = "SKILL.md" if rel == (rel[-1],) and rel[-1].lower() == "skill.md" else "/".join(rel)
        files[key] = archive.read(info)
    return files, skipped


def _safe_target(tmp: Path, rel: str) -> Path:
    """写入前再确认一次：解析后的目标必须严格位于暂存目录内。"""
    root = tmp.resolve()
    target = (tmp / rel).resolve()
    if target == root or root not in target.parents:
        raise SkillUploadError(f"压缩包里有不安全的路径：{rel}")
    return target


def install_user_skill(
    data: bytes,
    filename: str,
    user_dir: Path,
    *,
    system_skills: dict[str, str],
    uploader: dict,
    overwrite: bool = False,
) -> tuple[str, list[str]]:
    """校验并安装上传的 Skill，返回 (内部名, 提示列表)。system_skills 为 {name: title}。"""
    if len(data) > MAX_UPLOAD_BYTES:
        raise SkillUploadError(f"文件超过 {MAX_UPLOAD_BYTES // 1024 // 1024}MB")
    suffix = PurePosixPath(str(filename or "").lower()).suffix
    skipped: list[str] = []
    if suffix == ".zip":
        raw_files, skipped = _read_zip(data)
    elif suffix == ".md":
        raw_files = {"SKILL.md": data}
    else:
        raise SkillUploadError("只支持上传 .zip 压缩包或 SKILL.md 文件")

    texts = {rel: _decode_text(content, rel) for rel, content in raw_files.items()}
    meta, _body = parse_frontmatter(texts["SKILL.md"])
    raw_name = str(meta.get("name") or "").strip()
    if not raw_name:
        raise SkillUploadError("SKILL.md 开头缺少 name")
    if not str(meta.get("description") or "").strip():
        raise SkillUploadError("SKILL.md 开头缺少 description")
    name = skill_dir_name(raw_name)
    title = str(meta.get("title") or raw_name).strip()

    if name in system_skills:
        raise SkillUploadError(f"和系统技能「{system_skills[name]}」重名，请修改 name 后再上传")
    dest = user_dir / name
    exists = (dest / "SKILL.md").exists()
    if exists and not overwrite:
        raise SkillUploadError(f"已存在同名技能「{title}」", status_code=409)
    if not exists and user_dir.exists():
        count = sum(1 for child in user_dir.iterdir() if child.is_dir() and not child.name.startswith("."))
        if count >= MAX_SKILLS_PER_USER:
            raise SkillUploadError(f"最多只能添加 {MAX_SKILLS_PER_USER} 个技能，请先删除不用的")

    warnings: list[str] = []
    if skipped:
        sample = "、".join(skipped[:3]) + (f" 等 {len(skipped)} 个文件" if len(skipped) > 3 else "")
        warnings.append(f"{sample} 不是文本文件，已跳过；DesignFlow 只读取 .md / .txt，脚本不会执行")
    declared = meta.get("references_with_image") or []
    if isinstance(declared, str):
        declared = [declared]
    declared = [str(item).strip().lstrip("/") for item in declared] if isinstance(declared, list) else []
    missing = [rel for rel in declared if rel not in texts]
    if missing:
        warnings.append("references_with_image 声明的文件不存在：" + "、".join(missing))
    context_chars = len(texts["SKILL.md"]) + sum(len(texts[rel]) for rel in declared if rel in texts)
    if context_chars > SKILL_CONTEXT_MAX_CHARS:
        warnings.append(f"技能内容约 {context_chars} 字，超过 {SKILL_CONTEXT_MAX_CHARS} 字的部分不会被使用")
    if _SCRIPT_HINT_RE.search(texts["SKILL.md"]):
        warnings.append("技能里提到了脚本或命令，这些步骤在 DesignFlow 中不会执行")

    user_dir.mkdir(parents=True, exist_ok=True)
    tmp = user_dir / f".tmp-{uuid.uuid4().hex}"
    try:
        for rel, text in texts.items():
            target = _safe_target(tmp, rel)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(text, encoding="utf-8")
        (tmp / MANIFEST_NAME).write_text(json.dumps({
            "user_id": str(uploader.get("id") or ""),
            "username": str(uploader.get("username") or ""),
            "original_filename": str(filename or ""),
            "uploaded_at": time.time(),
            "warnings": warnings,
            "skipped_files": skipped,
        }, ensure_ascii=False, indent=2), encoding="utf-8")
        if dest.exists():
            backup = user_dir / f".old-{uuid.uuid4().hex}"
            dest.rename(backup)
            tmp.rename(dest)
            shutil.rmtree(backup, ignore_errors=True)
        else:
            tmp.rename(dest)
    finally:
        if tmp.exists():
            shutil.rmtree(tmp, ignore_errors=True)
    return name, warnings


def delete_user_skill(user_dir: Path, name: str) -> bool:
    clean = str(name or "").strip()
    if not _SAFE_NAME_RE.match(clean):
        return False
    target = user_dir / clean
    if not (target / "SKILL.md").exists():
        return False
    shutil.rmtree(target)
    return True


def _read_manifest(skill_dir: Path) -> dict:
    try:
        data = json.loads((skill_dir / MANIFEST_NAME).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _skill_files(skill_dir: Path) -> list[Path]:
    return sorted(
        path for path in skill_dir.rglob("*")
        if path.is_file() and path.name != MANIFEST_NAME
    )


def list_all_user_skills(base_dir: Path) -> list[dict]:
    """管理员视角：所有用户上传的 Skill 概要。"""
    if not base_dir.exists():
        return []
    items: list[dict] = []
    for user_dir in sorted(base_dir.iterdir()):
        if not user_dir.is_dir() or user_dir.name.startswith("."):
            continue
        for skill_dir in sorted(user_dir.iterdir()):
            if not skill_dir.is_dir() or skill_dir.name.startswith(".") or not (skill_dir / "SKILL.md").exists():
                continue
            manifest = _read_manifest(skill_dir)
            meta, _ = parse_frontmatter((skill_dir / "SKILL.md").read_text(encoding="utf-8-sig", errors="replace"))
            files = _skill_files(skill_dir)
            items.append({
                "user_id": manifest.get("user_id") or user_dir.name,
                "username": manifest.get("username") or "",
                "name": skill_dir.name,
                "title": str(meta.get("title") or meta.get("name") or skill_dir.name),
                "description": str(meta.get("description") or ""),
                "file_count": len(files),
                "total_bytes": sum(path.stat().st_size for path in files),
                "uploaded_at": manifest.get("uploaded_at") or (skill_dir / "SKILL.md").stat().st_mtime,
                "original_filename": manifest.get("original_filename") or "",
                "warnings": manifest.get("warnings") or [],
                "skipped_files": manifest.get("skipped_files") or [],
            })
    items.sort(key=lambda item: item["uploaded_at"], reverse=True)
    return items


def read_user_skill_detail(user_dir: Path, name: str) -> dict | None:
    """管理员视角：单个 Skill 的上传记录和全部文本文件内容。"""
    clean = str(name or "").strip()
    if not _SAFE_NAME_RE.match(clean):
        return None
    skill_dir = user_dir / clean
    if not (skill_dir / "SKILL.md").exists():
        return None
    files = [
        {
            "path": path.relative_to(skill_dir).as_posix(),
            "size": path.stat().st_size,
            "content": path.read_text(encoding="utf-8", errors="replace"),
        }
        for path in _skill_files(skill_dir)
    ]
    files.sort(key=lambda item: (item["path"] != "SKILL.md", item["path"]))
    return {"name": clean, "manifest": _read_manifest(skill_dir), "files": files}
