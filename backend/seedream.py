"""Seedream 5.5 的统一模型标识；旧入口和已保存配置在新请求时升级。"""

SEEDREAM_MODEL = "seedream-5-5"
SEEDREAM_ALIASES = {
    name: SEEDREAM_MODEL
    for name in (
        SEEDREAM_MODEL, "seedream-5.5",
        "seedream-5.0-pro", "seedream-5.0-flash",
        "seedream-5-0-pro", "seedream-5-0-flash",
    )
}


def upgrade_seedream_model(model: str) -> str:
    clean = str(model or "").strip()
    return SEEDREAM_ALIASES.get(clean.casefold(), clean)
