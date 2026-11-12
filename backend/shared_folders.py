"""共享文件夹白名单：管理员在 shared_folders.json 里配置可访问的共享盘目录，Agent 只读访问。

配置示例（列表，每项一个根目录）：
    [{"name": "素材库", "path": "\\\\192.168.152.52\\素材库",
      "aliases": ["smb://192.168.152.52/素材库", "/Volumes/素材库"], "users": []}]
- path：服务器上实际能访问到的路径（Windows 用 UNC，Mac 用挂载点）
- aliases：用户可能贴过来的其它写法，都映射到 path
- users：允许的用户 id 或用户名；空列表表示所有登录用户
每次调用都重新读配置，改完不用重启。

用户贴的路径写法不固定（smb://、\\\\主机名\\、映射盘符 Z:\\、只写后半段、大小写或空格不一致），
解析时先按配置的前缀匹配，匹配不上再按"路径后半段在某个根目录下真实存在"来认。
"""
from __future__ import annotations

import json
import os
import re
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

from PIL import Image

from .config import settings

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".jfif", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff"}
TABLE_SUFFIXES = {".xlsx", ".xlsm", ".csv"}
_JUNK = {"thumbs.db", ".ds_store", "desktop.ini"}
MAX_LIST_FILES = 3000   # 一次最多列出的图片和表格数
MAX_SIZED_IMAGES = 1500  # 读取宽高的图片数上限（每张要读一次文件头）


class SharedFolderError(Exception):
    pass


@dataclass
class SharedRoot:
    name: str
    path: Path
    prefixes: list[str]
    users: list[str]


def _norm(raw: str) -> str:
    """统一成 //host/share/a/b 或 /Volumes/x 这类正斜杠写法，便于比较前缀。"""
    text = unicodedata.normalize("NFC", str(raw or "")).strip().strip("\"'").replace("\\", "/")
    for scheme in ("smb:", "file:"):
        if text.lower().startswith(scheme):
            text = text[len(scheme):]
    while "//" in text[1:]:
        text = text[0] + text[1:].replace("//", "/")
    return text.rstrip("/")


def _loose(name: str) -> str:
    """文件名的宽松比较：忽略大小写、全半角和首尾空格。"""
    return unicodedata.normalize("NFKC", name).strip().casefold()


def load_roots() -> list[SharedRoot]:
    path = settings.shared_folders_path
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    roots = []
    for item in data if isinstance(data, list) else []:
        if not isinstance(item, dict) or not item.get("name") or not item.get("path"):
            continue
        prefixes = [_norm(p) for p in [item["name"], item["path"], *(item.get("aliases") or [])] if str(p).strip()]
        roots.append(SharedRoot(name=str(item["name"]).strip(), path=Path(str(item["path"]).strip()),
                                prefixes=prefixes, users=[str(u) for u in item.get("users") or []]))
    return roots


def allowed_roots(user: dict) -> list[SharedRoot]:
    ids = {str(user.get("id") or ""), str(user.get("username") or "")}
    return [r for r in load_roots() if not r.users or ids & set(r.users)]


def _walk_parts(base: Path, parts: list[str]) -> Path | None:
    """从 base 往下逐级找；名字精确匹配不到时按宽松规则（大小写、全半角、空格）再找一次。"""
    current = base
    for part in parts:
        exact = current / part
        if exact.exists():
            current = exact
            continue
        try:
            hit = next((e for e in os.scandir(current) if _loose(e.name) == _loose(part)), None)
        except OSError:
            return None
        if hit is None:
            return None
        current = Path(hit.path)
    return current


def _shown(root: SharedRoot, path: Path) -> str:
    try:
        rest = path.relative_to(root.path).as_posix()
    except ValueError:
        rest = ""
    return f"{root.name}/{rest}" if rest and rest != "." else root.name


def _candidates(roots: list[SharedRoot], target: str) -> list[tuple[SharedRoot, list[str], bool]]:
    """(根目录, 根目录下的路径分段, 是否是明确的前缀匹配)。明确匹配排在前面。"""
    out = []
    for root in roots:
        for prefix in root.prefixes:
            if target.lower() == prefix.lower() or target.lower().startswith(prefix.lower() + "/"):
                out.append((root, [p for p in target[len(prefix):].split("/") if p], True))
    # 匹配不上配置的前缀：盘符（Z:）、主机名、挂载点各人不同，按"后半段在根目录下真实存在"来认
    parts = [p for p in target.split("/") if p and not re.fullmatch(r"[A-Za-z]:", p)]
    for root in roots:
        for i, part in enumerate(parts):
            if _loose(part) == _loose(root.name):
                out.append((root, parts[i + 1:], False))
    for i in range(len(parts)):
        for root in roots:
            out.append((root, parts[i:], False))
    return out


