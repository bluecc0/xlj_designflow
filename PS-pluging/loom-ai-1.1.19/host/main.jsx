#target photoshop

$.localize = true;

if (typeof $._loomAiPainter === "undefined") {
  $._loomAiPainter = {};
}

$._loomAiPainter._escapeString = function (value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, "\\\"")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
};

$._loomAiPainter._stringify = function (value) {
  if (value === null || typeof value === "undefined") {
    return "null";
  }

  var valueType = typeof value;

  if (valueType === "string") {
    return "\"" + $._loomAiPainter._escapeString(value) + "\"";
  }

  if (valueType === "number" || valueType === "boolean") {
    return String(value);
  }

  if (value instanceof Array) {
    var items = [];
    var index;
    for (index = 0; index < value.length; index += 1) {
      items.push($._loomAiPainter._stringify(value[index]));
    }
    return "[" + items.join(",") + "]";
  }

  var pairs = [];
  var key;
  for (key in value) {
    if (value.hasOwnProperty(key) && typeof value[key] !== "undefined") {
      pairs.push(
        "\"" + $._loomAiPainter._escapeString(key) + "\":" + $._loomAiPainter._stringify(value[key])
      );
    }
  }
  return "{" + pairs.join(",") + "}";
};

$._loomAiPainter._ok = function (data) {
  return $._loomAiPainter._stringify({ ok: true, data: data });
};

$._loomAiPainter._error = function (message) {
  return $._loomAiPainter._stringify({ ok: false, error: message });
};

$._loomAiPainter._parse = function (raw) {
  if (!raw) {
    return {};
  }
  return eval("(" + raw + ")");
};

$._loomAiPainter._readTextFile = function (filePath) {
  var file = new File(filePath);
  if (!file.exists) {
    throw new Error("Payload file does not exist: " + filePath);
  }

  file.encoding = "UTF8";
  if (!file.open("r")) {
    throw new Error("Unable to open payload file: " + filePath);
  }

  var content = file.read();
  file.close();
  return content || "";
};

$._loomAiPainter._appendHostLog = function (message) {
  try {
    var logFile = new File(Folder.temp.fsName + "/loom-ai-host.log");
    logFile.encoding = "UTF8";
    if (!logFile.open(logFile.exists ? "e" : "w")) {
      return;
    }
    logFile.seek(0, 2);
    logFile.writeln("[" + (new Date()).toUTCString() + "] " + String(message || ""));
    logFile.close();
  } catch (loggingError) {
    // Ignore logging failures to avoid masking the real host error.
  }
};

$._loomAiPainter._now = function () {
  return (new Date()).getTime();
};

$._loomAiPainter._withPixels = function (callback) {
  var previousUnits = app.preferences.rulerUnits;
  var previousDialogs = app.displayDialogs;
  app.preferences.rulerUnits = Units.PIXELS;
  app.displayDialogs = DialogModes.NO;
  try {
    return callback();
  } finally {
    app.preferences.rulerUnits = previousUnits;
    app.displayDialogs = previousDialogs;
  }
};

$._loomAiPainter._toPx = function (value) {
  return Number(value.as("px"));
};

$._loomAiPainter._findDocumentById = function (documentId) {
  var index;
  for (index = 0; index < app.documents.length; index += 1) {
    if (app.documents[index].id === documentId) {
      return app.documents[index];
    }
  }
  return null;
};

$._loomAiPainter._getSelectionBounds = function (doc) {
  try {
    var bounds = doc.selection.bounds;
    return {
      left: $._loomAiPainter._toPx(bounds[0]),
      top: $._loomAiPainter._toPx(bounds[1]),
      right: $._loomAiPainter._toPx(bounds[2]),
      bottom: $._loomAiPainter._toPx(bounds[3])
    };
  } catch (error) {
    return null;
  }
};

$._loomAiPainter._clampBounds = function (bounds, width, height) {
  return {
    left: Math.max(0, Math.min(width, bounds.left)),
    top: Math.max(0, Math.min(height, bounds.top)),
    right: Math.max(0, Math.min(width, bounds.right)),
    bottom: Math.max(0, Math.min(height, bounds.bottom))
  };
};

$._loomAiPainter._expandBounds = function (bounds, padding, width, height) {
  var amount = Math.max(0, Number(padding) || 0);
  return $._loomAiPainter._clampBounds({
    left: bounds.left - amount,
    top: bounds.top - amount,
    right: bounds.right + amount,
    bottom: bounds.bottom + amount
  }, width, height);
};

$._loomAiPainter._resizeDocumentToMaxSide = function (doc, maxSide) {
  var limit = Math.max(0, Number(maxSide) || 0);
  if (!limit) {
    return;
  }

  var width = $._loomAiPainter._toPx(doc.width);
  var height = $._loomAiPainter._toPx(doc.height);
  var longest = Math.max(width, height);
  if (longest <= limit) {
    return;
  }

  var scale = limit / longest;
  doc.resizeImage(
    UnitValue(Math.max(1, Math.round(width * scale)), "px"),
    UnitValue(Math.max(1, Math.round(height * scale)), "px"),
    null,
    ResampleMethod.BICUBIC
  );
};

$._loomAiPainter._alignDocumentTo16 = function (doc) {
  var w = $._loomAiPainter._toPx(doc.width);
  var h = $._loomAiPainter._toPx(doc.height);
  var newW = Math.max(16, Math.round(w / 16) * 16);
  var newH = Math.max(16, Math.round(h / 16) * 16);
  if (newW === Math.round(w) && newH === Math.round(h)) {
    return;
  }
  doc.resizeImage(
    UnitValue(newW, "px"),
    UnitValue(newH, "px"),
    null,
    ResampleMethod.BICUBIC
  );
};

$._loomAiPainter._getDocumentPixelSize = function (doc) {
  return {
    width: Math.round($._loomAiPainter._toPx(doc.width)),
    height: Math.round($._loomAiPainter._toPx(doc.height))
  };
};

