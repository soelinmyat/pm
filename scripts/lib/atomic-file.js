"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function writeFileAtomic(filePath, content, options = {}) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true, mode: options.directoryMode });
  const temporary = path.join(
    directory,
    `.${path.basename(filePath)}.tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`
  );
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, "wx", options.fileMode ?? 0o666);
    fs.writeFileSync(descriptor, content, options.encoding || "utf8");
    if (options.fsync !== false) fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    if (options.fileMode !== undefined) fs.chmodSync(temporary, options.fileMode);
    fs.renameSync(temporary, filePath);
    if (options.fileMode !== undefined) fs.chmodSync(filePath, options.fileMode);
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

function writeJsonAtomic(filePath, value, options = {}) {
  writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`, options);
}

function writeTextAtomic(filePath, value, options = {}) {
  writeFileAtomic(filePath, String(value), options);
}

module.exports = { writeFileAtomic, writeJsonAtomic, writeTextAtomic };
