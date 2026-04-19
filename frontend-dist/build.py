#!/usr/bin/env python3
"""
Build script — inlines all src/*.jsx and src/api.js into index.html.
Run after editing any .jsx file:
  python build.py
Then refresh http://localhost:8000/ui/
"""
import os, re, sys

BASE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(BASE, 'src')

PLAIN_JS = ['src/api.js']
BABEL_JSX = [
    'src/Icons.jsx',
    'src/Placeholders.jsx',
    'src/TopBar.jsx',
    'src/TemplatePanel.jsx',
    'src/ChatExtras.jsx',
    'src/Canvas.jsx',
    'src/Chat.jsx',
    'src/app.jsx',
]

TEMPLATE = os.path.join(BASE, 'index.html')

def read(path):
    with open(os.path.join(BASE, path), 'r', encoding='utf-8') as f:
        return f.read()

def write(path, content):
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)

def build():
    html = read('index.html')

    # Find injection point — everything after vendor scripts up to </body>
    # We look for the first <script> after babel.min.js (our injected section)
    vendor_end = html.find('<script src="vendor/babel.min.js"></script>') + len('<script src="vendor/babel.min.js"></script>')
    body_end = html.rfind('</body></html>')

    if body_end == -1:
        print('ERROR: </body></html> not found in index.html')
        sys.exit(1)

    before = html[:vendor_end]
    after = '\n</body></html>'

    # Build inline scripts
    inline = '\n'

    for f in PLAIN_JS:
        src = read(f)
        # Strip ES module export so it runs as plain script
        src = src.replace('export async function ', 'async function ')
        src = src.replace('export function ', 'function ')
        inline += f'<script>\n// ── {f} ──\n{src}\n</script>\n'

    for f in BABEL_JSX:
        src = read(f)
        inline += f'<script type="text/babel">\n// ── {f} ──\n{src}\n</script>\n'

    new_html = before + inline + after
    write(TEMPLATE, new_html)

    size_kb = len(new_html.encode('utf-8')) / 1024
    print(f'✓ Built index.html ({size_kb:.1f} KB)')
    print(f'  Inlined: {", ".join(PLAIN_JS + BABEL_JSX)}')
    print(f'  → Refresh http://localhost:8000/ui/')

if __name__ == '__main__':
    build()
