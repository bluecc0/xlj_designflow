var fs = require("fs");
var path = require("path");
var os = require("os");

window.__loom = window.__loom || {};

function loadLocalExpandOverride() {
  try {
    var baseDir = process.platform === "win32"
      ? (process.env.APPDATA || os.homedir())
      : path.join(os.homedir(), ".config");
    var fp = path.join(baseDir, "loom-ai", "expand.json");
    if (fs.existsSync(fp)) {
      var parsed = JSON.parse(fs.readFileSync(fp, "utf8") || "{}");
      if (parsed && typeof parsed === "object") return parsed;
    }
  } catch (_e) {}
  return {};
}

var localOverride = loadLocalExpandOverride();

window.__loom.CONFIG = {
  version: "2.0.0",
  providerName: "PS Expand",
  // 局域网 DesignFlow FastAPI 扩图服务地址与访问令牌：
  // 内部打包发布前填入正式机地址与 PS_EXPAND_CLIENT_TOKEN（或在本机 %APPDATA%\loom-ai\expand.json 覆写，切勿将真实密钥提交到仓库）
  expandServerUrl: String(localOverride.expandServerUrl || "http://127.0.0.1:8000").trim().replace(/\/+$/, ""),
  expandApiPrefix: "/api/v1/expand",
  expandAuthToken: String(localOverride.expandAuthToken || "").trim(),
  pollIntervalMs: 1500,
  taskTimeoutMs: 180000,
  statusPollIntervalMs: 15000,
  cropFallbackPollMs: 700,
  maxOutputSidePx: 6000,
  maxUploadBytes: 20 * 1024 * 1024,
  outputFormat: "jpg",
  outputQuality: 92,
  returnAllVariants: true,
  paths: {
    windows: {
      templateSourcePath: "\\\\192.168.152.52\\素材库\\场景图\\场景图.psd",
      exportBannerDir: "\\\\192.168.152.52\\素材库\\场景图\\banner",
      exportPosterDir: "\\\\192.168.152.52\\素材库\\场景图\\poster",
      updateManifestPath: "\\\\192.168.152.52\\素材库\\工具\\loom\\latest.json"
    },
    mac: {
      templateSourcePath: "/Volumes/素材库/场景图/场景图.psd",
      exportBannerDir: "/Volumes/素材库/场景图/banner",
      exportPosterDir: "/Volumes/素材库/场景图/poster",
      updateManifestPath: "/Volumes/素材库/工具/loom/latest.json"
    }
  }
};

window.__loom.HOST_LOG_PATH = path.join(os.tmpdir(), "loom-ai-host.log");
window.__loom.EXPAND_CACHE_ROOT = path.join(os.tmpdir(), "loom-expand-cache");

// 由 app.js 在初始化时覆盖
window.__loom.log = function () {};
