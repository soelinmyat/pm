#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const { readProjectInput, writeProjectJsonAtomic } = require("./lib/project-file");

const MAX_RAW_AUDIT_BYTES = 1024 * 1024;
const MAX_CAPTURE_IDS = 40;
const MAX_LANDMARKS = 100;
const MAX_CONTROLS = 1000;
const MAX_ISSUES_PER_KIND = 200;
const MAX_LOCATOR_CHARS = 500;
const MAX_DETAIL_CHARS = 1000;
const AUDIT_KINDS = new Set(["accessibility-tree", "dom-audit"]);
const DOM_ISSUE_KINDS = Object.freeze(["hierarchy", "edge_alignment", "consistency", "asymmetry"]);

function normalizeAuditBytes(bytes, rawBinding) {
  const input = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (input.length > MAX_RAW_AUDIT_BYTES)
    throw new Error(`raw audit exceeds ${MAX_RAW_AUDIT_BYTES}-byte budget`);
  validateRawBinding(rawBinding);
  const observedSha256 = digest(input);
  if (rawBinding.sha256 !== observedSha256)
    throw new Error("raw audit SHA-256 does not match input bytes");
  let raw;
  try {
    raw = JSON.parse(input.toString("utf8"));
  } catch (error) {
    throw new Error(`raw audit is invalid JSON: ${error.message}`);
  }
  return normalizeRawAudit(raw, rawBinding);
}

function normalizeRawAudit(raw, rawBinding) {
  validateRawBinding(rawBinding);
  exactObject(
    raw,
    ["schema_version", "kind", "subject_id", "commit", "capture_ids", "observations"],
    "raw audit"
  );
  if (raw.schema_version !== 1) throw new Error("raw audit schema_version must equal 1");
  if (!AUDIT_KINDS.has(raw.kind))
    throw new Error("raw audit kind must be accessibility-tree or dom-audit");
  if (!slug(raw.subject_id)) throw new Error("raw audit subject_id must be kebab-case");
  if (!sha(raw.commit)) throw new Error("raw audit commit must be a SHA-1 or SHA-256 commit");
  validateCaptureIds(raw.capture_ids);

  const normalized =
    raw.kind === "accessibility-tree"
      ? normalizeAccessibility(raw.observations)
      : normalizeDom(raw.observations);
  return {
    schema_version: 2,
    subject_id: raw.subject_id,
    commit: raw.commit,
    capture_ids: [...raw.capture_ids],
    raw: { path: rawBinding.path, sha256: rawBinding.sha256 },
    checks: normalized.checks,
    findings: normalized.findings.sort(compareFindings),
  };
}

