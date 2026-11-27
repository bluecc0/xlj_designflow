(function () {
  "use strict";

  var fs = require("fs");
  var os = require("os");
  var path = require("path");

  var csInterface = typeof window.CSInterface === "function" ? new window.CSInterface() : null;
  var cep = window.__adobe_cep__;

  function evalScriptRaw(script) {
    return new Promise(function (resolve, reject) {
      var fn = (csInterface && csInterface.evalScript)
        ? csInterface.evalScript.bind(csInterface)
        : (cep && cep.evalScript ? cep.evalScript.bind(cep) : null);
      if (!fn) {
        reject(new Error("无法访问 Photoshop CEP 接口。"));
        return;
      }
      fn(script, function (res) {
        if (!res || res === "EvalScript error.") {
          reject(new Error("EvalScript error."));
          return;
        }
        resolve(res);
      });
    });
  }

  function getExtensionRootPath() {
    var pathname = decodeURIComponent(window.location.pathname || "");
    if (process.platform === "darwin") return path.dirname(path.dirname(pathname));
    var normalized = pathname.replace(/\//g, "\\");
    if (/^\\[A-Za-z]:\\/.test(normalized)) normalized = normalized.slice(1);
    return path.dirname(path.dirname(normalized));
  }

  function readHostScriptBody() {
    var hostPath = path.join(getExtensionRootPath(), "host", "main.jsx");
    if (!fs.existsSync(hostPath)) {
      throw new Error("宿主脚本不存在：" + hostPath);
    }
    var raw = fs.readFileSync(hostPath, "utf8");
    // 去掉首行 #target photoshop 与 BOM，确保在单次 evalScript 内联执行时语法合法
    return raw.replace(/^\uFEFF/, "").replace(/^\s*#target\s+photoshop\s*\r?\n/i, "");
  }

  /**
   * 每次调用均内联携带 host/main.jsx 正文执行：
   * 避免 PS 26.0.0 CEP 下 $.evalFile 失败、跨 evalScript 调用全局对象丢失，以及 rejected Promise 永久缓存问题。
   */
  function evalHost(methodName, payload, timeoutMs, onLateSettle) {
    var hostBody;
    try {
      hostBody = readHostScriptBody();
    } catch (readErr) {
      return Promise.reject(readErr);
    }

    var payloadPath = path.join(
      os.tmpdir(),
      "loom-worker-payload-" + Date.now() + "-" + Math.random().toString(16).slice(2) + ".json"
    );
    fs.writeFileSync(payloadPath, JSON.stringify(payload || {}), "utf8");

    var inlineScript = [
      "(function () {",
      "  try {",
      hostBody,
      "    return $._loomExpandWorker.invokeFromPath(" + JSON.stringify(methodName) + "," + JSON.stringify(payloadPath) + ");",
      "  } catch (e) {",
      "    return '{\"ok\":false,\"errorCode\":\"PS_HOST_BOOTSTRAP_ERROR\",\"error\":\"' + String((e && e.message) || e).replace(/\\\\/g, '\\\\\\\\').replace(/\"/g, '\\\\\"').replace(/\\r?\\n/g, ' ') + '\"}';",
      "  }",
      "}())"
    ].join("\n");

    return new Promise(function (resolve, reject) {
      var timedOut = false;
      var settled = false;
      var timer = null;

      function cleanupPayload() {
        try { if (fs.existsSync(payloadPath)) fs.unlinkSync(payloadPath); } catch (_e) {}
      }

      if (timeoutMs && timeoutMs > 0) {
        timer = setTimeout(function () {
          if (settled) return;
          settled = true;
          timedOut = true;
          var err = new Error("Photoshop 执行超时（>" + Math.round(timeoutMs / 1000) + "s）");
          err.code = "PS_EXEC_TIMEOUT";
          reject(err);
        }, timeoutMs);
      }

      evalScriptRaw(inlineScript).then(function (raw) {
        cleanupPayload();
        if (timedOut) {
          if (typeof onLateSettle === "function") {
            try { onLateSettle(null, raw); } catch (_lateErr) {}
          }
          return;
        }
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        try {
          var parsed = JSON.parse(raw);
          if (!parsed.ok) {
            var err = new Error(parsed.error || "Photoshop 执行失败");
            if (parsed.errorCode) err.code = parsed.errorCode;
            reject(err);
            return;
          }
          resolve(parsed.data);
        } catch (_parseErr) {
          reject(new Error("无法解析 JSX 返回值：" + String(raw).slice(0, 200)));
        }
      }, function (err) {
        cleanupPayload();
        if (timedOut) {
          if (typeof onLateSettle === "function") {
            try { onLateSettle(err, null); } catch (_lateErr) {}
          }
          return;
        }
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        reject(new Error("宿主调用 [" + methodName + "] 失败：" + (err && err.message ? err.message : String(err))));
      });
    });
  }

  window.__worker.hostBridge = {
    evalHost: evalHost
  };
})();
