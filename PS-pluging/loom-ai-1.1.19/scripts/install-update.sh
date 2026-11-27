#!/bin/bash
set -euo pipefail

manifest_path=""
extension_root=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -ManifestPath)
      manifest_path="${2:-}"
      shift 2
      ;;
    -ExtensionRoot)
      extension_root="${2:-}"
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

json_field() {
  local file_path="$1"
  local field_name="$2"
  sed -n 's/.*"'"$field_name"'":[[:space:]]*"\([^"]*\)".*/\1/p' "$file_path" | head -n 1
}

version_state() {
  local left="$1"
  local right="$2"
  IFS='.' read -r -a left_parts <<<"$left"
  IFS='.' read -r -a right_parts <<<"$right"
  local length="${#left_parts[@]}"
  if (( ${#right_parts[@]} > length )); then
    length="${#right_parts[@]}"
  fi
  local index left_value right_value
  for (( index=0; index<length; index+=1 )); do
    left_value="${left_parts[index]:-0}"
    right_value="${right_parts[index]:-0}"
    if (( 10#$left_value > 10#$right_value )); then
      printf 'newer'
      return
    fi
    if (( 10#$left_value < 10#$right_value )); then
      printf 'older'
      return
    fi
  done
  printf 'equal'
}

if [[ -z "$manifest_path" || -z "$extension_root" ]]; then
  fail "ManifestPath and ExtensionRoot are required."
fi

if [[ ! -f "$manifest_path" ]]; then
  fail "Update manifest not found: $manifest_path"
fi

manifest_xml="${extension_root}/CSXS/manifest.xml"
if [[ ! -f "$manifest_xml" ]]; then
  fail "Local manifest not found: $manifest_xml"
fi

current_version="$(sed -n 's/.*ExtensionBundleVersion="\([^"]*\)".*/\1/p' "$manifest_xml" | head -n 1)"
if [[ -z "$current_version" ]]; then
  fail "Unable to parse local manifest version."
fi

latest_version="$(json_field "$manifest_path" "version" | tr -d '\r\n')"
package_file="$(json_field "$manifest_path" "packageFile" | tr -d '\r\n')"
bundle_id="$(json_field "$manifest_path" "bundleId" | tr -d '\r\n')"

if [[ -z "$latest_version" || -z "$package_file" ]]; then
  fail "Update manifest is missing required fields."
fi

version_result="$(version_state "$latest_version" "$current_version")"
if [[ "$version_result" == "older" || "$version_result" == "equal" ]]; then
  printf '{"ok":true,"updated":false,"currentVersion":"%s","latestVersion":"%s"}' \
    "$(json_escape "$current_version")" \
    "$(json_escape "$latest_version")"
  exit 0
fi

base_dir="$(cd "$(dirname "$manifest_path")" && pwd)"
package_source="${base_dir}/${package_file}"
if [[ ! -f "$package_source" ]]; then
  fail "Update package not found: $package_source"
fi

temp_root="$(mktemp -d "${TMPDIR:-/tmp}/loom-update.XXXXXX")"
zip_path="${temp_root}/${package_file}"
extract_dir="${temp_root}/extract"
mkdir -p "$extract_dir"
trap 'rm -rf "$temp_root"' EXIT

cp -f "$package_source" "$zip_path"
/usr/bin/unzip -oq "$zip_path" -d "$extract_dir"

source_root="$extract_dir"
if [[ -n "$bundle_id" && -d "${extract_dir}/${bundle_id}" ]]; then
  source_root="${extract_dir}/${bundle_id}"
fi

mkdir -p "$extension_root"
/usr/bin/ditto "$source_root" "$extension_root"

printf '{"ok":true,"updated":true,"currentVersion":"%s","latestVersion":"%s","reloadRequired":true}' \
  "$(json_escape "$current_version")" \
  "$(json_escape "$latest_version")"