function normalizeAccessibility(observations) {
  exactObject(observations, ["landmarks", "controls"], "raw accessibility observations");
  boundedArray(observations.landmarks, MAX_LANDMARKS, "raw accessibility landmarks");
  boundedArray(observations.controls, MAX_CONTROLS, "raw accessibility controls");

  const landmarks = observations.landmarks.map((item, index) => {
    const label = `raw accessibility landmarks[${index}]`;
    exactObject(item, ["role", "name", "locator"], label);
    role(item.role, `${label}.role`);
    boundedString(item.name, MAX_DETAIL_CHARS, `${label}.name`, true);
    boundedString(item.locator, MAX_LOCATOR_CHARS, `${label}.locator`);
    return item;
  });
  const controls = observations.controls.map((item, index) => {
    const label = `raw accessibility controls[${index}]`;
    exactObject(
      item,
      ["role", "name", "locator", "disabled", "tab_index", "document_index"],
      label
    );
    role(item.role, `${label}.role`);
    boundedString(item.name, MAX_DETAIL_CHARS, `${label}.name`, true);
    boundedString(item.locator, MAX_LOCATOR_CHARS, `${label}.locator`);
    if (typeof item.disabled !== "boolean") throw new Error(`${label}.disabled must be boolean`);
    if (!Number.isInteger(item.tab_index) || item.tab_index < -1 || item.tab_index > 32767)
      throw new Error(`${label}.tab_index must be an integer from -1 through 32767`);
    if (!Number.isInteger(item.document_index) || item.document_index < 0)
      throw new Error(`${label}.document_index must be a non-negative integer`);
    return item;
  });
  const indexes = new Set();
  for (const item of controls) {
    if (indexes.has(item.document_index))
      throw new Error("raw accessibility control document_index values must be unique");
    indexes.add(item.document_index);
  }

  const findings = [];
  const mainLandmarks = landmarks.filter((item) => item.role === "main");
  if (mainLandmarks.length !== 1)
    findings.push({
      check: "landmarks",
      code: mainLandmarks.length === 0 ? "missing-main-landmark" : "multiple-main-landmarks",
      locator: "document",
      detail: `Expected exactly one main landmark; observed ${mainLandmarks.length}.`,
    });
  const byRole = new Map();
  for (const item of landmarks) {
    if (!byRole.has(item.role)) byRole.set(item.role, []);
    byRole.get(item.role).push(item);
  }
  for (const [landmarkRole, items] of byRole) {
    if (items.length < 2) continue;
    const names = new Map();
    for (const item of items) {
      const name = item.name.trim().replace(/\s+/g, " ").toLowerCase();
      if (!name) {
        findings.push({
          check: "landmarks",
          code: "unnamed-duplicate-landmark",
          locator: item.locator,
          detail: `Repeated ${landmarkRole} landmarks require distinct accessible names.`,
        });
        continue;
      }
      const matches = names.get(name) || [];
      matches.push(item);
      names.set(name, matches);
    }
    for (const duplicates of names.values())
      if (duplicates.length > 1)
        for (const item of duplicates)
          findings.push({
            check: "landmarks",
            code: "duplicate-landmark-name",
            locator: item.locator,
            detail: `Repeated ${landmarkRole} landmarks use the same accessible name.`,
          });
  }
  for (const item of controls.filter((candidate) => candidate.name.trim() === ""))
    findings.push({
      check: "names",
      code: "missing-accessible-name",
      locator: item.locator,
      detail: `${item.role} has no accessible name.`,
    });

  const enabled = controls
    .filter((item) => !item.disabled)
    .sort((left, right) => left.document_index - right.document_index);
  for (const item of enabled) {
    if (item.tab_index < 0)
      findings.push({
        check: "focus_order",
        code: "not-keyboard-reachable",
        locator: item.locator,
        detail: `${item.role} has tab index ${item.tab_index}.`,
      });
    else if (item.tab_index > 0)
      findings.push({
        check: "focus_order",
        code: "positive-tab-index",
        locator: item.locator,
        detail: `${item.role} uses positive tab index ${item.tab_index} instead of DOM order.`,
      });
  }
  return {
    checks: {
      landmarks: !findings.some((item) => item.check === "landmarks"),
      names: !findings.some((item) => item.check === "names"),
      focus_order: !findings.some((item) => item.check === "focus_order"),
    },
    findings,
  };
}

function normalizeDom(observations) {
  exactObject(observations, ["viewport", ...DOM_ISSUE_KINDS], "raw DOM observations");
  exactObject(
    observations.viewport,
    ["inner_width", "client_width", "scroll_width"],
    "raw DOM viewport"
  );
  for (const field of ["inner_width", "client_width", "scroll_width"])
    if (!positiveInt(observations.viewport[field]))
      throw new Error(`raw DOM viewport.${field} must be a positive integer`);
  if (observations.viewport.client_width > observations.viewport.inner_width)
    throw new Error("raw DOM viewport client_width cannot exceed inner_width");
  if (observations.viewport.scroll_width < observations.viewport.client_width)
    throw new Error("raw DOM viewport scroll_width cannot be smaller than client_width");

  const findings = [];
  for (const issueKind of DOM_ISSUE_KINDS) {
    boundedArray(observations[issueKind], MAX_ISSUES_PER_KIND, `raw DOM ${issueKind} issues`);
    for (const [index, item] of observations[issueKind].entries()) {
      const label = `raw DOM ${issueKind} issues[${index}]`;
      exactObject(item, ["code", "locator", "detail"], label);
      if (!slug(item.code)) throw new Error(`${label}.code must be kebab-case`);
      boundedString(item.locator, MAX_LOCATOR_CHARS, `${label}.locator`);
      boundedString(item.detail, MAX_DETAIL_CHARS, `${label}.detail`);
      findings.push({ check: issueKind, ...item });
    }
  }
  if (observations.viewport.scroll_width > observations.viewport.client_width)
    findings.push({
      check: "overflow",
      code: "horizontal-overflow",
      locator: "document.documentElement",
      detail: `scroll width ${observations.viewport.scroll_width}px exceeds client width ${observations.viewport.client_width}px.`,
    });

  return {
    checks: {
      overflow: !findings.some((item) => item.check === "overflow"),
      edge_alignment: !findings.some((item) => item.check === "edge_alignment"),
      hierarchy: !findings.some((item) => item.check === "hierarchy"),
      consistency: !findings.some((item) => item.check === "consistency"),
      asymmetry: !findings.some((item) => item.check === "asymmetry"),
    },
    findings,
  };
}

