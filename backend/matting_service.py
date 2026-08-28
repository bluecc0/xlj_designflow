"""
AI 智能抠图服务 - 基于 BiRefNet (Bilateral Reference Network)
提供高精度边缘与细节前景提取，支持 GPU 加速与启动预热常驻显存。
"""
from __future__ import annotations

import logging
import os
import threading
import time
from pathlib import Path
from typing import Optional

from PIL import Image, ImageOps

from .config import settings

logger = logging.getLogger(__name__)

# 延迟导入重型 ML 库，避免非 ML 路径冷启动开销
torch = None
transforms = None
AutoModelForImageSegmentation = None


def _ensure_ml_imports() -> None:
    global torch, transforms, AutoModelForImageSegmentation
    # 必须在导入 transformers / huggingface_hub 前设置 HF_ENDPOINT，否则 hub 初始化时读取的仍是默认域名
    if settings.matting_hf_endpoint and "HF_ENDPOINT" not in os.environ:
        os.environ["HF_ENDPOINT"] = settings.matting_hf_endpoint
    if torch is None:
        import torch as _torch
        import torchvision.transforms as _transforms
        from transformers import AutoModelForImageSegmentation as _AutoModel

        torch = _torch
        transforms = _transforms
        AutoModelForImageSegmentation = _AutoModel


