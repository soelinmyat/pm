#!/usr/bin/env node
"use strict";

const path = require("node:path");

const { runLoopControlEffect } = require("./loop-install.js");

function main() {
  const input = JSON.parse(process.argv[2] || "{}");
  const pmDir = path.resolve(input.pmDir || "");
  const pmStateDir = path.resolve(input.pmStateDir || "");
  if (!pmDir || !pmStateDir || typeof input.paused !== "boolean") {
    throw new Error("board toggle worker requires PM paths and an explicit paused state");
  }
  const result = runLoopControlEffect(pmDir, input.paused, {
    pmStateDir,
    authorityActions: ["control_loop"],
    requestKey: input.requestKey || null,
    timeout: input.timeout,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.state === "verified" ? 0 : 2;
}

try {
  main();
} catch (error) {
  process.stderr.write(`board-toggle-worker: ${error.message}\n`);
  process.exitCode = 1;
}
