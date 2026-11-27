(function () {
  "use strict";

  var fs = require("fs");
  var os = require("os");
  var path = require("path");
  var http = require("http");
  var https = require("https");
  var url = require("url");

  var $L = window.__loom;
  var CONFIG = $L.CONFIG;
  var u = $L.utils;

  function log(m, v) { $L.log(m, v); }

  // ─── URL & 鉴权辅助 ──────────────────────────────────

  function getBaseApiUrl() {
    var base = String(CONFIG.expandServerUrl || "").trim().replace(/\/+$/, "");
    var prefix = String(CONFIG.expandApiPrefix || "/api/v1/expand").trim();
    if (prefix && prefix.charAt(0) !== "/") prefix = "/" + prefix;
    return base + prefix;
  }

  function joinUrl(baseUrl, apiPath) {
    var cleanBase = String(baseUrl || "").replace(/\/+$/, "");
    var cleanPath = String(apiPath || "");
    if (!cleanPath) return cleanBase;
    if (/^https?:\/\//i.test(cleanPath)) return cleanPath;
    if (cleanPath.charAt(0) !== "/") cleanPath = "/" + cleanPath;
    return cleanBase + cleanPath;
  }

  function resolveServerAssetUrl(rawUrl) {
    var text = String(rawUrl || "").trim();
    if (!text) return "";
    if (/^https?:\/\//i.test(text)) return text;
    return joinUrl(CONFIG.expandServerUrl, text);
  }

  function buildAuthHeaders(extraHeaders) {
    var headers = {};
    Object.keys(extraHeaders || {}).forEach(function (k) { headers[k] = extraHeaders[k]; });
    var token = String(CONFIG.expandAuthToken || "").trim();
    if (token && !headers.Authorization) {
      headers.Authorization = "Bearer " + token;
    }
    return headers;
  }

  // ─── 底层 HTTP 传输 ──────────────────────────────────

  function requestRawNative(options, redirectCount) {
    return new Promise(function (resolve, reject) {
      var parsedUrl;
      try {
        parsedUrl = new url.URL(String(options.url));
      } catch (urlError) {
        reject(new Error("无效的服务地址：" + String(options.url)));
        return;
      }

      var transport = parsedUrl.protocol === "https:" ? https : http;
      var headers = options.headers || {};
      var body = (typeof options.body === "string" || Buffer.isBuffer(options.body)) ? options.body : null;

      var requestOptions = {
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || undefined,
        path: parsedUrl.pathname + parsedUrl.search,
        method: String(options.method || "GET"),
        headers: headers
      };

      if (body && typeof requestOptions.headers["Content-Length"] === "undefined") {
        requestOptions.headers["Content-Length"] = Buffer.isBuffer(body)
          ? body.length
          : Buffer.byteLength(body, "utf8");
      }

      var req = transport.request(requestOptions, function (response) {
        var status = Number(response.statusCode || 0);
        var location = response.headers && response.headers.location;

        if (location && status >= 300 && status < 400) {
          response.resume();
          if ((redirectCount || 0) >= 5) {
            reject(new Error("重定向次数过多。"));
            return;
          }
          requestRawNative(
            {
              url: new url.URL(location, parsedUrl).toString(),
              method: options.method,
              headers: headers,
              body: body,
              timeoutMs: options.timeoutMs
            },
            (redirectCount || 0) + 1
          ).then(resolve, reject);
          return;
        }

        var chunks = [];
        response.on("data", function (c) { chunks.push(c); });
        response.on("end", function () {
          resolve({
            status: status,
            headers: response.headers || {},
            buffer: Buffer.concat(chunks)
          });
        });
      });

      req.on("error", reject);
      req.setTimeout(options.timeoutMs || 30000, function () {
        req.destroy(new Error("网络请求超时。"));
      });

      if (body) {
        req.write(Buffer.isBuffer(body) ? body : body, Buffer.isBuffer(body) ? undefined : "utf8");
      }
      req.end();
    });
  }

  function requestJson(options) {
    return requestRawNative(options, 0).then(function (response) {
      var text = u.sanitizeResponseText(response.buffer.toString("utf8"));
      var json = null;
      if (text) {
        try { json = JSON.parse(text); } catch (_e) { json = null; }
      }
      return {
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        json: json,
        text: text,
        headers: response.headers
      };
    });
  }

  function downloadBinaryFile(fileUrl, destinationPath) {
    var targetUrl = resolveServerAssetUrl(fileUrl);
    return requestRawNative(
      {
        url: targetUrl,
        method: "GET",
        headers: buildAuthHeaders({}),
        timeoutMs: 120000
      },
      0
    ).then(function (response) {
      if (response.status < 200 || response.status >= 300) {
        throw new Error("下载变体图片失败，HTTP " + response.status);
      }
      var dir = path.dirname(destinationPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(destinationPath, response.buffer);
      return destinationPath;
    });
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  // ─── Multipart 组装 ──────────────────────────────────

  function appendMultipartText(chunks, boundary, name, value) {
    chunks.push(Buffer.from(
      "--" + boundary + "\r\n" +
      "Content-Disposition: form-data; name=\"" + String(name).replace(/"/g, "_") + "\"\r\n\r\n" +
      String(value) + "\r\n",
      "utf8"
    ));
  }

  function appendMultipartFile(chunks, boundary, name, filePath, fileName) {
    var safeName = String(fileName || path.basename(filePath || "source.png")).replace(/"/g, "_");
    chunks.push(Buffer.from(
      "--" + boundary + "\r\n" +
      "Content-Disposition: form-data; name=\"" + String(name).replace(/"/g, "_") + "\"; filename=\"" + safeName + "\"\r\n" +
      "Content-Type: " + u.getMimeType(filePath) + "\r\n\r\n",
      "utf8"
    ));
    chunks.push(fs.readFileSync(filePath));
    chunks.push(Buffer.from("\r\n", "utf8"));
  }

  function getClientId() {
    var host = "unknown-host";
    var user = "unknown-user";
    try { host = os.hostname() || host; } catch (_e1) {}
    try { user = (os.userInfo && os.userInfo().username) || process.env.USER || process.env.USERNAME || user; } catch (_e2) {}
    return host + ":" + user;
  }

  // ─── Expand API ──────────────────────────────────────

  function getWorkerStatus() {
    var endpoint = joinUrl(getBaseApiUrl(), "/worker/status");
    return requestJson({
      url: endpoint,
      method: "GET",
      headers: buildAuthHeaders({ Accept: "application/json" }),
      timeoutMs: 6000
    }).then(function (response) {
      if (!response.ok || !response.json) {
        return {
          reachable: false,
          online: false,
          busy: false,
          queue_length: 0,
          avg_duration_sec: 20,
          error: u.formatApiDetails(response.json, response.status, response.text)
        };
      }
      var data = response.json;
      return {
        reachable: true,
        online: Boolean(data.online),
        busy: Boolean(data.busy),
        queue_length: Number(data.queue_length || 0),
        avg_duration_sec: Number(data.avg_duration_sec || 20),
        ps_version: data.ps_version || "",
        current_task_id: data.current_task_id || null,
        last_heartbeat_at: data.last_heartbeat_at || null
      };
    }).catch(function (error) {
      return {
        reachable: false,
        online: false,
        busy: false,
        queue_length: 0,
        avg_duration_sec: 20,
        error: error.message || String(error)
      };
    });
  }

  function submitExpandTask(params) {
    var imagePath = params && params.imagePath;
    if (!imagePath || !fs.existsSync(imagePath)) {
      return Promise.reject(new Error("原图临时文件不存在，无法提交扩图任务。"));
    }

    var fileBytes = u.getFileSize(imagePath);
    if (fileBytes > CONFIG.maxUploadBytes) {
      return Promise.reject(new Error("原图大小超过限制：" + u.formatBytes(fileBytes) + " / " + u.formatBytes(CONFIG.maxUploadBytes)));
    }

    var spec = {
      mode: "padding",
      padding: {
        top: Math.max(0, Math.round(Number(params.padding && params.padding.top) || 0)),
        right: Math.max(0, Math.round(Number(params.padding && params.padding.right) || 0)),
        bottom: Math.max(0, Math.round(Number(params.padding && params.padding.bottom) || 0)),
        left: Math.max(0, Math.round(Number(params.padding && params.padding.left) || 0))
      },
      prompt: String(params.prompt || "").trim(),
      return_all_variants: CONFIG.returnAllVariants !== false,
      output_format: params.outputFormat || CONFIG.outputFormat || "jpg",
      quality: Number(params.quality || CONFIG.outputQuality || 92),
      client_id: getClientId(),
      client_request_id: params.clientRequestId || ("loom-" + Date.now())
    };

    var boundary = "----loom-expand-" + Date.now() + "-" + Math.random().toString(16).slice(2);
    var chunks = [];
    appendMultipartText(chunks, boundary, "spec", JSON.stringify(spec));
    appendMultipartFile(chunks, boundary, "image", imagePath, "source" + (path.extname(imagePath) || ".png"));
    chunks.push(Buffer.from("--" + boundary + "--\r\n", "utf8"));
    var body = Buffer.concat(chunks);

    var endpoint = joinUrl(getBaseApiUrl(), "/tasks");
    log("提交扩图任务：" + u.formatBytes(fileBytes) + "，padding=" + JSON.stringify(spec.padding) + "。", "muted");

    return requestJson({
      url: endpoint,
      method: "POST",
      headers: buildAuthHeaders({
        "Content-Type": "multipart/form-data; boundary=" + boundary,
        Accept: "application/json"
      }),
      body: body,
      timeoutMs: 60000
    }).then(function (response) {
      if (!response.ok || !response.json) {
        throw new Error(u.formatApiDetails(response.json, response.status, response.text));
      }
      return response.json;
    });
  }

  function getExpandTask(taskId) {
    var endpoint = joinUrl(getBaseApiUrl(), "/tasks/" + encodeURIComponent(String(taskId)));
    return requestJson({
      url: endpoint,
      method: "GET",
      headers: buildAuthHeaders({ Accept: "application/json" }),
      timeoutMs: 15000
    }).then(function (response) {
      if (!response.ok || !response.json) {
        throw new Error(u.formatApiDetails(response.json, response.status, response.text));
      }
      return response.json;
    });
  }

  function cancelExpandTask(taskId) {
    var endpoint = joinUrl(getBaseApiUrl(), "/tasks/" + encodeURIComponent(String(taskId)) + "/cancel");
    return requestJson({
      url: endpoint,
      method: "POST",
      headers: buildAuthHeaders({ Accept: "application/json" }),
      timeoutMs: 10000
    }).then(function (response) {
      return {
        ok: response.ok,
        status: response.status,
        json: response.json,
        message: u.formatApiDetails(response.json, response.status, response.text)
      };
    });
  }

  function downloadVariantImages(outputs, taskId) {
    var list = outputs instanceof Array ? outputs : [];
    if (!list.length) {
      return Promise.reject(new Error("扩图成功但未返回任何变体图片。"));
    }

    var cacheDir = path.join($L.EXPAND_CACHE_ROOT || path.join(os.tmpdir(), "loom-expand-cache"), String(taskId || ("task-" + Date.now())));
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

    // 多个变体共享同一份原生分层 PSD 时仅下载 1 次，避免重复传输
    var psdPromiseByUrl = {};
    function downloadSharedPsd(psdUrl, variantIndex) {
      if (!psdUrl) return Promise.resolve("");
      if (!psdPromiseByUrl[psdUrl]) {
        var targetPsdPath = path.join(cacheDir, "v" + variantIndex + ".psd");
        psdPromiseByUrl[psdUrl] = downloadBinaryFile(psdUrl, targetPsdPath);
      }
      return psdPromiseByUrl[psdUrl];
    }

    var tasks = list.map(function (item, idx) {
      var variantIndex = typeof item.variant_index === "number" ? item.variant_index : idx;
      var remoteUrl = item.url || "";
      var ext = ".jpg";
      try {
        var parsedExt = path.extname(new url.URL(resolveServerAssetUrl(remoteUrl)).pathname).toLowerCase();
        if (parsedExt === ".png" || parsedExt === ".jpg" || parsedExt === ".jpeg" || parsedExt === ".webp") {
          ext = parsedExt;
        }
      } catch (_e) {}

      var localPath = path.join(cacheDir, "v" + variantIndex + ext);
      var psdUrl = item.psd_url || "";

      return Promise.all([
        downloadBinaryFile(remoteUrl, localPath),
        downloadSharedPsd(psdUrl, variantIndex)
      ]).then(function (results) {
        var psdLocalPath = results[1] || "";
        return {
          variantIndex: variantIndex,
          localPath: localPath,
          psdLocalPath: psdLocalPath,
          fileUrl: u.toFileUrl(localPath),
          width: item.width || 0,
          height: item.height || 0,
          sizeBytes: item.size_bytes || u.getFileSize(localPath),
          psdSizeBytes: item.psd_size_bytes || (psdLocalPath ? u.getFileSize(psdLocalPath) : 0),
          cacheDir: cacheDir
        };
      });
    });

    return Promise.all(tasks);
  }

  window.__loom.api = {
    getBaseApiUrl: getBaseApiUrl,
    joinUrl: joinUrl,
    resolveServerAssetUrl: resolveServerAssetUrl,
    requestRawNative: requestRawNative,
    requestJson: requestJson,
    downloadBinaryFile: downloadBinaryFile,
    sleep: sleep,
    getWorkerStatus: getWorkerStatus,
    submitExpandTask: submitExpandTask,
    getExpandTask: getExpandTask,
    cancelExpandTask: cancelExpandTask,
    downloadVariantImages: downloadVariantImages
  };
})();
