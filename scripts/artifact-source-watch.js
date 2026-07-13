#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const [sourcePath, readyPath, driftPath] = process.argv.slice(2);
if (!sourcePath || !readyPath || !driftPath) process.exit(2);

const sourceDir = path.dirname(sourcePath);
const sourceName = path.basename(sourcePath);
let drifted = false;

function markDrift(reason) {
  if (drifted) return;
  drifted = true;
  try {
    fs.writeFileSync(driftPath, `${reason}\n`, { mode: 0o600, flag: "wx" });
  } catch {
    // The parent treats a missing/dead watcher as failure too.
  }
}

const directoryWatcher = fs.watch(sourceDir, { persistent: true }, (event, filename) => {
  if (filename && String(filename) === sourceName) markDrift(`source ${event}`);
});
const fileWatcher = fs.watch(sourcePath, { persistent: true }, (event) =>
  markDrift(`source-file ${event}`)
);
directoryWatcher.on("error", (error) => markDrift(`directory watcher error: ${error.message}`));
fileWatcher.on("error", (error) => markDrift(`file watcher error: ${error.message}`));
fs.writeFileSync(readyPath, `${process.pid}\n`, { mode: 0o600, flag: "wx" });

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    directoryWatcher.close();
    fileWatcher.close();
    process.exit(0);
  });
}
