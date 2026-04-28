import re, json, base64, gzip

with open('Loom Design Studio.html', 'r', encoding='utf-8', errors='replace') as f:
    content = f.read()

# Find :root blocks
css_vars = re.findall(r':root\s*\{[^}]+\}', content)
print('CSS :root blocks:', len(css_vars))
for v in css_vars:
    print(v[:3000])
print()

# Look for injected CSS via JS
style_inject = re.findall(r'\.textContent\s*=\s*`([^`]+)`', content)
print('Style injections via JS:', len(style_inject))
for s in style_inject[:3]:
    print(s[:2000])
    print('---')

# Search in the extracted modules
manifest_match = re.search(r'<script type="__bundler/manifest">(.*?)</script>', content, re.DOTALL)
manifest = json.loads(manifest_match.group(1).strip())

all_decoded = {}
for key, mod in manifest.items():
    data = mod.get('data', '')
    compressed = mod.get('compressed', False)
    mime = mod.get('mime', '')
    if not data: continue
    try:
        raw = base64.b64decode(data)
        text = gzip.decompress(raw).decode('utf-8', errors='replace') if compressed else raw.decode('utf-8', errors='replace')
        all_decoded[key] = {'mime': mime, 'text': text}
    except: pass

# Search each module for :root
for key, v in all_decoded.items():
    if ':root' in v['text']:
        print(f'\n=== MODULE {key} has :root ===')
        idx = v['text'].index(':root')
        print(v['text'][max(0, idx-100):idx+2000])
