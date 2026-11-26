#target photoshop

if (typeof $._loomExpandWorker === "undefined") {
  $._loomExpandWorker = {};
}

$._loomExpandWorker._escape = function (v) {
  return String(v).replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\r/g, "\\r").replace(/\n/g, "\\n");
};

$._loomExpandWorker._stringify = function (val) {
  if (val === null || typeof val === "undefined") return "null";
  var t = typeof val;
  if (t === "string") return "\"" + $._loomExpandWorker._escape(val) + "\"";
  if (t === "number" || t === "boolean") return String(val);
  if (val instanceof Array) {
    var arr = [];
    for (var i = 0; i < val.length; i += 1) arr.push($._loomExpandWorker._stringify(val[i]));
    return "[" + arr.join(",") + "]";
  }
  var pairs = [];
  for (var k in val) {
    if (val.hasOwnProperty(k) && typeof val[k] !== "undefined") {
      pairs.push("\"" + $._loomExpandWorker._escape(k) + "\":" + $._loomExpandWorker._stringify(val[k]));
    }
  }
  return "{" + pairs.join(",") + "}";
};

$._loomExpandWorker._ok = function (data) {
  return $._loomExpandWorker._stringify({ ok: true, data: data });
};

$._loomExpandWorker._err = function (message, code) {
  return $._loomExpandWorker._stringify({ ok: false, error: String(message || "Unknown error"), errorCode: code || "PS_EXEC_FAILED" });
};

$._loomExpandWorker._readJsonFile = function (filePath) {
  var f = new File(filePath);
  if (!f.exists) throw new Error("Payload file not found: " + filePath);
  f.encoding = "UTF8";
  if (!f.open("r")) throw new Error("Unable to open payload file: " + filePath);
  var raw = f.read();
  f.close();
  return raw ? eval("(" + raw + ")") : {};
};

$._loomExpandWorker._withPixels = function (fn) {
  var prevUnits = app.preferences.rulerUnits;
  var prevDialogs = app.displayDialogs;
  app.preferences.rulerUnits = Units.PIXELS;
  app.displayDialogs = DialogModes.NO;
  try {
    return fn();
  } finally {
    app.preferences.rulerUnits = prevUnits;
    app.displayDialogs = prevDialogs;
  }
};

$._loomExpandWorker.invokeFromPath = function (methodName, payloadPath) {
  try {
    var fn = $._loomExpandWorker[methodName];
    if (typeof fn !== "function") throw new Error("Unknown host method: " + methodName);
    var args = payloadPath ? $._loomExpandWorker._readJsonFile(payloadPath) : {};
    return fn(args);
  } catch (e) {
    return $._loomExpandWorker._err(e.message || e.toString());
  }
};

$._loomExpandWorker.getHostInfo = function () {
  return $._loomExpandWorker._ok({
    psVersion: String(app.version || "unknown"),
    openDocuments: app.documents ? app.documents.length : 0
  });
};

// ─── 原生 Generative Expand ActionManager 封装 ────────────
// Phase 1 Spike 注意：不同 PS 25.x / 26.x 小版本的 Firefly 内部 descriptor
// 可能有细微差异。若本机实测报错，请用 ScriptingListener 录制一次 Generative Expand
// 并替换 _executeGenerativeFillDescriptor 中的 ActionDescriptor 即可。

$._loomExpandWorker._unlockBackgroundLayer = function (doc) {
  try {
    if (doc.activeLayer && doc.activeLayer.isBackgroundLayer) {
      doc.activeLayer.isBackgroundLayer = false;
    }
  } catch (_e) {}
};

