#!/usr/bin/env python3
"""Rebuild frontend JSX and tldraw canvas only when sources are newer than artifacts."""

from __future__ import annotations

import argparse
import importlib.util
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
FRONTEND = ROOT / "frontend"
TLDRAW = ROOT / "editor-lab-tldraw"
MTIME_EPS = 0.01


def load_babel_files() -> list[str]:
    spec = importlib.util.spec_from_file_location(
        "frontend_build", FRONTEND / "build.py"
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load frontend/build.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return list(module.BABEL_FILES)


def newest_mtime(paths: list[Path]) -> float:
    times = [path.stat().st_mtime for path in paths if path.is_file()]
    return max(times) if times else 0.0


def walk_files(directory: Path) -> list[Path]:
    files: list[Path] = []
    if not directory.is_dir():
        return files
    for root, dirs, names in os.walk(directory):
        dirs[:] = [name for name in dirs if name not in {"node_modules", "dist", ".git"}]
        for name in names:
            files.append(Path(root) / name)
    return files


def resolve_cmd(name: str) -> str:
    found = shutil.which(name)
    if found:
        return found
    if os.name == "nt":
        for candidate in (f"{name}.cmd", f"{name}.exe"):
            found = shutil.which(candidate)
            if found:
                return found
    return name


def run(cmd: list[str], cwd: Path) -> None:
    print(f"  $ {' '.join(cmd)}")
    subprocess.run(cmd, cwd=str(cwd), check=True)


def frontend_sources() -> list[Path]:
    files = [
        FRONTEND / "build.py",
        FRONTEND / "vendor" / "babel.min.js",
    ]
    files.extend(FRONTEND / rel for rel in load_babel_files())
    return files


def frontend_artifact_mtime() -> float:
    compiled = FRONTEND / "compiled"
    if not compiled.is_dir():
        return 0.0
    apps = [
        path
        for path in compiled.glob("app-*.js")
        if path.is_file()
    ]
    if not apps:
        return 0.0
    return max(path.stat().st_mtime for path in apps)


def index_html_bundle_ok() -> bool:
    html_path = FRONTEND / "index.html"
    if not html_path.is_file():
        return False
    html = html_path.read_text(encoding="utf-8", errors="replace")
    match = re.search(r'src="(compiled/app-[^"]+\.js)"', html)
    if not match:
        return False
    return (FRONTEND / match.group(1)).is_file()


def frontend_status() -> tuple[bool, str]:
    if frontend_artifact_mtime() <= 0:
        return True, "missing compiled/app-*.js"
    if not index_html_bundle_ok():
        return True, "index.html bundle missing"
    if newest_mtime(frontend_sources()) > frontend_artifact_mtime() + MTIME_EPS:
        return True, "sources newer than bundle"
    return False, "fresh"


def tldraw_sources() -> list[Path]:
    files = walk_files(TLDRAW / "src")
    for name in (
        "package.json",
        "package-lock.json",
        "vite.config.ts",
        "tsconfig.json",
        "index.html",
    ):
        path = TLDRAW / name
        if path.is_file():
            files.append(path)
    return files


def tldraw_status() -> tuple[bool, str]:
    dist = TLDRAW / "dist" / "index.html"
    if not dist.is_file():
        return True, "missing dist/index.html"
    if newest_mtime(tldraw_sources()) > dist.stat().st_mtime + MTIME_EPS:
        return True, "sources newer than dist"
    return False, "fresh"


def ensure_npm() -> None:
    node_modules = TLDRAW / "node_modules"
    marker = node_modules / "tldraw"
    lock = TLDRAW / "package-lock.json"
    package = TLDRAW / "package.json"
    need_install = not marker.exists()
    if not need_install and node_modules.is_dir():
        baseline = node_modules.stat().st_mtime
        for path in (lock, package):
            if path.is_file() and path.stat().st_mtime > baseline + MTIME_EPS:
                need_install = True
                break
    if need_install:
        print("[UI] npm install editor-lab-tldraw")
        run([resolve_cmd("npm"), "install"], TLDRAW)


def rebuild_frontend() -> None:
    run([sys.executable, str(FRONTEND / "build.py")], FRONTEND)


def rebuild_tldraw() -> None:
    if not shutil.which("node") and not shutil.which("node.exe"):
        raise RuntimeError("Node.js is required to build editor-lab-tldraw")
    ensure_npm()
    run([resolve_cmd("npm"), "run", "build"], TLDRAW)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Rebuild frontend / tldraw when source files are stale."
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="rebuild both even when artifacts look fresh",
    )
    args = parser.parse_args()

    try:
        need_frontend, frontend_reason = frontend_status()
        if args.force or need_frontend:
            print(f"[UI] rebuild frontend ({('forced' if args.force else frontend_reason)})")
            rebuild_frontend()
        else:
            print("[UI] frontend up to date")

        need_canvas, canvas_reason = tldraw_status()
        if args.force or need_canvas:
            print(f"[UI] rebuild canvas ({('forced' if args.force else canvas_reason)})")
            rebuild_tldraw()
        else:
            print("[UI] canvas up to date")
    except subprocess.CalledProcessError as exc:
        print(f"[UI] rebuild failed with exit {exc.returncode}")
        return exc.returncode or 1
    except Exception as exc:
        print(f"[UI] rebuild failed: {exc}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