$._loomAiPainter._exportMaskPng = function (doc, outputPath) {
  var file = new File(outputPath);
  var options = new ExportOptionsSaveForWeb();
  options.format = SaveDocumentType.PNG;
  options.PNG8 = false;
  options.transparency = true;
  options.interlaced = false;
  doc.exportDocument(file, ExportType.SAVEFORWEB, options);
};


$._loomAiPainter._setLayerVisibilityExcept = function (container, visibleLayer) {
  var index;
  var layer;

  if (container.artLayers) {
    for (index = 0; index < container.artLayers.length; index += 1) {
      layer = container.artLayers[index];
      layer.visible = layer === visibleLayer;
    }
  }

  if (container.layerSets) {
    for (index = 0; index < container.layerSets.length; index += 1) {
      layer = container.layerSets[index];
      layer.visible = true;
      $._loomAiPainter._setLayerVisibilityExcept(layer, visibleLayer);
    }
  }
};

$._loomAiPainter._saveCompositeRegion = function (doc, bounds, outputPath, maxSide, format) {
  var duplicate = doc.duplicate();
  try {
    if (duplicate.activeLayer && duplicate.activeLayer.isBackgroundLayer) {
      duplicate.activeLayer.isBackgroundLayer = false;
    }
  } catch (error) {
    // Some Photoshop versions keep the duplicated background locked; flatten below still works as a fallback.
  }
  duplicate.flatten();
  duplicate.crop([
    UnitValue(bounds.left, "px"),
    UnitValue(bounds.top, "px"),
    UnitValue(bounds.right, "px"),
    UnitValue(bounds.bottom, "px")
  ]);
  $._loomAiPainter._resizeDocumentToMaxSide(duplicate, maxSide);
  $._loomAiPainter._alignDocumentTo16(duplicate);

  var file = new File(outputPath);
  var options;
  if (format === "jpg" || format === "jpeg") {
    options = new JPEGSaveOptions();
    options.quality = 10;
    duplicate.saveAs(file, options, true, Extension.LOWERCASE);
  } else {
    options = new PNGSaveOptions();
    duplicate.saveAs(file, options, true, Extension.LOWERCASE);
  }
  var savedSize = $._loomAiPainter._getDocumentPixelSize(duplicate);
  duplicate.close(SaveOptions.DONOTSAVECHANGES);
  return savedSize;
};

$._loomAiPainter._makeMaskLayerOnlyDocument = function (doc, bounds, maxSide) {
  var originalDoc = app.activeDocument;
  var originalLayer = doc.activeLayer;
  var sourceMaskLayer = null;
  var duplicate = null;

  try {
    $._loomAiPainter._appendHostLog("Mask step 1: create temp mask layer on source document");
    app.activeDocument = doc;
    var white = new SolidColor();
    white.rgb.red = 255;
    white.rgb.green = 255;
    white.rgb.blue = 255;
    sourceMaskLayer = doc.artLayers.add();
    sourceMaskLayer.name = "Loom AI Mask";
    doc.activeLayer = sourceMaskLayer;
    // OpenAI API 约定：透明区域(alpha=0) = 要编辑的区域，不透明 = 保留区域
    // 先反选，把选区外(保留区域)填白，选区内保持透明 = 标记为编辑区
    doc.selection.invert();
    doc.selection.fill(white, ColorBlendMode.NORMAL, 100, false);
    doc.selection.invert();

    $._loomAiPainter._appendHostLog("Mask step 2: duplicate source document with temp mask layer");
    duplicate = doc.duplicate();

    $._loomAiPainter._appendHostLog("Mask step 3: remove temp mask layer from source document");
    app.activeDocument = doc;
    doc.activeLayer = sourceMaskLayer;
    sourceMaskLayer.remove();
    sourceMaskLayer = null;
    try {
      doc.activeLayer = originalLayer;
    } catch (_restoreLayerError) {}

    $._loomAiPainter._appendHostLog("Mask step 4: isolate mask layer in duplicate");
    app.activeDocument = duplicate;
    var duplicateMaskLayer = duplicate.artLayers.getByName("Loom AI Mask");
    duplicate.activeLayer = duplicateMaskLayer;
    $._loomAiPainter._setLayerVisibilityExcept(duplicate, duplicateMaskLayer);

    $._loomAiPainter._appendHostLog("Mask step 5: crop duplicate to target bounds");
    duplicate.crop([
      UnitValue(bounds.left, "px"),
      UnitValue(bounds.top, "px"),
      UnitValue(bounds.right, "px"),
      UnitValue(bounds.bottom, "px")
    ]);

    $._loomAiPainter._appendHostLog("Mask step 6: resize duplicate if needed");
    $._loomAiPainter._resizeDocumentToMaxSide(duplicate, maxSide);
    app.activeDocument = duplicate;
    return duplicate;
  } catch (error) {
    if (sourceMaskLayer) {
      try {
        app.activeDocument = doc;
        sourceMaskLayer.remove();
      } catch (_removeError) {}
    }
    try {
      if (duplicate) {
        duplicate.close(SaveOptions.DONOTSAVECHANGES);
      }
    } catch (_closeError) {}
    throw error;
  } finally {
    try {
      if (originalDoc && app.documents.length) {
        app.activeDocument = originalDoc;
      }
    } catch (_restoreDocError) {}
  }
};

$._loomAiPainter._resizeDocumentToExactSize = function (doc, targetSize) {
  if (!targetSize || !targetSize.width || !targetSize.height) {
    return;
  }
  var currentSize = $._loomAiPainter._getDocumentPixelSize(doc);
  if (currentSize.width === targetSize.width && currentSize.height === targetSize.height) {
    return;
  }
  doc.resizeImage(
    UnitValue(Math.max(1, Math.round(targetSize.width)), "px"),
    UnitValue(Math.max(1, Math.round(targetSize.height)), "px"),
    null,
    ResampleMethod.NEARESTNEIGHBOR
  );
};

