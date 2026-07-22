#!/usr/bin/env python3
"""Compile the browser JSX sources into one content-hashed JavaScript bundle."""

from __future__ import annotations

import hashlib
import os
import re
import subprocess
import sys


BASE = os.path.dirname(os.path.abspath(__file__))
HTML = os.path.join(BASE, "index.html")
COMPILED_DIR = os.path.join(BASE, "compiled")
BABEL_STANDALONE = os.path.join(BASE, "vendor", "babel.min.js")

BABEL_FILES = [
    "src/Icons.jsx",
    "src/Utils.jsx",
    "src/TopBar.jsx",
    "src/TemplatePanel.jsx",
    "src/Canvas.jsx",
    "src/ChatExtras.jsx",
    "src/Chat.jsx",
    "src/Tweaks.jsx",
    "src/AdminPage.jsx",
    "src/InspirationPanel.jsx",
    "src/app.jsx",
]

NODE_TRANSFORM = r"""
const fs = require('fs');
const Babel = require(process.argv[1]);
const source = fs.readFileSync(0, 'utf8');
const output = Babel.transform(source, {
  presets: ['react'],
  sourceType: 'script',
  comments: true,
  compact: false,
}).code;
process.stdout.write(output);
"""


def read(path: str) -> str:
    with open(path, "r", encoding="utf-8", errors="replace") as handle:
        return handle.read()


def compile_jsx(rel_path: str) -> str:
    source = read(os.path.join(BASE, rel_path))
    try:
        result = subprocess.run(
            ["node", "-e", NODE_TRANSFORM, BABEL_STANDALONE],
            input=source,
            text=True,
            encoding="utf-8",
            capture_output=True,
            check=True,
        )
    except FileNotFoundError:
        print("[ERROR] Node.js is required to compile frontend JSX.")
        sys.exit(1)
    except subprocess.CalledProcessError as exc:
        print(f"[ERROR] Failed to compile {rel_path}:\n{exc.stderr}")
        sys.exit(1)
    return f"// {rel_path}\n{result.stdout}\n"


def replace_bundle_tag(html: str, bundle_name: str) -> str:
    bundle_tag = (
        f'<script src="compiled/{bundle_name}" '
        'data-designflow-bundle="true"></script>'
    )
    compiled_pattern = re.compile(
        r'<script\s+[^>]*data-designflow-bundle="true"[^>]*>\s*</script>'
    )
    if compiled_pattern.search(html):
        html = compiled_pattern.sub(bundle_tag, html, count=1)
    else:
        babel_pattern = re.compile(
            r'<script\s+type="text/babel"[^>]*>.*?</script>',
            re.DOTALL,
        )
        matches = list(babel_pattern.finditer(html))
        if len(matches) != len(BABEL_FILES):
            print(
                f"[ERROR] index.html has {len(matches)} Babel blocks; "
                f"expected {len(BABEL_FILES)}."
            )
            sys.exit(1)
        html = html[: matches[0].start()] + bundle_tag + html[matches[-1].end() :]

    html = re.sub(
        r'\s*<script\s+src="vendor/babel\.min\.js"></script>',
        "",
        html,
        count=1,
    )
    return html


def build() -> None:
    html = read(HTML)
    original_size = len(html)
    compiled_parts = [compile_jsx(rel_path) for rel_path in BABEL_FILES]
    bundle = "\n".join(compiled_parts)
    digest = hashlib.sha256(bundle.encode("utf-8")).hexdigest()[:12]
    bundle_name = f"app-{digest}.js"

    os.makedirs(COMPILED_DIR, exist_ok=True)
    bundle_path = os.path.join(COMPILED_DIR, bundle_name)
    with open(bundle_path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(bundle)

    html = replace_bundle_tag(html, bundle_name)
    with open(HTML, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(html)

    for name in os.listdir(COMPILED_DIR):
        old_path = os.path.join(COMPILED_DIR, name)
        if name.startswith("app-") and name.endswith(".js") and name != bundle_name:
            if os.path.isfile(old_path):
                os.remove(old_path)

    print(f"[BUILD DONE] {original_size // 1024} KB HTML -> {len(html) // 1024} KB HTML")
    print(f"  bundle: compiled/{bundle_name} ({len(bundle) // 1024} KB)")
    print("  browser-side Babel: removed")


if __name__ == "__main__":
    build()
