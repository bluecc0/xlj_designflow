#!/usr/bin/env node
"use strict";

const path = require("path");
const cp = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT_DIR = "\\\\192.168.152.52\\素材库\\工具\\loom";

function runNodeScript(scriptName, args = []) {
  return new Promise((resolve, reject) => {
    cp.execFile(
      process.execPath,
      [path.join(ROOT, "scripts", scriptName)].concat(args),
      {
        windowsHide: false,
        timeout: 120000,
        maxBuffer: 20 * 1024 * 1024
      },
      (error, stdout, stderr) => {
        if (stderr) {
          process.stderr.write(String(stderr).trim() + "\n");
        }

        const output = String(stdout || "").trim();
        if (error) {
          reject(new Error(output || error.message));
          return;
        }

        try {
          resolve(JSON.parse(output || "{}"));
        } catch (_parseError) {
          reject(new Error(output || "Script returned non-JSON output."));
        }
      }
    );
  });
}

(async function main() {
  const bumped = await runNodeScript("bump-version.js");
  if (!bumped.ok) {
    throw new Error(bumped.error || "Version bump failed.");
  }

  process.stdout.write("Version bumped: " + bumped.previousVersion + " -> " + bumped.version + "\n");

  const published = await runNodeScript("build-update-package.js", ["-OutputDir", OUTPUT_DIR]);
  if (!published.ok) {
    throw new Error(published.error || "Package build failed.");
  }

  process.stdout.write("Published: " + published.packagePath + "\n");
  process.stdout.write("Manifest: " + published.latestJsonPath + "\n");
})().catch((error) => {
  process.stderr.write((error.message || String(error)) + "\n");
  process.exit(1);
});