$._loomAiPainter._saveSelectionMaskRegion = function (doc, bounds, outputPath, maxSide, targetSize) {
  var maskDoc = $._loomAiPainter._makeMaskLayerOnlyDocument(doc, bounds, maxSide);
  try {
    app.activeDocument = maskDoc;
    $._loomAiPainter._resizeDocumentToExactSize(maskDoc, targetSize);
    var maskSize = $._loomAiPainter._getDocumentPixelSize(maskDoc);
    maskDoc.activeLayer = maskDoc.artLayers.getByName("Loom AI Mask");
    $._loomAiPainter._setLayerVisibilityExcept(maskDoc, maskDoc.activeLayer);

    $._loomAiPainter._exportMaskPng(maskDoc, outputPath);

    return maskSize;
  } finally {
    maskDoc.close(SaveOptions.DONOTSAVECHANGES);
  }
};

$._loomAiPainter._findLayerSetByName = function (container, targetName) {
  var index;
  var candidate;

  if (!container.layerSets) {
    return null;
  }

  for (index = 0; index < container.layerSets.length; index += 1) {
    candidate = container.layerSets[index];
    if (candidate.name === targetName) {
      return candidate;
    }

    candidate = $._loomAiPainter._findLayerSetByName(candidate, targetName);
    if (candidate) {
      return candidate;
    }
  }

  return null;
};

$._loomAiPainter._ensureAdobeArtboardExportLoaded = function () {
  if (typeof getABLayerInfo === "function" &&
      typeof artboardDuplToNewDoc === "function" &&
      typeof unArtBoard === "function" &&
      typeof cropFromMask === "function" &&
      typeof saveFileNow === "function") {
    return;
  }

  var presetRoot = new Folder(app.path.fsName + "/Presets/Scripts");
  var includeFile = new File(presetRoot.fsName + "/ArtboardExport.inc");
  if (!includeFile.exists) {
    throw new Error("Adobe Artboard export script not found: " + includeFile.fsName);
  }

  $._loomAiPainter._appendHostLog("Loading Adobe Artboard export include: " + includeFile.fsName);
  ScriptFilePath = presetRoot.fsName;
  running = "abToFiles";
  try {
    $.evalFile(includeFile);
  } catch (includeError) {
    throw new Error("Failed to eval Adobe Artboard export include: " + (includeError.message || includeError.toString()));
  }

  if (typeof getABLayerInfo !== "function" ||
      typeof artboardDuplToNewDoc !== "function" ||
      typeof unArtBoard !== "function" ||
      typeof cropFromMask !== "function" ||
      typeof saveFileNow !== "function") {
    throw new Error("Adobe Artboard export functions were not initialized after loading: " + includeFile.fsName);
  }
};

$._loomAiPainter._findArtboardByName = function (artboards, targetName) {
  var index;
  for (index = 0; index < artboards.length; index += 1) {
    if (artboards[index].name === targetName) {
      return artboards[index];
    }
  }
  return null;
};

$._loomAiPainter._hideLayersByName = function (container, targetName) {
  if (!container || !targetName) {
    return 0;
  }
  var count = 0;
  try {
    var layers = container.layers;
    var target = String(targetName || "").replace(/^[\s﻿\xA0]+|[\s﻿\xA0]+$/g, "").toLowerCase();
    var i;
    for (i = 0; i < layers.length; i += 1) {
      var layer = layers[i];
      try {
        var layerName = String(layer.name || "").replace(/^[\s﻿\xA0]+|[\s﻿\xA0]+$/g, "").toLowerCase();
        if (layerName === target) {
          layer.visible = false;
          count += 1;
        }
      } catch (_e1) {}

      try {
        if (layer.typename === "LayerSet" || (layer.layers && layer.layers.length > 0)) {
          count += $._loomAiPainter._hideLayersByName(layer, targetName);
        }
      } catch (_e2) {}
    }
  } catch (_e3) {}
  return count;
};

$._loomAiPainter._exportArtboardWithAdobeLogic = function (doc, entry) {
  $._loomAiPainter._ensureAdobeArtboardExportLoaded();
  $._loomAiPainter._appendHostLog("Preparing artboard export: " + entry.artboardName);

  var artboardInfo = getABLayerInfo();
  var artboard = $._loomAiPainter._findArtboardByName(artboardInfo.all, entry.artboardName);
  if (!artboard) {
    throw new Error("Artboard not found: " + entry.artboardName);
  }

  var exportInfo = {};
  exportInfo.includeOverlapping = false;
  exportInfo.expOptions = false;
  exportInfo.contentOnly = true;
  exportInfo.fileType = png24Index;
  exportInfo.preserveArtboard = false;
  exportInfo.iccPNG24 = true;
  exportInfo.png24Transparency = true;
  exportInfo.png24Interlaced = false;
  exportInfo.png24Trim = true;
  exportInfo.inclArtboardName = false;
  exportInfo.exportArtboardBackground = true;
  exportInfo.destination = Folder(entry.outputFolder).fsName;
  exportInfo.fileNamePrefix = entry.fileNameBody;

  var originalDoc = app.activeDocument;
  var artboardDoc = null;

  selectLayerFromAMid(artboard.AMid, "replaceSelection");
  try {
    $._loomAiPainter._appendHostLog("Selected artboard layer: " + entry.artboardName);
    artboardDuplToNewDoc(artboard.name);
    artboardDoc = app.activeDocument;
    $._loomAiPainter._appendHostLog("Duplicated artboard to temp document: " + artboardDoc.name);

    setEnabled("autoNestEnabled", false);
    setEnabled("autoPositionEnabled", false);
    setEnabled("autoExpandEnabled", false);
    $._loomAiPainter._appendHostLog("Disabled auto artboard behaviors");

    var duplicatedArtboards = getABLayerInfo().all;
    unArtBoard(duplicatedArtboards, artboardDoc, duplicatedArtboards[0].AMid, true, exportInfo);
    artboardDoc.activeLayer = artboardDoc.layers[0];
    $._loomAiPainter._appendHostLog("Converted duplicated artboard into exportable document");

    cropFromMask();
    $._loomAiPainter._appendHostLog("Cropped temporary document from artboard mask");

    if (entry.hideLayerNames && entry.hideLayerNames instanceof Array && entry.hideLayerNames.length) {
      var h;
      for (h = 0; h < entry.hideLayerNames.length; h += 1) {
        var hiddenCount = $._loomAiPainter._hideLayersByName(artboardDoc, entry.hideLayerNames[h]);
        $._loomAiPainter._appendHostLog("Hidden layer '" + entry.hideLayerNames[h] + "' in artboard: " + entry.artboardName + " (count: " + hiddenCount + ")");
      }
    }

    removeEmptyLayers(artboardDoc);
    $._loomAiPainter._appendHostLog("Removed empty layers in temporary document");
    saveFileNow(artboardDoc, entry.fileNameBody, exportInfo);
    $._loomAiPainter._appendHostLog("Saved PNG for artboard: " + entry.artboardName + " -> " + exportInfo.destination + "/" + entry.fileNameBody + ".png");
  } finally {
    if (artboardDoc) {
      try {
        artboardDoc.close(SaveOptions.DONOTSAVECHANGES);
      } catch (closeError) {
        // Ignore cleanup failures so we can still restore the original document focus.
      }
    }

    try {
      app.activeDocument = originalDoc || doc;
    } catch (restoreError) {
      app.activeDocument = doc;
    }
  }
};

