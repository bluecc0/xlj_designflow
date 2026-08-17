"""
配置管理 — 从环境变量 / .env 文件加载
"""
from __future__ import annotations

import os
import json
from pathlib import Path

from dotenv import dotenv_values, load_dotenv

# 加载 .env（在 backend/ 上一级）
_env_path = Path(__file__).parent.parent / ".env"
# The checked-in launcher may discover a virtual WSL/Hyper-V adapter first.
# Keep only the browser-facing Penpot URL controlled by the repository's .env;
# other process-level environment variables retain their normal precedence.
load_dotenv(_env_path)
_penpot_url_from_env = dotenv_values(_env_path).get("PENPOT_BASE_URL")
if _penpot_url_from_env:
    os.environ["PENPOT_BASE_URL"] = str(_penpot_url_from_env)


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

    # AI 生图 API（订阅线路；CLIProxyAPI 优先，兼容旧 SUB2API_* 环境变量）
    sub2api_base_url: str = os.getenv("SUB2API_BASE_URL", "")
    sub2api_api_key: str = os.getenv("SUB2API_API_KEY", "")
    cliproxy_base_url: str = os.getenv("CLIPROXY_BASE_URL", "") or sub2api_base_url
    cliproxy_api_key: str = os.getenv("CLIPROXY_API_KEY", "") or sub2api_api_key
    cliproxy_proxy_url: str = os.getenv("CLIPROXY_PROXY_URL", "").strip()
    ai_image_download_proxy_url: str = os.getenv("AI_IMAGE_DOWNLOAD_PROXY_URL", "").strip()
    sub2api_monitor_enabled: bool = os.getenv("SUB2API_MONITOR_ENABLED", "true").strip().lower() in ("1", "true", "yes", "on")
    sub2api_monitor_timezone: str = os.getenv("SUB2API_MONITOR_TIMEZONE", "Asia/Shanghai").strip() or "Asia/Shanghai"
    sub2api_monitor_timeout_seconds: int = int(os.getenv("SUB2API_MONITOR_TIMEOUT_SECONDS", "600"))
    sub2api_monitor_retention_days: int = int(os.getenv("SUB2API_MONITOR_RETENTION_DAYS", "30"))

    # 默认对话 LLM：优先使用订阅 OpenAI-compatible line，SiliconFlow Qwen 作为兜底
    chat_llm_model: str = os.getenv("CHAT_LLM_MODEL", "") or "gpt-5.5"
    chat_llm_base_url: str = os.getenv("CHAT_LLM_BASE_URL", "") or cliproxy_base_url
    chat_llm_api_key: str = os.getenv("CHAT_LLM_API_KEY", "") or cliproxy_api_key
    chat_llm_timeout_seconds: int = int(os.getenv("CHAT_LLM_TIMEOUT_SECONDS", "30"))

    # 硅基流动 API（默认对话兜底 / 旧表格解析，OpenAI 兼容）
    siliconflow_api_key: str = os.getenv("SILICONFLOW_API_KEY", "")
    siliconflow_model: str = os.getenv("SILICONFLOW_MODEL", "Qwen/Qwen2.5-72B-Instruct")
    siliconflow_base_url: str = "https://api.siliconflow.cn/v1"

    # AI 生图 API（APIMart）
    ai_image_provider: str = os.getenv("AI_IMAGE_PROVIDER", "auto")
    ai_image_base_url: str = os.getenv("AI_IMAGE_BASE_URL", "https://api.apimart.ai")
    ai_image_api_key: str = os.getenv("AI_IMAGE_API_KEY", "")
    ai_image_job_timeout_seconds: int = int(os.getenv("AI_IMAGE_JOB_TIMEOUT_SECONDS", "600"))

    # AI 生图 API（adobe2api）
    adobe2api_base_url: str = os.getenv("ADOBE2API_BASE_URL", "http://77.73.8.142:6001/v1")
    adobe2api_api_key: str = os.getenv("ADOBE2API_API_KEY", "")

    # 智能路由模型自定义优先级规则 JSON（可选，用于动态覆写）
    smart_routing_rules_json: str = os.getenv("SMART_ROUTING_RULES_JSON", "")

    # AI 生图 API（可选的单独图生图配置；留空则复用上面的 APIMart 配置）
    nano_banana_base_url: str = os.getenv("NANO_BANANA_BASE_URL", "")
    nano_banana_api_key: str = os.getenv("NANO_BANANA_API_KEY", "")

    # VLM 图像分析配置；留空则复用 APIMart 的 BASE_URL / API_KEY
    vlm_model: str = os.getenv("VLM_MODEL", "qwen2.5-vl-72b-instruct")
    vlm_base_url: str = os.getenv("VLM_BASE_URL", "") or ai_image_base_url
    vlm_api_key: str = os.getenv("VLM_API_KEY", "") or ai_image_api_key

    # Kie Seedream 图层分离；key 留空则转 PSD 功能明确不可用
    kie_base_url: str = os.getenv("KIE_BASE_URL", "https://api.kie.ai")
    kie_upload_base_url: str = os.getenv("KIE_UPLOAD_BASE_URL", "https://kieai.redpandaai.co")
    kie_api_key: str = os.getenv("KIE_API_KEY", "")
    kie_layer_model: str = os.getenv("KIE_LAYER_MODEL", "seedream/5-pro-layer-decomposition")
    kie_layer_size: str = os.getenv("KIE_LAYER_SIZE", "auto")
    kie_layer_output_format: str = os.getenv("KIE_LAYER_OUTPUT_FORMAT", "png")
    kie_timeout_seconds: int = int(os.getenv("KIE_TIMEOUT_SECONDS", "900"))
    kie_poll_interval_seconds: float = float(os.getenv("KIE_POLL_INTERVAL_SECONDS", "3"))
    kie_input_download_retries: int = int(os.getenv("KIE_INPUT_DOWNLOAD_RETRIES", "1"))
    kie_result_download_retries: int = int(os.getenv("KIE_RESULT_DOWNLOAD_RETRIES", "1"))

    # agent mode
    agent_llm_model: str = os.getenv("AGENT_LLM_MODEL", "") or "gpt-5.5"
    agent_llm_base_url: str = os.getenv("AGENT_LLM_BASE_URL", "") or cliproxy_base_url
    agent_llm_api_key: str = os.getenv("AGENT_LLM_API_KEY", "") or cliproxy_api_key
    agent_llm_timeout_seconds: int = int(os.getenv("AGENT_LLM_TIMEOUT_SECONDS", "60"))

    agent_image_model: str = os.getenv("AGENT_IMAGE_MODEL", "gpt image 2")
    agent_refine_model: str = os.getenv("AGENT_REFINE_MODEL", "nano banana pro")
    agent_image_size: str = os.getenv("AGENT_IMAGE_SIZE", "auto")
    agent_image_resolution: str = os.getenv("AGENT_IMAGE_RESOLUTION", "")

    agent_vlm_model: str = os.getenv("AGENT_VLM_MODEL", "") or vlm_model
    agent_vlm_base_url: str = os.getenv("AGENT_VLM_BASE_URL", "") or vlm_base_url
    agent_vlm_api_key: str = os.getenv("AGENT_VLM_API_KEY", "") or vlm_api_key
    agent_vlm_timeout_seconds: int = int(os.getenv("AGENT_VLM_TIMEOUT_SECONDS", "60"))

    # Codex-style instruction skills. Use os.pathsep to separate multiple roots.
    agent_skill_paths: str = os.getenv("AGENT_SKILL_PATHS", "./skills")

    # Skill planner LLM. Defaults to the subscription OpenAI-compatible line so
    # SKILL.md interpretation can use a stronger model without affecting chat.
    skill_llm_model: str = os.getenv("SKILL_LLM_MODEL", "gpt-5.5")
    skill_llm_base_url: str = os.getenv("SKILL_LLM_BASE_URL", "") or cliproxy_base_url
    skill_llm_api_key: str = os.getenv("SKILL_LLM_API_KEY", "") or cliproxy_api_key
    skill_llm_timeout_seconds: int = int(os.getenv("SKILL_LLM_TIMEOUT_SECONDS", "60"))

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

    # 本地高清放大 CLI。必须配置 gigapixel-beta.exe 路径；留空则高清放大不可用。
    upscale_cli_path: str = os.getenv("UPSCALE_CLI_PATH", "").strip()
    upscale_cli_model: str = os.getenv("UPSCALE_CLI_MODEL", "").strip()
    upscale_cli_scale: int = int(os.getenv("UPSCALE_CLI_SCALE", "2"))
    upscale_cli_timeout_seconds: int = int(os.getenv("UPSCALE_CLI_TIMEOUT_SECONDS", "900"))

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
        for _key in ("ai_image_base_url", "nano_banana_base_url", "vlm_base_url", "agent_vlm_base_url", "kie_base_url", "kie_upload_base_url", "adobe2api_base_url", "cliproxy_base_url", "chat_llm_base_url", "skill_llm_base_url"):
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
                password_hash = str(item.get("password_hash", "")).strip()
                display_name = str(item.get("display_name", "")).strip()
                is_test = bool(item.get("is_test", False))
                if username and user_id:
                    users.append({
                        "id": user_id,
                        "username": username,
                        "role": role,
                        "password_hash": password_hash,
                        "display_name": display_name,
                        "is_test": is_test,
                    })
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

    def get_test_user_ids(self) -> set[str]:
        """返回所有标为测试账号的用户 ID 集合。"""
        return {
            str(u.get("id") or "").strip()
            for u in getattr(self, "allowed_login_users", [])
            if u.get("is_test")
        }


settings = Settings()
