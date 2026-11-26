#!/usr/bin/env node
"use strict";

const path = require("path");
const cp = require("child_process");
const fs = require("fs");
const os = require("os");

function parseArgs(argv) {
  const result = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("-")) {
      continue;
    }
    const key = token.slice(1);
    result[key] = argv[i + 1];
    i += 1;
  }
  return result;
}

function emit(payload) {
  process.stdout.write(JSON.stringify(payload));
}

function runFile(command, args) {
  return new Promise((resolve, reject) => {
    cp.execFile(command, args, { windowsHide: true, timeout: 120000, maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || stdout || error.message));
        return;
      }
      resolve(String(stdout || "").trim());
    });
  });
}

async function exportOnWindows(args) {
  const scriptPath = path.join(__dirname, "export-assets.ps1");
  const stdout = await runFile("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy", "Bypass",
    "-File", scriptPath,
    "-HostScriptPath", args.HostScriptPath,
    "-BannerDir", args.BannerDir,
    "-PosterDir", args.PosterDir,
    "-HorizontalArtboardName", args.HorizontalArtboardName,
    "-VerticalArtboardName", args.VerticalArtboardName,
    "-TemplateMarker", args.TemplateMarker
  ]);
  return JSON.parse(stdout || "{}");
}

async function exportOnMac(args) {
  const scriptPath = path.join(__dirname, "export-artboards.jsx");
  const payloadPath = path.join(os.tmpdir(), "loom-export-" + Date.now() + ".json");

  function runPhotoshopJavaScriptMac(jsCode) {
    const appleScript = [
      'tell application id "com.adobe.Photoshop"',
      'set resultText to do javascript ' + JSON.stringify(jsCode),
      "end tell",
      "return resultText"
    ].join("\n");
    return runFile("osascript", ["-e", appleScript]);
  }

  try {
    const documentName = (await runPhotoshopJavaScriptMac("app.documents.length ? app.activeDocument.name : '';")).trim();
    if (!documentName) {
      throw new Error("No active Photoshop document.");
    }

    const productName = path.basename(documentName, path.extname(documentName)).trim();
    if (!productName) {
      throw new Error("Unable to derive product name from current document.");
    }
    if (args.TemplateMarker && productName.indexOf(args.TemplateMarker) !== -1) {
      throw new Error("Please save the template copy as a product code first, for example ABC-123.psd.");
    }

    const safeProductName = productName.replace(/[\\/:*?"<>|]/g, "-");
    const bannerPath = path.join(args.BannerDir, safeProductName + ".png");
    const posterPath = path.join(args.PosterDir, safeProductName + ".png");
    const posterExtraPath = path.join(args.PosterDir, safeProductName + "_1.png");
    fs.mkdirSync(args.BannerDir, { recursive: true });
    fs.mkdirSync(args.PosterDir, { recursive: true });

    fs.writeFileSync(payloadPath, JSON.stringify({
      exports: [
        { artboardName: args.HorizontalArtboardName, outputPath: bannerPath },
        { artboardName: args.VerticalArtboardName, outputPath: posterPath },
        { artboardName: args.VerticalArtboardName, outputPath: posterExtraPath, hideLayerNames: ["poster-1"] }
      ]
    }), "utf8");

    const escapedScriptPath = scriptPath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const escapedPayloadPath = payloadPath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const jsx = [
      "(function () {",
      "  var LOOM_EXPORT_PAYLOAD_PATH = \"" + escapedPayloadPath + "\";",
      "  return $.evalFile(new File(\"" + escapedScriptPath + "\"));",
      "}())"
    ].join("\n");
    const stdout = await runPhotoshopJavaScriptMac(jsx);
    const result = JSON.parse(stdout || "{}");
    if (result && result.ok) {
      result.bannerPath = bannerPath;
      result.posterPath = posterPath;
      result.posterExtraPath = posterExtraPath;
      result.documentName = documentName;
    }
    return result;
  } finally {
    if (fs.existsSync(payloadPath)) {
      fs.unlinkSync(payloadPath);
    }
  }
}

async function main() {
  try {
    const args = parseArgs(process.argv);
    let result;

    if (process.platform === "win32") {
      result = await exportOnWindows(args);
    } else if (process.platform === "darwin") {
      result = await exportOnMac(args);
    } else {
      throw new Error("Unsupported platform: " + process.platform);
    }

    emit(result);
  } catch (error) {
    emit({ ok: false, error: error.message || String(error) });
    process.exitCode = 1;
  }
}

main();