$._loomAiPainter._ensureWritableTargetLayer = function (doc) {
  try {
    if (doc.activeLayer && doc.activeLayer.isBackgroundLayer) {
      var helperLayer = doc.artLayers.add();
      helperLayer.name = "Loom AI Target";
      doc.activeLayer = helperLayer;
    }
  } catch (error) {
    // If Photoshop refuses this optimization, paste() will still be attempted normally.
  }
};

$._loomAiPainter.invoke = function (rawArgs) {
  try {
    var args = $._loomAiPainter._parse(rawArgs);
    if (!args.method) {
      throw new Error("Host method name is missing.");
    }

    var method = $._loomAiPainter[args.method];
    if (typeof method !== "function") {
      throw new Error("Host method does not exist: " + args.method);
    }

    if (args.method === "invoke") {
      throw new Error("Recursive host invoke is not allowed.");
    }

    var payloadRaw = "";
    if (args.payloadPath) {
      payloadRaw = $._loomAiPainter._readTextFile(args.payloadPath);
    } else if (typeof args.payload !== "undefined") {
      payloadRaw = $._loomAiPainter._stringify(args.payload);
    }

    return method(payloadRaw);
  } catch (error) {
    return $._loomAiPainter._error(error.message || error.toString());
  }
};

$._loomAiPainter.invokeFromPath = function (methodName, payloadPath) {
  try {
    if (!methodName) {
      throw new Error("Host method name is missing.");
    }

    if (methodName === "invoke" || methodName === "invokeFromPath") {
      throw new Error("Recursive host invoke is not allowed.");
    }

    var method = $._loomAiPainter[methodName];
    if (typeof method !== "function") {
      throw new Error("Host method does not exist: " + methodName);
    }

    var payloadRaw = payloadPath ? $._loomAiPainter._readTextFile(payloadPath) : "";
    return method(payloadRaw);
  } catch (error) {
    var errorMessage = error && error.message ? error.message : String(error);
    $._loomAiPainter._appendHostLog("invokeFromPath(" + methodName + ") failed: " + errorMessage);
    return $._loomAiPainter._error(errorMessage);
  }
};

$._loomAiPainter.exportArtboardsDebugFromPath = function (payloadPath) {
  try {
    $._loomAiPainter._appendHostLog("exportArtboardsDebugFromPath started");
    var payloadRaw = $._loomAiPainter._readTextFile(payloadPath);
    $._loomAiPainter._appendHostLog("Payload loaded from: " + payloadPath);
    return $._loomAiPainter.exportArtboards(payloadRaw);
  } catch (error) {
    var errorMessage = error && error.message ? error.message : String(error);
    $._loomAiPainter._appendHostLog("exportArtboardsDebugFromPath failed: " + errorMessage);
    return $._loomAiPainter._error(errorMessage);
  }
};

$._loomAiPainter.getDocumentContext = function () {
  try {
    return $._loomAiPainter._ok($._loomAiPainter._withPixels(function () {
      if (!app.documents.length) {
        throw new Error("Please open a Photoshop document first.");
      }

      var doc = app.activeDocument;
      var width = $._loomAiPainter._toPx(doc.width);
      var height = $._loomAiPainter._toPx(doc.height);
      var selectionBounds = $._loomAiPainter._getSelectionBounds(doc);

      return {
        documentId: doc.id,
        documentName: doc.name,
        width: width,
        height: height,
        hasSelection: Boolean(selectionBounds),
        targetBounds: selectionBounds || {
          left: 0,
          top: 0,
          right: width,
          bottom: height
        }
      };
    }));
  } catch (error) {
    return $._loomAiPainter._error(error.message || error.toString());
  }
};

$._loomAiPainter.captureContext = function () {
  try {
    return $._loomAiPainter._ok($._loomAiPainter._withPixels(function () {
      if (!app.documents.length) {
        throw new Error("Please open a Photoshop document first.");
      }

      var doc = app.activeDocument;
      var width = $._loomAiPainter._toPx(doc.width);
      var height = $._loomAiPainter._toPx(doc.height);
      var selectionBounds = $._loomAiPainter._getSelectionBounds(doc);
      var targetBounds = selectionBounds || {
        left: 0,
        top: 0,
        right: width,
        bottom: height
      };
      var referencePath = null;
      var referenceSize = null;

      if (selectionBounds) {
        referencePath = Folder.temp.fsName + "/loom-ai-reference-" + $._loomAiPainter._now() + ".jpg";
        referenceSize = $._loomAiPainter._saveCompositeRegion(doc, targetBounds, referencePath, 0, "jpg");
      }

      return {
        documentId: doc.id,
        documentName: doc.name,
        width: width,
        height: height,
        hasSelection: Boolean(selectionBounds),
        referencePath: referencePath,
        referenceSize: referenceSize,
        targetBounds: targetBounds
      };
    }));
  } catch (error) {
    return $._loomAiPainter._error(error.message || error.toString());
  }
};

