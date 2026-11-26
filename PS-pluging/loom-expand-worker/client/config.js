var fs = require("fs");
var os = require("os");
var path = require("path");

window.__worker = window.__worker || {};

function getConfigFilePath() {
  var baseDir = process.platform === "win32"
    ? (process.env.APPDATA || os.homedir())
    : path.join(os.homedir(), ".config");
  return path.join(baseDir, "loom-expand-worker", "worker.json");
}

function loadConfig() {
  var defaults = {
    workerVersion: "1.0.0",
    serverUrl: "http://127.0.0.1:8000",
    workerId: "win-ps-01",
    // 必须与正式机 .env 中的 PS_EXPAND_WORKER_SECRET 一致（留空时拒绝连接）
    token: "",
    heartbeatIntervalMs: 10000,
    wsPingIntervalMs: 15000,
    evalTimeoutMs: 75000,
    purgeEveryNTasks: 10
  };
  try {
    var fp = getConfigFilePath();
    if (fs.existsSync(fp)) {
      var parsed = JSON.parse(fs.readFileSync(fp, "utf8") || "{}");
      if (parsed && typeof parsed === "object") {
        Object.keys(parsed).forEach(function (k) {
          if (parsed[k] !== undefined && parsed[k] !== null && parsed[k] !== "") {
            defaults[k] = parsed[k];
          }
        });
      }
    }
  } catch (_e) {}
  defaults.serverUrl = String(defaults.serverUrl || "").trim().replace(/\/+$/, "");
  return defaults;
}

function saveConfig(patch) {
  var current = loadConfig();
  Object.keys(patch || {}).forEach(function (k) { current[k] = patch[k]; });
  current.serverUrl = String(current.serverUrl || "").trim().replace(/\/+$/, "");
  var fp = getConfigFilePath();
  var dir = path.dirname(fp);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(current, null, 2), "utf8");
  window.__worker.CONFIG = current;
  return current;
}

window.__worker.CONFIG = loadConfig();
window.__worker.saveConfig = saveConfig;
window.__worker.TEMP_ROOT = path.join(os.tmpdir(), "ps-expand");
window.__worker.HEARTBEAT_PATH = path.join(window.__worker.TEMP_ROOT, "heartbeat.json");
