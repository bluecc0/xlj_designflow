#!/bin/bash
set -e

EXTENSION_ID="${EXTENSION_ID:-com.loom.ai.painter}"
CEP_ROOT="${HOME}/Library/Application Support/Adobe/CEP/extensions"
LINK_PATH="${CEP_ROOT}/${EXTENSION_ID}"

if [ ! -L "${LINK_PATH}" ] && [ ! -d "${LINK_PATH}" ]; then
  echo "软连接不存在：${LINK_PATH}"
  exit 0
fi

if [ ! -L "${LINK_PATH}" ]; then
  echo "错误：${LINK_PATH} 不是软连接，请手动检查。"
  exit 1
fi

rm "${LINK_PATH}"
echo "✅ 已移除开发软连接：${LINK_PATH}"
