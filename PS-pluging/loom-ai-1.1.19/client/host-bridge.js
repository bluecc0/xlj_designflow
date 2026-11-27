(function () {
  "use strict";

  var fs = require("fs");
  var os = require("os");
  var path = require("path");
  var childProcess = require("child_process");

  var $L = window.__loom;
  var CONFIG = $L.CONFIG;
  var HOST_LOG_PATH = $L.HOST_LOG_PATH;
  var u = $L.utils;

  function log(m, v) { $L.log(m, v); }

  // ─── CEP 接口 ────────────────────────────────────────

  var csInterface = typeof window.CSInterface === "function" ? new window.CSInterface() : null;
  var cep = window.__adobe_cep__;

  var cs = {
    evalScript: function (script, callback) {
      if (csInterface && typeof csInterface.evalScript === "function") { csInterface.evalScript(script, callback); return; }
      if (cep && typeof cep.evalScript === "function") { cep.evalScript(script, callback); return; }
      callback("EvalScript error.");
    }
  };

  // ─── 环境工具 ────────────────────────────────────────

  function escapeForJsx(value) { return JSON.stringify(value); }

  function getExtensionRootPath() {
    var pathname = window.location.pathname || "";
    var decoded = decodeURIComponent(pathname);
    if (process.platform === "darwin") return path.dirname(path.dirname(decoded));
    var normalized = decoded.replace(/\//g, "\\");
    if (/^\\[A-Za-z]:\\/.test(normalized)) normalized = normalized.slice(1);
    return path.dirname(path.dirname(normalized));
  }

  function isSymlinkPath(targetPath) {
    try { return fs && fs.lstatSync(targetPath).isSymbolicLink(); } catch (_e) { return false; }
  }

  function resolvePlatformPaths() {
    var platform = process.platform === "darwin" ? "mac" : "windows";
    var pathsConfig = CONFIG.paths && CONFIG.paths[platform];
    if (!pathsConfig) throw new Error("Missing path configuration for platform: " + platform);
    return pathsConfig;
  }

  // ─── 宿主脚本加载 ────────────────────────────────────

  var hostScriptReadyPromise = null;

  function ensureHostScriptLoaded() {
    if (hostScriptReadyPromise) return hostScriptReadyPromise;

    hostScriptReadyPromise = new Promise(function (resolve, reject) {
      var hostScriptPath = path.join(getExtensionRootPath(), "host", "main.jsx");
      var escaped = escapeForJsx(hostScriptPath);
      var script = "(function(){var f=new File(" + escaped + ");if(!f.exists){return 'HOST_SCRIPT_MISSING:' + f.fsName;}$.evalFile(f);return (typeof $._loomAiPainter !== 'undefined') ? 'OK' : 'HOST_SCRIPT_NOT_READY';}())";

      cs.evalScript(script, function (result) {
        if (result === "OK") { log("宿主脚本已就绪。", "muted"); resolve(); return; }
        reject(new Error(result || "HOST_SCRIPT_LOAD_FAILED"));
      });
    });

    return hostScriptReadyPromise;
  }

  // ─── 底层 evalScript ────────────────────────────────

  function evalScriptRaw(script) {
    return new Promise(function (resolve, reject) {
      cs.evalScript(script, function (result) {
        if (!result || result === "EvalScript error.") { reject(new Error("EvalScript error.")); return; }
        resolve(result);
      });
    });
  }

  function evalScriptDirect(script) {
    return new Promise(function (resolve, reject) {
      cs.evalScript(script, function (result) {
        if (!result || result === "EvalScript error.") { reject(new Error("EvalScript error.")); return; }
        resolve(result);
      });
    });
  }

  // ─── 调用宿主方法 ────────────────────────────────────

  function evalHost(methodName, payload) {
    return ensureHostScriptLoaded()
      .then(function () { return evalScriptRaw("typeof $._loomAiPainter"); })
      .then(function (bridgeType) {
        if (bridgeType !== "object") throw new Error("HOST_BRIDGE_UNAVAILABLE");
        return evalScriptRaw("typeof $._loomAiPainter['" + methodName + "']");
      })
      .then(function (methodType) {
        if (methodType !== "function") throw new Error("HOST_METHOD_MISSING:" + methodName);

        return new Promise(function (resolve, reject) {
          var payloadFilePath = u.writeTempTextFile("loom-host-payload", JSON.stringify(payload || {}), ".json");
          var callScript = "$._loomAiPainter.invokeFromPath(" + escapeForJsx(methodName) + ", " + escapeForJsx(payloadFilePath) + ")";

          cs.evalScript(callScript, function (result) {
            u.cleanupFile(payloadFilePath);
            if (!result || result === "EvalScript error.") {
              reject(new Error("Photoshop 宿主脚本执行失败：" + methodName + "。请查看日志：" + HOST_LOG_PATH));
              return;
            }
            try {
              var parsed = JSON.parse(result);
              if (!parsed.ok) { reject(new Error((parsed && parsed.error) || "Photoshop 操作失败。")); return; }
              resolve(parsed.data);
            } catch (error) {
              reject(new Error("无法解析 Photoshop 返回值：" + result));
            }
          });
        });
      });
  }

  // ─── 平台脚本执行 ────────────────────────────────────

  function runPlatformTool(scriptName, args) {
    return new Promise(function (resolve, reject) {
      var isMac = process.platform === "darwin";
      var actualScriptName = scriptName.replace(/\.js$/i, isMac ? ".sh" : ".ps1");
      var scriptPath = path.join(getExtensionRootPath(), "scripts", actualScriptName);
      var commandPath = isMac ? "/bin/bash" : "powershell.exe";
      var commandArgs = isMac ? [scriptPath] : ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath];

      if (!fs.existsSync(scriptPath)) { reject(new Error("Tool script not found: " + scriptPath)); return; }

      Object.keys(args || {}).forEach(function (key) { commandArgs.push("-" + key); commandArgs.push(String(args[key])); });

      childProcess.execFile(commandPath, commandArgs, { windowsHide: true, timeout: 180000, maxBuffer: 20 * 1024 * 1024 }, function (error, stdout, stderr) {
        var outputText = String(stdout || stderr || "").trim();

        if (error) {
          if (outputText) {
            try { var parsed = JSON.parse(outputText); if (parsed && parsed.error) { reject(new Error(parsed.error)); return; } } catch (_e) {}
          }
          reject(new Error(outputText || error.message || ("Tool script failed: " + actualScriptName)));
          return;
        }

        try { resolve(JSON.parse(outputText || "{}")); }
        catch (_e) { reject(new Error("Tool script returned non-JSON output: " + outputText)); }
      });
    });
  }

  // ─── 挂载到全局命名空间 ─────────────────────────────

  window.__loom.hostBridge = {
    cs: cs,
    csInterface: csInterface,
    escapeForJsx: escapeForJsx,
    getExtensionRootPath: getExtensionRootPath,
    isSymlinkPath: isSymlinkPath,
    resolvePlatformPaths: resolvePlatformPaths,
    ensureHostScriptLoaded: ensureHostScriptLoaded,
    evalScriptRaw: evalScriptRaw,
    evalScriptDirect: evalScriptDirect,
    evalHost: evalHost,
    runPlatformTool: runPlatformTool
  };
})();
