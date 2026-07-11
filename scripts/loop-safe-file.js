"use strict";

const fs = require("node:fs");

function failed(kind, suffix, reason) {
  return {
    ok: false,
    status: "failed-contract",
    code: `${kind}-${suffix}`,
    reason,
  };
}

function readBoundedRegularFile(filePath, maxBytes, kind, options = {}) {
  let fd;
  try {
    const before = fs.lstatSync(filePath);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      (options.requirePrivate !== false && (before.mode & 0o077) !== 0)
    ) {
      return failed(kind, "unsafe-path", `${kind} path is not a restrictive regular file`);
    }
    fd = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const stat = fs.fstatSync(fd);
    if (
      !stat.isFile() ||
      stat.dev !== before.dev ||
      stat.ino !== before.ino ||
      (options.requirePrivate !== false && (stat.mode & 0o077) !== 0)
    ) {
      return failed(kind, "unsafe-path", `${kind} changed during inspection or is unsafe`);
    }
    if (stat.size > maxBytes) {
      return failed(kind, "too-large", `${kind} exceeds ${maxBytes} bytes`);
    }
    if (options.readContent === false) return { ok: true, bytes: stat.size };
    const buffer = Buffer.allocUnsafe(maxBytes + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const bytesRead = fs.readSync(fd, buffer, offset, buffer.length - offset, null);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > maxBytes) {
      return failed(kind, "too-large", `${kind} exceeds ${maxBytes} bytes`);
    }
    const after = fs.fstatSync(fd);
    if (after.dev !== stat.dev || after.ino !== stat.ino || after.size !== offset) {
      return failed(kind, "unsafe-path", `${kind} changed while it was being read`);
    }
    return { ok: true, content: buffer.subarray(0, offset) };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return failed(kind, "missing", `${kind} file is missing`);
    }
    if (error && error.code === "ELOOP") {
      return failed(kind, "unsafe-path", `${kind} is a symlink`);
    }
    return failed(kind, "unreadable", `${kind} could not be read: ${error.message}`);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

module.exports = { readBoundedRegularFile };
