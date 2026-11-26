#!/bin/bash
set -euo pipefail

banner_dir=""
poster_dir=""
horizontal_artboard_name=""
vertical_artboard_name=""
template_marker=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -BannerDir)
      banner_dir="${2:-}"
      shift 2
      ;;
    -PosterDir)
      poster_dir="${2:-}"
      shift 2
      ;;
    -HorizontalArtboardName)
      horizontal_artboard_name="${2:-}"
      shift 2
      ;;
    -VerticalArtboardName)
      vertical_artboard_name="${2:-}"
      shift 2
      ;;
    -TemplateMarker)
      template_marker="${2:-}"
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

run_photoshop_js_file() {
  local js_file="$1"
  /usr/bin/osascript - "$js_file" <<'OSA'
on run argv
  set jsPath to item 1 of argv
  set jsFile to open for access POSIX file jsPath
  set jsCode to read jsFile
  close access jsFile
  tell application id "com.adobe.Photoshop"
    activate
    set resultText to do javascript jsCode
  end tell
  return resultText
end run
OSA
}

if [[ -z "$banner_dir" || -z "$poster_dir" ]]; then
  fail "BannerDir and PosterDir are required."
fi

if [[ -z "$horizontal_artboard_name" || -z "$vertical_artboard_name" ]]; then
  fail "HorizontalArtboardName and VerticalArtboardName are required."
fi

script_dir="$(cd "$(dirname "$0")" && pwd)"
standalone_script_path="${script_dir}/export-artboards.jsx"
if [[ ! -f "$standalone_script_path" ]]; then
  fail "Standalone export script not found: $standalone_script_path"
fi

temp_dir="${TMPDIR:-/tmp}"
temp_dir="${temp_dir%/}"
document_js_base="$(mktemp "${temp_dir}/loom-doc.XXXXXX")"
payload_base="$(mktemp "${temp_dir}/loom-export.XXXXXX")"
runner_js_base="$(mktemp "${temp_dir}/loom-export-runner.XXXXXX")"
document_js="${document_js_base}.jsx"
payload_path="${payload_base}.json"
runner_js_path="${runner_js_base}.jsx"
rm -f "$document_js_base" "$payload_base" "$runner_js_base"
trap 'rm -f "$document_js" "$payload_path" "$runner_js_path"' EXIT

printf "app.documents.length ? app.activeDocument.name : '';" >"$document_js"
document_name="$(run_photoshop_js_file "$document_js")"
document_name="${document_name//$'\r'/}"
document_name="${document_name//$'\n'/}"
if [[ -z "$document_name" ]]; then
  fail "No active Photoshop document."
fi

product_name="${document_name%.*}"
product_name="${product_name#"${product_name%%[![:space:]]*}"}"
product_name="${product_name%"${product_name##*[![:space:]]}"}"
if [[ -z "$product_name" ]]; then
  fail "Unable to derive product name from current document."
fi

if [[ -n "$template_marker" && "$product_name" == *"$template_marker"* ]]; then
  fail "Please save the template copy as a product code first, for example ABC-123.psd."
fi

safe_product_name="$(printf '%s' "$product_name" | sed 's#[\\/:*?"<>|]#-#g')"
banner_path="${banner_dir}/${safe_product_name}.png"
poster_path="${poster_dir}/${safe_product_name}.png"
poster_extra_path="${poster_dir}/${safe_product_name}_1.png"

mkdir -p "$banner_dir" "$poster_dir"

cat >"$payload_path" <<JSON
{"exports":[{"artboardName":"$(json_escape "$horizontal_artboard_name")","outputPath":"$(json_escape "$banner_path")"},{"artboardName":"$(json_escape "$vertical_artboard_name")","outputPath":"$(json_escape "$poster_path")"},{"artboardName":"$(json_escape "$vertical_artboard_name")","outputPath":"$(json_escape "$poster_extra_path")","hideLayerNames":["poster-1"]}]}
JSON

cat >"$runner_js_path" <<JSX
(function () {
  var LOOM_EXPORT_PAYLOAD_PATH = "$(json_escape "$payload_path")";
  return $.evalFile(new File("$(json_escape "$standalone_script_path")"));
}())
JSX

raw_result="$(run_photoshop_js_file "$runner_js_path")"
raw_result="${raw_result//$'\r'/}"
raw_result="${raw_result//$'\n'/}"
if [[ -z "$raw_result" ]]; then
  fail "Photoshop returned an empty export response."
fi

printf '%s' "$raw_result"
