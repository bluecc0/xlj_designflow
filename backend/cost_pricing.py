"""Model pricing and cost estimation for DesignFlow Cost Center."""
from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

# Default image generation pricing (USD per image/call by resolution tier).
# Upstream-returned `cost` always takes precedence when present.
DEFAULT_IMAGE_PRICING: dict[str, dict[str, Any]] = {
    "gpt-image-2": {"price_1k": 0.04, "price_1_5k": 0.05, "price_2k": 0.06, "price_4k": 0.08},
    "gpt-image-2.5": {"price_1k": 0.05, "price_1_5k": 0.06, "price_2k": 0.075, "price_4k": 0.10},
    "gpt-image-2.6": {"price_1k": 0.06, "price_1_5k": 0.075, "price_2k": 0.09, "price_4k": 0.12},
    "gemini-3-pro-image-preview": {"price_1k": 0.04, "price_1_5k": 0.05, "price_2k": 0.06, "price_4k": 0.08},
    "gemini-nano-banana-2.1": {"price_1k": 0.03, "price_1_5k": 0.04, "price_2k": 0.045, "price_4k": 0.06},
    "seedream-5.0-lite": {"price_1k": 0.03, "price_1_5k": 0.035, "price_2k": 0.04, "price_4k": 0.06},
    "seedream-4.5": {"price_1k": 0.03, "price_1_5k": 0.035, "price_2k": 0.04, "price_4k": 0.06},
    "seedream-4.0": {"price_1k": 0.025, "price_1_5k": 0.03, "price_2k": 0.035, "price_4k": 0.05},
    "flux-tools/outpainting-v1": {"price_1k": 0.05, "price_1_5k": 0.05, "price_2k": 0.05, "price_4k": 0.05},
    "flux-vto": {"price_1k": 0.05, "price_1_5k": 0.05, "price_2k": 0.05, "price_4k": 0.05},
    "kie-topaz": {"price_1k": 0.04, "price_1_5k": 0.04, "price_2k": 0.04, "price_4k": 0.08},
    "layer-extract": {"price_1k": 0.03, "price_1_5k": 0.03, "price_2k": 0.03, "price_4k": 0.03},
}

# Default LLM / VLM pricing (USD per 1M tokens).
DEFAULT_LLM_PRICING: dict[str, dict[str, float]] = {
    "gpt-5": {"input_per_1m": 1.25, "output_per_1m": 10.0},
    "gpt-5-mini": {"input_per_1m": 0.25, "output_per_1m": 2.0},
    "gpt-4.1": {"input_per_1m": 2.0, "output_per_1m": 8.0},
    "gpt-4.1-mini": {"input_per_1m": 0.4, "output_per_1m": 1.6},
    "gpt-4o": {"input_per_1m": 2.5, "output_per_1m": 10.0},
    "gpt-4o-mini": {"input_per_1m": 0.15, "output_per_1m": 0.6},
    "claude-opus-4": {"input_per_1m": 15.0, "output_per_1m": 75.0},
    "claude-sonnet-4": {"input_per_1m": 3.0, "output_per_1m": 15.0},
    "claude-3-7-sonnet": {"input_per_1m": 3.0, "output_per_1m": 15.0},
    "claude-3-5-sonnet": {"input_per_1m": 3.0, "output_per_1m": 15.0},
    "gemini-3-pro": {"input_per_1m": 1.25, "output_per_1m": 10.0},
    "gemini-2.5-pro": {"input_per_1m": 1.25, "output_per_1m": 10.0},
    "gemini-2.5-flash": {"input_per_1m": 0.15, "output_per_1m": 0.6},
    "qwen-vl-max": {"input_per_1m": 0.4, "output_per_1m": 1.2},
    "deepseek-chat": {"input_per_1m": 0.27, "output_per_1m": 1.1},
}

_MODEL_ALIASES: dict[str, str] = {
    "nano-banana-pro": "gemini-3-pro-image-preview",
    "nano-banana-2.1": "gemini-nano-banana-2.1",
}

