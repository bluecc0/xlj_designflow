#!/bin/bash
set -e

EXTENSION_ID="${EXTENSION_ID:-com.loom.ai.painter}"
CEP_ROOT="${HOME}/Library/Application Support/Adobe/CEP/extensions"
LINK_PATH="${CEP_ROOT}/${EXTENSION_ID}"
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# 确保 CEP 扩展目录存在
mkdir -p "${CEP_ROOT}"

# 开启 PlayerDebugMode（CSXS 11-14）
for version in 11 12 13 14; do
  plist="${HOME}/Library/Preferences/com.adobe.CSXS.${version}.plist"
  if [ -f "${plist}" ]; then
    defaults write "${HOME}/Library/Preferences/com.adobe.CSXS.${version}" PlayerDebugMode -string "1"
  else
    defaults write "${HOME}/Library/Preferences/com.adobe.CSXS.${version}" PlayerDebugMode -string "1"
  fi
done

# 删除旧的链接/目录
if [ -L "${LINK_PATH}" ]; then
  rm "${LINK_PATH}"
elif [ -d "${LINK_PATH}" ]; then
  echo "错误：${LINK_PATH} 已存在且不是软连接，请手动删除后重试。"
  exit 1
fi

# 创建软连接
ln -s "${PROJECT_ROOT}" "${LINK_PATH}"

echo "✅ 开发软连接已创建：${LINK_PATH} -> ${PROJECT_ROOT}"
echo "✅ PlayerDebugMode 已开启（CSXS 11-14）"
echo ""
echo "请重启 Photoshop，然后从 窗口 > 扩展（旧版） > Loom AI 打开面板。"
