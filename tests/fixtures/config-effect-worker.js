"use strict";

const fs = require("node:fs");

const { applyConfigEffect } = require("../../scripts/config-effect.js");

const [projectDir, field, value, markerPath, releasePath] = process.argv.slice(2);
const pause = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);

const result = applyConfigEffect({
  projectDir,
  field,
  value,
  authorityActions: ["update_config"],
  beforeMutate() {
    fs.writeFileSync(markerPath, field);
    while (!fs.existsSync(releasePath)) pause();
  },
});

process.stdout.write(`${JSON.stringify(result)}\n`);
