import re, json, base64, gzip, os

with open('Loom Design Studio.html', 'r', encoding='utf-8', errors='replace') as f:
    content = f.read()

manifest_match = re.search(r'<script type="__bundler/manifest">(.*?)</script>', content, re.DOTALL)
manifest = json.loads(manifest_match.group(1).strip())

UUID_RE = re.compile(r'([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})')

# Find all @font-face blocks (they appear as escaped string literals in the HTML)
font_faces_raw = re.findall(r'@font-face\s*\{[^}]+\}', content)
print(f'Found {len(font_faces_raw)} @font-face declarations')

# Each ff is a string with literal \n - decode them
font_faces = [ff.replace('\\n', '\n').replace('\\"', '"').replace("\\'", "'") for ff in font_faces_raw]

# Build uuid -> {family, weight} map from all font faces
font_uuid_info = {}  # uuid -> {family, weight}
for ff in font_faces:
    uuid_match = UUID_RE.search(ff)
    family_match = re.search(r"font-family:\s*'([^']+)'", ff)
    weight_match = re.search(r'font-weight:\s*(\d+)', ff)
    if uuid_match and family_match:
        uuid = uuid_match.group(1)
        # Only store first occurrence for file naming
        if uuid not in font_uuid_info:
            font_uuid_info[uuid] = {
                'family': family_match.group(1),
                'weight': weight_match.group(1) if weight_match else '400'
            }

print(f'Unique font UUIDs: {len(font_uuid_info)}')

# Extract font files
os.makedirs('frontend/public/fonts', exist_ok=True)
font_file_map = {}  # uuid -> public filename

for uuid, info in font_uuid_info.items():
    if uuid not in manifest:
        print(f'  {uuid[:8]} not in manifest')
        continue
    mod = manifest[uuid]
    data = mod.get('data', '')
    compressed = mod.get('compressed', False)
    if not data:
        continue
    raw = base64.b64decode(data)
    font_bytes = gzip.decompress(raw) if compressed else raw
    family_safe = info['family'].replace(' ', '')
    fname = f"{family_safe}-{info['weight']}-{uuid[:8]}.woff2"
    fpath = f"frontend/public/fonts/{fname}"
    with open(fpath, 'wb') as f:
        f.write(font_bytes)
    print(f"  Saved: {fname} ({len(font_bytes)} bytes)")
    font_file_map[uuid] = fname

# Generate clean @font-face CSS with proper newlines
css_rules = []
for ff in font_faces:
    uuid_match = UUID_RE.search(ff)
    if not uuid_match:
        continue
    uuid = uuid_match.group(1)
    if uuid not in font_file_map:
        continue
    fname = font_file_map[uuid]
    # Replace uuid url with local path (cleaned up)
    new_ff = re.sub(r'url\(["\']?' + re.escape(uuid) + r'["\']?\)',
                    f'url("/fonts/{fname}")', ff)
    css_rules.append(new_ff)

with open('frontend/src/fonts.css', 'w', encoding='utf-8', newline='\n') as f:
    f.write('\n\n'.join(css_rules) + '\n')
print(f'\nWrote fonts.css with {len(css_rules)} @font-face rules')

# Rename files correctly (they may have wrong weight in filename)
# The actual file serves all weights, so just name them by UUID
print('\nRenaming font files to be UUID-based to avoid confusion...')
new_font_file_map = {}
for uuid, info in font_uuid_info.items():
    if uuid not in manifest:
        continue
    family_safe = info['family'].replace(' ', '')
    old_fname = f"{family_safe}-{info['weight']}-{uuid[:8]}.woff2"
    new_fname = f"{family_safe}-{uuid[:8]}.woff2"
    old_path = f"frontend/public/fonts/{old_fname}"
    new_path = f"frontend/public/fonts/{new_fname}"
    if os.path.exists(old_path):
        os.rename(old_path, new_path)
        new_font_file_map[uuid] = new_fname

# Regenerate CSS with new filenames
css_rules = []
for ff in font_faces:
    uuid_match = UUID_RE.search(ff)
    if not uuid_match:
        continue
    uuid = uuid_match.group(1)
    if uuid not in new_font_file_map:
        continue
    fname = new_font_file_map[uuid]
    new_ff = re.sub(r'url\(["\']?' + re.escape(uuid) + r'["\']?\)',
                    f'url("/fonts/{fname}")', ff)
    css_rules.append(new_ff)

with open('frontend/src/fonts.css', 'w', encoding='utf-8', newline='\n') as f:
    f.write('\n\n'.join(css_rules) + '\n')
print(f'Rewrote fonts.css with {len(css_rules)} rules using clean filenames')
