"use strict";

const fs = require("node:fs");
const path = require("node:path");

function readBoundedJsonFile(filePath, maxBytes = 4 * 1024 * 1024) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
    throw new Error("JSON byte budget must be a non-negative safe integer");
  const resolved = path.resolve(filePath);
  let descriptor;
  try {
    descriptor = fs.openSync(resolved, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size > maxBytes)
      throw new Error("input must be a bounded regular JSON file");
    return JSON.parse(readDescriptorBounded(descriptor, maxBytes).toString("utf8"));
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function readDescriptorBounded(descriptor, maxBytes) {
  const chunks = [];
  let total = 0;
  while (true) {
    const remaining = maxBytes - total;
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, remaining + 1));
    const count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
    if (count === 0) break;
    total += count;
    if (total > maxBytes) throw new Error("input must be a bounded regular JSON file");
    chunks.push(buffer.subarray(0, count));
  }
  return Buffer.concat(chunks, total);
}

module.exports = { readBoundedJsonFile };
