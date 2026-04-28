import re, json, base64, gzip, sys

with open("Loom Design Studio.html", "r", encoding="utf-8", errors="replace") as f:
    content = f.read()

manifest_match = re.search(r'<script type="__bundler/manifest">(.*?)</script>', content, re.DOTALL)
if not manifest_match:
    print("No manifest found"); sys.exit(1)

manifest = json.loads(manifest_match.group(1).strip())
print(f"Total modules: {len(manifest)}")

first_key = list(manifest.keys())[0]
first_val = manifest[first_key]
print(f"First module sub-keys: {list(first_val.keys())}")
print(f"mime: {first_val.get('mime')}")
print(f"compressed: {first_val.get('compressed')}")
data_preview = first_val.get('data', '')[:100]
print(f"data preview: {data_preview}")

# Now decode properly: compressed=true means base64+gzip, else base64 plain
all_decoded = []
for key, mod in manifest.items():
    data = mod.get('data', '')
    mime = mod.get('mime', '')
    compressed = mod.get('compressed', False)
    if not data:
        continue
    try:
        raw = base64.b64decode(data)
        if compressed:
            text = gzip.decompress(raw).decode('utf-8', errors='replace')
        else:
            text = raw.decode('utf-8', errors='replace')
        all_decoded.append((key, mime, text))
    except Exception as e:
        print(f"Error decoding {key}: {e}")

print(f"\nDecoded modules: {len(all_decoded)}")

# Find CSS modules
css_mods = [(k, m, t) for k, m, t in all_decoded if 'css' in m or 'font' in t.lower()[:200]]
js_mods = [(k, m, t) for k, m, t in all_decoded if 'javascript' in m or 'jsx' in m]

print(f"CSS-like modules: {len(css_mods)}")
print(f"JS modules: {len(js_mods)}")

# Dump all CSS modules
for key, mime, text in css_mods:
    print(f"\n=== CSS MODULE {key} ({mime}) ===")
    print(text[:5000])

# Dump JS modules that look like they have styling
print("\n\n=== JS MODULES WITH STYLE ===")
for key, mime, text in js_mods:
    if 'fontFamily' in text or 'fontSize' in text or 'color' in text[:3000]:
        print(f"\n--- {key} ({mime}, len={len(text)}) ---")
        print(text[:4000])
        print("...")
