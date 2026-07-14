"use strict";

const { writeJsonAtomic } = require("../atomic-file");

function parseStructuredResult(value, label = "result") {
  if (value && typeof value === "object" && !Buffer.isBuffer(value)) return value;
  if (typeof value !== "string" || value.trim() === "") throw new Error(`missing ${label}`);
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`malformed ${label}: ${error.message}`);
  }
}

function writeStructuredResult(filePath, value) {
  writeJsonAtomic(filePath, value, { directoryMode: 0o700, fileMode: 0o600 });
}

module.exports = { parseStructuredResult, writeStructuredResult };
