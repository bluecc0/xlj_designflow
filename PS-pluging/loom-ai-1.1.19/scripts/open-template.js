#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");

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
    cp.execFile(command, args, { windowsHide: true, timeout: 120000, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || stdout || error.message));
        return;
      }
      resolve(String(stdout || "").trim());
    });
  });
}

function copyTemplate(templatePath, copyName) {
  if (!fs.existsSync(templatePath)) {
    throw new Error("Template file not found: " + templatePath);
  }

  const extension = path.extname(templatePath) || ".psd";
  const finalName = path.extname(copyName || "") ? copyName : (copyName + extension);
  const copyPath = path.join(os.tmpdir(), finalName);
  fs.copyFileSync(templatePath, copyPath);
  return copyPath;
}

async function openOnWindows(templatePath, copyName) {
  const scriptPath = path.join(__dirname, "open-template.ps1");
  const stdout = await runFile("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy", "Bypass",
    "-File", scriptPath,
    "-TemplatePath", templatePath,
    "-CopyName", copyName
  ]);
  return JSON.parse(stdout || "{}");
}

async function openOnMac(templatePath, copyName) {
  const copyPath = copyTemplate(templatePath, copyName);
  const escapedPath = copyPath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const appleScript = [
    'tell application id "com.adobe.Photoshop"',
    'open POSIX file "' + escapedPath + '"',
    "end tell"
  ].join("\n");
  await runFile("osascript", ["-e", appleScript]);
  return {
    ok: true,
    copyPath,
    documentName: path.basename(copyPath)
  };
}

async function main() {
  try {
    const args = parseArgs(process.argv);
    const templatePath = args.TemplatePath;
    const copyName = args.CopyName || "template-copy.psd";

    if (!templatePath) {
      throw new Error("TemplatePath is required.");
    }

    let result;
    if (process.platform === "win32") {
      result = await openOnWindows(templatePath, copyName);
    } else if (process.platform === "darwin") {
      result = await openOnMac(templatePath, copyName);
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