$._loomExpandWorker._expandCanvasWithPadding = function (doc, pad) {
  var w = Math.round(Number(doc.width.as("px")));
  var h = Math.round(Number(doc.height.as("px")));
  var top = Math.max(0, Math.round(Number(pad.top) || 0));
  var right = Math.max(0, Math.round(Number(pad.right) || 0));
  var bottom = Math.max(0, Math.round(Number(pad.bottom) || 0));
  var left = Math.max(0, Math.round(Number(pad.left) || 0));

  // 分步扩展画布以支持任意四边不对称 padding
  if (left > 0) {
    doc.resizeCanvas(UnitValue(w + left, "px"), UnitValue(h, "px"), AnchorPosition.MIDDLERIGHT);
    w += left;
  }
  if (right > 0) {
    doc.resizeCanvas(UnitValue(w + right, "px"), UnitValue(h, "px"), AnchorPosition.MIDDLELEFT);
    w += right;
  }
  if (top > 0) {
    doc.resizeCanvas(UnitValue(w, "px"), UnitValue(h + top, "px"), AnchorPosition.BOTTOMCENTER);
    h += top;
  }
  if (bottom > 0) {
    doc.resizeCanvas(UnitValue(w, "px"), UnitValue(h + bottom, "px"), AnchorPosition.TOPCENTER);
    h += bottom;
  }

  return { width: w, height: h, origLeft: left, origTop: top, origRight: w - right, origBottom: h - bottom };
};

$._loomExpandWorker._selectExpandedRegion = function (doc, origRect) {
  // 选中原图区域并反选 → 得到外扩的空白区域（向内略微羽化/重叠 2px 保证接缝无缝衔接）
  var overlap = 2;
  var l = Math.min(origRect.origRight - 1, origRect.origLeft + overlap);
  var t = Math.min(origRect.origBottom - 1, origRect.origTop + overlap);
  var r = Math.max(l + 1, origRect.origRight - overlap);
  var b = Math.max(t + 1, origRect.origBottom - overlap);
  doc.selection.select([[l, t], [r, t], [r, b], [l, b]]);
  doc.selection.invert();
};