$._loomAiPainter.captureInpaintContext = function (rawArgs) {
  try {
    var args = $._loomAiPainter._parse(rawArgs);

    return $._loomAiPainter._ok($._loomAiPainter._withPixels(function () {
      if (!app.documents.length) {
        throw new Error("Please open a Photoshop document first.");
      }

      var doc = app.activeDocument;
      var width = $._loomAiPainter._toPx(doc.width);
      var height = $._loomAiPainter._toPx(doc.height);
      var selectionBounds = $._loomAiPainter._getSelectionBounds(doc);

      if (!selectionBounds) {
        throw new Error("Please select an area in Photoshop before using inpaint mode.");
      }
      var targetBounds = {
        left: 0,
        top: 0,
        right: width,
        bottom: height
      };
      var timestamp = $._loomAiPainter._now();
      var referencePath = Folder.temp.fsName + "/loom-ai-inpaint-reference-" + timestamp + ".jpg";
      var maskPath = Folder.temp.fsName + "/loom-ai-inpaint-mask-" + timestamp + ".png";
      var maxSide = Math.max(1, Number(args.maxSide) || 0);

      var referenceSize = $._loomAiPainter._saveCompositeRegion(doc, targetBounds, referencePath, maxSide, "jpg");
      var maskSize = $._loomAiPainter._saveSelectionMaskRegion(doc, targetBounds, maskPath, maxSide, referenceSize);

      return {
        documentId: doc.id,
        documentName: doc.name,
        width: width,
        height: height,
        hasSelection: true,
        referencePath: referencePath,
        maskPath: maskPath,
        referenceBytes: (new File(referencePath)).length,
        maskBytes: (new File(maskPath)).length,
        referenceSize: referenceSize,
        maskSize: maskSize,
        targetBounds: targetBounds,
        editBounds: selectionBounds
      };
    }));
  } catch (error) {
    return $._loomAiPainter._error(error.message || error.toString());
  }
};

$._loomAiPainter.placeGeneratedImage = function (rawArgs) {
  try {
    var args = $._loomAiPainter._parse(rawArgs);

    return $._loomAiPainter._ok($._loomAiPainter._withPixels(function () {
      if (!app.documents.length) {
        throw new Error("Please open a Photoshop document first.");
      }

      if (!args.imagePath) {
        throw new Error("Generated image path is missing.");
      }

      if (!args.documentId) {
        throw new Error("Target document id is missing.");
      }

      var targetDoc = $._loomAiPainter._findDocumentById(args.documentId);
      if (!targetDoc) {
        throw new Error("Target document is no longer open: " + args.documentId);
      }

      app.activeDocument = targetDoc;
      $._loomAiPainter._ensureWritableTargetLayer(targetDoc);
      var targetBounds = args.targetBounds;
      var targetWidth = targetBounds.right - targetBounds.left;
      var targetHeight = targetBounds.bottom - targetBounds.top;
      var imageFile = new File(args.imagePath);

      if (!imageFile.exists) {
        throw new Error("Generated image does not exist: " + args.imagePath);
      }

      var sourceDoc = app.open(imageFile);
      // 生成的 PNG 只有单个图层，不需要合并；如果有多层则先合并以保留合成效果
      try {
        if (sourceDoc.artLayers.length > 1 || sourceDoc.layerSets.length > 0) {
          sourceDoc.mergeVisibleLayers();
        }
      } catch (_mergeError) {
        // 单图层文档合并会失败，忽略即可
      }
      sourceDoc.selection.selectAll();
      sourceDoc.selection.copy();
      sourceDoc.close(SaveOptions.DONOTSAVECHANGES);

      app.activeDocument = targetDoc;
      targetDoc.paste();

      var insertedLayer = targetDoc.activeLayer;
      insertedLayer.name = args.layerName || "AI Generated";

      var layerBounds = insertedLayer.bounds;
      var layerLeft = $._loomAiPainter._toPx(layerBounds[0]);
      var layerTop = $._loomAiPainter._toPx(layerBounds[1]);
      var layerRight = $._loomAiPainter._toPx(layerBounds[2]);
      var layerBottom = $._loomAiPainter._toPx(layerBounds[3]);
      var layerWidth = Math.max(1, layerRight - layerLeft);
      var layerHeight = Math.max(1, layerBottom - layerTop);
      var scale = Math.min(targetWidth / layerWidth, targetHeight / layerHeight);
      var scaleX = scale * 100;
      var scaleY = scale * 100;

      insertedLayer.resize(scaleX, scaleY, AnchorPosition.TOPLEFT);

      layerBounds = insertedLayer.bounds;
      layerLeft = $._loomAiPainter._toPx(layerBounds[0]);
      layerTop = $._loomAiPainter._toPx(layerBounds[1]);
      layerRight = $._loomAiPainter._toPx(layerBounds[2]);
      layerBottom = $._loomAiPainter._toPx(layerBounds[3]);
      layerWidth = Math.max(1, layerRight - layerLeft);
      layerHeight = Math.max(1, layerBottom - layerTop);

      var targetCenterX = targetBounds.left + (targetWidth / 2);
      var targetCenterY = targetBounds.top + (targetHeight / 2);
      var layerCenterX = layerLeft + (layerWidth / 2);
      var layerCenterY = layerTop + (layerHeight / 2);

      insertedLayer.translate(targetCenterX - layerCenterX, targetCenterY - layerCenterY);

      return {
        layerName: insertedLayer.name,
        imagePath: args.imagePath
      };
    }));
  } catch (error) {
    return $._loomAiPainter._error(error.message || error.toString());
  }
};

$._loomAiPainter.openDocument = function (rawArgs) {
  try {
    var args = $._loomAiPainter._parse(rawArgs);

    return $._loomAiPainter._ok($._loomAiPainter._withPixels(function () {
      if (!args.path) {
        throw new Error("Document path is missing.");
      }

      var file = new File(args.path);
      if (!file.exists) {
        throw new Error("Document does not exist: " + args.path);
      }

      var doc = app.open(file);
      return {
        documentId: doc.id,
        documentName: doc.name,
        path: file.fsName
      };
    }));
  } catch (error) {
    return $._loomAiPainter._error(error.message || error.toString());
  }
};

