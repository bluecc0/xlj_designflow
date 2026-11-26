#target photoshop
/**
 * Phase 1 Spike 最小验证脚本：在目标 Windows 正版 Photoshop 上直接验证
 * 「解锁背景 -> 扩画布 -> 原生 Generative Expand -> 导出 3 个变体 -> 无弹窗关闭」。
 *
 * 使用方法：
 *   1. 在 Windows 正版 Photoshop 中打开任意一张测试图片；
 *   2. 菜单栏：文件 > 脚本 > 浏览...，选择本文件运行；
 *   3. 结果将导出到桌面 `ps-expand-spike-out/` 文件夹。
 *
 * 如果本机 PS 版本的 `syntheticFill` / `setVariation` 报错：
 *   请开启 Adobe ScriptingListener 插件，手动做一次“生成式扩展”和“切换变体”，
 *   把桌面 ScriptingListenerJS.log 里录出的 ActionDescriptor 替换到
 *   `host/main.jsx` 的 `_executeGenerativeFillDescriptor` 和 `_selectVariationIndex`。
 */

(function () {
  var prevUnits = app.preferences.rulerUnits;
  var prevDialogs = app.displayDialogs;
  app.preferences.rulerUnits = Units.PIXELS;
  app.displayDialogs = DialogModes.NO;

  var testDoc = null;
  try {
    if (!app.documents.length) {
      alert("请先打开一张测试图片再运行 Spike 脚本。");
      return;
    }

    var outDir = new Folder(Folder.desktop.fsName + "/ps-expand-spike-out");
    if (!outDir.exists) outDir.create();

    // 在副本上测试，不破坏当前打开的测试图
    testDoc = app.activeDocument.duplicate("spike_expand_test");
    if (testDoc.mode !== DocumentMode.RGB) testDoc.changeMode(ChangeMode.RGB);
    if (testDoc.bitsPerChannel !== BitsPerChannelType.EIGHT) testDoc.bitsPerChannel = BitsPerChannelType.EIGHT;
    try {
      if (testDoc.activeLayer && testDoc.activeLayer.isBackgroundLayer) {
        testDoc.activeLayer.isBackgroundLayer = false;
      }
    } catch (_e) {}

    var origW = Math.round(Number(testDoc.width.as("px")));
    var origH = Math.round(Number(testDoc.height.as("px")));
    var padTop = 160;
    var padRight = 160;

    // 向上与向右各扩展 160px
    testDoc.resizeCanvas(UnitValue(origW + padRight, "px"), UnitValue(origH, "px"), AnchorPosition.MIDDLELEFT);
    testDoc.resizeCanvas(UnitValue(origW + padRight, "px"), UnitValue(origH + padTop, "px"), AnchorPosition.BOTTOMCENTER);

    // 选中原图区域并反选得到外扩空白区
    var overlap = 2;
    testDoc.selection.select([
      [overlap, padTop + overlap],
      [origW - overlap, padTop + overlap],
      [origW - overlap, padTop + origH - overlap],
      [overlap, padTop + origH - overlap]
    ]);
    testDoc.selection.invert();

    // 触发原生 Generative Expand
    var desc = new ActionDescriptor();
    var ref = new ActionReference();
    ref.putEnumerated(charIDToTypeID("Dcmn"), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
    desc.putReference(charIDToTypeID("null"), ref);
    desc.putString(stringIDToTypeID("prompt"), "");
    desc.putString(stringIDToTypeID("serviceID"), "clio");
    desc.putString(stringIDToTypeID("workflow"), "out_painting");
    desc.putEnumerated(stringIDToTypeID("dualCrop"), stringIDToTypeID("dualCrop"), stringIDToTypeID("dualCrop"));
    executeAction(stringIDToTypeID("syntheticFill"), desc, DialogModes.NO);

    // 尝试导出 3 个变体
    var exported = [];
    var variantSwitchSupported = true;
    for (var i = 0; i < 3; i += 1) {
      if (i > 0) {
        try {
          var vDesc = new ActionDescriptor();
          var vRef = new ActionReference();
          vRef.putEnumerated(charIDToTypeID("Lyr "), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
          vDesc.putReference(charIDToTypeID("null"), vRef);
          vDesc.putInteger(stringIDToTypeID("variationIndex"), i);
          executeAction(stringIDToTypeID("setVariation"), vDesc, DialogModes.NO);
        } catch (varErr) {
          variantSwitchSupported = false;
          break;
        }
      }
      var dup = testDoc.duplicate();
      dup.flatten();
      var jpgOpt = new JPEGSaveOptions();
      jpgOpt.quality = 11;
      var outFile = new File(outDir.fsName + "/spike_v" + i + ".jpg");
      dup.saveAs(outFile, jpgOpt, true, Extension.LOWERCASE);
      dup.close(SaveOptions.DONOTSAVECHANGES);
      exported.push(outFile.fsName);
    }

    testDoc.close(SaveOptions.DONOTSAVECHANGES);
    testDoc = null;

    alert(
      "Spike 验证成功！\n" +
      "PS 版本: " + app.version + "\n" +
      "导出变体数: " + exported.length + "\n" +
      "3变体切换支持: " + (variantSwitchSupported ? "是" : "否（需用 ScriptingListener 录制 setVariation）") + "\n" +
      "输出目录: " + outDir.fsName
    );
  } catch (err) {
    if (testDoc) {
      try { testDoc.close(SaveOptions.DONOTSAVECHANGES); } catch (_ce) {}
    }
    alert(
      "Spike 执行报错（PS " + app.version + "）：\n" +
      (err.message || err.toString()) + "\n\n" +
      "请使用 ScriptingListener 录制一次原生生成式扩展以核对当前 PS 版本的 ActionDescriptor。"
    );
  } finally {
    app.preferences.rulerUnits = prevUnits;
    app.displayDialogs = prevDialogs;
  }
})();
