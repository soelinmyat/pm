"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { readDescriptorBounded } = require("./bounded-descriptor-read");

function readBoundedFile(filePath, maxBytes = 4 * 1024 * 1024) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
    throw new Error("input byte budget must be a non-negative safe integer");
  const resolved = path.resolve(filePath);
  const flags =
    fs.constants.O_RDONLY |
    (fs.constants.O_NOFOLLOW || 0) |
    (fs.constants.O_NONBLOCK || 0) |
    (fs.constants.O_NOCTTY || 0);
  let descriptor;
  try {
    const initial = fs.lstatSync(resolved, { bigint: true });
    if (!initial.isFile() || initial.size > BigInt(maxBytes)) {
      throw new Error("input must be a bounded regular file");
    }
    descriptor = fs.openSync(resolved, flags);
    const before = fs.fstatSync(descriptor, { bigint: true });
    if (!before.isFile() || before.size > BigInt(maxBytes) || !sameFileMetadata(initial, before)) {
      throw new Error("input must be a bounded regular file");
    }
    const bytes = readDescriptorBounded(descriptor, maxBytes, {
      overflowMessage: "input must be a bounded regular file",
    });
    const after = fs.fstatSync(descriptor, { bigint: true });
    if (!sameFileMetadata(before, after)) {
      throw new Error("input changed during bounded read");
    }
    const final = fs.lstatSync(resolved, { bigint: true });
    if (!final.isFile() || !sameFileMetadata(after, final)) {
      throw new Error("input path changed during bounded read");
    }
    return bytes;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function readBoundedJsonFile(filePath, maxBytes = 4 * 1024 * 1024) {
  return JSON.parse(readBoundedFile(filePath, maxBytes).toString("utf8"));
}

function sameFileMetadata(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

module.exports = { readBoundedFile, readBoundedJsonFile };