$._loomAiPainter.exportArtboards = function (rawArgs) {
  try {
    $._loomAiPainter._appendHostLog("exportArtboards entered");
    var args = $._loomAiPainter._parse(rawArgs);
    $._loomAiPainter._appendHostLog("exportArtboards payload parsed");

    return $._loomAiPainter._ok($._loomAiPainter._withPixels(function () {
      if (!app.documents.length) {
        throw new Error("Please open a Photoshop document first.");
      }

      if (!args.exports || !(args.exports instanceof Array) || !args.exports.length) {
        throw new Error("No export targets were provided.");
      }

      var doc = app.activeDocument;
      $._loomAiPainter._appendHostLog("Active document: " + doc.name);
      var results = [];
      var index;
      var entry;
      var outputFile;
      var outputFolder;
      var fileNameBody;

      for (index = 0; index < args.exports.length; index += 1) {
        entry = args.exports[index];
        if (!entry.artboardName) {
          throw new Error("Export target is missing artboardName.");
        }
        if (!entry.outputPath) {
          throw new Error("Export target is missing outputPath.");
        }

        outputFile = new File(entry.outputPath);
        outputFolder = outputFile.parent;
        if (!outputFolder.exists && !outputFolder.create()) {
          throw new Error("Unable to create export folder: " + outputFolder.fsName);
        }
        var extensionIndex = outputFile.name.lastIndexOf(".");
        fileNameBody = extensionIndex > 0 ? outputFile.name.substring(0, extensionIndex) : outputFile.name;
        $._loomAiPainter._appendHostLog("Export target ready: " + entry.artboardName + " -> " + outputFolder.fsName + "/" + fileNameBody + ".png");

        $._loomAiPainter._exportArtboardWithAdobeLogic(doc, {
          artboardName: entry.artboardName,
          outputFolder: outputFolder.fsName,
          fileNameBody: fileNameBody,
          hideLayerNames: entry.hideLayerNames || []
        });

        results.push({
          artboardName: entry.artboardName,
          outputPath: outputFolder.fsName + "/" + fileNameBody + ".png",
          hideLayerNames: entry.hideLayerNames || []
        });
      }

      return {
        documentId: doc.id,
        documentName: doc.name,
        exports: results
      };
    }));
  } catch (error) {
    $._loomAiPainter._appendHostLog("exportArtboards failed: " + (error.message || error.toString()));
    return $._loomAiPainter._error(error.message || error.toString());
  }
};


// ─── 生成式扩展（原生裁剪联动 + 变体图层组秒切） ────────────────────────

$._loomAiPainter._selectTool = function (toolStringId) {
  var desc = new ActionDescriptor();
  var ref = new ActionReference();
  ref.putClass(stringIDToTypeID(toolStringId));
  desc.putReference(charIDToTypeID("null"), ref);
  executeAction(charIDToTypeID("slct"), desc, DialogModes.NO);
};

$._loomAiPainter._saveFlatDocumentSnapshot = function (doc, outputPath) {
  var duplicate = doc.duplicate();
  try {
    try {
      if (duplicate.activeLayer && duplicate.activeLayer.isBackgroundLayer) {
        duplicate.activeLayer.isBackgroundLayer = false;
      }
    } catch (_bgErr) {}
    duplicate.flatten();
    if (duplicate.mode !== DocumentMode.RGB) {
      duplicate.changeMode(ChangeMode.RGB);
    }
    if (duplicate.bitsPerChannel !== BitsPerChannelType.EIGHT) {
      duplicate.bitsPerChannel = BitsPerChannelType.EIGHT;
    }

    var file = new File(outputPath);
    var options = new PNGSaveOptions();
    options.compression = 6;
    options.interlaced = false;
    duplicate.saveAs(file, options, true, Extension.LOWERCASE);
    return $._loomAiPainter._getDocumentPixelSize(duplicate);
  } finally {
    try {
      duplicate.close(SaveOptions.DONOTSAVECHANGES);
    } catch (_closeErr) {}
  }
};

$._loomAiPainter.beginGenerativeExpandCrop = function () {
  try {
    return $._loomAiPainter._ok($._loomAiPainter._withPixels(function () {
      if (!app.documents.length) {
        throw new Error("请先在 Photoshop 中打开一张图片文档。");
      }

      var doc = app.activeDocument;
      var origWidth = Math.round($._loomAiPainter._toPx(doc.width));
      var origHeight = Math.round($._loomAiPainter._toPx(doc.height));
      var resolution = Number(doc.resolution) || 72;
      var historyLength = doc.historyStates ? doc.historyStates.length : 0;
      var ts = $._loomAiPainter._now();
      var snapshotPath = Folder.temp.fsName + "/loom-expand-src-" + ts + ".png";

      $._loomAiPainter._appendHostLog("beginGenerativeExpandCrop: doc=" + doc.name + " " + origWidth + "x" + origHeight);
      $._loomAiPainter._saveFlatDocumentSnapshot(doc, snapshotPath);

      app.activeDocument = doc;
      $._loomAiPainter._selectTool("cropTool");

      return {
        documentId: doc.id,
        documentName: doc.name,
        origWidth: origWidth,
        origHeight: origHeight,
        resolution: resolution,
        historyLength: historyLength,
        preCropImagePath: snapshotPath
      };
    }));
  } catch (error) {
    return $._loomAiPainter._error(error.message || error.toString());
  }
};

$._loomAiPainter.exitCropTool = function () {
  try {
    return $._loomAiPainter._ok($._loomAiPainter._withPixels(function () {
      try {
        $._loomAiPainter._selectTool("moveTool");
      } catch (_toolErr) {}
      return { exited: true };
    }));
  } catch (error) {
    return $._loomAiPainter._error(error.message || error.toString());
  }
};

