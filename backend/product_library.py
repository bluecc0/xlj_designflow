"""
产品图库管理

负责：
- 扫描本地产品图库目录
- 按产品名称匹配图片（精确 > 模糊）
- 返回匹配图片路径
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Optional


SUPPORTED_EXTS = {".png", ".jpg", ".jpeg", ".webp"}
EXT_PRIORITY = [".png", ".jpg", ".jpeg", ".webp"]  # 同名时优先选 PNG


class ProductLibrary:
    def __init__(self, library_path: Path) -> None:
        self.path = Path(library_path)

    def list_products(self) -> list[dict]:
        """列出图库中所有产品图片"""
        products = []
        if not self.path.exists():
            return products
        for entry in sorted(self.path.iterdir()):
            if entry.suffix.lower() in SUPPORTED_EXTS and entry.is_file():
                products.append(
                    {
                        "name": entry.stem,
                        "filename": entry.name,
                        "path": str(entry),
                        "size": entry.stat().st_size,
                    }
                )
        return products

    def find(self, product_name: str, search_dir: Optional["Path"] = None) -> Optional[str]:
        """
        按产品名查找图片路径（只做路径构造，不遍历目录）。
        search_dir 未指定时默认用 self.path。
        只按扩展名优先级逐一拼接路径检查是否存在，避免 iterdir() 遍历大目录。
        """
        base = search_dir if search_dir is not None else self.path
        if not base.exists():
            return None
        name = product_name.strip()
        for ext in EXT_PRIORITY:
            p = base / (name + ext)
            if p.exists():
                return str(p)
        return None

    def find_by_filename(self, filename: str, search_dir: Optional["Path"] = None) -> Optional[str]:
        """
        按文件名查找（含扩展名或不含均可），只做路径构造，不遍历目录。
        search_dir 未指定时默认用 self.path。
        """
        base = search_dir if search_dir is not None else self.path
        if not base.exists():
            return None
        target = filename.strip()
        # 先直接拼接完整文件名
        p = base / target
        if p.exists() and p.suffix.lower() in SUPPORTED_EXTS:
            return str(p)
        # 再按扩展名优先级补后缀
        stem = target.rsplit(".", 1)[0] if "." in target else target
        for ext in EXT_PRIORITY:
            p2 = base / (stem + ext)
            if p2.exists():
                return str(p2)
        return None

    def find_in_folder(self, product_name: str, folder: str) -> Optional[str]:
        """
        在指定子文件夹里按产品名（SKU）查找图片。
        只做路径构造 + exists()，绝不 iterdir()。
        UNC 路径下 iterdir()+is_file() 每个文件都是独立网络请求，5万文件=500秒。
        """
        target_dir = self.path / folder
        if not target_dir.exists():
            return None

        name = product_name.strip()

        # 按扩展名优先级逐一拼路径，直接 exists() 检查
        for ext in EXT_PRIORITY:
            p = target_dir / (name + ext)
            if p.exists():
                return str(p)

        # 大小写变体：全大写 / 全小写
        for variant in (name.upper(), name.lower()):
            if variant == name:
                continue
            for ext in EXT_PRIORITY:
                p = target_dir / (variant + ext)
                if p.exists():
                    return str(p)

        return None

    def find_all(self, product_name: str) -> list[str]:
        """返回所有模糊匹配结果"""
        if not self.path.exists():
            return []

        name_lower = product_name.lower().strip()
        results = []

        for entry in self.path.iterdir():
            if entry.suffix.lower() not in SUPPORTED_EXTS or not entry.is_file():
                continue
            stem_lower = entry.stem.lower().strip()
            if name_lower in stem_lower or stem_lower in name_lower:
                results.append(str(entry))

        return results
