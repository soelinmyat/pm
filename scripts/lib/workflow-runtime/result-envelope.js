"use strict";

const { isObject } = require("./records");

const EVIDENCE_FIELDS = new Set(["kind", "command", "exit_code", "artifact"]);
const RUNTIME_FIELDS = new Set(["provider", "model", "reasoning", "session_id"]);

function evidenceRecordIssues(record, index, basePath = "$.evidence") {
  const errors = [];
  const recordPath = `${basePath}[${index}]`;
  if (!isObject(record)) return [issue(recordPath, "must be an object")];
  exactFieldIssues(record, EVIDENCE_FIELDS, recordPath, errors);
  for (const field of EVIDENCE_FIELDS) requiredFieldIssue(record, field, recordPath, errors);
  if (typeof record.kind !== "string" || record.kind.trim().length === 0) {
    errors.push(issue(`${recordPath}.kind`, "required"));
  }
  if (record.command !== null && typeof record.command !== "string") {
    errors.push(issue(`${recordPath}.command`, "must be null or a string"));
  }
  if (!Number.isInteger(record.exit_code)) {
    errors.push(issue(`${recordPath}.exit_code`, "must be integer"));
  }
  if (record.artifact !== null && typeof record.artifact !== "string") {
    errors.push(issue(`${recordPath}.artifact`, "must be null or a string"));
  }
  return errors;
}

function runtimeRecordIssues(runtime, runtimePath = "$.runtime", options = {}) {
  const errors = [];
  if (!isObject(runtime)) return [issue(runtimePath, "must be an object")];
  exactFieldIssues(runtime, RUNTIME_FIELDS, runtimePath, errors);
  for (const field of ["provider", "model", "reasoning"]) {
    requiredFieldIssue(runtime, field, runtimePath, errors);
    if (typeof runtime[field] !== "string" || runtime[field].trim().length === 0) {
      errors.push(issue(`${runtimePath}.${field}`, "must be a non-empty string"));
    }
  }
  if (options.requireSessionId) requiredFieldIssue(runtime, "session_id", runtimePath, errors);
  if (
    runtime.session_id !== undefined &&
    runtime.session_id !== null &&
    (typeof runtime.session_id !== "string" || runtime.session_id.trim().length === 0)
  ) {
    errors.push(issue(`${runtimePath}.session_id`, "must be null or a non-empty string"));
  }
  return errors;
}

function exactFieldIssues(value, allowed, objectPath, errors = []) {
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) errors.push(issue(`${objectPath}.${field}`, "unknown field"));
  }
  return errors;
}

function requiredFieldIssue(value, field, objectPath, errors = []) {
  if (!Object.prototype.hasOwnProperty.call(value, field)) {
    errors.push(issue(`${objectPath}.${field}`, "required field is missing"));
  }
  return errors;
}

function issue(path, message) {
  return { path, message };
}

module.exports = {
  EVIDENCE_FIELDS,
  RUNTIME_FIELDS,
  evidenceRecordIssues,
  exactFieldIssues,
  requiredFieldIssue,
  runtimeRecordIssues,
};
