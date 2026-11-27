#!/bin/bash
set -euo pipefail

template_path=""
copy_name=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -TemplatePath)
      template_path="${2:-}"
      shift 2
      ;;
    -CopyName)
      copy_name="${2:-}"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

json_escape() {
  local value="${1:-}"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\n'/\\n}"
  printf '%s' "$value"
}

fail() {
  printf '{"ok":false,"error":"%s"}' "$(json_escape "${1:-Unknown error}")"
  exit 1
}

if [[ -z "$template_path" ]]; then
  fail "TemplatePath is required."
fi

if [[ ! -f "$template_path" ]]; then
  fail "Template file not found: $template_path"
fi

extension="${template_path##*.}"
if [[ "$extension" == "$template_path" ]]; then
  extension="psd"
fi

temp_dir="${TMPDIR:-/tmp}"
temp_dir="${temp_dir%/}"
find "$temp_dir" -maxdepth 1 -type f -name 'loom-template-copy.*.psd' -mtime +1 -delete 2>/dev/null || true
copy_base="$(mktemp "${temp_dir}/loom-template-copy.XXXXXX")"
copy_path="${copy_base}.${extension}"
rm -f "$copy_base"
cp -f "$template_path" "$copy_path"

js_escape() {
  local value="${1:-}"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\n'/\\n}"
  printf '%s' "$value"
}

jsx_base="$(mktemp "${temp_dir}/loom-open-template.XXXXXX")"
jsx_path="${jsx_base}.jsx"
rm -f "$jsx_base"
trap 'rm -f "$jsx_path"' EXIT

cat >"$jsx_path" <<JSX
(function () {
  var file = new File("$(js_escape "$copy_path")");
  if (!file.exists) {
    throw new Error("Template copy does not exist: " + file.fsName);
  }
  app.open(file);
  return app.activeDocument.name;
}())
JSX

open_result="$(/usr/bin/osascript - "$jsx_path" <<'OSA'
on run argv
  set jsxPath to item 1 of argv
  set jsxFile to open for access POSIX file jsxPath
  set jsxCode to read jsxFile
  close access jsxFile
  tell application id "com.adobe.Photoshop"
    activate
    set resultText to do javascript jsxCode
  end tell
  return resultText
end run
OSA
)"

if [[ -z "$open_result" ]]; then
  fail "Photoshop did not confirm opening the template copy."
fi

printf '{"ok":true,"copyPath":"%s","documentName":"%s"}' \
  "$(json_escape "$copy_path")" \
  "$(json_escape "$open_result")"