function validateRawBinding(binding) {
  exactObject(binding, ["path", "sha256"], "raw binding");
  if (
    typeof binding.path !== "string" ||
    binding.path.length === 0 ||
    path.isAbsolute(binding.path) ||
    binding.path.split(/[\\/]+/).some((part) => !part || part === "." || part === "..")
  )
    throw new Error("raw binding path must be project-relative without traversal");
  if (!/^[a-f0-9]{64}$/.test(binding.sha256 || ""))
    throw new Error("raw binding sha256 must be lowercase SHA-256");
}

function validateCaptureIds(captureIds) {
  boundedArray(captureIds, MAX_CAPTURE_IDS, "raw audit capture_ids", 1);
  const seen = new Set();
  for (const [index, value] of captureIds.entries()) {
    if (!slug(value)) throw new Error(`raw audit capture_ids[${index}] must be kebab-case`);
    if (seen.has(value)) throw new Error("raw audit capture_ids must be unique");
    seen.add(value);
  }
}

function exactObject(value, fields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  const allowed = new Set(fields);
  const unknown = Object.keys(value).find((field) => !allowed.has(field));
  const missing = fields.find((field) => !Object.prototype.hasOwnProperty.call(value, field));
  if (unknown) throw new Error(`${label}.${unknown} is an unknown field`);
  if (missing) throw new Error(`${label}.${missing} is required`);
}

function boundedArray(value, maxItems, label, minItems = 0) {
  if (!Array.isArray(value) || value.length < minItems || value.length > maxItems)
    throw new Error(`${label} must contain ${minItems} through ${maxItems} items`);
}

function boundedString(value, maxChars, label, allowEmpty = false) {
  if (
    typeof value !== "string" ||
    (!allowEmpty && value.trim().length === 0) ||
    value.length > maxChars
  )
    throw new Error(
      `${label} must be ${allowEmpty ? "at most" : "1 through"} ${maxChars} characters`
    );
}

function role(value, label) {
  if (typeof value !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(value))
    throw new Error(`${label} must be a lowercase accessibility role`);
}

function compareFindings(left, right) {
  return (
    left.code.localeCompare(right.code) ||
    left.locator.localeCompare(right.locator) ||
    left.detail.localeCompare(right.detail)
  );
}

function slug(value) {
  return typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function sha(value) {
  return typeof value === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
}

function positiveInt(value) {
  return Number.isInteger(value) && value > 0;
}

function digest(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = { "--root": "root", "--raw": "rawPath", "--output": "outputPath" }[argv[index]];
    if (!key) throw new Error(`unknown argument ${argv[index]}`);
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`${argv[index - 1]} requires a value`);
    options[key] = value;
  }
  options.root ||= process.cwd();
  for (const key of ["rawPath", "outputPath"])
    if (!options[key]) throw new Error(`missing required ${key}`);
  if (options.rawPath === options.outputPath) throw new Error("raw and output paths must differ");
  return options;
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const rawFile = readProjectInput(options.root, options.rawPath, MAX_RAW_AUDIT_BYTES);
    const rawBinding = { path: rawFile.relative, sha256: digest(rawFile.bytes) };
    const audit = normalizeAuditBytes(rawFile.bytes, rawBinding);
    const outputBytes = Buffer.from(`${JSON.stringify(audit, null, 2)}\n`);
    writeProjectJsonAtomic(options.root, options.outputPath, audit, {
      fileMode: 0o600,
      maxBytes: MAX_RAW_AUDIT_BYTES,
      attestations: [
        {
          path: rawBinding.path,
          sha256: `sha256:${rawBinding.sha256}`,
          maxBytes: MAX_RAW_AUDIT_BYTES,
        },
      ],
    });
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        raw: rawBinding,
        output: { path: options.outputPath, sha256: digest(outputBytes) },
        checks: audit.checks,
      })}\n`
    );
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  MAX_RAW_AUDIT_BYTES,
  normalizeAuditBytes,
  normalizeRawAudit,
};
