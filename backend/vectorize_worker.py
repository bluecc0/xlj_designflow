from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


def _inject_viewbox(svg_path: Path, fallback_src: Path) -> tuple[int, int]:
    text = svg_path.read_text(encoding="utf-8")
    head_end = text.find(">") + 1
    has_viewbox = "viewBox=" in text[:head_end]
    m_w = re.search(r'\bwidth="([\d.]+)"', text[:300])
    m_h = re.search(r'\bheight="([\d.]+)"', text[:300])
    if m_w and m_h:
        w, h = int(float(m_w.group(1))), int(float(m_h.group(1)))
    else:
        from PIL import Image
        with Image.open(fallback_src) as im:
            w, h = im.width, im.height
    if not has_viewbox:
        text = re.sub(r"(<svg\b)", rf'\1 viewBox="0 0 {w} {h}"', text, count=1)
        svg_path.write_text(text, encoding="utf-8")
    return w, h


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--src", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    src_path = Path(args.src)
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        import vtracer
    except ImportError as exc:
        print(json.dumps({"ok": False, "error": "未安装 vtracer，请在后端环境执行 pip install vtracer"}, ensure_ascii=False))
        return 3

    try:
        # vtracer 0.6.15 pyo3 绑定在 Python 3.14 上传关键字参数会 segfault，必须用位置参数。
        vtracer.convert_image_to_svg_py(
            str(src_path), str(out_path),
            "color", "stacked", "spline", 4, 6, 16, 60, 4.0, 10, 45, 8,
        )
    except Exception as exc:
        print(json.dumps({"ok": False, "error": f"vtracer 执行失败: {exc}"}, ensure_ascii=False))
        return 1

    if not out_path.exists():
        print(json.dumps({"ok": False, "error": "vtracer 未输出 SVG 文件"}, ensure_ascii=False))
        return 2

    try:
        w, h = _inject_viewbox(out_path, src_path)
    except Exception as exc:
        print(json.dumps({"ok": False, "error": f"viewBox 注入失败: {exc}"}, ensure_ascii=False))
        return 4

    print(json.dumps({"ok": True, "out": str(out_path), "width": w, "height": h}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