def resolve(user: dict, raw: str, base: str = "") -> tuple[SharedRoot, Path, str]:
    """把用户给的路径映射到白名单根目录下，返回 (根目录, 实际路径, 显示用路径)。
    base：raw 是相对路径时的基准文件夹。"""
    target = _norm(raw)
    if ".." in target.split("/"):
        raise SharedFolderError("路径里不能有 ..")
    roots = allowed_roots(user)
    if not roots:
        raise SharedFolderError("还没有配置可访问的共享文件夹，请联系管理员在 shared_folders.json 里添加")
    if base:
        base_root, base_path, _ = resolve(user, base)
        hit = _walk_parts(base_path, [p for p in target.split("/") if p])
        if hit is not None:
            return _check_inside(base_root, hit)
    fallback = None
    for root, parts, explicit in _candidates(roots, target):
        hit = _walk_parts(root.path, parts)
        if hit is not None:
            return _check_inside(root, hit)
        if explicit and fallback is None:
            fallback = (root, root.path.joinpath(*parts))
    if fallback:  # 前缀对得上但文件不存在：交给调用方报"找不到"
        return fallback[0], fallback[1], _shown(*fallback)
    names = "、".join(r.name for r in roots)
    raise SharedFolderError(f"这个路径不在可访问的共享文件夹里，或者路径不存在（可访问：{names}）")


def _check_inside(root: SharedRoot, path: Path) -> tuple[SharedRoot, Path, str]:
    # 防止符号链接跳出根目录
    if not path.resolve().is_relative_to(root.path.resolve()):
        raise SharedFolderError("路径超出了共享文件夹范围")
    return root, path, _shown(root, path)


def natural_key(name: str):
    """按"名字 + 编号"排序：男子-1、男子-2、男子4、男子-5（忽略 - _ 空格，编号按数值比）。"""
    stem, _, suffix = name.rpartition(".") if "." in name else (name, "", "")
    match = re.search(r"(\d+)\D*$", stem)
    if not match:
        return (re.sub(r"[-_\s]", "", stem).lower(), -1, suffix)
    head = re.sub(r"[-_\s]", "", stem[:match.start(1)]).lower()
    return (head, int(match.group(1)), stem[match.end(1):] + suffix)


def _image_size(path: str) -> str:
    try:
        with Image.open(path) as im:  # 只读文件头
            return f"{im.width}x{im.height}"
    except Exception:
        return ""


def _is_junk(name: str) -> bool:
    return name.lower() in _JUNK or name.startswith((".", "~$"))


def _inside(root_real: Path, path: Path) -> bool:
    try:
        return path.resolve().is_relative_to(root_real)
    except (OSError, RuntimeError):  # 解析不了（断链、链接循环）一律当作越界
        return False


def _scan(folder: Path, root_real: Path, seen: set[Path]) -> tuple[list[os.DirEntry], list[os.DirEntry]]:
    """列出一个文件夹里的子文件夹和文件，只保留实际位置仍在白名单根目录里的。
    符号链接、Windows 目录联接（junction）指向根目录外面的直接丢掉；
    seen 记录已经进过的目录（按实际位置），链接绕回来的不再进，防止死循环。"""
    subdirs, files = [], []
    for entry in sorted((e for e in os.scandir(folder) if not _is_junk(e.name)), key=lambda e: natural_key(e.name)):
        linked = entry.is_symlink() or getattr(entry, "is_junction", lambda: False)()
        try:
            is_dir = entry.is_dir()
        except OSError:
            continue
        if is_dir:
            try:
                real = Path(entry.path).resolve()
            except (OSError, RuntimeError):
                continue
            if real.is_relative_to(root_real) and real not in seen:
                seen.add(real)
                subdirs.append(entry)
        elif not linked or _inside(root_real, Path(entry.path)):
            files.append(entry)
    return subdirs, files


def _walk_start(root: SharedRoot, path: Path) -> tuple[Path, set[Path]]:
    root_real = root.path.resolve()
    return root_real, {path.resolve()}


