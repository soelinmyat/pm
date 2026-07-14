"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { readDescriptorBounded } = require("./bounded-descriptor-read");

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
    return JSON.parse(
      readDescriptorBounded(descriptor, maxBytes, {
        overflowMessage: "input must be a bounded regular JSON file",
      }).toString("utf8")
    );
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

module.exports = { readBoundedJsonFile };
