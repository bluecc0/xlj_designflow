#!/usr/bin/env python3
"""
Build script -- inlines all src/*.jsx and src/api.js into index.html.
Run after editing any .jsx file:
  python build.py
Then refresh http://localhost:8000/ui/
"""
import os, sys

BASE = os.path.dirname(os.path.abspath(__file__))

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

    # Cut point: right before vendor scripts
    # Structure: <styles> ... </style>  <-- cut here
    #            <body>
    #            <div id="root"></div>
    #            <script src="vendor/react.js"> ...
    #            <script src="vendor/babel.min.js">
    #            <our inline scripts>
    #            </body></html>

    vendor_react = '<script src="vendor/react.js"></script>'
    vendor_babel = '<script src="vendor/babel.min.js"></script>'

    vendor_react_idx = html.find(vendor_react)
    vendor_babel_end = html.find(vendor_babel) + len(vendor_babel)

    if vendor_react_idx == -1 or vendor_babel_end == len(vendor_babel) - 1:
        print('ERROR: vendor script tags not found in index.html')
        sys.exit(1)

    # Keep everything up to and including vendor scripts
    # But first find where the style section ends (before vendor scripts)
    style_end = html.rfind('</style>', 0, vendor_react_idx) + len('</style>')
    if style_end == len('</style>') - 1:
        style_end = vendor_react_idx  # fallback

    css_section = html[:style_end]
    vendor_section = html[vendor_react_idx:vendor_babel_end]

    # Build inline scripts
    inline = ''
    for f in PLAIN_JS:
        src = read(f)
        src = src.replace('export async function ', 'async function ')
        src = src.replace('export function ', 'function ')
        inline += f'\n<script>\n// -- {f} --\n{src}\n</script>\n'

    for f in BABEL_JSX:
        src = read(f)
        inline += f'\n<script type="text/babel">\n// -- {f} --\n{src}\n</script>\n'

    new_html = (
        css_section + '\n'
        '<body>\n'
        '<div id="root"></div>\n\n'
        + vendor_section + '\n'
        + inline
        + '\n</body></html>'
    )

    write(TEMPLATE, new_html)

    size_kb = len(new_html.encode('utf-8')) / 1024
    print(f'[OK] Built index.html ({size_kb:.1f} KB)')
    print(f'     -> Refresh http://localhost:8000/ui/')

if __name__ == '__main__':
    build()
