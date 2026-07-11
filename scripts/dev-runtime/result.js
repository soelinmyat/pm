const fs = require("node:fs");
const path = require("node:path");
const { validateWorkUnitResult } = require("../lib/dev-work-units");

function parseJson(value, label = "result") {
  if (value && typeof value === "object" && !Buffer.isBuffer(value)) return value;
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`missing ${label}`);
  }
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`malformed ${label}: ${error.message}`);
  }
}

function validateWorkerResult(input) {
  const result = parseJson(input, "worker result");
  if (Array.isArray(result)) throw new Error("worker result must be an object");
  if (result.status === "merged") {
    if (!nonEmpty(result.issue_id))
      throw new Error("legacy merged worker result requires issue_id");
    if (!Number.isInteger(result.pr) || result.pr < 1)
      throw new Error("legacy merged worker result requires positive integer pr");
    if (!nonEmpty(result.merge_sha))
      throw new Error("legacy merged worker result requires merge_sha");
    if (!Number.isInteger(result.files_changed) || result.files_changed < 0)
      throw new Error("legacy merged worker result requires non-negative integer files_changed");
    return result;
  }
  return validateWorkUnitResult(result);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

module.exports = { parseJson, validateWorkerResult, writeJsonAtomic };
