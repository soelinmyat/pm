"use strict";

const fs = require("node:fs");
const path = require("node:path");

const MiB = 1024 * 1024;
const fileLimit = 64 * MiB;
const archiveLimit = 256 * MiB;
const derivedOutputs = new Set([
  "Build",
  "Index.noindex",
  "ModuleCache.noindex",
  "CompilationCache.noindex",
  "SDKStatCaches.noindex",
]);

// Read metadata only. A symlink in historical evidence can point outside the session.
function inspectSessionStorage(root) {
  const report = { bytes: 0, files: 0, oversized: false, generated: [], largest: [] };
  const directories = [""];
  while (directories.length) {
    const directory = directories.pop();
    const inDerivedData =
      path.basename(directory) === "DerivedData" ||
      path.basename(path.dirname(directory)) === "DerivedData";
    const entries = fs.readdirSync(path.join(root, directory), { withFileTypes: true });
    const cluster =
      entries.some((e) => e.isFile() && e.name === "PG_VERSION") &&
      entries.some((e) => e.isDirectory() && e.name === "base") &&
      entries.some((e) => e.isDirectory() && e.name === "global");
    if (cluster && report.generated.length < 10) report.generated.push(directory || ".");
    for (const entry of entries) {
      const relative = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (
          report.generated.length < 10 &&
          (entry.name === "node_modules" || (inDerivedData && derivedOutputs.has(entry.name)))
        ) {
          report.generated.push(relative);
        }
        directories.push(relative);
      } else if (entry.isFile()) {
        const size = fs.lstatSync(path.join(root, relative)).size;
        report.bytes += size;
        report.files++;
        if (size >= fileLimit) report.oversized = true;
        if (report.largest.length < 5 || size > report.largest.at(-1).bytes) {
          report.largest.push({ path: relative, bytes: size });
          report.largest.sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path));
          report.largest.length = Math.min(5, report.largest.length);
        }
      }
    }
  }
  report.oversized ||= report.bytes >= archiveLimit;
  return report;
}

module.exports = { inspectSessionStorage };