class MattingModelManager:
    """线程安全单例：管理 BiRefNet 模型生命周期、显存预热与推理。"""

    _instance: Optional[MattingModelManager] = None
    _lock = threading.Lock()

    def __new__(cls) -> MattingModelManager:
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance

    def __init__(self) -> None:
        if getattr(self, "_initialized", False):
            return
        self.model = None
        self.device = None
        self.transform = None
        self.is_ready = False
        self.init_error = ""
        self._inference_lock = threading.Lock()
        self._initialized = True

    def get_target_device(self) -> str:
        _ensure_ml_imports()
        configured = (settings.matting_device or "auto").lower()
        if configured == "cuda":
            return "cuda" if torch.cuda.is_available() else "cpu"
        if configured == "cpu":
            return "cpu"
        return "cuda" if torch.cuda.is_available() else "cpu"

    def load_model(self) -> bool:
        """加载 BiRefNet 模型到目标设备。"""
        if not settings.matting_enabled:
            logger.info("[MattingService] 抠图功能已通过配置禁用")
            return False

        with self._lock:
            if self.is_ready and self.model is not None:
                return True

            try:
                _ensure_ml_imports()
                if settings.matting_hf_endpoint and "HF_ENDPOINT" not in os.environ:
                    os.environ["HF_ENDPOINT"] = settings.matting_hf_endpoint

                target_device_str = self.get_target_device()
                self.device = torch.device(target_device_str)
                logger.info("[MattingService] 正在加载 BiRefNet 模型到设备: %s ...", self.device)

                model_source = settings.matting_model_path or settings.matting_model_name
                loaded_custom = False

                if settings.matting_model_path and Path(settings.matting_model_path).is_dir():
                    local_dir = Path(settings.matting_model_path).resolve()
                    birefnet_py = local_dir / "birefnet.py"
                    safetensors_candidates = [
                        local_dir / "BiRefNet-general.safetensors",
                        local_dir / "model.safetensors",
                        local_dir / "BiRefNet-portrait.safetensors",
                    ]
                    safetensors_path = next((p for p in safetensors_candidates if p.is_file()), None)
                    if not safetensors_path:
                        for p in local_dir.glob("*.safetensors"):
                            safetensors_path = p
                            break

                    # 1. 优先尝试本地 safetensors 直接装载
                    if birefnet_py.is_file() and safetensors_path and safetensors_path.is_file():
                        try:
                            import sys
                            if str(local_dir) not in sys.path:
                                sys.path.insert(0, str(local_dir))
                            parent_dir = str(local_dir.parent)
                            if parent_dir not in sys.path:
                                sys.path.insert(0, parent_dir)

                            from safetensors.torch import load_file
                            try:
                                import birefnet
                                birefnet_cls = getattr(birefnet, "BiRefNet", None)
                            except ImportError:
                                # 兼容包含相对导入 (from .BiRefNet_config) 的快照包
                                pkg = __import__(f"{local_dir.name}.birefnet", fromlist=["BiRefNet"])
                                birefnet_cls = getattr(pkg, "BiRefNet", None)

                            if birefnet_cls:
                                self.model = birefnet_cls(bb_pretrained=False)
                                weights = load_file(str(safetensors_path))
                                self.model.load_state_dict(weights, strict=False)
                                loaded_custom = True
                                logger.info("[MattingService] 本地独立权重加载成功: %s", safetensors_path.name)
                        except Exception as custom_err:
                            logger.warning("[MattingService] 本地独立类加载失败，转由 AutoModel 尝试: %s", custom_err)

                    # 2. 尝试标准 Hugging Face 本地 snapshot 加载
                    if not loaded_custom:
                        logger.info("[MattingService] 尝试通过 AutoModel 加载本地权重: %s", local_dir)
                        self.model = AutoModelForImageSegmentation.from_pretrained(
                            str(local_dir),
                            trust_remote_code=True,
                            local_files_only=True,
                        )
                else:
                    logger.info("[MattingService] 从 Hugging Face 加载模型: %s", model_source)
                    self.model = AutoModelForImageSegmentation.from_pretrained(
                        model_source,
                        trust_remote_code=True,
                    )

                self.model.to(self.device)
                self.model.eval()

                input_size = (settings.matting_input_size, settings.matting_input_size)
                self.transform = transforms.Compose([
                    transforms.Resize(input_size),
                    transforms.ToTensor(),
                    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
                ])

                self.is_ready = True
                self.init_error = ""
                logger.info("[MattingService] BiRefNet 模型加载成功 (设备: %s)", self.device)
                return True

            except Exception as exc:
                self.is_ready = False
                self.init_error = str(exc)
                logger.exception("[MattingService] 加载 BiRefNet 模型失败: %s", exc)
                return False

    def warmup(self) -> bool:
        """
        启动预热：执行一次 dummy 推理以编译 CUDA 算子并使显存常驻，
        避免首次使用时的冷启动卡顿。
        """
        if not self.is_ready or self.model is None:
            if not self.load_model():
                return False

        if not settings.matting_warmup_enabled:
            return True

        try:
            logger.info("[MattingService] 开始 GPU 预热 (Dummy Forward Pass)...")
            start_ts = time.time()
            size = settings.matting_input_size
            dummy_input = torch.zeros((1, 3, size, size), dtype=torch.float32, device=self.device)

            with torch.no_grad():
                with self._inference_lock:
                    if self.device.type == "cuda":
                        torch.cuda.synchronize()
                    _ = self.model(dummy_input)
                    if self.device.type == "cuda":
                        torch.cuda.synchronize()

            elapsed = time.time() - start_ts
            vram_mb = (
                torch.cuda.memory_allocated(self.device) / (1024 * 1024)
                if self.device.type == "cuda"
                else 0
            )
            logger.info(
                "[MattingService] 预热完成 耗时: %.2fs (已占用显存: %.1f MB)",
                elapsed,
                vram_mb,
            )
            return True
        except Exception as exc:
            logger.warning("[MattingService] 预热推理失败: %s", exc)
            return False

    def extract_foreground(self, image: Image.Image) -> Image.Image:
        """提取图像前景并输出透明 RGBA PNG。"""
        if not self.is_ready or self.model is None:
            if not self.load_model():
                raise RuntimeError(f"抠图模型未就绪: {self.init_error or '初始化失败'}")

        # 纠正 EXIF 方向
        normalized_img = ImageOps.exif_transpose(image) or image
        orig_w, orig_h = normalized_img.size

        # 处理透明通道输入，垫白底避免转 RGB 时产生黑色暗边
        if normalized_img.mode in ("RGBA", "LA") or (
            normalized_img.mode == "P" and "transparency" in normalized_img.info
        ):
            bg = Image.new("RGB", normalized_img.size, (255, 255, 255))
            mask = normalized_img.split()[-1] if normalized_img.mode in ("RGBA", "LA") else None
            bg.paste(normalized_img, mask=mask)
            rgb_image = bg
        else:
            rgb_image = normalized_img.convert("RGB")

        input_tensor = self.transform(rgb_image).unsqueeze(0).to(self.device)

        with torch.no_grad():
            with self._inference_lock:
                preds = self.model(input_tensor)
                if isinstance(preds, (list, tuple)):
                    pred = preds[-1]
                else:
                    pred = preds

                mask_tensor = pred.sigmoid().squeeze().cpu()

        # 转为 0~255 的单通道掩码图像
        import numpy as np
        mask_np = (mask_tensor.numpy() * 255).astype(np.uint8)
        mask_img = Image.fromarray(mask_np, mode="L")

        # 缩放回原图真实尺寸
        mask_resized = mask_img.resize((orig_w, orig_h), Image.LANCZOS)

        # 合成 RGBA 透明图
        result_rgba = rgb_image.convert("RGBA")
        result_rgba.putalpha(mask_resized)
        return result_rgba

    def process_image_file(self, src_path: Path, out_path: Path) -> tuple[int, int]:
        """读取输入图片，执行抠图并写入透明 PNG。"""
        with Image.open(src_path) as im:
            cutout = self.extract_foreground(im)
            out_path.parent.mkdir(parents=True, exist_ok=True)
            cutout.save(out_path, format="PNG", optimize=True)
            return cutout.width, cutout.height


matting_service = MattingModelManager()
