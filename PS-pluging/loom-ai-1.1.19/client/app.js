(function () {
  "use strict";

  var fs = require("fs");
  var os = require("os");
  var path = require("path");

  var $L = window.__loom;
  var CONFIG = $L.CONFIG;
  var utils = $L.utils;
  var api = $L.api;
  var hostBridge = $L.hostBridge;

  // Photoshop Crop 事件的 4-char TypeID ('Crop' = 0x43726f70 = 1131573104)
  var PS_EVENT_CROP = 1131573104;

  // ─── DOM 引用 ─────────────────────────────────────────

  var connectionStatus = document.getElementById("connectionStatus");

  var promptInput = document.getElementById("promptInput");
  var cropHintBanner = document.getElementById("cropHintBanner");
  var queueHintBanner = document.getElementById("queueHintBanner");
  var expandButton = document.getElementById("expandButton");
  var cancelButton = document.getElementById("cancelButton");

  var variantsSection = document.getElementById("variantsSection");
  var variantsMeta = document.getElementById("variantsMeta");
  var variantsGrid = document.getElementById("variantsGrid");

  var openTemplateButton = document.getElementById("openTemplateButton");
  var exportAssetsButton = document.getElementById("exportAssetsButton");
  var statusText = document.getElementById("statusText");
  var logPanel = document.getElementById("logPanel");
  var toggleLogButton = document.getElementById("toggleLogButton");

  // ─── 运行态状态机 ─────────────────────────────────────
  // phase: "idle" | "selecting_crop" | "waiting_result"

  var phase = "idle";
  var logEntries = [];
  var isLogExpanded = false;
  var cropSession = null;       // { documentId, documentName, origWidth, origHeight, resolution, historyLength, preCropImagePath }
  var cropPollTimerId = null;
  var cropHandling = false;
  var activeTask = null;        // { taskId, documentId, groupName, startedAt, cancelled, stageText, remoteStatus, queuePosition }
  var lastWorkerStatus = { reachable: false, online: false, busy: false, queue_length: 0, avg_duration_sec: 20 };
  var busyTimerId = null;
  var statusTimerId = null;
  var activeVariants = null;    // { taskId, documentId, groupName, cacheDir, items: [...], activeIndex: 0 }
  var isSwitchingVariant = false;

  // ─── 日志 ─────────────────────────────────────────────

  $L.log = function (message, variant) {
    logEntries.push({
      time: utils.formatLogTime(new Date()),
      message: String(message || ""),
      variant: variant || "muted"
    });
    if (logEntries.length > 30) logEntries = logEntries.slice(logEntries.length - 30);
    renderLogs();
  };

  function appendLog(message, variant) {
    $L.log(message, variant);
  }

  function renderLogs() {
    if (!logPanel) return;
    logPanel.innerHTML = logEntries.map(function (entry) {
      return '<div class="log-line log-line--' + utils.escapeHtml(entry.variant) + '">' +
        '<span class="log-line__time">' + utils.escapeHtml(entry.time) + "</span>" +
        "<span>" + utils.escapeHtml(entry.message) + "</span></div>";
    }).join("");
    logPanel.scrollTop = logPanel.scrollHeight;
  }

  // ─── UI 辅助 ──────────────────────────────────────────

  function setStatus(message, variant) {
    if (!statusText) return;
    statusText.textContent = message;
    statusText.setAttribute("data-variant", variant || "default");
  }

  function setConnectionState(label, state) {
    if (!connectionStatus) return;
    connectionStatus.textContent = label;
    connectionStatus.className = "connection-status connection-status--" + state;
  }

  function setLogExpanded(expanded) {
    isLogExpanded = expanded;
    if (logPanel) logPanel.classList.toggle("log-panel--collapsed", !expanded);
    if (toggleLogButton) toggleLogButton.textContent = expanded ? "收起日志" : "展开日志";
  }

  function stopBusyTimer() {
    if (busyTimerId) {
      clearInterval(busyTimerId);
      busyTimerId = null;
    }
  }

  function updateExpandButtonLabel() {
    if (!expandButton) return;
    if (phase === "selecting_crop") {
      expandButton.textContent = "等待画布确认裁剪...";
      return;
    }
    if (phase === "waiting_result" && activeTask) {
      var secs = Math.max(0, Math.floor((Date.now() - activeTask.startedAt) / 1000));
      expandButton.textContent = (activeTask.stageText || "扩图中") + " · " + secs + "s";
      return;
    }
    expandButton.textContent = "生成式扩展";
  }

  function formatEtaText(aheadCount, avgSec) {
    var totalSec = Math.max(10, Math.round(Math.max(1, aheadCount) * (Number(avgSec) || 20)));
    if (totalSec >= 60) {
      var mins = Math.floor(totalSec / 60);
      var rem = totalSec % 60;
      return rem >= 10 ? ("约 " + mins + " 分 " + rem + " 秒") : ("约 " + mins + " 分钟");
    }
    return "约 " + totalSec + " 秒";
  }

  function updateQueueBanner() {
    if (!queueHintBanner) return;

    if (phase === "waiting_result" && activeTask) {
      if (activeTask.remoteStatus === "queued") {
        var pos = Math.max(1, Number(activeTask.queuePosition || 1));
        var ahead = Math.max(0, pos - 1);
        queueHintBanner.className = "queue-banner";
        queueHintBanner.textContent = ahead > 0
          ? ("当前排第 " + pos + " 位，前方还有 " + ahead + " 个任务（预计 " + formatEtaText(ahead, lastWorkerStatus.avg_duration_sec) + "）")
          : "当前排第 1 位，即将开始生成式扩展...";
        return;
      }
      if (activeTask.remoteStatus === "processing") {
        queueHintBanner.className = "queue-banner queue-banner--active";
        queueHintBanner.textContent = "已轮到你，Photoshop 正在执行原生生成式扩展...";
        return;
      }
    }

    if (phase === "idle" && lastWorkerStatus && lastWorkerStatus.online) {
      var pending = Number(lastWorkerStatus.queue_length || 0) + (lastWorkerStatus.busy ? 1 : 0);
      if (pending > 0) {
        queueHintBanner.className = "queue-banner";
        queueHintBanner.textContent = "当前前方有 " + pending + " 个任务排队中（预计 " + formatEtaText(pending, lastWorkerStatus.avg_duration_sec) + "）";
        return;
      }
    }

    queueHintBanner.className = "queue-banner queue-banner--hidden";
    queueHintBanner.textContent = "";
  }

  function updateCancelButtonLabel() {
    if (!cancelButton) return;
    if (phase === "selecting_crop") {
      cancelButton.textContent = "取消裁剪";
      return;
    }
    if (phase === "waiting_result" && activeTask) {
      if (activeTask.remoteStatus === "queued") {
        cancelButton.textContent = "取消排队";
      } else if (activeTask.remoteStatus === "processing") {
        cancelButton.textContent = "放弃等待";
      } else {
        cancelButton.textContent = "取消";
      }
    }
  }

  function setPhase(nextPhase) {
    phase = nextPhase;
    var locked = phase !== "idle";

    if (expandButton) expandButton.disabled = locked;
    if (promptInput) promptInput.disabled = phase === "waiting_result";
    if (openTemplateButton) openTemplateButton.disabled = locked;
    if (exportAssetsButton) exportAssetsButton.disabled = locked;

    if (cropHintBanner) {
      cropHintBanner.classList.toggle("crop-banner--hidden", phase !== "selecting_crop");
    }
    if (cancelButton) {
      cancelButton.classList.toggle("cancel-button--hidden", phase === "idle");
    }

    stopBusyTimer();
    if (phase === "waiting_result") {
      busyTimerId = setInterval(updateExpandButtonLabel, 1000);
    }
    updateExpandButtonLabel();
    updateCancelButtonLabel();
    updateQueueBanner();
    renderVariants();
  }

  // ─── 前置校验 ─────────────────────────────────────────

  function ensureHostReady() {
    var cs = hostBridge.cs;
    if (!cs || typeof cs.evalScript !== "function") {
      throw new Error("无法连接到 Photoshop，请确认面板是在 Photoshop 中打开的。");
    }
    if (!fs || !os || !path) {
      throw new Error("Node.js 运行时异常，请重新打开面板。");
    }
    if (!CONFIG.expandServerUrl) {
      throw new Error("扩图服务地址未配置。");
    }
  }

  // ─── Photoshop Crop 事件解析 ─────────────────────────

  function resolveDescriptorNumber(rawVal, resolution, refDimension) {
    if (typeof rawVal === "number" && isFinite(rawVal)) return rawVal;
    if (rawVal && typeof rawVal === "object") {
      var val = Number(rawVal._value);
      if (!isFinite(val)) return null;
      var unit = String(rawVal._unit || "");
      if (unit === "pixelsUnit" || !unit) return val;
      if (unit === "distanceUnit" || unit === "pointsUnit") {
        return val * ((Number(resolution) || 72) / 72);
      }
      if (unit === "percentUnit" && refDimension) {
        return (val / 100) * refDimension;
      }
      return val;
    }
    return null;
  }

  function extractCropRectFromEventData(rawData, session) {
    if (!rawData || !session) return null;
    var text = String(rawData).replace(/^ver\d+,/i, "").trim();
    if (!text) return null;

    var parsed;
    try {
      parsed = JSON.parse(text);
    } catch (_e) {
      return null;
    }

    var eventId = Number(parsed.eventID || parsed.eventId || 0);
    if (eventId && eventId !== PS_EVENT_CROP) return null;

    var desc = parsed.eventData || parsed;
    var toRect = desc.to || desc["T   "] || desc.bounds;
    if (!toRect || typeof toRect !== "object") return null;

    var res = session.resolution || 72;
    var left = resolveDescriptorNumber(toRect.left !== undefined ? toRect.left : toRect["Left"], res, session.origWidth);
    var top = resolveDescriptorNumber(toRect.top !== undefined ? toRect.top : toRect["Top "], res, session.origHeight);
    var right = resolveDescriptorNumber(toRect.right !== undefined ? toRect.right : toRect["Rght"], res, session.origWidth);
    var bottom = resolveDescriptorNumber(toRect.bottom !== undefined ? toRect.bottom : toRect["Btom"], res, session.origHeight);

    if (left === null || top === null || right === null || bottom === null) return null;
    return { left: left, top: top, right: right, bottom: bottom };
  }

  function registerPhotoshopCropListener() {
    var csInterface = hostBridge.csInterface;
    if (!csInterface || typeof csInterface.addEventListener !== "function" || typeof window.CSEvent !== "function") {
      appendLog("当前环境不支持原生 Crop 事件监听，将使用画布变化轮询。", "muted");
      return;
    }

    var extId = csInterface.getExtensionID();
    var appId = csInterface.getApplicationID();
    if (!extId) return;

    var callbackEventName = "com.adobe.PhotoshopJSONCallback" + extId;
    csInterface.addEventListener(callbackEventName, function (csEvent) {
      if (phase !== "selecting_crop" || !cropSession || cropHandling) return;
      var rect = extractCropRectFromEventData(csEvent && csEvent.data, cropSession);
      if (!rect) return;
      handleCropConfirmed(rect, "event");
    });

    var regEvent = new window.CSEvent("com.adobe.PhotoshopRegisterEvent", "APPLICATION", appId, extId);
    regEvent.data = String(PS_EVENT_CROP);
    csInterface.dispatchEvent(regEvent);
  }

  function stopCropFallbackPoll() {
    if (cropPollTimerId) {
      clearInterval(cropPollTimerId);
      cropPollTimerId = null;
    }
  }

  function startCropFallbackPoll() {
    stopCropFallbackPoll();
    cropPollTimerId = setInterval(async function () {
      if (phase !== "selecting_crop" || !cropSession || cropHandling) return;
      try {
        var state = await hostBridge.evalHost("getExpandDocumentState", { documentId: cropSession.documentId });
        if (phase !== "selecting_crop" || !cropSession || cropHandling) return;
        if (!state || !state.exists) {
          cancelCropSession("目标文档已关闭，已退出裁剪。");
          return;
        }
        if (state.width !== cropSession.origWidth || state.height !== cropSession.origHeight) {
          // 检测到画布尺寸变化，等待原生 Crop 事件送达精确裁剪坐标（绝不通过宽高猜测对称坐标，避免破坏单侧扩图）
          var capturedSession = cropSession;
          stopCropFallbackPoll();
          setTimeout(function () {
            if (phase !== "selecting_crop" || cropSession !== capturedSession || cropHandling) return;
            cancelCropSession("未捕获到 Photoshop 精确裁剪坐标，已取消本次提交（请撤销裁剪后重试）。");
          }, 1200);
        }
      } catch (_pollErr) {}
    }, CONFIG.cropFallbackPollMs || 700);
  }

  // ─── 生成式扩展主流程 ─────────────────────────────────

  async function handleStartExpand() {
    try {
      ensureHostReady();
      if (phase !== "idle") return;

      setStatus("正在准备画布并进入裁剪...", "default");
      appendLog("准备进入裁剪状态。", "muted");

      var snapshot = await hostBridge.evalHost("beginGenerativeExpandCrop", {});
      cropSession = snapshot;
      cropHandling = false;

      setPhase("selecting_crop");
      setConnectionState("裁剪中", "busy");
      setStatus("请在画布拖出扩展范围，按 Enter 确认", "default");
      appendLog("已切换至裁剪工具，原图 " + snapshot.origWidth + "x" + snapshot.origHeight + "。", "muted");
      startCropFallbackPoll();
    } catch (error) {
      setPhase("idle");
      setStatus(error.message || "进入裁剪状态失败。", "error");
      appendLog(error.message || "进入裁剪状态失败。", "error");
      refreshWorkerStatus();
    }
  }

  async function cancelCropSession(reason) {
    stopCropFallbackPoll();
    if (cropSession && cropSession.preCropImagePath) {
      utils.cleanupFile(cropSession.preCropImagePath);
    }
    cropSession = null;
    cropHandling = false;
    try {
      await hostBridge.evalHost("exitCropTool", {});
    } catch (_e) {}
    setPhase("idle");
    setStatus(reason || "已取消裁剪", "default");
    appendLog(reason || "已取消裁剪。", "muted");
    refreshWorkerStatus();
  }

  async function handleCropConfirmed(cropRect, sourceTag) {
    if (cropHandling || !cropSession) return;
    cropHandling = true;
    stopCropFallbackPoll();

    var session = cropSession;
    cropSession = null;
    var preparedSourcePath = null;

    try {
      setPhase("waiting_result");
      activeTask = {
        taskId: null,
        documentId: session.documentId,
        groupName: "Loom 扩展 " + utils.formatShortClock(new Date()),
        startedAt: Date.now(),
        cancelled: false,
        stageText: "准备原图",
        remoteStatus: "submitting",
        queuePosition: 0
      };
      updateExpandButtonLabel();
      setConnectionState("扩图中", "busy");
      setStatus("正在计算扩展范围...", "default");

      var prepared = await hostBridge.evalHost("prepareExpandSourceImage", {
        preCropImagePath: session.preCropImagePath,
        origWidth: session.origWidth,
        origHeight: session.origHeight,
        cropRect: cropRect
      });
      preparedSourcePath = prepared.sourcePath;

      var pad = prepared.padding || { top: 0, right: 0, bottom: 0, left: 0 };
      var totalPad = (pad.top || 0) + (pad.right || 0) + (pad.bottom || 0) + (pad.left || 0);
      if (totalPad <= 0) {
        throw new Error("未检测到向外扩展区域（仅向内裁剪无需调用生成式扩展）。");
      }

      if (prepared.targetWidth > CONFIG.maxOutputSidePx || prepared.targetHeight > CONFIG.maxOutputSidePx) {
        throw new Error("扩展后目标尺寸 " + prepared.targetWidth + "x" + prepared.targetHeight + " 超过上限 " + CONFIG.maxOutputSidePx + "px。");
      }

      appendLog(
        "裁剪确认（" + (sourceTag === "event" ? "精确坐标" : "画布检测") + "）：扩展 " +
        utils.describePadding(pad) + "，目标 " + prepared.targetWidth + "x" + prepared.targetHeight + "。",
        "muted"
      );

      activeTask.stageText = "提交任务";
      updateExpandButtonLabel();
      setStatus("正在提交扩图任务...", "default");

      var userPrompt = promptInput ? (promptInput.value || "").trim() : "";
      var submitRes = await api.submitExpandTask({
        imagePath: prepared.sourcePath,
        padding: pad,
        prompt: userPrompt,
        outputFormat: CONFIG.outputFormat,
        quality: CONFIG.outputQuality,
        clientRequestId: "loom-" + session.documentId + "-" + Date.now()
      });

      if (!activeTask || activeTask.cancelled) return;
      activeTask.taskId = submitRes.task_id;
      var qPos = Number(submitRes.queue_position || 1);
      activeTask.remoteStatus = String(submitRes.status || "queued");
      activeTask.queuePosition = qPos;
      activeTask.stageText = qPos > 1 ? ("排队第" + qPos + "位") : "排队中";
      setConnectionState(activeTask.remoteStatus === "queued" ? "排队中" : "扩图中", "busy");
      updateExpandButtonLabel();
      updateCancelButtonLabel();
      updateQueueBanner();
      setStatus("任务已入队，等待订阅机处理...", "default");
      appendLog("任务已入队：" + submitRes.task_id + (qPos ? ("（第 " + qPos + " 位）") : "") + "。", "muted");

      var finalResult = await pollExpandTaskUntilDone(submitRes.task_id);
      if (!activeTask || activeTask.cancelled) return;

      var expectedCount = Number(finalResult.requested_variants || 3);
      var actualCount = (finalResult.outputs && finalResult.outputs.length) || 0;
      activeTask.stageText = "下载成图";
      updateExpandButtonLabel();
      setStatus("正在下载 " + actualCount + " 张变体成图...", "default");
      var downloaded = await api.downloadVariantImages(finalResult.outputs, submitRes.task_id);
      if (!activeTask || activeTask.cancelled) return;

      var cacheDir = downloaded[0] ? downloaded[0].cacheDir : null;
      utils.cleanupStaleExpandCaches(cacheDir);

      activeVariants = {
        taskId: submitRes.task_id,
        documentId: session.documentId,
        groupName: activeTask.groupName,
        cacheDir: cacheDir,
        items: downloaded,
        activeIndex: 0
      };

      activeTask.stageText = "写回画布";
      updateExpandButtonLabel();
      setStatus("正在置入默认变体...", "default");
      var placeResult = await applyVariantByIndex(0, true);
      if (!placeResult || !placeResult.ok) {
        var placeErr = (placeResult && placeResult.error) || "置入画布失败";
        setStatus("成图已下载，但置入画布失败：" + placeErr, "error");
        appendLog("默认变体写回画布失败：" + placeErr + "（已保留变体缩略图，可恢复文档后点击缩略图重试）。", "error");
        return;
      }

      var elapsed = utils.formatElapsed(activeTask.startedAt);
      var variantsComplete = finalResult.variants_complete !== false && downloaded.length >= expectedCount;
      if (!variantsComplete) {
        var warnText = finalResult.variant_warning || ("仅返回 " + downloaded.length + "/" + expectedCount + " 个变体");
        setStatus("扩展完成（仅返回 " + downloaded.length + "/" + expectedCount + " 变体）", "default");
        appendLog("扩图完成但变体不足：" + warnText + "，总耗时 " + elapsed + "。", "error");
      } else {
        setStatus("扩展完成（共 " + downloaded.length + " 个变体，点击缩略图切换）", "success");
        appendLog("扩图完成，共 " + downloaded.length + " 个变体，总耗时 " + elapsed + "。", "success");
      }
    } catch (error) {
      if (activeTask && activeTask.cancelled) return;
      var msg = error && error.message ? error.message : String(error || "扩图失败");
      setStatus(msg, "error");
      appendLog("扩图失败：" + msg, "error");
    } finally {
      utils.cleanupFile(session.preCropImagePath);
      if (preparedSourcePath && preparedSourcePath !== session.preCropImagePath) {
        utils.cleanupFile(preparedSourcePath);
      }
      activeTask = null;
      cropHandling = false;
      setPhase("idle");
      refreshWorkerStatus();
    }
  }

  async function pollExpandTaskUntilDone(taskId) {
    var deadline = Date.now() + (CONFIG.taskTimeoutMs || 180000);
    while (activeTask && !activeTask.cancelled) {
      if (Date.now() > deadline) {
        throw new Error("等待扩图结果超时，请稍后重试。");
      }

      var data = await api.getExpandTask(taskId);
      if (!activeTask || activeTask.cancelled) return null;

      var st = String(data.status || "");
      activeTask.remoteStatus = st;
      if (st === "queued") {
        var pos = Math.max(1, Number(data.queue_position || 1));
        activeTask.queuePosition = pos;
        activeTask.stageText = pos > 1 ? ("排队第" + pos + "位") : "排队中";
        setConnectionState("排队中", "busy");
        setStatus(pos > 1 ? ("排队等待中（第 " + pos + " 位）...") : "排队等待订阅机接单...", "default");
      } else if (st === "processing") {
        activeTask.queuePosition = 0;
        setConnectionState("扩图中", "busy");
        var stage = String(data.stage || "");
        if (stage === "downloading") {
          activeTask.stageText = "读取原图";
          setStatus("订阅机正在读取原图...", "default");
        } else if (stage === "uploading") {
          activeTask.stageText = "回传结果";
          setStatus("订阅机正在回传变体...", "default");
        } else {
          activeTask.stageText = "云端扩图中";
          setStatus("Photoshop 正在执行原生生成式扩展...", "default");
        }
      } else if (st === "succeeded") {
        return data;
      } else if (st === "cancelled") {
        throw new Error("任务已取消。");
      } else if (st === "timeout") {
        throw new Error(data.error_message || "订阅机执行超时，已触发自动恢复，请重试。");
      } else if (st === "failed") {
        var errCode = data.error_code ? ("[" + data.error_code + "] ") : "";
        throw new Error(errCode + (data.error_message || "扩图执行失败。"));
      }

      updateExpandButtonLabel();
      updateCancelButtonLabel();
      updateQueueBanner();
      await api.sleep(CONFIG.pollIntervalMs || 1500);
    }
    return null;
  }

  async function handleCancelAction() {
    if (phase === "selecting_crop") {
      await cancelCropSession("已取消裁剪。");
      return;
    }
    if (phase === "waiting_result" && activeTask) {
      var taskId = activeTask.taskId;
      activeTask.cancelled = true;
      if (taskId) {
        try {
          var res = await api.cancelExpandTask(taskId);
          if (res.ok) {
            appendLog("已取消排队任务：" + taskId + "。", "muted");
          } else {
            appendLog("任务已在处理中，已解锁本地面板。", "muted");
          }
        } catch (_e) {}
      }
      activeTask = null;
      setPhase("idle");
      setStatus("已取消等待", "default");
      refreshWorkerStatus();
    }
  }

  // ─── 3 变体缩略图渲染与画布秒切 ───────────────────────

  function renderVariants() {
    if (!variantsSection || !variantsGrid) return;
    if (!activeVariants || !activeVariants.items || !activeVariants.items.length) {
      variantsSection.classList.add("variants-section--hidden");
      variantsGrid.innerHTML = "";
      return;
    }

    variantsSection.classList.remove("variants-section--hidden");
    if (variantsMeta) {
      variantsMeta.textContent = (activeVariants.activeIndex + 1) + " / " + activeVariants.items.length;
    }

    var disabled = phase !== "idle" || isSwitchingVariant;
    variantsGrid.innerHTML = activeVariants.items.map(function (item, idx) {
      var isActive = idx === activeVariants.activeIndex;
      return (
        '<button type="button" class="variant-card' + (isActive ? " variant-card--active" : "") + '"' +
        ' data-variant-idx="' + idx + '"' + (disabled ? " disabled" : "") +
        ' title="切换到变体 ' + (idx + 1) + '">' +
        '<img class="variant-card__img" src="' + utils.escapeHtml(item.fileUrl) + '" alt="变体 ' + (idx + 1) + '" />' +
        '<span class="variant-card__badge">' + (idx + 1) + "</span>" +
        "</button>"
      );
    }).join("");

    var buttons = variantsGrid.querySelectorAll(".variant-card");
    Array.prototype.forEach.call(buttons, function (btn) {
      btn.addEventListener("click", function () {
        var idx = Number(btn.getAttribute("data-variant-idx"));
        if (!isNaN(idx)) applyVariantByIndex(idx, false);
      });
    });
  }

  async function applyVariantByIndex(index, isInitial) {
    if (!activeVariants || !activeVariants.items[index]) return { ok: false, error: "变体数据不存在" };
    if (!isInitial && (phase !== "idle" || isSwitchingVariant)) return { ok: false, error: "当前正在操作中" };

    var item = activeVariants.items[index];
    isSwitchingVariant = true;
    renderVariants();

    try {
      var startedAt = Date.now();
      var res = await hostBridge.evalHost("applyExpandVariant", {
        documentId: activeVariants.documentId,
        groupName: activeVariants.groupName,
        variantIndex: index,
        layerName: "变体 " + (index + 1),
        imagePath: item.localPath
      });
      activeVariants.activeIndex = index;
      if (!isInitial) {
        setStatus("已切换至变体 " + (index + 1), "success");
        appendLog(
          "切换至变体 " + (index + 1) + (res.created ? "（首次置入）" : "（图层秒切）") +
          "，耗时 " + utils.formatElapsed(startedAt) + "。",
          "muted"
        );
      }
      return { ok: true, created: Boolean(res && res.created) };
    } catch (error) {
      var msg = error && error.message ? error.message : "切换变体失败";
      if (!isInitial) {
        setStatus(msg, "error");
        appendLog("切换变体 " + (index + 1) + " 失败：" + msg, "error");
      }
      return { ok: false, error: msg };
    } finally {
      isSwitchingVariant = false;
      renderVariants();
    }
  }

  // ─── 特殊品：打开模板 / 导出素材（完整保留） ─────────

  async function handleOpenTemplate() {
    try {
      ensureHostReady();
      var platformPaths = hostBridge.resolvePlatformPaths();
      setStatus("正在复制模板副本...", "default");
      appendLog("打开模板：开始复制副本。", "muted");

      var result;
      if (process.platform === "win32") {
        if (!fs.existsSync(platformPaths.templateSourcePath)) {
          throw new Error("模板文件不存在：" + platformPaths.templateSourcePath);
        }
        var templateExt = path.extname(platformPaths.templateSourcePath) || ".psd";
        var copyDir = path.join(os.tmpdir(), "loom-template-" + Date.now());
        var copyPath = path.join(copyDir, "场景图-副本" + templateExt);
        fs.mkdirSync(copyDir, { recursive: true });
        fs.copyFileSync(platformPaths.templateSourcePath, copyPath);
        appendLog("打开模板：副本已复制到临时目录。", "muted");
        result = await hostBridge.evalHost("openDocument", { path: copyPath });
        result.ok = true;
      } else {
        result = await hostBridge.runPlatformTool("open-template.js", {
          TemplatePath: platformPaths.templateSourcePath,
          CopyName: "场景图-副本"
        });
      }

      if (!result.ok) throw new Error(result.error || "打开模板失败。");
      setStatus("模板副本已打开", "success");
      appendLog("打开模板：已打开 " + (result.documentName || "场景图-副本.psd"), "success");
    } catch (error) {
      setStatus(error.message || "打开模板失败。", "error");
      appendLog(error.message || "打开模板失败。", "error");
    }
  }

  async function runStandaloneArtboardExport(exportsPayload) {
    var payloadPath = utils.writeTempTextFile("loom-export", JSON.stringify({ exports: exportsPayload }), ".json");
    var scriptPath = path.join(hostBridge.getExtensionRootPath(), "scripts", "export-artboards.jsx");

    try {
      if (!fs.existsSync(scriptPath)) {
        throw new Error("导出脚本不存在：" + scriptPath);
      }
      var jsx = [
        "(function () {",
        "  var LOOM_EXPORT_PAYLOAD_PATH = " + hostBridge.escapeForJsx(payloadPath) + ";",
        "  return $.evalFile(new File(" + hostBridge.escapeForJsx(scriptPath) + "));",
        "}())"
      ].join("\n");
      var rawResult = await hostBridge.evalScriptDirect(jsx);
      var parsed = JSON.parse(rawResult || "{}");
      if (!parsed.ok) throw new Error(parsed.error || "画板导出失败。");
      return parsed.data || {};
    } finally {
      utils.cleanupFile(payloadPath);
    }
  }

  async function handleExportAssets() {
    try {
      if (exportAssetsButton) {
        exportAssetsButton.disabled = true;
        exportAssetsButton.textContent = "导出中...";
      }
      ensureHostReady();
      var platformPaths = hostBridge.resolvePlatformPaths();
      setStatus("正在导出素材...", "default");
      appendLog("导出素材：开始执行。", "muted");

      var result;
      if (process.platform === "win32") {
        var context = await hostBridge.evalHost("getDocumentContext", {});
        if (!context || !context.documentName) {
          throw new Error("请先打开需要导出的 Photoshop 文档。");
        }
        var productName = path.basename(context.documentName, path.extname(context.documentName)).trim();
        if (!productName) throw new Error("无法从当前文档名获取货号，请先保存为货号文件名。");
        if (productName.indexOf("副本") !== -1 || productName.indexOf("场景图") !== -1) {
          throw new Error("请先将模板副本另存为货号文件名，例如 ABC-123.psd。");
        }

        var safeProductName = productName.replace(/[\\/:*?"<>|]/g, "-");
        if (!fs.existsSync(platformPaths.exportBannerDir)) fs.mkdirSync(platformPaths.exportBannerDir, { recursive: true });
        if (!fs.existsSync(platformPaths.exportPosterDir)) fs.mkdirSync(platformPaths.exportPosterDir, { recursive: true });

        var bannerPath = path.join(platformPaths.exportBannerDir, safeProductName + ".png");
        var posterPath = path.join(platformPaths.exportPosterDir, safeProductName + ".png");
        var posterExtraPath = path.join(platformPaths.exportPosterDir, safeProductName + "_1.png");
        result = await runStandaloneArtboardExport([
          { artboardName: "横版", outputPath: bannerPath },
          { artboardName: "竖版", outputPath: posterPath },
          { artboardName: "竖版", outputPath: posterExtraPath, hideLayerNames: ["poster-1"] }
        ]);
        result.ok = true;
        result.bannerPath = bannerPath;
        result.posterPath = posterPath;
        result.posterExtraPath = posterExtraPath;
      } else {
        result = await hostBridge.runPlatformTool("export-assets.js", {
          HostScriptPath: path.join(hostBridge.getExtensionRootPath(), "host", "main.jsx"),
          BannerDir: platformPaths.exportBannerDir,
          PosterDir: platformPaths.exportPosterDir,
          HorizontalArtboardName: "横版",
          VerticalArtboardName: "竖版",
          TemplateMarker: "副本"
        });
      }

      if (!result.ok) throw new Error(result.error || "素材导出失败。");
      setStatus("素材导出完成", "success");
      appendLog("导出素材：横版 -> " + (result.bannerPath || "完成"), "success");
      appendLog("导出素材：竖版 -> " + (result.posterPath || "完成"), "success");
      appendLog("导出素材：竖版(隐藏poster-1) -> " + (result.posterExtraPath || "完成"), "success");
    } catch (error) {
      setStatus(error.message || "素材导出失败。", "error");
      appendLog(error.message || "素材导出失败。", "error");
    } finally {
      if (exportAssetsButton) {
        exportAssetsButton.disabled = phase !== "idle";
        exportAssetsButton.textContent = "导出素材";
      }
    }
  }

  // ─── 自动更新（完整保留） ─────────────────────────────

  async function autoCheckForUpdate() {
    try {
      var platformPaths = hostBridge.resolvePlatformPaths();
      if (!platformPaths.updateManifestPath) return;

      var extensionRoot = hostBridge.getExtensionRootPath();
      if (hostBridge.isSymlinkPath(extensionRoot)) {
        appendLog("开发模式，跳过自动更新检查。", "muted");
        return;
      }

      appendLog("正在检查更新...", "muted");
      var result = await hostBridge.runPlatformTool("install-update.js", {
        ManifestPath: platformPaths.updateManifestPath,
        ExtensionRoot: extensionRoot
      });

      if (!result.ok) { appendLog("更新检查失败：" + (result.error || "未知错误"), "muted"); return; }
      if (!result.updated) { appendLog("自动更新：当前已是最新版本。", "muted"); return; }

      setStatus("插件已自动更新，请重新打开面板", "success");
      appendLog("自动更新：已从 " + result.currentVersion + " 更新到 " + result.latestVersion + "。", "success");
    } catch (error) {
      appendLog("自动更新检查异常：" + (error.message || "未知错误"), "muted");
    }
  }

  // ─── Worker 状态与设置 ────────────────────────────────

  async function refreshWorkerStatus() {
    var st = await api.getWorkerStatus();
    lastWorkerStatus = st;
    if (phase !== "idle") {
      updateQueueBanner();
      return;
    }

    if (!st.reachable) {
      setConnectionState("服务离线", "offline");
      updateQueueBanner();
      return;
    }
    if (!st.online) {
      setConnectionState("PS 离线", "offline");
      updateQueueBanner();
      return;
    }
    var pending = Number(st.queue_length || 0) + (st.busy ? 1 : 0);
    if (pending > 0) {
      setConnectionState("前方 " + pending + " 人", "busy");
      updateQueueBanner();
      return;
    }
    setConnectionState("空闲", "ready");
    updateQueueBanner();
  }

  // ─── 事件绑定与启动 ───────────────────────────────────

  if (expandButton) expandButton.addEventListener("click", handleStartExpand);
  if (cancelButton) cancelButton.addEventListener("click", handleCancelAction);
  if (openTemplateButton) openTemplateButton.addEventListener("click", handleOpenTemplate);
  if (exportAssetsButton) exportAssetsButton.addEventListener("click", handleExportAssets);
  if (toggleLogButton) toggleLogButton.addEventListener("click", function () { setLogExpanded(!isLogExpanded); });

  if (promptInput) {
    promptInput.addEventListener("keydown", function (event) {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && phase === "idle") {
        handleStartExpand();
      }
    });
  }

  window.addEventListener("beforeunload", function () {
    stopCropFallbackPoll();
    stopBusyTimer();
    if (statusTimerId) clearInterval(statusTimerId);
    if (cropSession && cropSession.preCropImagePath) utils.cleanupFile(cropSession.preCropImagePath);
    utils.cleanupStaleExpandCaches(null);
  });

  // 启动初始化
  utils.cleanupStaleExpandCaches(null);
  registerPhotoshopCropListener();
  setPhase("idle");
  setLogExpanded(false);
  appendLog("Loom AI v" + CONFIG.version + " 已就绪。", "muted");
  refreshWorkerStatus();
  statusTimerId = setInterval(refreshWorkerStatus, CONFIG.statusPollIntervalMs || 15000);
  autoCheckForUpdate();
})();