$._loomExpandWorker._executeGenerativeFillDescriptor = function (promptText) {
  var desc = new ActionDescriptor();
  var ref = new ActionReference();
  ref.putEnumerated(charIDToTypeID("Dcmn"), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
  desc.putReference(charIDToTypeID("null"), ref);
  desc.putString(stringIDToTypeID("prompt"), String(promptText || ""));
  desc.putString(stringIDToTypeID("serviceID"), "clio");
  desc.putString(stringIDToTypeID("workflow"), "out_painting");
  desc.putEnumerated(
    stringIDToTypeID("dualCrop"),
    stringIDToTypeID("dualCrop"),
    stringIDToTypeID("dualCrop")
  );
  executeAction(stringIDToTypeID("syntheticFill"), desc, DialogModes.NO);
};

$._loomExpandWorker._selectVariationIndex = function (index, totalCount) {
  // 来自 PS 26.0.0 ScriptingListener 实测录制的精确 ActionDescriptor
  var desc = new ActionDescriptor();
  var ref = new ActionReference();
  ref.putEnumerated(charIDToTypeID("Lyr "), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
  desc.putReference(charIDToTypeID("null"), ref);
  desc.putInteger(stringIDToTypeID("index"), index);
  desc.putInteger(stringIDToTypeID("remainingVariationsCount"), totalCount || 3);
  executeAction(stringIDToTypeID("selectGeneratedVariation"), desc, DialogModes.NO);
};

$._loomExpandWorker._exportCurrentDocPreview = function (doc, outputPath, format, quality) {
  var dup = doc.duplicate();
  try {
    dup.flatten();
    var outFile = new File(outputPath);
    if (format === "png") {
      var pngOpt = new PNGSaveOptions();
      pngOpt.compression = 6;
      pngOpt.interlaced = false;
      dup.saveAs(outFile, pngOpt, true, Extension.LOWERCASE);
    } else {
      var jpgOpt = new JPEGSaveOptions();
      jpgOpt.quality = Math.max(1, Math.min(12, Math.round((Number(quality) || 92) / 100 * 12)));
      jpgOpt.matte = MatteType.NONE;
      dup.saveAs(outFile, jpgOpt, true, Extension.LOWERCASE);
    }
  } finally {
    try { dup.close(SaveOptions.DONOTSAVECHANGES); } catch (_e) {}
  }
};

$._loomExpandWorker._exportCurrentDocLayeredPsd = function (doc, psdPath) {
  // 保留原生分层结构（hasUserMask=true, isSyntheticFill=true），使用 asCopy=true 不改变当前文档状态
  var psdFile = new File(psdPath);
  var psdOpt = new PhotoshopSaveOptions();
  psdOpt.layers = true;
  psdOpt.alphaChannels = true;
  psdOpt.embedColorProfile = true;
  psdOpt.maximizeCompatibility = true;
  doc.saveAs(psdFile, psdOpt, true, Extension.LOWERCASE);
};

$._loomExpandWorker.runGenerativeExpand = function (args) {
  var doc = null;
  try {
    return $._loomExpandWorker._ok($._loomExpandWorker._withPixels(function () {
      var inputFile = new File(args.inputPath);
      if (!inputFile.exists) throw new Error("输入原图不存在: " + args.inputPath);

      var spec = args.spec || {};
      var pad = spec.padding || { top: 0, right: 0, bottom: 0, left: 0 };
      var format = (spec.output_format === "png") ? "png" : "jpg";
      var quality = Number(spec.quality || 92);
      var returnAll = spec.return_all_variants !== false;

      doc = app.open(inputFile);

      // 1. 色彩与图层预处理（RGB 8-bit + sRGB + 解锁背景层）
      if (doc.mode !== DocumentMode.RGB) doc.changeMode(ChangeMode.RGB);
      if (doc.bitsPerChannel !== BitsPerChannelType.EIGHT) doc.bitsPerChannel = BitsPerChannelType.EIGHT;
      try { doc.convertProfile("sRGB IEC61966-2.1", Intent.RELATIVECOLORIMETRIC, true, false); } catch (_iccErr) {}
      $._loomExpandWorker._unlockBackgroundLayer(doc);

      // 2. 扩展画布并选中外扩空白区
      var expanded = $._loomExpandWorker._expandCanvasWithPadding(doc, pad);
      $._loomExpandWorker._selectExpandedRegion(doc, expanded);

      // 3. 执行 Adobe 原生 Generative Expand
      $._loomExpandWorker._executeGenerativeFillDescriptor(spec.prompt || "");

      // 4. 导出 1~3 个原生变体（每个变体同时导出轻量预览图 + 原生分层 PSD 保留蒙版）
      var exported = [];
      var maxVariants = returnAll ? 3 : 1;
      var variantWarning = "";
      for (var i = 0; i < maxVariants; i += 1) {
        if (i > 0) {
          try {
            $._loomExpandWorker._selectVariationIndex(i, 3);
          } catch (varErr) {
            variantWarning = "PS " + app.version + " 变体切换不可用（" + (varErr.message || varErr.toString()) + "），仅导出 " + exported.length + "/" + maxVariants + " 个变体";
            break;
          }
        }
        var previewPath = args.outputDir + "/v" + i + "." + format;
        var psdPath = args.outputDir + "/v" + i + ".psd";
        $._loomExpandWorker._exportCurrentDocPreview(doc, previewPath, format, quality);
        $._loomExpandWorker._exportCurrentDocLayeredPsd(doc, psdPath);
        exported.push({
          variantIndex: i,
          previewPath: previewPath,
          psdPath: psdPath
        });
      }

      doc.close(SaveOptions.DONOTSAVECHANGES);
      doc = null;

      if (args.purgeAfter) {
        try { app.purge(PurgeTarget.ALLCACHES); } catch (_pErr) {}
      }

      return {
        variants: exported,
        width: expanded.width,
        height: expanded.height,
        requested_variants: maxVariants,
        variants_complete: exported.length >= maxVariants,
        variant_warning: variantWarning
      };
    }));
  } catch (e) {
    if (doc) {
      try { doc.close(SaveOptions.DONOTSAVECHANGES); } catch (_ce) {}
    }
    var msg = e.message || e.toString();
    var code = "PS_EXEC_FAILED";
    if (/credit|quota|subscription/i.test(msg)) code = "PS_CREDITS_EXHAUSTED";
    else if (/guideline|violation|policy/i.test(msg)) code = "PS_CONTENT_VIOLATION";
    return $._loomExpandWorker._err(msg, code);
  }
};
