#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const MANIFEST_PATH = path.join(ROOT, "CSXS", "manifest.xml");
const INDEX_PATH = path.join(ROOT, "client", "index.html");

function readFile(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function writeFile(filePath, content) {
  fs.writeFileSync(filePath, content, "utf8");
}

function getManifestVersion(xml) {
  const match = xml.match(/ExtensionBundleVersion="([^"]+)"/);
  if (!match) {
    throw new Error("Unable to parse ExtensionBundleVersion from manifest.xml");
  }
  return match[1];
}

function bumpPatchVersion(version) {
  const parts = String(version || "0.0.0").split(".").map((value) => parseInt(value, 10) || 0);
  while (parts.length < 3) {
    parts.push(0);
  }
  parts[2] += 1;
  return parts.slice(0, 3).join(".");
}

function replaceVersionInManifest(xml, nextVersion) {
  let output = xml.replace(/ExtensionBundleVersion="([^"]+)"/, `ExtensionBundleVersion="${nextVersion}"`);
  output = output.replace(/<Extension Id="com\.loom\.ai\.painter\.panel" Version="([^"]+)" \/>/, `<Extension Id="com.loom.ai.painter.panel" Version="${nextVersion}" />`);
  return output;
}

function replaceVersionInIndex(html, nextVersion) {
  return html.replace(/<span class="version-tag">v[^<]+<\/span>/, `<span class="version-tag">v${nextVersion}</span>`);
}

function main() {
  const manifestXml = readFile(MANIFEST_PATH);
  const currentVersion = getManifestVersion(manifestXml);
  const nextVersion = bumpPatchVersion(currentVersion);

  writeFile(MANIFEST_PATH, replaceVersionInManifest(manifestXml, nextVersion));
  writeFile(INDEX_PATH, replaceVersionInIndex(readFile(INDEX_PATH), nextVersion));

  process.stdout.write(JSON.stringify({
    ok: true,
    previousVersion: currentVersion,
    version: nextVersion
  }));
}

try {
  main();
} catch (error) {
  process.stdout.write(JSON.stringify({
    ok: false,
    error: error.message || String(error)
  }));
  process.exitCode = 1;
}
