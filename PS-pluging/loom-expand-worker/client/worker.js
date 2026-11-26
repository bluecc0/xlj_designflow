(function () {
  "use strict";

  var fs = require("fs");
  var path = require("path");
  var http = require("http");
  var https = require("https");
  var url = require("url");

  var $W = window.__worker;
  var hostBridge = $W.hostBridge;

  // ─── DOM ─────────────────────────────────────────────

  var statusDot = document.getElementById("statusDot");
  var statusBadge = document.getElementById("statusBadge");
  var psVersionText = document.getElementById("psVersionText");
  var taskStateText = document.getElementById("taskStateText");
  var serverUrlInput = document.getElementById("serverUrlInput");
  var workerIdInput = document.getElementById("workerIdInput");
  var tokenInput = document.getElementById("tokenInput");
  var saveReconnectBtn = document.getElementById("saveReconnectBtn");
  var pauseBtn = document.getElementById("pauseBtn");
  var localTestBtn = document.getElementById("localTestBtn");
  var clearLogBtn = document.getElementById("clearLogBtn");
  var logBox = document.getElementById("logBox");

  // ─── 状态 ────────────────────────────────────────────

  var ws = null;
  var isBusy = false;
  var isPaused = false;
  var isQuarantined = false;
  var currentTaskId = null;
  var currentTaskStartedAt = 0;
  var pendingFinal = null; // { taskId, payload, workDir, retryTimer, createdAt }
  var psVersion = "unknown";
  var completedCount = 0;
  var reconnectAttempt = 0;
  var reconnectTimer = null;
  var pingTimer = null;
  var logs = [];

  var BACKOFF_MS = [1000, 2000, 5000, 10000, 20000, 30000];

  // ─── 日志与状态 ──────────────────────────────────────

  function nowClock() {
    var d = new Date();
    return String(d.getHours()).padStart(2, "0") + ":" +
      String(d.getMinutes()).padStart(2, "0") + ":" +
      String(d.getSeconds()).padStart(2, "0");
  }

  function appendLog(msg, variant) {
    logs.push({ time: nowClock(), msg: String(msg || ""), variant: variant || "muted" });
    if (logs.length > 50) logs = logs.slice(logs.length - 50);
    if (!logBox) return;
    logBox.innerHTML = logs.map(function (item) {
      return '<div class="log-line log-line--' + item.variant + '">[' + item.time + "] " +
        item.msg.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") + "</div>";
    }).join("");
    logBox.scrollTop = logBox.scrollHeight;
  }

  function refreshStatusUI(connState) {
    if (isQuarantined) {
      statusDot.className = "dot dot--offline";
      statusBadge.textContent = "超时隔离中";
    } else if (connState === "connected") {
      statusDot.className = isBusy ? "dot dot--busy" : "dot dot--online";
      statusBadge.textContent = isPaused ? "已暂停" : (isBusy ? "执行中" : "在线空闲");
    } else if (connState === "connecting") {
      statusDot.className = "dot dot--busy";
      statusBadge.textContent = "连接中...";
    } else {
      statusDot.className = "dot dot--offline";
      statusBadge.textContent = "断开重连中";
    }
    taskStateText.textContent = isQuarantined
      ? ("等待恢复: " + (currentTaskId || ""))
      : (currentTaskId ? ("任务: " + currentTaskId) : (isPaused ? "已暂停接单" : "空闲"));
    if (pauseBtn) pauseBtn.textContent = isPaused ? "恢复接单" : "暂停接单";
  }

  // ─── 本地心跳文件（供外部 Watchdog 监控） ────────────

  function writeHeartbeatFile() {
    try {
      if (!fs.existsSync($W.TEMP_ROOT)) fs.mkdirSync($W.TEMP_ROOT, { recursive: true });
      var payload = {
        ts: Math.floor(Date.now() / 1000),
        iso: new Date().toISOString(),
        worker_id: $W.CONFIG.workerId,
        ps_version: psVersion,
        busy: isBusy,
        paused: isPaused,
        quarantined: isQuarantined,
        task_id: currentTaskId,
        task_started_at: currentTaskStartedAt ? Math.floor(currentTaskStartedAt / 1000) : null
      };
      fs.writeFileSync($W.HEARTBEAT_PATH, JSON.stringify(payload, null, 2), "utf8");
    } catch (_e) {}
  }

  // ─── 临时目录清理 ────────────────────────────────────

  function removeDirRecursive(dirPath) {
    try {
      if (!dirPath || !fs.existsSync(dirPath)) return;
      fs.readdirSync(dirPath).forEach(function (name) {
        var full = path.join(dirPath, name);
        if (fs.lstatSync(full).isDirectory()) removeDirRecursive(full);
        else fs.unlinkSync(full);
      });
      fs.rmdirSync(dirPath);
    } catch (_e) {}
  }

  // ─── HTTP 文件下载与上传 ─────────────────────────────

  function resolveServerUrl(relOrAbs) {
    var s = String(relOrAbs || "");
    if (/^https?:\/\//i.test(s)) return s;
    var base = String($W.CONFIG.serverUrl || "").replace(/\/+$/, "");
    if (s.charAt(0) !== "/") s = "/" + s;
    return base + s;
  }

  function downloadFile(remoteUrl, destPath) {
    return new Promise(function (resolve, reject) {
      var parsed = new url.URL(resolveServerUrl(remoteUrl));
      var transport = parsed.protocol === "https:" ? https : http;
      var req = transport.request(
        {
          protocol: parsed.protocol,
          hostname: parsed.hostname,
          port: parsed.port || undefined,
          path: parsed.pathname + parsed.search,
          method: "GET",
          headers: { "X-Worker-Token": $W.CONFIG.token || "" }
        },
        function (res) {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            res.resume();
            reject(new Error("下载原图失败 HTTP " + res.statusCode));
            return;
          }
          var chunks = [];
          res.on("data", function (c) { chunks.push(c); });
          res.on("end", function () {
            fs.writeFileSync(destPath, Buffer.concat(chunks));
            resolve(destPath);
          });
        }
      );
      req.on("error", reject);
      req.setTimeout(60000, function () { req.destroy(new Error("下载原图超时")); });
      req.end();
    });
  }

  function uploadVariantFile(uploadUrl, taskId, variantIndex, filePath, artifactType) {
    return new Promise(function (resolve, reject) {
      var boundary = "----loom-worker-" + Date.now() + "-" + Math.random().toString(16).slice(2);
      var ext = path.extname(filePath || ".jpg").toLowerCase();
      var kind = artifactType || (ext === ".psd" ? "psd" : "preview");
      var mime = kind === "psd" ? "application/octet-stream" : (ext === ".png" ? "image/png" : "image/jpeg");
      var chunks = [];
      chunks.push(Buffer.from("--" + boundary + "\r\nContent-Disposition: form-data; name=\"task_id\"\r\n\r\n" + taskId + "\r\n", "utf8"));
      chunks.push(Buffer.from("--" + boundary + "\r\nContent-Disposition: form-data; name=\"variant_index\"\r\n\r\n" + String(variantIndex) + "\r\n", "utf8"));
      chunks.push(Buffer.from("--" + boundary + "\r\nContent-Disposition: form-data; name=\"artifact_type\"\r\n\r\n" + kind + "\r\n", "utf8"));
      chunks.push(Buffer.from("--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"v" + variantIndex + ext + "\"\r\nContent-Type: " + mime + "\r\n\r\n", "utf8"));
      chunks.push(fs.readFileSync(filePath));
      chunks.push(Buffer.from("\r\n--" + boundary + "--\r\n", "utf8"));
      var body = Buffer.concat(chunks);

      var parsed = new url.URL(resolveServerUrl(uploadUrl));
      var transport = parsed.protocol === "https:" ? https : http;
      var req = transport.request(
        {
          protocol: parsed.protocol,
          hostname: parsed.hostname,
          port: parsed.port || undefined,
          path: parsed.pathname + parsed.search,
          method: "POST",
          headers: {
            "X-Worker-Token": $W.CONFIG.token || "",
            "Content-Type": "multipart/form-data; boundary=" + boundary,
            "Content-Length": body.length
          }
        },
        function (res) {
          var resChunks = [];
          res.on("data", function (c) { resChunks.push(c); });
          res.on("end", function () {
            var text = Buffer.concat(resChunks).toString("utf8");
            if (res.statusCode < 200 || res.statusCode >= 300) {
              reject(new Error("上传工件(" + kind + ")失败 HTTP " + res.statusCode + ": " + text.slice(0, 160)));
              return;
            }
            try { resolve(JSON.parse(text)); }
            catch (_e) { reject(new Error("上传返回非 JSON")); }
          });
        }
      );
      req.on("error", reject);
      req.setTimeout(120000, function () { req.destroy(new Error("上传工件(" + kind + ")超时")); });
      req.write(body);
      req.end();
    });
  }

  // ─── 任务执行 ────────────────────────────────────────

  function sendWsJson(obj) {
    if (ws && ws.readyState === window.WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
      return true;
    }
    return false;
  }

  function clearPendingFinal(taskId, shouldDeleteWorkDir, reason, logVariant) {
    if (!pendingFinal) return;
    if (taskId && pendingFinal.taskId !== taskId) return;
    var item = pendingFinal;
    pendingFinal = null;
    if (item.retryTimer) clearInterval(item.retryTimer);
    if (shouldDeleteWorkDir) {
      removeDirRecursive(item.workDir);
    }
    if (!isQuarantined && currentTaskId === item.taskId) {
      isBusy = false;
      currentTaskId = null;
      currentTaskStartedAt = 0;
    }
    if (reason) appendLog(reason, logVariant || "muted");
    refreshStatusUI(ws && ws.readyState === window.WebSocket.OPEN ? "connected" : "offline");
    writeHeartbeatFile();
  }

  function flushPendingFinal() {
    if (!pendingFinal) return;
    if (Date.now() - pendingFinal.createdAt > 120000) {
      var preservedDir = pendingFinal.workDir;
      clearPendingFinal(
        pendingFinal.taskId,
        false,
        "结果回传确认超时（>120s），已停止重发并保留本地成图目录供排查：" + preservedDir,
        "error"
      );
      return;
    }
    if (sendWsJson(pendingFinal.payload)) {
      appendLog("已发送任务 " + pendingFinal.taskId + " 最终结果，等待服务端确认...", "muted");
    }
  }

  function enqueueFinalDelivery(taskId, payload, workDir) {
    if (pendingFinal && pendingFinal.retryTimer) clearInterval(pendingFinal.retryTimer);
    pendingFinal = {
      taskId: taskId,
      payload: payload,
      workDir: workDir,
      createdAt: Date.now(),
      retryTimer: setInterval(flushPendingFinal, 3000)
    };
    flushPendingFinal();
  }

  function uploadVariantWithRetry(uploadUrl, taskId, variantIndex, filePath, artifactType) {
    var attempts = 0;
    function tryOnce() {
      attempts += 1;
      return uploadVariantFile(uploadUrl, taskId, variantIndex, filePath, artifactType).catch(function (err) {
        if (attempts >= 3) throw err;
        appendLog("上传变体 " + variantIndex + "(" + (artifactType || "preview") + ") 失败（第 " + attempts + " 次），2s 后重试...", "muted");
        return new Promise(function (resolve) { setTimeout(resolve, 2000); }).then(tryOnce);
      });
    }
    return tryOnce();
  }

  async function executeAssignedTask(msg) {
    var taskId = msg.task_id;
    if (isBusy || isPaused || isQuarantined) {
      var rejectReason = isQuarantined ? "quarantined" : (isBusy ? "busy" : "paused");
      appendLog("拒收任务 " + taskId + "（当前状态：" + rejectReason + "），已通知服务端重新排队。", "muted");
      sendWsJson({
        type: "task.rejected",
        task_id: taskId,
        reason: rejectReason,
        busy: isBusy,
        paused: isPaused,
        quarantined: isQuarantined,
        current_task_id: currentTaskId
      });
      return;
    }

    isBusy = true;
    currentTaskId = taskId;
    currentTaskStartedAt = Date.now();
    refreshStatusUI("connected");
    writeHeartbeatFile();

    var workDir = path.join($W.TEMP_ROOT, taskId);
    var enteredQuarantine = false;
    try {
      if (!fs.existsSync(workDir)) fs.mkdirSync(workDir, { recursive: true });
      var inputExt = path.extname(String(msg.image_url || ".png")) || ".png";
      var inputPath = path.join(workDir, "input" + inputExt);

      sendWsJson({ type: "task.progress", task_id: taskId, stage: "downloading" });
      appendLog("接单 " + taskId + "：下载原图...", "muted");
      await downloadFile(msg.image_url, inputPath);

      sendWsJson({ type: "task.progress", task_id: taskId, stage: "expanding" });
      appendLog("执行 Photoshop 原生生成式扩展...", "muted");
      completedCount += 1;
      var shouldPurge = (completedCount % ($W.CONFIG.purgeEveryNTasks || 10)) === 0;
      var softTimeout = Math.min(
        Number($W.CONFIG.evalTimeoutMs || 75000),
        Math.max(30000, (Number(msg.timeout_sec || 90) - 10) * 1000)
      );

      var jsxRes = await hostBridge.evalHost(
        "runGenerativeExpand",
        {
          inputPath: inputPath,
          outputDir: workDir,
          spec: msg.spec || {},
          purgeAfter: shouldPurge
        },
        softTimeout,
        function () {
          // 若超时后 Photoshop 最终自行结束了原生脚本（未触发 Watchdog 强杀），此时再安全清理并解除隔离
          removeDirRecursive(workDir);
          if (currentTaskId === taskId && isQuarantined) {
            isQuarantined = false;
            isBusy = false;
            currentTaskId = null;
            currentTaskStartedAt = 0;
            appendLog("超时任务 " + taskId + " 的 PS 原生执行已结束，清理完成并解除隔离。", "success");
            refreshStatusUI(ws && ws.readyState === window.WebSocket.OPEN ? "connected" : "offline");
            writeHeartbeatFile();
            sendWsJson({
              type: "ping",
              ts: Math.floor(Date.now() / 1000),
              busy: false,
              paused: isPaused,
              quarantined: false
            });
          }
        }
      );

      var exportedVariants = (jsxRes && jsxRes.variants) || [];
      if (!exportedVariants.length) {
        throw new Error("Photoshop 未导出任何变体图片。");
      }

      sendWsJson({ type: "task.progress", task_id: taskId, stage: "uploading" });
      appendLog("上传 " + exportedVariants.length + " 组变体（预览图 + 原生分层 PSD）...", "muted");
      var uploadedOutputs = [];
      for (var i = 0; i < exportedVariants.length; i += 1) {
        var entry = exportedVariants[i];
        var vIdx = typeof entry.variantIndex === "number" ? entry.variantIndex : i;
        var previewRes = await uploadVariantWithRetry(msg.upload_url, taskId, vIdx, entry.previewPath, "preview");
        var psdRes = await uploadVariantWithRetry(msg.upload_url, taskId, vIdx, entry.psdPath, "psd");
        uploadedOutputs.push({
          variant_index: vIdx,
          url: previewRes.url,
          psd_url: psdRes.url,
          width: previewRes.width,
          height: previewRes.height,
          size_bytes: previewRes.size_bytes,
          psd_size_bytes: psdRes.size_bytes
        });
      }

      var durationMs = Date.now() - currentTaskStartedAt;
      var requestedVariants = Number((jsxRes && jsxRes.requested_variants) || ((msg.spec && msg.spec.return_all_variants === false) ? 1 : 3));
      var variantsComplete = Boolean(jsxRes && jsxRes.variants_complete) && uploadedOutputs.length >= requestedVariants;
      var variantWarning = String((jsxRes && jsxRes.variant_warning) || "");
      var resultPayload = {
        type: "task.result",
        task_id: taskId,
        outputs: uploadedOutputs,
        requested_variants: requestedVariants,
        variants_complete: variantsComplete,
        variant_warning: variantWarning,
        duration_ms: durationMs
      };
      if (!variantsComplete) {
        appendLog(
          "完成（变体不足）" + taskId + "：" + uploadedOutputs.length + "/" + requestedVariants +
          "（" + (variantWarning || "多变体切换不可用") + "）。",
          "error"
        );
      } else {
        appendLog("完成 " + taskId + "（" + uploadedOutputs.length + " 变体，" + (durationMs / 1000).toFixed(1) + "s）。", "success");
      }
      // 等待服务端 task.ack 后再清理临时目录与释放 isBusy，断线重连时自动重发
      enqueueFinalDelivery(taskId, resultPayload, workDir);
      return;
    } catch (err) {
      var code = (err && err.code) || "PS_EXEC_FAILED";
      var message = (err && err.message) || String(err || "未知错误");
      if (code === "PS_EXEC_TIMEOUT") {
        // 软超时不代表 PS 原生执行已退出：保持 isBusy/currentTaskId/task_started_at 与工作目录，等待原生完成或 Watchdog 重启恢复
        enteredQuarantine = true;
        isQuarantined = true;
        sendWsJson({
          type: "task.error",
          task_id: taskId,
          error_code: code,
          error_message: message,
          quarantined: true
        });
        appendLog("超时隔离 " + taskId + "：已暂停接单并保留心跳超时状态，等待 PS 结束或 Watchdog 重启。", "error");
        refreshStatusUI(ws && ws.readyState === window.WebSocket.OPEN ? "connected" : "offline");
        writeHeartbeatFile();
      } else {
        appendLog("失败 " + taskId + " [" + code + "] " + message, "error");
        enqueueFinalDelivery(taskId, {
          type: "task.error",
          task_id: taskId,
          error_code: code,
          error_message: message
        }, workDir);
        return;
      }
    } finally {
      if (!enteredQuarantine && !pendingFinal) {
        removeDirRecursive(workDir);
        isBusy = false;
        currentTaskId = null;
        currentTaskStartedAt = 0;
        refreshStatusUI(ws && ws.readyState === window.WebSocket.OPEN ? "connected" : "offline");
        writeHeartbeatFile();
      }
    }
  }

  // ─── 反向 WebSocket 长连接 ───────────────────────────

  function buildWsUrl() {
    var base = String($W.CONFIG.serverUrl || "http://127.0.0.1:8000").replace(/\/+$/, "");
    var wsBase = base.replace(/^https:/i, "wss:").replace(/^http:/i, "ws:");
    return wsBase + "/api/v1/expand/worker?worker_id=" +
      encodeURIComponent($W.CONFIG.workerId || "win-ps-01") +
      "&token=" + encodeURIComponent($W.CONFIG.token || "");
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    var delay = BACKOFF_MS[Math.min(reconnectAttempt, BACKOFF_MS.length - 1)];
    reconnectAttempt += 1;
    appendLog("连接断开，" + (delay / 1000) + "s 后重连...", "muted");
    reconnectTimer = setTimeout(function () {
      reconnectTimer = null;
      connectWebSocket();
    }, delay);
  }

  function connectWebSocket() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
    if (ws) {
      try { ws.onclose = null; ws.close(); } catch (_e) {}
      ws = null;
    }

    if (!String($W.CONFIG.token || "").trim()) {
      refreshStatusUI("offline");
      appendLog("未配置 Worker Secret，请先在上方填入与后端 .env 一致的 PS_EXPAND_WORKER_SECRET 后点击「保存并重连」。", "error");
      return;
    }

    refreshStatusUI("connecting");
    appendLog("正在连接 FastAPI（" + $W.CONFIG.serverUrl + "）...", "muted");

    try {
      ws = new window.WebSocket(buildWsUrl());
    } catch (err) {
      appendLog("创建 WebSocket 失败：" + (err.message || err), "error");
      refreshStatusUI("offline");
      scheduleReconnect();
      return;
    }

    ws.onopen = function () {
      reconnectAttempt = 0;
      refreshStatusUI("connected");
      appendLog("已连接 FastAPI 任务中心。", "success");
      sendWsJson({
        type: "worker.hello",
        ps_version: psVersion,
        worker_version: $W.CONFIG.workerVersion || "1.0.0",
        exec_mode: "cep",
        busy: isBusy,
        paused: isPaused,
        quarantined: isQuarantined,
        current_task_id: currentTaskId
      });
      if (pendingFinal) {
        flushPendingFinal();
      }
      pingTimer = setInterval(function () {
        sendWsJson({
          type: "ping",
          ts: Math.floor(Date.now() / 1000),
          busy: isBusy,
          paused: isPaused,
          quarantined: isQuarantined
        });
      }, $W.CONFIG.wsPingIntervalMs || 15000);
    };

    ws.onmessage = function (event) {
      var msg;
      try { msg = JSON.parse(event.data); } catch (_e) { return; }
      if (!msg || !msg.type) return;
      if (msg.type === "task.assign") {
        executeAssignedTask(msg);
      } else if (msg.type === "task.ack") {
        if (msg.accepted === false) {
          var keptDir = pendingFinal && pendingFinal.taskId === msg.task_id ? pendingFinal.workDir : "";
          clearPendingFinal(
            msg.task_id,
            false,
            "服务端未接收任务 " + msg.task_id + " 的结果（真实状态=" + (msg.status || "unknown") +
              "，原因=" + (msg.reason || "rejected") + "），已保留本地目录供排查：" + keptDir,
            "error"
          );
        } else {
          clearPendingFinal(
            msg.task_id,
            true,
            "服务端已确认任务 " + msg.task_id + " 结果（" + (msg.status || "ok") +
              (msg.idempotent ? "，幂等确认" : "") + "）。",
            "muted"
          );
        }
      }
    };

    ws.onerror = function () {
      appendLog("WebSocket 通信异常。", "error");
    };

    ws.onclose = function (evt) {
      if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
      refreshStatusUI("offline");
      appendLog("WebSocket 已关闭（code=" + evt.code + "）。", "muted");
      scheduleReconnect();
    };
  }

  // ─── 按钮事件与初始化 ────────────────────────────────

  function syncInputsFromConfig() {
    if (serverUrlInput) serverUrlInput.value = $W.CONFIG.serverUrl || "";
    if (workerIdInput) workerIdInput.value = $W.CONFIG.workerId || "";
    if (tokenInput) tokenInput.value = $W.CONFIG.token || "";
  }

  if (saveReconnectBtn) {
    saveReconnectBtn.addEventListener("click", function () {
      $W.saveConfig({
        serverUrl: serverUrlInput.value.trim(),
        workerId: workerIdInput.value.trim() || "win-ps-01",
        token: tokenInput.value.trim()
      });
      reconnectAttempt = 0;
      appendLog("配置已保存，正在重连...", "muted");
      connectWebSocket();
    });
  }

  if (pauseBtn) {
    pauseBtn.addEventListener("click", function () {
      isPaused = !isPaused;
      appendLog(isPaused ? "已暂停接单。" : "已恢复接单。", "muted");
      refreshStatusUI(ws && ws.readyState === window.WebSocket.OPEN ? "connected" : "offline");
      sendWsJson({ type: "ping", ts: Math.floor(Date.now() / 1000), busy: isBusy, paused: isPaused });
      writeHeartbeatFile();
    });
  }

  if (localTestBtn) {
    localTestBtn.addEventListener("click", async function () {
      if (isBusy) { appendLog("当前正在执行任务，请稍后再试。", "muted"); return; }
      appendLog("开始本地自检（检查 PS 版本与宿主脚本）...", "muted");
      try {
        var info = await hostBridge.evalHost("getHostInfo", {}, 15000);
        psVersion = info.psVersion || psVersion;
        if (psVersionText) psVersionText.textContent = "PS: " + psVersion;
        appendLog("宿主自检通过：PS " + psVersion + "，已打开文档数=" + info.openDocuments + "。", "success");
      } catch (err) {
        appendLog("本地自检失败：" + (err.message || err), "error");
      }
    });
  }

  if (clearLogBtn) {
    clearLogBtn.addEventListener("click", function () {
      logs = [];
      if (logBox) logBox.innerHTML = "";
    });
  }

  syncInputsFromConfig();
  writeHeartbeatFile();
  setInterval(writeHeartbeatFile, $W.CONFIG.heartbeatIntervalMs || 10000);

  hostBridge.evalHost("getHostInfo", {}, 15000).then(function (info) {
    psVersion = info.psVersion || "unknown";
    if (psVersionText) psVersionText.textContent = "PS: " + psVersion;
    appendLog("宿主就绪：Photoshop " + psVersion + "。", "muted");
    writeHeartbeatFile();
    connectWebSocket();
  }).catch(function (err) {
    appendLog("读取 PS 版本失败：" + (err.message || err), "error");
    connectWebSocket();
  });
})();
