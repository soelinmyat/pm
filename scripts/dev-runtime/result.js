const { writeJsonAtomic: writeAtomicJson } = require("../lib/atomic-file");
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

function validateWorkerResult(input, options = {}) {
  const result = parseJson(input, "worker result");
  if (Array.isArray(result)) throw new Error("worker result must be an object");
  if (result.status === "merged") {
    if (!options.allowLegacyMerged) {
      throw new Error("merged worker result is allowed only in legacy compatibility mode");
    }
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
  return validateWorkUnitResult(result, {
    expectedWorkUnitId: options.expectedWorkUnitId,
    expectedOwnership: options.expectedOwnership,
    worktree: options.worktree,
  });
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function writeJsonAtomic(filePath, value) {
  writeAtomicJson(filePath, value, { directoryMode: 0o700, fileMode: 0o600 });
}

module.exports = { parseJson, validateWorkerResult, writeJsonAtomic };
