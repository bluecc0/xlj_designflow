#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const MANIFEST_PATH = path.join(ROOT, "CSXS", "manifest.xml");
const INCLUDE_PATHS = [
  "assets",
  "client",
  "CSXS",
  "host",
  "scripts",
  "README.md"
];
const EXCLUDE_NAMES = new Set([
  ".debug",
  "test",
  "node_modules"
]);

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

function readManifestInfo() {
  const xml = fs.readFileSync(MANIFEST_PATH, "utf8");
  const versionMatch = xml.match(/ExtensionBundleVersion="([^"]+)"/);
  const bundleMatch = xml.match(/ExtensionBundleId="([^"]+)"/);
  if (!versionMatch || !bundleMatch) {
    throw new Error("Unable to parse manifest version or bundle id.");
  }
  return {
    version: versionMatch[1],
    bundleId: bundleMatch[1]
  };
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyRecursive(sourcePath, targetPath) {
  const stat = fs.statSync(sourcePath);
  if (stat.isDirectory()) {
    ensureDir(targetPath);
    for (const entry of fs.readdirSync(sourcePath)) {
      if (EXCLUDE_NAMES.has(entry)) {
        continue;
      }
      copyRecursive(path.join(sourcePath, entry), path.join(targetPath, entry));
    }
    return;
  }
  ensureDir(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath);
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

async function createZip(sourceDir, zipPath) {
  if (process.platform === "win32") {
    await runFile("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy", "Bypass",
      "-Command",
      `Compress-Archive -Path ${JSON.stringify(path.join(sourceDir, "*"))} -DestinationPath ${JSON.stringify(zipPath)} -Force`
    ]);
    return;
  }

  if (process.platform === "darwin") {
    await runFile("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", sourceDir, zipPath]);
    return;
  }

  throw new Error("Unsupported platform for package build: " + process.platform);
}

async function main() {
  const args = parseArgs(process.argv);
  let outputDir = args.OutputDir || path.join(ROOT, "dist", "updates");
  if (/^[\\\/]/.test(outputDir) && !/^[A-Za-z]:/.test(outputDir)) {
    outputDir = "\\\\" + outputDir.replace(/^[\\\/]+/, "");
  } else {
    outputDir = path.resolve(outputDir);
  }
  ensureDir(outputDir);

  const manifestInfo = readManifestInfo();
  const packageName = `loom-ai-${manifestInfo.version}.zip`;
  const packagePath = path.join(outputDir, packageName);
  const latestJsonPath = path.join(outputDir, "latest.json");
  const stageRoot = path.join(os.tmpdir(), `loom-build-${Date.now()}`);
  const stageDir = path.join(stageRoot, manifestInfo.bundleId);

  try {
    ensureDir(stageDir);

    for (const relativePath of INCLUDE_PATHS) {
      const sourcePath = path.join(ROOT, relativePath);
      if (!fs.existsSync(sourcePath)) {
        continue;
      }
      copyRecursive(sourcePath, path.join(stageDir, relativePath));
    }

    if (fs.existsSync(packagePath)) {
      fs.unlinkSync(packagePath);
    }
    await createZip(stageDir, packagePath);

    const manifest = {
      version: manifestInfo.version,
      bundleId: manifestInfo.bundleId,
      packageFile: packageName,
      publishedAt: new Date().toISOString()
    };
    fs.writeFileSync(latestJsonPath, JSON.stringify(manifest, null, 2), "utf8");

    process.stdout.write(JSON.stringify({
      ok: true,
      version: manifestInfo.version,
      packagePath,
      latestJsonPath
    }));
  } finally {
    fs.rmSync(stageRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stdout.write(JSON.stringify({ ok: false, error: error.message || String(error) }));
  process.exitCode = 1;
});
