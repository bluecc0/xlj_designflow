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
    ai_image_provider: str = os.getenv("AI_IMAGE_PROVIDER", "apimart")
    ai_image_base_url: str = os.getenv("AI_IMAGE_BASE_URL", "https://api.apimart.ai")
    ai_image_api_key: str = os.getenv("AI_IMAGE_API_KEY", "")

    # AI 生图 API（ZenMux，多模型备用线路；API key 留空则禁用）
    zenmux_base_url: str = os.getenv("ZENMUX_BASE_URL", "https://zenmux.ai/api/v1")
    zenmux_api_key: str = os.getenv("ZENMUX_API_KEY", "")
    zenmux_management_api_key: str = os.getenv("ZENMUX_MANAGEMENT_API_KEY", "")
    zenmux_gpt_image_model: str = os.getenv("ZENMUX_GPT_IMAGE_MODEL", "openai/gpt-image-2")
    zenmux_nano_banana_model: str = os.getenv("ZENMUX_NANO_BANANA_MODEL", "google/gemini-3-pro-image-preview")

    # AI 生图 API（订阅线路；CLIProxyAPI 优先，兼容旧 SUB2API_* 环境变量）
    sub2api_base_url: str = os.getenv("SUB2API_BASE_URL", "")
    sub2api_api_key: str = os.getenv("SUB2API_API_KEY", "")
    cliproxy_base_url: str = os.getenv("CLIPROXY_BASE_URL", "") or sub2api_base_url
    cliproxy_api_key: str = os.getenv("CLIPROXY_API_KEY", "") or sub2api_api_key

    # AI 生图 API（可选的单独图生图配置；留空则复用上面的 APIMart 配置）
    nano_banana_base_url: str = os.getenv("NANO_BANANA_BASE_URL", "")
    nano_banana_api_key: str = os.getenv("NANO_BANANA_API_KEY", "")

    # VLM 图像分析配置；留空则复用 APIMart 的 BASE_URL / API_KEY
    vlm_model: str = os.getenv("VLM_MODEL", "qwen2.5-vl-72b-instruct")
    vlm_base_url: str = os.getenv("VLM_BASE_URL", "") or ai_image_base_url
    vlm_api_key: str = os.getenv("VLM_API_KEY", "") or ai_image_api_key

    # agent mode
    agent_llm_model: str = os.getenv("AGENT_LLM_MODEL", "") or siliconflow_model
    agent_llm_base_url: str = os.getenv("AGENT_LLM_BASE_URL", "") or siliconflow_base_url
    agent_llm_api_key: str = os.getenv("AGENT_LLM_API_KEY", "") or siliconflow_api_key
    agent_llm_timeout_seconds: int = int(os.getenv("AGENT_LLM_TIMEOUT_SECONDS", "60"))

    agent_image_model: str = os.getenv("AGENT_IMAGE_MODEL", "gpt image 2")
    agent_refine_model: str = os.getenv("AGENT_REFINE_MODEL", "nano banana pro")
    agent_image_size: str = os.getenv("AGENT_IMAGE_SIZE", "auto")
    agent_image_resolution: str = os.getenv("AGENT_IMAGE_RESOLUTION", "")

    agent_vlm_model: str = os.getenv("AGENT_VLM_MODEL", "") or vlm_model
    agent_vlm_base_url: str = os.getenv("AGENT_VLM_BASE_URL", "") or vlm_base_url
    agent_vlm_api_key: str = os.getenv("AGENT_VLM_API_KEY", "") or vlm_api_key
    agent_vlm_timeout_seconds: int = int(os.getenv("AGENT_VLM_TIMEOUT_SECONDS", "60"))

    # 工作目录（始终指向 design-tool/）
    # proxy_download relay
    proxy_download_enabled: bool = os.getenv("PROXY_DOWNLOAD_ENABLED", "false").strip().lower() in {"1", "true", "yes", "on"}
    proxy_download_base_url: str = os.getenv("PROXY_DOWNLOAD_BASE_URL", "http://127.0.0.1:8765")
    proxy_download_token: str = os.getenv("PROXY_DOWNLOAD_TOKEN", "")
    proxy_download_allowed_hosts: str = os.getenv("PROXY_DOWNLOAD_ALLOWED_HOSTS", "huaban.com,www.huaban.com,huabanimg.com")
    proxy_download_headless: bool = os.getenv("PROXY_DOWNLOAD_HEADLESS", "false").strip().lower() in {"1", "true", "yes", "on"}
    proxy_download_browser_channel: str = os.getenv("PROXY_DOWNLOAD_BROWSER_CHANNEL", "msedge")
    proxy_download_login_url: str = os.getenv("PROXY_DOWNLOAD_LOGIN_URL", "https://huaban.com/")
    proxy_download_request_timeout_seconds: int = int(os.getenv("PROXY_DOWNLOAD_REQUEST_TIMEOUT_SECONDS", "180"))
    proxy_download_navigation_timeout_ms: int = int(os.getenv("PROXY_DOWNLOAD_NAVIGATION_TIMEOUT_MS", "30000"))

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

        # 统一补协议前缀，避免 ai_image_base_url 等配置没有 http://
        for _key in ("ai_image_base_url", "nano_banana_base_url", "vlm_base_url", "agent_vlm_base_url", "zenmux_base_url", "cliproxy_base_url"):
            _val = getattr(self, _key, "")
            if _val and not _val.startswith("http"):
                setattr(self, _key, "https://" + _val)

    def _load_knowledge(self) -> str:
        if not self.knowledge_path.exists():
            return ""
        try:
            mtime = self.knowledge_path.stat().st_mtime
            cached = getattr(self, "_knowledge_cache", None)
            if cached and cached[0] == mtime:
                return cached[1]
            text = self.knowledge_path.read_text(encoding="utf-8")
            self._knowledge_cache = (mtime, text)
            return text
        except Exception:
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

    def reload_login_users(self) -> list[dict[str, str]]:
        """从 login_users.json 重新读取用户列表（热加载用）。"""
        self.allowed_login_users = self._load_login_users()
        return self.allowed_login_users

    def save_login_users(self, users: list[dict[str, str]]) -> None:
        """写入 login_users.json 并热更新内存。"""
        self.login_users_path.write_text(
            json.dumps(users, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        self.reload_login_users()


settings = Settings()
