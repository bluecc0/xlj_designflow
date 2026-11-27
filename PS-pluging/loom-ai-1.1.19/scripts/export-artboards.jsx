#target photoshop

$.localize = true;

var ScriptFilePath = new Folder(app.path.fsName + "/Presets/Scripts").fsName;
var running = "abToFiles";
var strTitle = localize("$$$/JavaScripts/ArtboardsToFiles/Title=Artboards To Files");
var strMessage = localize("$$$/JavaScripts/ArtboardsToFiles/Message=Artboard To Files action settings");
$.evalFile(new File(ScriptFilePath + "/ArtboardExport.inc"));

function loomEscapeString(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
}

function loomStringify(value) {
  if (value === null || typeof value === "undefined") {
    return "null";
  }

  var valueType = typeof value;
  if (valueType === "string") {
    return "\"" + loomEscapeString(value) + "\"";
  }

  if (valueType === "number" || valueType === "boolean") {
    return String(value);
  }

  if (value instanceof Array) {
    var items = [];
    var i;
    for (i = 0; i < value.length; i += 1) {
      items.push(loomStringify(value[i]));
    }
    return "[" + items.join(",") + "]";
  }

  var pairs = [];
  var key;
  for (key in value) {
    if (value.hasOwnProperty(key) && typeof value[key] !== "undefined") {
      pairs.push("\"" + loomEscapeString(key) + "\":" + loomStringify(value[key]));
    }
  }
  return "{" + pairs.join(",") + "}";
}

function loomOk(data) {
  return loomStringify({ ok: true, data: data });
}

function loomError(message) {
  return loomStringify({ ok: false, error: String(message || "Unknown error") });
}

function loomLog(message) {
  try {
    var logFile = new File(Folder.temp.fsName + "/loom-export-artboards.log");
    logFile.encoding = "UTF8";
    if (!logFile.open(logFile.exists ? "e" : "w")) {
      return;
    }
    logFile.seek(0, 2);
    logFile.writeln("[" + (new Date()).toUTCString() + "] " + String(message || ""));
    logFile.close();
  } catch (_ignored) {}
}

function loomReadTextFile(filePath) {
  var file = new File(filePath);
  if (!file.exists) {
    throw new Error("Payload file not found: " + filePath);
  }

  file.encoding = "UTF8";
  if (!file.open("r")) {
    throw new Error("Unable to open payload file: " + filePath);
  }

  var content = file.read();
  file.close();
  return content || "";
}

function loomParse(raw) {
  if (!raw) {
    return {};
  }
  return eval("(" + raw + ")");
}

function loomToPx(value) {
  return Number(value.as("px"));
}

function loomWithPixels(callback) {
  var previousUnits = app.preferences.rulerUnits;
  app.preferences.rulerUnits = Units.PIXELS;
  try {
    return callback();
  } finally {
    app.preferences.rulerUnits = previousUnits;
  }
}

function loomFindArtboardByName(artboards, targetName) {
  var index;
  for (index = 0; index < artboards.length; index += 1) {
    if (artboards[index].name === targetName) {
      return artboards[index];
    }
  }
  return null;
}

function loomBuildExportInfo(outputFolder, fileNameBody) {
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
  exportInfo.destination = outputFolder.fsName;
  exportInfo.fileNamePrefix = fileNameBody;
  return exportInfo;
}

function loomTrim(value) {
  return String(value || "").replace(/^[\s﻿\xA0]+|[\s﻿\xA0]+$/g, "");
}

function loomHideLayersByName(container, targetName) {
  if (!container || !targetName) {
    return 0;
  }
  var count = 0;
  try {
    var layers = container.layers;
    var target = loomTrim(targetName).toLowerCase();
    var i;
    for (i = 0; i < layers.length; i += 1) {
      var layer = layers[i];
      try {
        if (loomTrim(layer.name).toLowerCase() === target) {
          layer.visible = false;
          count += 1;
        }
      } catch (_e1) {}

      try {
        if (layer.typename === "LayerSet" || (layer.layers && layer.layers.length > 0)) {
          count += loomHideLayersByName(layer, targetName);
        }
      } catch (_e2) {}
    }
  } catch (_e3) {}
  return count;
}