_SIZE_TO_TIER: dict[str, str] = {
    "1024x1024": "1K",
    "768x1024": "1K",
    "1280x1024": "1K",
    "1080x1920": "1K",
    "1536x1536": "1.5K",
    "2048x2048": "2K",
    "1536x2048": "2K",
    "2560x2048": "2K",
    "1152x2048": "2K",
    "4096x4096": "4K",
    "2448x3264": "4K",
    "2160x3840": "4K",
}

_DEFAULT_FALLBACK_IMAGE_PRICE = 0.04
_DEFAULT_FALLBACK_LLM_PRICE = {"input_per_1m": 1.0, "output_per_1m": 4.0}
_DIM_RE = re.compile(r"^\s*(\d+)\s*[xX×]\s*(\d+)\s*$")


def _load_custom_pricing() -> dict[str, Any]:
    raw_env = os.getenv("MODEL_PRICING_JSON", "").strip()
    if raw_env:
        try:
            data = json.loads(raw_env)
            if isinstance(data, dict):
                return data
        except Exception:
            pass
    root_file = Path(__file__).resolve().parent.parent / "model_pricing.json"
    if root_file.is_file():
        try:
            data = json.loads(root_file.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return data
        except Exception:
            pass
    return {}


def get_usd_to_cny_rate() -> float:
    raw = os.getenv("COST_CENTER_USD_TO_CNY", "7.2").strip()
    try:
        val = float(raw)
        return val if val > 0 else 7.2
    except Exception:
        return 7.2


def normalize_model_key(model: str | None) -> str:
    clean = str(model or "").strip().lower()
    if not clean:
        return "unknown"
    if clean in _MODEL_ALIASES:
        return _MODEL_ALIASES[clean]
    for suffix in ("-flare", "-sunburst"):
        if clean.endswith(suffix):
            return clean[: -len(suffix)]
    return clean


def infer_resolution_tier(resolution: str | None = None, size: str | None = None) -> str:
    """Normalize resolution into one of '1K', '1.5K', '2K', '4K'."""
    res = str(resolution or "").strip().upper()
    if res in ("1K", "1.5K", "2K", "4K"):
        return res
    sz = str(size or "").strip().lower()
    if sz in _SIZE_TO_TIER:
        return _SIZE_TO_TIER[sz]
    m = _DIM_RE.match(sz)
    if m:
        w, h = int(m.group(1)), int(m.group(2))
        max_dim = max(w, h)
        if max_dim >= 3200:
            return "4K"
        if max_dim >= 1900:
            return "2K"
        if max_dim >= 1450:
            return "1.5K"
    return "1K"


def _is_free_local_model(model: str | None, provider: str | None = None) -> bool:
    m = str(model or "").strip().lower()
    p = str(provider or "").strip().lower()
    return p == "local" or m.startswith("local-")


def _pick_tier_price(entry: dict[str, Any], tier: str) -> float:
    tier_field = {
        "1K": "price_1k",
        "1.5K": "price_1_5k",
        "2K": "price_2k",
        "4K": "price_4k",
    }.get(tier, "price_1k")

    if entry.get(tier_field) is not None:
        return float(entry[tier_field])

    base = float(entry.get("price_1k") or entry.get("unit_price") or _DEFAULT_FALLBACK_IMAGE_PRICE)
    if tier == "1.5K":
        return base * 1.25
    if tier == "2K":
        mults = entry.get("resolution_multipliers")
        if isinstance(mults, dict) and mults.get("2K") is not None:
            return base * float(mults["2K"])
        return base * 1.5
    if tier == "4K":
        mults = entry.get("resolution_multipliers")
        if isinstance(mults, dict) and mults.get("4K") is not None:
            return base * float(mults["4K"])
        return base * 2.0
    return base


def estimate_image_cost(
    model: str | None,
    provider: str | None = None,
    resolution: str | None = None,
    size: str | None = None,
    db_overrides: dict[str, dict[str, Any]] | None = None,
) -> tuple[float, str]:
    """Return (estimated_cost_usd, cost_source)."""
    if _is_free_local_model(model, provider):
        return 0.0, "free"

    custom = _load_custom_pricing()
    custom_img = custom.get("image") if isinstance(custom.get("image"), dict) else {}
    pricing = {**DEFAULT_IMAGE_PRICING, **custom_img}
    if isinstance(db_overrides, dict):
        pricing.update(db_overrides)

    key = normalize_model_key(model)
    entry = pricing.get(key)
    matched_key = key if entry is not None else None
    if entry is None:
        for k, v in pricing.items():
            if key.startswith(k) or k in key:
                entry = v
                matched_key = k
                break

    if isinstance(entry, (int, float)):
        return round(float(entry), 6), "estimated"

    if isinstance(entry, dict):
        tier = infer_resolution_tier(resolution, size)
        price = _pick_tier_price(entry, tier)
        src = "manual" if (db_overrides and matched_key in db_overrides) else "estimated"
        return round(price, 6), src

    return _DEFAULT_FALLBACK_IMAGE_PRICE, "estimated"


def resolve_image_cost(
    model: str | None,
    provider: str | None = None,
    resolution: str | None = None,
    size: str | None = None,
    upstream_cost: Any = None,
    db_overrides: dict[str, dict[str, Any]] | None = None,
) -> tuple[float, str]:
    """Use upstream cost when available; otherwise estimate from pricing table."""
    if upstream_cost is not None:
        try:
            val = float(upstream_cost)
            if val >= 0:
                return round(val, 6), "upstream"
        except (TypeError, ValueError):
            pass
    return estimate_image_cost(
        model, provider=provider, resolution=resolution, size=size, db_overrides=db_overrides
    )


def estimate_llm_cost(
    model: str | None,
    input_tokens: int = 0,
    output_tokens: int = 0,
    db_overrides: dict[str, dict[str, Any]] | None = None,
) -> tuple[float, str]:
    """Return (estimated_cost_usd, cost_source) for an LLM/VLM call."""
    in_tok = max(0, int(input_tokens or 0))
    out_tok = max(0, int(output_tokens or 0))
    if in_tok == 0 and out_tok == 0:
        return 0.0, "estimated"

    custom = _load_custom_pricing()
    custom_llm = custom.get("llm") if isinstance(custom.get("llm"), dict) else {}
    pricing = {**DEFAULT_LLM_PRICING, **custom_llm}
    if isinstance(db_overrides, dict):
        pricing.update(db_overrides)

    key = normalize_model_key(model)
    entry = pricing.get(key)
    matched_key = key if entry is not None else None
    if entry is None:
        best_len = 0
        for k, v in pricing.items():
            if (key.startswith(k) or k in key) and len(k) > best_len:
                entry = v
                matched_key = k
                best_len = len(k)

    if not isinstance(entry, dict):
        entry = _DEFAULT_FALLBACK_LLM_PRICE

    in_rate = float(entry.get("input_per_1m", _DEFAULT_FALLBACK_LLM_PRICE["input_per_1m"]))
    out_rate = float(entry.get("output_per_1m", _DEFAULT_FALLBACK_LLM_PRICE["output_per_1m"]))
    cost = (in_tok * in_rate + out_tok * out_rate) / 1_000_000.0
    src = "manual" if (db_overrides and matched_key in db_overrides) else "estimated"
    return round(cost, 6), src


def resolve_llm_cost(
    model: str | None,
    input_tokens: int = 0,
    output_tokens: int = 0,
    upstream_cost: Any = None,
    db_overrides: dict[str, dict[str, Any]] | None = None,
) -> tuple[float, str]:
    if upstream_cost is not None:
        try:
            val = float(upstream_cost)
            if val >= 0:
                return round(val, 6), "upstream"
        except (TypeError, ValueError):
            pass
    return estimate_llm_cost(
        model, input_tokens=input_tokens, output_tokens=output_tokens, db_overrides=db_overrides
    )
