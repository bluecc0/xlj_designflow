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

  var hostReadyPromise = null;

  function ensureHostLoaded() {
    if (hostReadyPromise) return hostReadyPromise;
    var hostPath = path.join(getExtensionRootPath(), "host", "main.jsx");
    var script = "(function(){var f=new File(" + JSON.stringify(hostPath) + ");if(!f.exists){return 'MISSING';}$.evalFile(f);return (typeof $._loomExpandWorker==='object')?'OK':'NOT_READY';}())";
    hostReadyPromise = evalScriptRaw(script).then(function (res) {
      if (res !== "OK") {
        hostReadyPromise = null;
        throw new Error("加载 Worker 宿主脚本失败：" + res);
      }
      return true;
    });
    return hostReadyPromise;
  }

  function evalHost(methodName, payload, timeoutMs) {
    return ensureHostLoaded().then(function () {
      var payloadPath = path.join(os.tmpdir(), "loom-worker-payload-" + Date.now() + "-" + Math.random().toString(16).slice(2) + ".json");
      fs.writeFileSync(payloadPath, JSON.stringify(payload || {}), "utf8");
      var callScript = "$._loomExpandWorker.invokeFromPath(" + JSON.stringify(methodName) + "," + JSON.stringify(payloadPath) + ")";

      return new Promise(function (resolve, reject) {
        var settled = false;
        var timer = null;
        if (timeoutMs && timeoutMs > 0) {
          timer = setTimeout(function () {
            if (settled) return;
            settled = true;
            try { if (fs.existsSync(payloadPath)) fs.unlinkSync(payloadPath); } catch (_e) {}
            var err = new Error("Photoshop 执行超时（>" + Math.round(timeoutMs / 1000) + "s）");
            err.code = "PS_EXEC_TIMEOUT";
            reject(err);
          }, timeoutMs);
        }

        evalScriptRaw(callScript).then(function (raw) {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          try { if (fs.existsSync(payloadPath)) fs.unlinkSync(payloadPath); } catch (_e) {}
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
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          try { if (fs.existsSync(payloadPath)) fs.unlinkSync(payloadPath); } catch (_e) {}
          reject(err);
        });
      });
    });
  }

  window.__worker.hostBridge = {
    evalHost: evalHost,
    ensureHostLoaded: ensureHostLoaded
  };
})();
