"""
配置管理 — 从环境变量 / .env 文件加载
"""
from __future__ import annotations

import os
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

    # 产品图库目录（相对于项目根目录）
    product_library_path: Path = Path(
        os.getenv("PRODUCT_LIBRARY_PATH", "./product-library")
    )

    # 导出结果目录
    output_path: Path = Path(os.getenv("OUTPUT_PATH", "./output"))

    # 硅基流动 API（用于表格解析，OpenAI 兼容）
    siliconflow_api_key: str = os.getenv("SILICONFLOW_API_KEY", "")
    siliconflow_model: str = os.getenv("SILICONFLOW_MODEL", "Qwen/Qwen2.5-72B-Instruct")
    siliconflow_base_url: str = "https://api.siliconflow.cn/v1"

    # 工作目录（始终指向 design-tool/）
    root_dir: Path = Path(__file__).parent.parent

    def __init__(self) -> None:
        # 解析相对路径（相对于项目根目录）
        if not self.product_library_path.is_absolute():
            self.product_library_path = self.root_dir / self.product_library_path
        if not self.output_path.is_absolute():
            self.output_path = self.root_dir / self.output_path

        self.output_path.mkdir(parents=True, exist_ok=True)


settings = Settings()
