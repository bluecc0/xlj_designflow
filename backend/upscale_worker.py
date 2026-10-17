from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import time
from pathlib import Path


def _find_latest_image_file(folder: Path, after_ts: float) -> Path | None:
    exts = {".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff"}
    candidates: list[Path] = []
    if not folder.exists():
        return None
    for item in folder.iterdir():
        try:
            if item.is_file() and item.suffix.lower() in exts and item.stat().st_mtime >= after_ts - 1:
                candidates.append(item)
        except OSError:
            continue
    if not candidates:
        return None
    return max(candidates, key=lambda item: item.stat().st_mtime)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True)
    parser.add_argument("--src", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--scale", required=True)
    parser.add_argument("--model", default="")
    parser.add_argument("--timeout", type=int, default=900)
    args = parser.parse_args()

    exe = Path(args.exe)
    src_path = Path(args.src)
    out_path = Path(args.out)
    scale = max(1, min(int(args.scale or 2), 4))
    output_dir = out_path.parent / (out_path.stem + "_gigapixel")
    log_path = out_path.parent / f"{out_path.stem}_gigapixel.log"
    if output_dir.exists():
        shutil.rmtree(output_dir, ignore_errors=True)
    output_dir.mkdir(parents=True, exist_ok=True)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    cmd = [
        str(exe),
        "-i", str(src_path),
        "-o", str(output_dir),
        "--scale", str(scale),
        "--dt", "12",
        "--sh", "8",
        "--dn", "2",
        "--cf",
        "--suffix", "_upscaled",
        "-f", "png",
        "--verbose",
    ]
    if args.model:
        cmd[1:1] = ["-m", args.model]

    started = time.time()
    try:
        with log_path.open("w", encoding="utf-8", errors="replace") as log_file:
            proc = subprocess.run(
                cmd,
                cwd=str(exe.parent) if exe.exists() else None,
                stdout=log_file,
                stderr=subprocess.STDOUT,
                text=True,
                timeout=max(30, int(args.timeout or 900)),
                check=False,
            )
    except subprocess.TimeoutExpired as exc:
        print(json.dumps({"ok": False, "error": f"Gigapixel CLI timed out after {exc.timeout} seconds", "log_path": str(log_path)}, ensure_ascii=False))
        return 124

    if proc.returncode != 0:
        try:
            detail = log_path.read_text(encoding="utf-8", errors="replace").strip()[-800:]
        except Exception:
            detail = ""
        print(json.dumps({"ok": False, "error": detail or str(proc.returncode), "log_path": str(log_path)}, ensure_ascii=False))
        return proc.returncode or 1

    generated = _find_latest_image_file(output_dir, started)
    if not generated:
        print(json.dumps({"ok": False, "error": "Gigapixel CLI did not output an image", "log_path": str(log_path)}, ensure_ascii=False))
        return 2
    shutil.copyfile(generated, out_path)
    print(json.dumps({"ok": True, "generated": str(generated), "out": str(out_path), "log_path": str(log_path)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