function loomExportOneArtboardNative(doc, artboard, outputFile, hideLayerNames) {
  var outputFolder = outputFile.parent;
  var extensionIndex = outputFile.name.lastIndexOf(".");
  var fileNameBody = extensionIndex > 0 ? outputFile.name.substring(0, extensionIndex) : outputFile.name;
  var exportInfo = loomBuildExportInfo(outputFolder, fileNameBody);
  var originalDoc = app.activeDocument;
  var artboardDoc = null;

  loomLog("Native export start: " + artboard.name);
  selectLayerFromAMid(artboard.AMid, "replaceSelection");

  try {
    artboardDuplToNewDoc(artboard.name);
    artboardDoc = app.activeDocument;
    setEnabled("autoNestEnabled", false);
    setEnabled("autoPositionEnabled", false);
    setEnabled("autoExpandEnabled", false);

    var duplicatedArtboards = getABLayerInfo().all;
    unArtBoard(duplicatedArtboards, artboardDoc, duplicatedArtboards[0].AMid, true, exportInfo);
    artboardDoc.activeLayer = artboardDoc.layers[0];
    cropFromMask();

    if (hideLayerNames && hideLayerNames instanceof Array && hideLayerNames.length) {
      var h;
      for (h = 0; h < hideLayerNames.length; h += 1) {
        var hiddenCount = loomHideLayersByName(artboardDoc, hideLayerNames[h]);
        loomLog("Hide layer '" + hideLayerNames[h] + "' in " + artboard.name + ", hidden count: " + hiddenCount);
      }
    }

    removeEmptyLayers(artboardDoc);
    saveFileNow(artboardDoc, fileNameBody, exportInfo);
    loomLog("Native export saved: " + outputFile.fsName);
  } finally {
    if (artboardDoc) {
      try {
        artboardDoc.close(SaveOptions.DONOTSAVECHANGES);
      } catch (_closeError) {}
    }

    try {
      app.activeDocument = originalDoc || doc;
    } catch (_restoreError) {
      app.activeDocument = doc;
    }
  }
}

function loomExportArtboardsFromPayloadPath(payloadPath) {
  try {
    loomLog("Standalone export started");

    return loomOk(loomWithPixels(function () {
      if (!app.documents.length) {
        throw new Error("Please open a Photoshop document first.");
      }

      var payload = loomParse(loomReadTextFile(payloadPath));
      if (!payload.exports || !(payload.exports instanceof Array) || !payload.exports.length) {
        throw new Error("No export targets were provided.");
      }

      var doc = app.activeDocument;
      var artboardInfo = getABLayerInfo();
      if (!artboardInfo || !artboardInfo.all || !artboardInfo.all.length) {
        throw new Error("No artboards were detected in the active document.");
      }
      var results = [];
      var index;

      loomLog("Active document: " + doc.name);

      for (index = 0; index < payload.exports.length; index += 1) {
        var entry = payload.exports[index];
        if (!entry.artboardName) {
          throw new Error("Export target is missing artboardName.");
        }
        if (!entry.outputPath) {
          throw new Error("Export target is missing outputPath.");
        }

        var artboard = loomFindArtboardByName(artboardInfo.all, entry.artboardName);
        if (!artboard) {
          throw new Error("Artboard not found: " + entry.artboardName);
        }

        var outputFile = new File(entry.outputPath);
        var outputFolder = outputFile.parent;
        if (!outputFolder.exists && !outputFolder.create()) {
          throw new Error("Unable to create export folder: " + outputFolder.fsName);
        }

        loomExportOneArtboardNative(doc, artboard, outputFile, entry.hideLayerNames);

        results.push({
          artboardName: entry.artboardName,
          outputPath: outputFile.fsName,
          hideLayerNames: entry.hideLayerNames || []
        });
      }

      return {
        documentName: doc.name,
        exports: results
      };
    }));
  } catch (error) {
    loomLog("Standalone export failed: " + (error.message || error.toString()));
    return loomError(error.message || error.toString());
  }
}

loomExportArtboardsFromPayloadPath(typeof LOOM_EXPORT_PAYLOAD_PATH !== "undefined" ? LOOM_EXPORT_PAYLOAD_PATH : "");
