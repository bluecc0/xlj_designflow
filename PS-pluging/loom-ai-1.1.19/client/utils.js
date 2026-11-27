(function () {
  "use strict";

  var fs = require("fs");
  var os = require("os");
  var path = require("path");

  var $L = window.__loom;

  // ─── 格式化 ──────────────────────────────────────────

  function formatLogTime(date) {
    var hours = String(date.getHours()).padStart(2, "0");
    var minutes = String(date.getMinutes()).padStart(2, "0");
    var seconds = String(date.getSeconds()).padStart(2, "0");
    return hours + ":" + minutes + ":" + seconds;
  }

  function formatShortClock(date) {
    var hours = String(date.getHours()).padStart(2, "0");
    var minutes = String(date.getMinutes()).padStart(2, "0");
    return hours + ":" + minutes;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function sanitizeResponseText(text) {
    if (!text) return "";
    return String(text).replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").trim();
  }

  function previewResponseText(text) {
    var sanitized = sanitizeResponseText(text);
    return sanitized ? sanitized.slice(0, 300) : "<empty>";
  }

  function extractApiMessage(payload) {
    if (!payload) return "";
    if (payload.detail && typeof payload.detail === "string") return payload.detail;
    if (payload.error_message) return String(payload.error_message);
    if (payload.error && payload.error.message) return String(payload.error.message);
    if (payload.message) return String(payload.message);
    if (payload.msg) return String(payload.msg);
    return "";
  }

  function extractApiCode(payload) {
    if (!payload) return "";
    if (payload.error_code) return String(payload.error_code);
    if (payload.error && typeof payload.error.code !== "undefined") return String(payload.error.code);
    if (typeof payload.code !== "undefined") return String(payload.code);
    return "";
  }

  function formatApiDetails(payload, statusCode, rawText) {
    var parts = ["HTTP " + statusCode];
    var code = extractApiCode(payload);
    var message = extractApiMessage(payload);
    var bodyPreview = previewResponseText(rawText);
    if (code) parts.push("code=" + code);
    if (message) {
      parts.push(message);
    } else if (bodyPreview && bodyPreview !== "<empty>") {
      parts.push(bodyPreview);
    }
    return parts.join(" | ");
  }

  function formatBytes(bytes) {
    var size = Math.max(0, Number(bytes) || 0);
    if (size >= 1024 * 1024) return (size / 1024 / 1024).toFixed(2) + "MB";
    if (size >= 1024) return (size / 1024).toFixed(1) + "KB";
    return size + "B";
  }

  function formatElapsed(startedAt) {
    return ((Date.now() - startedAt) / 1000).toFixed(1) + "s";
  }

  // ─── 文件与路径 ──────────────────────────────────────

  function getMimeType(filePath) {
    var ext = String(path.extname(filePath || "") || "").toLowerCase();
    if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
    if (ext === ".webp") return "image/webp";
    if (ext === ".gif") return "image/gif";
    return "image/png";
  }

  function getFileSize(filePath) {
    try { return filePath && fs.existsSync(filePath) ? fs.statSync(filePath).size : 0; }
    catch (_e) { return 0; }
  }

  function toFileUrl(filePath) {
    var normalized = String(filePath || "").replace(/\\/g, "/");
    if (/^[A-Za-z]:\//.test(normalized)) {
      return "file:///" + encodeURI(normalized);
    }
    return "file://" + encodeURI(normalized);
  }

  function writeTempTextFile(prefix, content, extension) {
    var filePath = path.join(
      os.tmpdir(),
      prefix + "-" + Date.now() + "-" + Math.random().toString(16).slice(2) + (extension || ".txt")
    );
    fs.writeFileSync(filePath, content, "utf8");
    return filePath;
  }

  function cleanupFile(filePath) {
    try {
      if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (_e) {}
  }

  function cleanupDirectory(dirPath) {
    try {
      if (!dirPath || !fs.existsSync(dirPath)) return;
      var entries = fs.readdirSync(dirPath);
      entries.forEach(function (name) {
        var full = path.join(dirPath, name);
        try {
          var stat = fs.lstatSync(full);
          if (stat.isDirectory()) {
            cleanupDirectory(full);
          } else {
            fs.unlinkSync(full);
          }
        } catch (_e1) {}
      });
      fs.rmdirSync(dirPath);
    } catch (_e2) {}
  }

  function cleanupStaleExpandCaches(keepDir) {
    var root = $L.EXPAND_CACHE_ROOT || path.join(os.tmpdir(), "loom-expand-cache");
    try {
      if (!fs.existsSync(root)) return;
      var entries = fs.readdirSync(root);
      entries.forEach(function (name) {
        var full = path.join(root, name);
        if (keepDir && path.resolve(full) === path.resolve(keepDir)) return;
        cleanupDirectory(full);
      });
    } catch (_e) {}
  }

  function describePadding(padding) {
    if (!padding) return "0/0/0/0";
    return "上" + (padding.top || 0) + " 右" + (padding.right || 0) + " 下" + (padding.bottom || 0) + " 左" + (padding.left || 0);
  }

  window.__loom.utils = {
    formatLogTime: formatLogTime,
    formatShortClock: formatShortClock,
    escapeHtml: escapeHtml,
    sanitizeResponseText: sanitizeResponseText,
    previewResponseText: previewResponseText,
    extractApiMessage: extractApiMessage,
    extractApiCode: extractApiCode,
    formatApiDetails: formatApiDetails,
    formatBytes: formatBytes,
    formatElapsed: formatElapsed,
    getMimeType: getMimeType,
    getFileSize: getFileSize,
    toFileUrl: toFileUrl,
    writeTempTextFile: writeTempTextFile,
    cleanupFile: cleanupFile,
    cleanupDirectory: cleanupDirectory,
    cleanupStaleExpandCaches: cleanupStaleExpandCaches,
    describePadding: describePadding
  };
})();
