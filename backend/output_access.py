"""输出目录里 ai-images 以外文件的归属判断，静态文件的读取校验和共享画布的保存校验共用。

/output 挂载的是整个输出目录，/results 只是其中的 results 子目录。
没有列在这里的路径（锁文件、被拒绝的画布快照、缩略图缓存等）不属于任何用户。
"""
from __future__ import annotations

import posixpath
import re
from typing import Sequence

from .job_store import load_job_owner_id

_USER_DIRECTORIES = {"agent2-uploads", "proxy-downloads", "psd"}
_JOB_FILE_RE = re.compile(r"(.+?)(?:_grid_\d{2})?\.png")


def output_user_directory(user_id: str) -> str:
    """按用户分目录时的目录名。"""
    return re.sub(r"[^A-Za-z0-9_-]", "_", str(user_id)) or "user"


def output_asset_parts(path: str) -> list[str] | None:
    """把请求路径按静态文件服务的解析方式归一化，返回输出目录下的相对路径；ai-images 和其他路径返回 None。"""
    parts = [part for part in posixpath.normpath(path.replace("\\", "/")).split("/") if part]
    if not parts or parts[0] not in ("output", "results"):
        return None
    if parts[0] == "output":
        parts = parts[1:]
    if parts and parts[0].rstrip(" .").casefold() == "ai-images":
        return None
    return parts


def is_output_asset_owner(parts: Sequence[str], user_id: str) -> bool:
    """只认精确匹配：不区分大小写的文件系统上，大小写或末尾带点的别名一律当作不属于该用户。"""
    if len(parts) == 1:
        match = _JOB_FILE_RE.fullmatch(parts[0])
        return bool(match) and load_job_owner_id(match.group(1)) == user_id
    if len(parts) < 3:
        return False
    if parts[0] == "results":
        return load_job_owner_id(parts[1]) == user_id
    return parts[0] in _USER_DIRECTORIES and parts[1] == output_user_directory(user_id)


def shareable_asset_urls(parts: Sequence[str]) -> list[str]:
    """这个文件放进共享画布时可能用的地址；空列表表示不能靠共享画布放行。"""
    rel = "/".join(parts)
    if len(parts) >= 3 and parts[0] == "results":
        return [f"/results/{'/'.join(parts[1:])}", f"/output/{rel}"]
    if len(parts) == 1 and _JOB_FILE_RE.fullmatch(parts[0]):
        return [f"/output/{rel}"]
    if len(parts) >= 3 and parts[0] in _USER_DIRECTORIES:
        return [f"/output/{rel}"]
    return []
