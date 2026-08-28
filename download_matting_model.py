"""
一键下载 BiRefNet 抠图模型到本地 models/ 目录。
用于开发机离线导出、正式机离线拷贝部署。

用法:
    python download_matting_model.py
"""
from __future__ import annotations

import os
import sys
import socket
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent
TARGET_DIR = ROOT_DIR / "models" / "BiRefNet"


def _is_port_listening(host: str, port: int, timeout: float = 0.5) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except Exception:
        return False


def download_model(repo_id: str = "ZhengPeng7/BiRefNet", target_dir: Path = TARGET_DIR) -> bool:
    print("=" * 50)
    print(f"Downloading BiRefNet model: {repo_id}")
    print(f"Target directory: {target_dir}")

    # Auto-detect Clash proxy
    if _is_port_listening("127.0.0.1", 7890):
        print("Detected local proxy on 127.0.0.1:7890, enabling proxy...")
        os.environ["HTTP_PROXY"] = "http://127.0.0.1:7890"
        os.environ["HTTPS_PROXY"] = "http://127.0.0.1:7890"
    else:
        hf_mirror = os.getenv("HF_ENDPOINT", "https://hf-mirror.com")
        os.environ["HF_ENDPOINT"] = hf_mirror
        print(f"Using HF Endpoint / Mirror: {hf_mirror}")

    print("=" * 50)

    try:
        from huggingface_hub import snapshot_download
    except ImportError:
        print("Installing huggingface_hub...")
        import subprocess
        subprocess.run([sys.executable, "-m", "pip", "install", "huggingface_hub"], check=True)
        from huggingface_hub import snapshot_download

    target_dir.mkdir(parents=True, exist_ok=True)
    try:
        snapshot_download(
            repo_id=repo_id,
            local_dir=str(target_dir),
            local_dir_use_symlinks=False,
            endpoint=os.environ.get("HF_ENDPOINT"),
        )
        print("\n[OK] BiRefNet model downloaded successfully!")
        print(f"Saved to: {target_dir}")
        print("To deploy to the production machine, simply copy the entire 'models/' folder to the root of the project.")
        return True
    except Exception as exc:
        print(f"\n[ERROR] Download failed: {exc}")
        return False


if __name__ == "__main__":
    success = download_model()
    sys.exit(0 if success else 1)
