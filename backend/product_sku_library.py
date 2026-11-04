"""按款号/色号定位素材文件夹；只遍历命中的 SKU 子树，不扫描素材库根目录。"""
from __future__ import annotations

import os
import re
import shutil
import uuid
from pathlib import Path
from urllib.parse import urlencode, quote

from PIL import Image


IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif"}
MAX_SKUS = 20
MAX_IMPORT_IMAGES = 200


def _component(value: str) -> str:
    value = str(value or "").strip()
    if (not value or value in {".", ".."} or value.endswith((".", " "))
            or re.search(r'[\\/:*?"<>|\x00-\x1f]', value)):
        raise ValueError("货号或文件名无效，请检查后再试。")
    return value


def _natural_key(value: str):
    return [(0, int(part)) if part.isdigit() else (1, part.casefold())
            for part in re.split(r"(\d+)", value)]


def _raise_scan_error(error: OSError):
    raise error


class SkuFolderLibrary:
    def __init__(self, primary: Path, additional: Path | None = None):
        self.roots: dict[str, Path] = {"primary": Path(primary).resolve()}
        if additional is not None:
            candidate = Path(additional).resolve()
            if candidate != self.roots["primary"]:
                self.roots["sku"] = candidate
        self._folders: dict[tuple[str, str], Path | None] = {}

    def _folder(self, source: str, sku: str) -> Path | None:
        sku = _component(sku)
        if source not in self.roots:
            raise ValueError("素材库不存在，请重新查询。")
        key = (source, sku)
        if key in self._folders:
            return self._folders[key]
        root = self.roots[source]
        names = list(dict.fromkeys([sku, sku.upper(), sku.lower()]))
        for base in (root, root / "02 产品库"):
            for name in names:
                candidates = [base / name]
                if "-" in name:
                    candidates.append(base / name.rsplit("-", 1)[0] / name)
                for candidate in candidates:
                    if candidate.is_dir():
                        candidate = candidate.resolve()
                        if not candidate.is_relative_to(root) or candidate == root:
                            raise ValueError("素材目录无效，请联系管理员检查。")
                        self._folders[key] = candidate
                        return candidate
        self._folders[key] = None
        return None

    def search(self, text: str) -> dict:
        skus = list(dict.fromkeys(_component(s) for s in re.split(r"[,，\s]+", text.strip()) if s))
        if not skus:
            raise ValueError("请输入商品货号。")
        if len(skus) > MAX_SKUS:
            raise ValueError(f"一次最多查询 {MAX_SKUS} 个货号，请分批查询。")
        folders, missing = [], []
        seen: set[Path] = set()
        available = {key: path.is_dir() for key, path in self.roots.items()}
        for sku in skus:
            found = False
            for source, root in self.roots.items():
                if not available[source]:
                    continue
                target = self._folder(source, sku)
                if target is None:
                    continue
                found = True
                if target in seen:
                    continue
                for directory, entries, files in os.walk(target, followlinks=False, onerror=_raise_scan_error):
                    parent = Path(directory)
                    if parent in seen:
                        entries[:] = []
                        continue
                    seen.add(parent)
                    # Windows junctions must not pull another tree into this SKU.
                    entries[:] = sorted([
                        name for name in entries
                        if not (parent / name).is_symlink()
                        and not getattr(parent / name, "is_junction", lambda: False)()
                        and parent / name not in seen
                    ], key=_natural_key)
                    images = []
                    for filename in sorted(files, key=_natural_key):
                        path = parent / filename
                        if path.suffix.lower() not in IMAGE_EXTENSIONS or path.is_symlink():
                            continue
                        relative = path.relative_to(root).as_posix()
                        query = urlencode({"library": source, "sku": sku, "path": relative})
                        url = "/products/sku-folder-image?" + query
                        images.append({
                            "id": source + ":" + relative, "library": source, "sku": sku,
                            "path": relative, "filename": filename, "url": url, "preview_url": url + "&thumb=1",
                        })
                    # Keep an empty SKU folder visible, while omitting empty nested categories.
                    if images or parent == target:
                        folders.append({
                            "id": source + ":" + parent.relative_to(root).as_posix(), "sku": sku,
                            "name": target.name if parent == target else target.name + "/" + parent.relative_to(target).as_posix(),
                            "library_label": "SKU 素材库" if source == "sku" else "常规素材库",
                            "images": images,
                        })
            if not found:
                missing.append(sku)
        # A style containing only colour folders needs no extra empty parent card.
        folders = [folder for folder in folders if folder["images"] or not any(
            other["sku"] == folder["sku"] and other["images"] for other in folders
        )]
        return {"folders": folders, "missing_skus": missing, "library_exists": any(available.values())}

    def resolve_image(self, source: str, sku: str, relative: str) -> Path:
        relative = str(relative or "")
        if not relative or "\\" in relative or any(_component(part) != part for part in relative.split("/")):
            raise ValueError("素材图片地址无效，请重新选择。")
        target = self._folder(source, sku)
        if target is None:
            raise FileNotFoundError("商品文件夹不存在，请重新查询。")
        path = (self.roots[source] / relative).resolve()
        if not path.is_relative_to(target) or path.suffix.lower() not in IMAGE_EXTENSIONS:
            raise ValueError("素材图片地址无效，请重新选择。")
        if not path.is_file():
            raise FileNotFoundError("素材图片已不存在，请重新查询。")
        return path

    def import_images(self, items: list[dict], output_root: Path, user_id: str) -> list[dict]:
        if not items or len(items) > MAX_IMPORT_IMAGES:
            raise ValueError(f"请选择 1～{MAX_IMPORT_IMAGES} 张图片导入。")
        output_root = Path(output_root).resolve()
        sources, seen = [], set()
        for item in items:
            if not isinstance(item, dict):
                raise ValueError("请选择需要导入的图片。")
            path = self.resolve_image(str(item.get("library") or ""), str(item.get("sku") or ""), str(item.get("path") or ""))
            if path not in seen:
                sources.append((item, path))
                seen.add(path)
        folder = output_root / "ai-images" / _component(user_id) / "product-import" / uuid.uuid4().hex
        folder = folder.resolve()
        if not folder.is_relative_to(output_root):
            raise ValueError("图片保存目录无效，请联系管理员检查。")
        results = []
        try:
            for index, (item, source) in enumerate(sources):
                with Image.open(source) as image:
                    width, height = image.size
                    if image.getexif().get(274) in (5, 6, 7, 8):
                        width, height = height, width
                target = folder / str(index) / source.name
                target.parent.mkdir(parents=True, exist_ok=True)
                # Copy the original bytes; previews never become the canvas source.
                shutil.copyfile(source, target)
                relative = target.relative_to(output_root / "ai-images").as_posix()
                results.append({
                    "url": "/ai-images/" + quote(relative), "name": source.name, "sku": item["sku"],
                    "assetType": "folder", "naturalWidth": width, "naturalHeight": height,
                })
        except Exception:
            shutil.rmtree(folder, ignore_errors=True)
            raise
        return results
