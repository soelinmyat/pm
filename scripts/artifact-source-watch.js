#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const [sourcePath, readyPath, driftPath] = process.argv.slice(2);
if (!sourcePath || !readyPath || !driftPath) process.exit(2);

const sourceDir = path.dirname(sourcePath);
const sourceName = path.basename(sourcePath);
let drifted = false;

function sourceIdentity() {
  try {
    const stat = fs.statSync(sourcePath, { bigint: true });
    return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].map(String).join(":");
  } catch (error) {
    return `error:${error.code || error.message}`;
  }
}

const initialIdentity = sourceIdentity();

function markDrift(reason) {
  if (drifted) return;
  drifted = true;
  try {
    fs.writeFileSync(driftPath, `${reason}\n`, { mode: 0o600, flag: "wx" });
  } catch {
    // The parent treats a missing/dead watcher as failure too.
  }
}

const watcher = fs.watch(sourceDir, { persistent: true }, (event, filename) => {
  if (filename && String(filename) === sourceName) markDrift(`source ${event}`);
  else if (!filename && sourceIdentity() !== initialIdentity) markDrift(`source ${event}`);
});
watcher.on("error", (error) => markDrift(`watcher error: ${error.message}`));
fs.writeFileSync(readyPath, `${process.pid}\n`, { mode: 0o600, flag: "wx" });

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    watcher.close();
    process.exit(0);
  });
}