$._loomAiPainter.getExpandDocumentState = function (rawArgs) {
  try {
    var args = $._loomAiPainter._parse(rawArgs);
    return $._loomAiPainter._ok($._loomAiPainter._withPixels(function () {
      if (!app.documents.length) {
        return { exists: false, isActive: false };
      }

      var doc = args.documentId ? $._loomAiPainter._findDocumentById(args.documentId) : app.activeDocument;
      if (!doc) {
        return { exists: false, isActive: false };
      }

      return {
        exists: true,
        isActive: app.activeDocument && app.activeDocument.id === doc.id,
        documentId: doc.id,
        documentName: doc.name,
        width: Math.round($._loomAiPainter._toPx(doc.width)),
        height: Math.round($._loomAiPainter._toPx(doc.height)),
        resolution: Number(doc.resolution) || 72,
        historyLength: doc.historyStates ? doc.historyStates.length : 0
      };
    }));
  } catch (error) {
    return $._loomAiPainter._error(error.message || error.toString());
  }
};

$._loomAiPainter.prepareExpandSourceImage = function (rawArgs) {
  try {
    var args = $._loomAiPainter._parse(rawArgs);
    return $._loomAiPainter._ok($._loomAiPainter._withPixels(function () {
      var srcPath = args.preCropImagePath;
      if (!srcPath || !(new File(srcPath)).exists) {
        throw new Error("裁剪前原图快照不存在，请重新点击生成式扩展。");
      }

      var origW = Math.max(1, Math.round(Number(args.origWidth) || 0));
      var origH = Math.max(1, Math.round(Number(args.origHeight) || 0));
      var rect = args.cropRect;
      if (!rect) {
        throw new Error("缺少裁剪区域坐标信息。");
      }

      var left = Math.round(Number(rect.left) || 0);
      var top = Math.round(Number(rect.top) || 0);
      var right = Math.round(Number(rect.right) || origW);
      var bottom = Math.round(Number(rect.bottom) || origH);

      var padLeft = Math.max(0, -left);
      var padTop = Math.max(0, -top);
      var padRight = Math.max(0, right - origW);
      var padBottom = Math.max(0, bottom - origH);

      var inLeft = Math.max(0, Math.min(origW, left));
      var inTop = Math.max(0, Math.min(origH, top));
      var inRight = Math.max(inLeft + 1, Math.min(origW, right));
      var inBottom = Math.max(inTop + 1, Math.min(origH, bottom));

      var finalSourcePath = srcPath;
      var sourceWidth = origW;
      var sourceHeight = origH;

      // 如果用户一侧向内裁小、另一侧向外扩展，先裁出保留的有效原图区域
      if (inLeft > 0 || inTop > 0 || inRight < origW || inBottom < origH) {
        var croppedPath = Folder.temp.fsName + "/loom-expand-cropped-" + $._loomAiPainter._now() + ".png";
        var activeBefore = app.documents.length ? app.activeDocument : null;
        var tempDoc = app.open(new File(srcPath));
        try {
          tempDoc.crop([
            UnitValue(inLeft, "px"),
            UnitValue(inTop, "px"),
            UnitValue(inRight, "px"),
            UnitValue(inBottom, "px")
          ]);
          var options = new PNGSaveOptions();
          options.compression = 6;
          options.interlaced = false;
          tempDoc.saveAs(new File(croppedPath), options, true, Extension.LOWERCASE);
          sourceWidth = Math.round($._loomAiPainter._toPx(tempDoc.width));
          sourceHeight = Math.round($._loomAiPainter._toPx(tempDoc.height));
          finalSourcePath = croppedPath;
        } finally {
          try { tempDoc.close(SaveOptions.DONOTSAVECHANGES); } catch (_cErr) {}
          try { if (activeBefore) app.activeDocument = activeBefore; } catch (_aErr) {}
        }
      }

      return {
        sourcePath: finalSourcePath,
        sourceWidth: sourceWidth,
        sourceHeight: sourceHeight,
        padding: {
          top: padTop,
          right: padRight,
          bottom: padBottom,
          left: padLeft
        },
        targetWidth: sourceWidth + padLeft + padRight,
        targetHeight: sourceHeight + padTop + padBottom
      };
    }));
  } catch (error) {
    return $._loomAiPainter._error(error.message || error.toString());
  }
};

$._loomAiPainter._findTopLevelLayerSet = function (doc, groupName) {
  var i;
  for (i = 0; i < doc.layerSets.length; i += 1) {
    if (doc.layerSets[i].name === groupName) {
      return doc.layerSets[i];
    }
  }
  return null;
};

$._loomAiPainter._findArtLayerInSet = function (layerSet, layerName) {
  var i;
  for (i = 0; i < layerSet.artLayers.length; i += 1) {
    if (layerSet.artLayers[i].name === layerName) {
      return layerSet.artLayers[i];
    }
  }
  return null;
};

$._loomAiPainter._findTopLevelArtLayer = function (doc, layerName) {
  var i;
  for (i = 0; i < doc.artLayers.length; i += 1) {
    if (doc.artLayers[i].name === layerName) {
      return doc.artLayers[i];
    }
  }
  return null;
};

