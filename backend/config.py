"""
配置管理 — 从环境变量 / .env 文件加载
"""
from __future__ import annotations

import os
import json
from pathlib import Path

from dotenv import load_dotenv

# 加载 .env（在 backend/ 上一级）
_env_path = Path(__file__).parent.parent / ".env"
load_dotenv(_env_path)


class Settings:
    # Penpot 本地实例
    penpot_base_url: str = os.getenv("PENPOT_BASE_URL", "http://localhost:9001")
    penpot_access_token: str = os.getenv("PENPOT_ACCESS_TOKEN", "")
    penpot_email: str = os.getenv("PENPOT_EMAIL", "")
    penpot_password: str = os.getenv("PENPOT_PASSWORD", "")

    # 目标文件/项目（可选，不强制配置）
    penpot_file_id: str = os.getenv("PENPOT_FILE_ID", "")

    # 产品图库根目录（支持 UNC 路径，如 \\192.168.1.1\素材库）
    product_library_path: Path = Path(
        os.getenv("PRODUCT_LIBRARY_PATH", "./product-library")
    )

    # 图片类型子文件夹映射（类型key → 实际文件夹名）
    # 前端传 image_type="white" → 在 product_library_path/White_Base/ 下查找
    IMAGE_TYPE_FOLDERS: dict[str, str] = {
        "png":      "PNG",
        "model":    "Model_Images",
        "shadow":   "PNG_Shadow",
        "white":    "White_Base",
        "white2x":  "White_Basex2",
        "whitex2":  "White_Basex2",   # slot/product_1/image_whitex2 → White_Basex2 文件夹
        "banner":   "场景图/Banner",     # 横版场景图
        "poster":   "场景图/Poster",    # 竖版场景图
    }

    # 导出结果目录
    output_path: Path = Path(os.getenv("OUTPUT_PATH", "./output"))

    # 硅基流动 API（用于表格解析，OpenAI 兼容）
    siliconflow_api_key: str = os.getenv("SILICONFLOW_API_KEY", "")
    siliconflow_model: str = os.getenv("SILICONFLOW_MODEL", "Qwen/Qwen2.5-72B-Instruct")
    siliconflow_base_url: str = "https://api.siliconflow.cn/v1"

    # AI 生图 API（APIMart）
    ai_image_base_url: str = os.getenv("AI_IMAGE_BASE_URL", "https://api.apimart.ai")
    ai_image_api_key: str = os.getenv("AI_IMAGE_API_KEY", "")

    # AI 生图 API（可选的单独图生图配置；留空则复用上面的 APIMart 配置）
    nano_banana_base_url: str = os.getenv("NANO_BANANA_BASE_URL", "")
    nano_banana_api_key: str = os.getenv("NANO_BANANA_API_KEY", "")

    # 工作目录（始终指向 design-tool/）
    root_dir: Path = Path(__file__).parent.parent

    # 产品知识库（注入到 AI 对话 system prompt）
    knowledge_path: Path = Path(os.getenv("KNOWLEDGE_PATH", "./KNOWLEDGE.md"))

    login_users_path: Path = Path(os.getenv("LOGIN_USERS_PATH", "./login_users.json"))
    allowed_login_users: list[dict[str, str]] = []

    def __init__(self) -> None:
        # 解析相对路径（相对于项目根目录）
        if not self.product_library_path.is_absolute():
            self.product_library_path = self.root_dir / self.product_library_path
        if not self.output_path.is_absolute():
            self.output_path = self.root_dir / self.output_path
        if not self.login_users_path.is_absolute():
            self.login_users_path = self.root_dir / self.login_users_path
        if not self.knowledge_path.is_absolute():
            self.knowledge_path = self.root_dir / self.knowledge_path

        self.output_path.mkdir(parents=True, exist_ok=True)
        self.allowed_login_users = self._load_login_users()

    def _load_knowledge(self) -> str:
        if self.knowledge_path.exists():
            try:
                return self.knowledge_path.read_text(encoding="utf-8")
            except Exception:
                return ""
        return ""

    def _load_login_users(self) -> list[dict[str, str]]:
        default_users = [
            {"id": "admin", "username": "管理员", "role": "admin"},
            {"id": "operator_a", "username": "运营A", "role": "user"},
            {"id": "operator_b", "username": "运营B", "role": "user"},
            {"id": "designer_a", "username": "设计A", "role": "user"},
        ]
        if not self.login_users_path.exists():
            self.login_users_path.write_text(
                json.dumps(default_users, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            return default_users

        try:
            data = json.loads(self.login_users_path.read_text(encoding="utf-8"))
        except Exception:
            return default_users

        users: list[dict[str, str]] = []
        for item in data if isinstance(data, list) else []:
            if isinstance(item, str):
                clean = item.strip()
                if clean:
                    users.append({"id": clean.casefold().replace(" ", "_"), "username": clean, "role": "user"})
                continue
            if isinstance(item, dict):
                username = str(item.get("username", "")).strip()
                user_id = str(item.get("id", "")).strip() or username.casefold().replace(" ", "_")
                role = str(item.get("role", "user")).strip() or "user"
                if username and user_id:
                    users.append({"id": user_id, "username": username, "role": role})
        return users or default_users


settings = Settings()
