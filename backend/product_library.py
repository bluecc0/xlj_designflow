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

    def find(self, product_name: str) -> Optional[str]:
        """
        按产品名查找图片路径。
        1. 精确匹配文件名（不含扩展名）
        2. 忽略大小写匹配
        3. 包含关系匹配（产品名是文件名的子串，或反之）
        返回匹配到的文件路径，未找到返回 None。
        """
        if not self.path.exists():
            return None

        name_lower = product_name.lower().strip()
        candidates = []

        for entry in self.path.iterdir():
            if entry.suffix.lower() not in SUPPORTED_EXTS or not entry.is_file():
                continue
            stem_lower = entry.stem.lower().strip()

            # 精确匹配
            if stem_lower == name_lower:
                return str(entry)

            # 包含匹配
            if name_lower in stem_lower or stem_lower in name_lower:
                candidates.append((len(stem_lower), str(entry)))

        if candidates:
            # 优先返回名称最短的（最精确）
            candidates.sort(key=lambda x: x[0])
            return candidates[0][1]

        return None

    def find_by_filename(self, filename: str) -> Optional[str]:
        """按文件名精确查找（含扩展名或不含均可）"""
        if not self.path.exists():
            return None
        target = filename.strip()
        # 先精确匹配完整文件名
        p = self.path / target
        if p.exists() and p.suffix.lower() in SUPPORTED_EXTS:
            return str(p)
        # 再尝试补扩展名
        for ext in SUPPORTED_EXTS:
            p2 = self.path / (target + ext)
            if p2.exists():
                return str(p2)
        # 最后不区分大小写匹配
        target_lower = target.lower()
        for entry in self.path.iterdir():
            if entry.suffix.lower() not in SUPPORTED_EXTS or not entry.is_file():
                continue
            if entry.name.lower() == target_lower or entry.stem.lower() == target_lower:
                return str(entry)
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
