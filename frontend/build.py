#!/usr/bin/env python3
"""
Build script — 原地替换 index.html 中的 10 个 babel script 块。

规则：
  - 始终以当前 index.html 为基准（保留 window.TWEAKS、CSS、api.js 内联块等一切）
  - 按顺序把 9 个 <script type="text/babel"> 块内容替换为 src/*.jsx 文件内容
  - 不增删任何 script 标签，不动标签之外的任何内容

用法：
  python build.py    (在 frontend-dist/ 目录下)
  刷新 http://localhost:8000/ui/
"""
import os, re, sys

BASE     = os.path.dirname(os.path.abspath(__file__))
HTML     = os.path.join(BASE, 'index.html')

# 顺序必须与 index.html 中 babel 块的顺序完全一致
BABEL_FILES = [
    'src/Icons.jsx',
    'src/Placeholders.jsx',
    'src/TopBar.jsx',
    'src/TemplatePanel.jsx',
    'src/Canvas.jsx',
    'src/ChatExtras.jsx',
    'src/Chat.jsx',
    'src/Tweaks.jsx',
    'src/AdminPage.jsx',
    'src/app.jsx',
]

def read(path):
    with open(path, 'r', encoding='utf-8', errors='replace') as f:
        return f.read()

def build():
    html = read(HTML)
    orig_size = len(html)

    babel_pat = re.compile(
        r'(<script\s+type="text/babel"[^>]*>)'
        r'(.*?)'
        r'(</script>)',
        re.DOTALL
    )
    matches = list(babel_pat.finditer(html))

    if len(matches) != len(BABEL_FILES):
        print(f'[ERROR] index.html 有 {len(matches)} 个 babel 块，但配置了 {len(BABEL_FILES)} 个文件')
        sys.exit(1)

    # 从后往前替换，避免位置偏移
    replacements = []
    for i, (m, rel) in enumerate(zip(matches, BABEL_FILES)):
        src = read(os.path.join(BASE, rel))
        new_content = f'\n{src}\n'
        replacements.append((m.start(2), m.end(2), new_content))

    replacements.sort(key=lambda x: x[0], reverse=True)
    for start, end, content in replacements:
        html = html[:start] + content + html[end:]

    with open(HTML, 'w', encoding='utf-8') as f:
        f.write(html)

    # 验证
    for rel in BABEL_FILES:
        src = read(os.path.join(BASE, rel))
        marker = src.strip()[:40]
        ok = marker in html
        print(f'  [{"OK" if ok else "MISS"}] {rel}')

    print(f'\n[BUILD DONE] {orig_size//1024} KB -> {len(html)//1024} KB')
    print(f'  window.TWEAKS preserved: {"window.TWEAKS =" in html}')
    print(f'  -> 刷新 http://localhost:8000/ui/')

if __name__ == '__main__':
    build()
