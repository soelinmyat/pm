"use strict";

const { readBoundedJsonFile } = require("../lib/safe-json-file.js");

const CAPABILITY_JSON_LIMITS = Object.freeze({
  oracle: 1024 * 1024,
  capture: 8 * 1024 * 1024,
  judgments: 4 * 1024 * 1024,
  report: 8 * 1024 * 1024,
  "runtime-profile": 256 * 1024,
  "scenario-identity": 256 * 1024,
  "candidate-findings": 2 * 1024 * 1024,
  "oracle-isolation": 1024 * 1024,
  command: 256 * 1024,
});

function readCapabilityJson(filePath, kind) {
  const maxBytes = CAPABILITY_JSON_LIMITS[kind];
  if (!maxBytes) throw new Error(`unknown capability JSON input kind: ${kind}`);
  try {
    return readBoundedJsonFile(filePath, maxBytes);
  } catch (error) {
    throw new Error(`${kind} JSON input exceeds its safe boundary or is invalid: ${error.message}`);
  }
}

function encodeCapabilityJson(value, kind) {
  const maxBytes = CAPABILITY_JSON_LIMITS[kind];
  if (!maxBytes) throw new Error(`unknown capability JSON output kind: ${kind}`);
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  if (bytes.length > maxBytes) {
    throw new Error(`${kind} JSON output exceeds its ${maxBytes}-byte safe boundary`);
  }
  return bytes;
}

module.exports = { CAPABILITY_JSON_LIMITS, encodeCapabilityJson, readCapabilityJson };