$._loomAiPainter._selectGeneratedVariationOnActiveLayer = function (index, totalCount) {
  var desc = new ActionDescriptor();
  var ref = new ActionReference();
  ref.putEnumerated(charIDToTypeID("Lyr "), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
  desc.putReference(charIDToTypeID("null"), ref);
  desc.putInteger(stringIDToTypeID("index"), index);
  desc.putInteger(stringIDToTypeID("remainingVariationsCount"), totalCount || 3);
  executeAction(stringIDToTypeID("selectGeneratedVariation"), desc, DialogModes.NO);
};

$._loomAiPainter._applyExpandVariantInner = function (targetDoc, args) {
  app.activeDocument = targetDoc;

  var layerName = args.layerName || args.groupName || "AI 扩展";
  var variantIndex = Number(args.variantIndex) || 0;
  var totalVariants = Number(args.totalVariants) || 3;
  var existingLayer = $._loomAiPainter._findTopLevelArtLayer(targetDoc, layerName);

  // 情况 1：单原生生成式图层已存在 -> 直接调用 selectGeneratedVariation 原地零闪烁切换（不打开任何文件、不新增图层）
  if (existingLayer) {
    targetDoc.activeLayer = existingLayer;
    if (!existingLayer.visible) existingLayer.visible = true;
    try {
      $._loomAiPainter._selectGeneratedVariationOnActiveLayer(variantIndex, totalVariants);
      return {
        created: false,
        nativeSwitch: true,
        layerName: layerName,
        variantIndex: variantIndex
      };
    } catch (_switchErr) {
      // 兜底：若旧版 PS 不支持直接切内嵌变体，则删除旧层并原地替换为新层，依然保证文档中只有 1 个图层
      try { existingLayer.remove(); } catch (_rmErr) {}
    }
  }

  var insertedLayer = null;
  var usedNativePsd = false;

  // 情况 2：首次导入 -> 打开 1 份原生分层 PSD，只把顶层 1 个带蒙版的生成式图层直接复制到文档顶层
  if (args.psdPath && (new File(args.psdPath)).exists) {
    var psdDoc = app.open(new File(args.psdPath));
    try {
      if (!psdDoc.layers || !psdDoc.layers.length) {
        throw new Error("原生分层 PSD 中未找到可用图层。");
      }
      var genLayer = psdDoc.layers[0];
      insertedLayer = genLayer.duplicate(targetDoc, ElementPlacement.PLACEATBEGINNING);
      usedNativePsd = true;
    } finally {
      try { psdDoc.close(SaveOptions.DONOTSAVECHANGES); } catch (_psdCloseErr) {}
    }
    app.activeDocument = targetDoc;
    insertedLayer.name = layerName;
    targetDoc.activeLayer = insertedLayer;
    if (variantIndex > 0) {
      try {
        $._loomAiPainter._selectGeneratedVariationOnActiveLayer(variantIndex, totalVariants);
      } catch (_initVarErr) {}
    }
  } else {
    if (!args.imagePath) {
      throw new Error("变体图片路径缺失。");
    }
    var imageFile = new File(args.imagePath);
    if (!imageFile.exists) {
      throw new Error("变体本地缓存文件不存在：" + args.imagePath);
    }

    var docW = Math.round($._loomAiPainter._toPx(targetDoc.width));
    var docH = Math.round($._loomAiPainter._toPx(targetDoc.height));

    var sourceDoc = app.open(imageFile);
    try {
      try {
        if (sourceDoc.artLayers.length > 1 || sourceDoc.layerSets.length > 0) {
          sourceDoc.mergeVisibleLayers();
        }
      } catch (_mergeErr) {}
      sourceDoc.selection.selectAll();
      sourceDoc.selection.copy();
    } finally {
      sourceDoc.close(SaveOptions.DONOTSAVECHANGES);
    }

    app.activeDocument = targetDoc;
    $._loomAiPainter._ensureWritableTargetLayer(targetDoc);
    targetDoc.paste();

    insertedLayer = targetDoc.activeLayer;
    insertedLayer.name = layerName;
    try {
      if (targetDoc.layers.length > 1) {
        insertedLayer.move(targetDoc.layers[0], ElementPlacement.PLACEBEFORE);
      }
    } catch (_mvErr) {}

    var lb = insertedLayer.bounds;
    var lLeft = $._loomAiPainter._toPx(lb[0]);
    var lTop = $._loomAiPainter._toPx(lb[1]);
    var lRight = $._loomAiPainter._toPx(lb[2]);
    var lBottom = $._loomAiPainter._toPx(lb[3]);
    var lW = Math.max(1, lRight - lLeft);
    var lH = Math.max(1, lBottom - lTop);

    if (Math.abs(lW - docW) > 1 || Math.abs(lH - docH) > 1) {
      insertedLayer.resize((docW / lW) * 100, (docH / lH) * 100, AnchorPosition.TOPLEFT);
      lb = insertedLayer.bounds;
      lLeft = $._loomAiPainter._toPx(lb[0]);
      lTop = $._loomAiPainter._toPx(lb[1]);
    }

    insertedLayer.translate(-lLeft, -lTop);
  }

  targetDoc.activeLayer = insertedLayer;
  return {
    created: true,
    nativeSwitch: false,
    nativePsd: usedNativePsd,
    layerName: layerName,
    variantIndex: variantIndex
  };
};

$._loomAiPainter.applyExpandVariant = function (rawArgs) {
  try {
    var args = $._loomAiPainter._parse(rawArgs);

    return $._loomAiPainter._ok($._loomAiPainter._withPixels(function () {
      if (!app.documents.length) {
        throw new Error("请先打开目标 Photoshop 文档。");
      }

      var targetDoc = args.documentId ? $._loomAiPainter._findDocumentById(args.documentId) : app.activeDocument;
      if (!targetDoc) {
        throw new Error("目标文档已关闭，无法切换扩展结果。");
      }

      // 使用 suspendHistory 合并为单步历史与单次画布重绘，大幅减少导入/切换变体时的闪动
      $._loomAiPainter._tmpVariantArgs = args;
      $._loomAiPainter._tmpVariantDoc = targetDoc;
      $._loomAiPainter._tmpVariantResult = null;
      $._loomAiPainter._tmpVariantError = null;
      try {
        targetDoc.suspendHistory(
          "AI 扩展",
          "try { $._loomAiPainter._tmpVariantResult = $._loomAiPainter._applyExpandVariantInner($._loomAiPainter._tmpVariantDoc, $._loomAiPainter._tmpVariantArgs); } catch (e) { $._loomAiPainter._tmpVariantError = e; }"
        );
      } finally {
        $._loomAiPainter._tmpVariantArgs = null;
        $._loomAiPainter._tmpVariantDoc = null;
      }

      if ($._loomAiPainter._tmpVariantError) {
        var capturedErr = $._loomAiPainter._tmpVariantError;
        $._loomAiPainter._tmpVariantError = null;
        throw capturedErr;
      }
      var res = $._loomAiPainter._tmpVariantResult;
      $._loomAiPainter._tmpVariantResult = null;
      return res;
    }));
  } catch (error) {
    return $._loomAiPainter._error(error.message || error.toString());
  }
};