def list_folder(user: dict, raw: str, recursive: bool = True) -> dict:
    """按文件夹列出图片和表格（不限层级）。图片带宽高，其它文件（PSD、日志等）只按类型计数。"""
    root, path, shown = resolve(user, raw)
    if not path.is_dir():
        raise SharedFolderError(f"找不到文件夹：{shown}")
    root_real, seen = _walk_start(root, path)
    folders: list[dict] = []
    sized: list[tuple[dict, int, str]] = []
    listed = 0
    truncated = False

    def scan(folder: Path, rel: str):
        nonlocal listed, truncated
        try:
            subdirs, files = _scan(folder, root_real, seen)
        except OSError as exc:
            if not rel:
                raise SharedFolderError(f"读取文件夹失败：{exc}") from exc
            folders.append({"dir": rel, "error": "读取失败"})
            return
        entry = {"dir": rel or ".", "images": [], "tables": [], "subfolders": [d.name for d in subdirs]}
        others: dict[str, int] = {}
        for item in files:
            suffix = Path(item.name).suffix.lower()
            if suffix not in IMAGE_SUFFIXES and suffix not in TABLE_SUFFIXES:
                kind = suffix.lstrip(".") or "无扩展名"
                others[kind] = others.get(kind, 0) + 1
            elif listed >= MAX_LIST_FILES:
                truncated = True
            elif suffix in TABLE_SUFFIXES:
                listed += 1
                entry["tables"].append(item.name)
            else:
                listed += 1
                entry["images"].append(item.name)
                if len(sized) < MAX_SIZED_IMAGES:
                    sized.append((entry, len(entry["images"]) - 1, item.path))
        if others:
            entry["other_files"] = "、".join(f"{k}×{v}" for k, v in sorted(others.items()))
        folders.append({k: v for k, v in entry.items() if v})
        if recursive:
            for sub in subdirs:
                scan(Path(sub.path), f"{rel}/{sub.name}" if rel else sub.name)

    scan(path, "")
    # 宽高并发读取：共享盘上逐个读文件头比较慢
    with ThreadPoolExecutor(max_workers=8) as pool:
        for (entry, idx, _p), size in zip(sized, pool.map(_image_size, [p for _e, _i, p in sized])):
            if size:
                entry["images"][idx] += f" ({size})"
    out = {"folder": shown, "folders": folders, "note": "images 里名字后面是 宽x高；文件路径 = folder/dir/文件名"}
    if truncated:
        out["truncated"] = f"图片和表格超过 {MAX_LIST_FILES} 个，只列出了一部分，请缩小到子文件夹再看"
    return out


def find_files(user: dict, raw: str, suffixes: set[str], limit: int) -> tuple[str, list[tuple[str, Path]], bool]:
    """递归找出文件夹里指定类型的文件，返回 (显示用路径, [(相对路径, 实际路径)], 是否超出上限)。"""
    root, path, shown = resolve(user, raw)
    if not path.is_dir():
        raise SharedFolderError(f"找不到文件夹：{shown}")
    root_real, seen = _walk_start(root, path)
    found: list[tuple[str, Path]] = []
    truncated = False

    def scan(folder: Path, rel: str):
        nonlocal truncated
        try:
            subdirs, files = _scan(folder, root_real, seen)
        except OSError:
            return
        for item in files:
            if Path(item.name).suffix.lower() in suffixes:
                if len(found) >= limit:
                    truncated = True
                    return
                found.append((f"{rel}/{item.name}" if rel else item.name, Path(item.path)))
        for sub in subdirs:
            scan(Path(sub.path), f"{rel}/{sub.name}" if rel else sub.name)

    scan(path, "")
    return shown, found, truncated


def human_size(size: int) -> str:
    return f"{size / 1024 / 1024:.2f} MB" if size >= 1024 * 1024 else f"{size / 1024:.0f} KB"


def large_images(user: dict, raw: str, min_mb: float) -> dict:
    """文件夹（含子文件夹）里大于 min_mb 的图片，从大到小。1 MB 按 1024 × 1024 字节算。"""
    shown, found, truncated = find_files(user, raw, IMAGE_SUFFIXES, MAX_LIST_FILES)
    limit = int(min_mb * 1024 * 1024)
    sizes = []
    for rel, path in found:
        try:
            sizes.append((rel, path.stat().st_size))
        except OSError:
            continue
    big = sorted(((rel, size) for rel, size in sizes if size > limit), key=lambda x: -x[1])
    out = {"folder": shown, "rule": f"大于 {min_mb:g} MB（1 MB = 1024 KB = {1024 * 1024:,} 字节）",
           "images_checked": len(sizes), "over_limit": len(big),
           "images": [{"path": rel, "size": human_size(size), "bytes": size} for rel, size in big]}
    if truncated:
        out["truncated"] = f"图片超过 {MAX_LIST_FILES} 张，只检查了前 {MAX_LIST_FILES} 张，请缩小到子文件夹再查"
    return out


def read_file(user: dict, raw: str, suffixes: set[str], base: str = "") -> tuple[bytes, str, str]:
    """读取白名单里的单个文件，返回 (内容, 文件名, 显示用路径)。"""
    _root, path, shown = resolve(user, raw, base)
    if path.suffix.lower() not in suffixes:
        hint = "；xls 请另存为 xlsx" if path.suffix.lower() == ".xls" else ""
        raise SharedFolderError(f"{shown} 不是支持的文件类型（{'、'.join(sorted(suffixes))}）{hint}")
    if not path.is_file():
        raise SharedFolderError(f"找不到文件：{shown}")
    return path.read_bytes(), path.name, shown
