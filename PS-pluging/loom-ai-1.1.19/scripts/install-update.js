#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");
const http = require("http");
const https = require("https");

function parseArgs(argv) {
  const result = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("-")) {
      continue;
    }
    result[token.slice(1)] = argv[i + 1];
    i += 1;
  }
  return result;
}

function runFile(command, args) {
  return new Promise((resolve, reject) => {
    cp.execFile(command, args, { windowsHide: true, timeout: 180000, maxBuffer: 30 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || stdout || error.message));
        return;
      }
      resolve(String(stdout || "").trim());
    });
  });
}

function compareVersions(a, b) {
  const left = String(a || "0").split(".").map((v) => parseInt(v, 10) || 0);
  const right = String(b || "0").split(".").map((v) => parseInt(v, 10) || 0);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

function readManifestVersion(extensionRoot) {
  const manifestPath = path.join(extensionRoot, "CSXS", "manifest.xml");
  const xml = fs.readFileSync(manifestPath, "utf8");
  const match = xml.match(/ExtensionBundleVersion="([^"]+)"/);
  if (!match) {
    throw new Error("Unable to parse local manifest version.");
  }
  return match[1];
}

function readJsonFromFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function fetchJson(urlString) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlString);
    const transport = parsed.protocol === "https:" ? https : http;
    const request = transport.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || undefined,
      path: parsed.pathname + parsed.search,
      method: "GET"
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        if ((response.statusCode || 0) < 200 || (response.statusCode || 0) >= 300) {
          reject(new Error("HTTP " + response.statusCode));
          return;
        }
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      });
    });
    request.on("error", reject);
    request.end();
  });
}

async function loadUpdateManifest(manifestPathOrUrl) {
  if (/^https?:\/\//i.test(manifestPathOrUrl)) {
    return {
      manifest: await fetchJson(manifestPathOrUrl),
      basePath: manifestPathOrUrl.replace(/\/[^/]*$/, "/")
    };
  }

  return {
    manifest: readJsonFromFile(manifestPathOrUrl),
    basePath: path.dirname(manifestPathOrUrl)
  };
}

async function copyOrDownloadPackage(packageSource, destinationPath) {
  if (/^https?:\/\//i.test(packageSource)) {
    const parsed = new URL(packageSource);
    const transport = parsed.protocol === "https:" ? https : http;
    await new Promise((resolve, reject) => {
      const request = transport.request({
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        path: parsed.pathname + parsed.search,
        method: "GET"
      }, (response) => {
        if ((response.statusCode || 0) < 200 || (response.statusCode || 0) >= 300) {
          reject(new Error("HTTP " + response.statusCode));
          return;
        }
        const file = fs.createWriteStream(destinationPath);
        response.pipe(file);
        file.on("finish", () => file.close(resolve));
        file.on("error", reject);
      });
      request.on("error", reject);
      request.end();
    });
    return;
  }

  fs.copyFileSync(packageSource, destinationPath);
}

async function extractZip(zipPath, outputDir) {
  if (process.platform === "win32") {
    await runFile("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy", "Bypass",
      "-Command",
      `Expand-Archive -LiteralPath ${JSON.stringify(zipPath)} -DestinationPath ${JSON.stringify(outputDir)} -Force`
    ]);
    return;
  }

  if (process.platform === "darwin") {
    await runFile("unzip", ["-o", zipPath, "-d", outputDir]);
    return;
  }

  throw new Error("Unsupported platform for update install: " + process.platform);
}

function copyRecursive(sourcePath, targetPath) {
  const stat = fs.statSync(sourcePath);
  if (stat.isDirectory()) {
    fs.mkdirSync(targetPath, { recursive: true });
    for (const entry of fs.readdirSync(sourcePath)) {
      copyRecursive(path.join(sourcePath, entry), path.join(targetPath, entry));
    }
    return;
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}

async function main() {
  const args = parseArgs(process.argv);
  const manifestPath = args.ManifestPath;
  const extensionRoot = path.resolve(args.ExtensionRoot);
  if (!manifestPath || !extensionRoot) {
    throw new Error("ManifestPath and ExtensionRoot are required.");
  }

  const currentVersion = readManifestVersion(extensionRoot);
  const { manifest, basePath } = await loadUpdateManifest(manifestPath);
  const latestVersion = manifest.version;

  if (compareVersions(latestVersion, currentVersion) <= 0) {
    process.stdout.write(JSON.stringify({
      ok: true,
      updated: false,
      currentVersion,
      latestVersion
    }));
    return;
  }

  const packageSource = /^https?:\/\//i.test(basePath)
    ? new URL(manifest.packageFile, basePath).toString()
    : path.join(basePath, manifest.packageFile);
  const tempRoot = path.join(os.tmpdir(), "loom-update-" + Date.now());
  const zipPath = path.join(tempRoot, manifest.packageFile);
  const extractDir = path.join(tempRoot, "extract");

  try {
    fs.mkdirSync(tempRoot, { recursive: true });
    await copyOrDownloadPackage(packageSource, zipPath);
    await extractZip(zipPath, extractDir);

    const bundleRoot = path.join(extractDir, manifest.bundleId || path.basename(extensionRoot));
    const sourceRoot = fs.existsSync(bundleRoot) ? bundleRoot : extractDir;
    copyRecursive(sourceRoot, extensionRoot);

    process.stdout.write(JSON.stringify({
      ok: true,
      updated: true,
      currentVersion,
      latestVersion,
      reloadRequired: true
    }));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stdout.write(JSON.stringify({ ok: false, error: error.message || String(error) }));
  process.exitCode = 1;
});
