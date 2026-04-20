"""
slot_schema.py — 加载并暴露 slot_schema.json 的内容

用法:
    from .slot_schema import schema

    schema.text_fields          # ["name", "price", "tag", "spec"]
    schema.all_fields           # ["image", "name", "price", "tag", "spec"]
    schema.column_aliases       # {"name": [...], "price": [...], ...}
    schema.image_filename_aliases  # [...]
    schema.discard_keywords     # [...]
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

# slot_schema.json 放在项目根目录（backend 的上一级）
_SCHEMA_PATH = Path(__file__).parent.parent / "slot_schema.json"


class SlotSchema:
    def __init__(self, path: Path) -> None:
        with open(path, "r", encoding="utf-8") as f:
            data: dict[str, Any] = json.load(f)

        self._data = data
        self.version: str = data.get("version", "1.0")
        self.fields: list[dict] = data.get("fields", [])

        # 便捷属性
        self.all_fields: list[str] = [f["key"] for f in self.fields]
        self.text_fields: list[str] = [f["key"] for f in self.fields if f.get("type") == "text"]
        self.image_fields: list[str] = [f["key"] for f in self.fields if f.get("type") == "image"]
        self.required_fields: list[str] = [f["key"] for f in self.fields if f.get("required")]

        # 列名别名映射：{ field_key: [alias1, alias2, ...] }
        self.column_aliases: dict[str, list[str]] = {
            f["key"]: f.get("column_aliases", [])
            for f in self.fields
            if f.get("type") == "text"
        }

        self.image_filename_aliases: list[str] = data.get("image_filename_aliases", [])
        self.discard_keywords: list[str] = data.get("discard_column_keywords", [])

    def reload(self) -> None:
        """热重载，修改 json 后调用无需重启服务"""
        self.__init__(_SCHEMA_PATH)

    def to_dict(self) -> dict:
        return self._data


# 单例，启动时加载一次
schema = SlotSchema(_SCHEMA_PATH)
