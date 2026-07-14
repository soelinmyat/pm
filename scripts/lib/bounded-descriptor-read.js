"use strict";

const fs = require("node:fs");

function readDescriptorBounded(descriptor, maxBytes, options = {}) {
  const chunks = [];
  let total = 0;
  while (true) {
    const remaining = maxBytes - total;
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, remaining + 1));
    const count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
    if (count === 0) break;
    total += count;
    if (total > maxBytes)
      throw new Error(options.overflowMessage || `input exceeds ${maxBytes}-byte budget`);
    chunks.push(buffer.subarray(0, count));
  }
  return Buffer.concat(chunks, total);
}

module.exports = { readDescriptorBounded };
