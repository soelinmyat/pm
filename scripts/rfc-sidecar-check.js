#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { issue, requireValue, printResult } = require("./lib/check-cli.js");
const { validateRepoRelativePattern } = require("./lib/dev-work-units");

// The RFC sidecar is the machine-readable twin of the human-render RFC HTML.
// Machine consumers (dev intake, groom re-discovery, rfc review child cards)
// read this JSON instead of grepping HTML anchors. Schema stays in lockstep
// with the .issue-detail cards and Test Strategy blocks the HTML renders, and
// the HTML root carries data-sidecar-hash to bind the two artifacts together.
const SCHEMA_VERSION = 3;
const SUPPORTED_SCHEMA_VERSIONS = new Set([2, SCHEMA_VERSION]);
const VALID_SIZES = new Set(["XS", "S", "M", "L", "XL"]);
const V2_ISSUE_FIELDS = new Set(["num", "title", "size", "test_hooks"]);
const ISSUE_FIELDS = new Set([
  "num",
  "title",
  "size",
  "depends_on",
  "owns",
  "acceptance_criteria",
  "approach",
  "verification_commands",
  "test_hooks",
]);
const ALLOWED_TOP_KEYS = new Set([
  "schema_version",
  "slug",
  "title",
  "size",
  "issues",
  "test_strategy",
]);
const TEST_STRATEGY_FIELDS = [
  "test_levels",
  "new_infrastructure",
  "regression_surface",
  "verification_commands",
  "open_questions",
];
const ALLOWED_TEST_STRATEGY_KEYS = new Set(TEST_STRATEGY_FIELDS);
const DEFAULT_SIDECAR_PATH = "{pm_dir}/backlog/rfcs/{slug}.json";

function validateRfcSidecar(sidecar, sidecarPath = DEFAULT_SIDECAR_PATH, opts = {}) {
  if (!sidecar || typeof sidecar !== "object" || Array.isArray(sidecar)) {
    return { ok: false, issues: [issue(sidecarPath, "RFC sidecar must be an object")] };
  }
  const issues = [];
  if (!SUPPORTED_SCHEMA_VERSIONS.has(sidecar.schema_version)) {
    issues.push(issue(sidecarPath, `schema_version must equal 2 or ${SCHEMA_VERSION}`));
  }
  for (const key of Object.keys(sidecar)) {
    if (!ALLOWED_TOP_KEYS.has(key)) {
      issues.push(issue(sidecarPath, `unknown field ${key}`));
    }
  }
  if (!isNonEmptyString(sidecar.slug)) {
    issues.push(issue(sidecarPath, "slug must be a non-empty string"));
  }
  if (!isNonEmptyString(sidecar.title)) {
    issues.push(issue(sidecarPath, "title must be a non-empty string"));
  }
  if (!isValidSize(sidecar.size)) {
    issues.push(issue(sidecarPath, `size must be one of ${[...VALID_SIZES].join(", ")}`));
  }
  validateIssues(sidecar.issues, sidecarPath, issues, sidecar.schema_version);
  validateTestStrategy(sidecar.test_strategy, sidecarPath, issues);

  if (
    opts.expectedSlug !== undefined &&
    opts.expectedSlug !== null &&
    sidecar.slug !== opts.expectedSlug
  ) {
    issues.push(issue(sidecarPath, `slug must equal ${opts.expectedSlug}`));
  }
  if (opts.htmlPath !== undefined && opts.htmlPath !== null) {
    validateHtmlBinding(opts, issues);
  }
  return { ok: issues.length === 0, issues };
}

function validateIssues(list, sidecarPath, issues, schemaVersion) {
  if (!Array.isArray(list) || list.length === 0) {
    issues.push(issue(sidecarPath, "issues must be a non-empty array"));
    return;
  }
  const seenNums = new Set();
  list.forEach((entry, index) => {
    const where = `${sidecarPath}#issues[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      issues.push(issue(where, "issue must be an object"));
      return;
    }
    const allowedFields = schemaVersion === 2 ? V2_ISSUE_FIELDS : ISSUE_FIELDS;
    for (const key of Object.keys(entry)) {
      if (!allowedFields.has(key)) issues.push(issue(where, `unknown issue field ${key}`));
    }
    if (!Number.isInteger(entry.num) || entry.num <= 0) {
      issues.push(issue(where, "num must be a positive integer"));
    } else if (seenNums.has(entry.num)) {
      issues.push(issue(where, `duplicate issue num ${entry.num}`));
    } else {
      seenNums.add(entry.num);
    }
    // Title lands verbatim in the markdown ## Tasks table, so a pipe would
    // inject a column and any control char (newline, tab, NUL) would corrupt a row.
    if (!isNonEmptyString(entry.title)) {
      issues.push(issue(where, "title must be a non-empty string"));
    } else if (hasUnsafeTitleChar(entry.title)) {
      issues.push(issue(where, "title must not contain '|', newlines, or control characters"));
    }
    if (!isValidSize(entry.size)) {
      issues.push(issue(where, `size must be one of ${[...VALID_SIZES].join(", ")}`));
    }
    if (schemaVersion === SCHEMA_VERSION) {
      validateIntegerList(entry.depends_on, "depends_on", where, issues);
      validateStringList(entry.owns, "owns", where, issues, { nonEmpty: true });
      for (const ownership of Array.isArray(entry.owns) ? entry.owns : []) {
        if (!isNonEmptyString(ownership)) continue;
        try {
          validateRepoRelativePattern(ownership, "owns");
        } catch (error) {
          issues.push(issue(where, error.message));
        }
      }
      validateStringList(entry.acceptance_criteria, "acceptance_criteria", where, issues, {
        nonEmpty: true,
      });
      if (!isNonEmptyString(entry.approach)) {
        issues.push(issue(where, "approach must be a non-empty string"));
      }
      validateStringList(entry.verification_commands, "verification_commands", where, issues, {
        nonEmpty: true,
      });
    }
    if (!Array.isArray(entry.test_hooks)) {
      issues.push(issue(where, "test_hooks must be an array"));
    } else {
      entry.test_hooks.forEach((hook, hookIndex) => {
        if (!isNonEmptyString(hook)) {
          issues.push(issue(where, `test_hooks[${hookIndex}] must be a non-empty string`));
        }
      });
    }
  });
  if (schemaVersion !== SCHEMA_VERSION) return;
  const issueNums = new Set(
    list.filter((entry) => Number.isInteger(entry?.num)).map((entry) => entry.num)
  );
  for (const entry of list) {
    if (!entry || !Array.isArray(entry.depends_on)) continue;
    for (const dependency of entry.depends_on) {
      if (dependency === entry.num) {
        issues.push(issue(sidecarPath, `issue ${entry.num} cannot depend on itself`));
      } else if (!issueNums.has(dependency)) {
        issues.push(issue(sidecarPath, `issue ${entry.num} has unknown dependency ${dependency}`));
      }
    }
  }
  if (hasDependencyCycle(list))
    issues.push(issue(sidecarPath, "issue dependencies contain a cycle"));
}

function validateIntegerList(value, field, where, issues) {
  if (!Array.isArray(value)) {
    issues.push(issue(where, `${field} must be an array`));
    return;
  }
  const seen = new Set();
  value.forEach((item, index) => {
    if (!Number.isInteger(item) || item <= 0) {
      issues.push(issue(where, `${field}[${index}] must be a positive integer`));
    } else if (seen.has(item)) {
      issues.push(issue(where, `${field} must not contain duplicates`));
    }
    seen.add(item);
  });
}

function validateStringList(value, field, where, issues, options = {}) {
  if (!Array.isArray(value) || (options.nonEmpty && value.length === 0)) {
    issues.push(issue(where, `${field} must be ${options.nonEmpty ? "a non-empty" : "an"} array`));
    return;
  }
  const seen = new Set();
  value.forEach((item, index) => {
    if (!isNonEmptyString(item)) {
      issues.push(issue(where, `${field}[${index}] must be a non-empty string`));
    } else if (seen.has(item)) {
      issues.push(issue(where, `${field} must not contain duplicates`));
    }
    seen.add(item);
  });
}

function hasDependencyCycle(list) {
  const graph = new Map(
    list
      .filter((entry) => Number.isInteger(entry?.num) && Array.isArray(entry.depends_on))
      .map((entry) => [entry.num, entry.depends_on])
  );
  const visiting = new Set();
  const visited = new Set();
  function visit(num) {
    if (visiting.has(num)) return true;
    if (visited.has(num) || !graph.has(num)) return false;
    visiting.add(num);
    if (graph.get(num).some(visit)) return true;
    visiting.delete(num);
    visited.add(num);
    return false;
  }
  return [...graph.keys()].some(visit);
}

function validateTestStrategy(strategy, sidecarPath, issues) {
  if (!strategy || typeof strategy !== "object" || Array.isArray(strategy)) {
    issues.push(issue(sidecarPath, "test_strategy must be an object"));
    return;
  }
  for (const key of Object.keys(strategy)) {
    if (!ALLOWED_TEST_STRATEGY_KEYS.has(key)) {
      issues.push(issue(sidecarPath, `unknown test_strategy field ${key}`));
    }
  }
  for (const field of TEST_STRATEGY_FIELDS) {
    if (!isNonEmptyString(strategy[field])) {
      issues.push(issue(sidecarPath, `test_strategy.${field} must be a non-empty string`));
    }
  }
}

function validateHtmlBinding(opts, issues) {
  if (opts.storedHash === undefined || opts.storedHash === null) {
    issues.push(issue(opts.htmlPath, "HTML is missing data-sidecar-hash"));
  } else if (opts.storedHash !== opts.sidecarHash) {
    issues.push(
      issue(
        opts.htmlPath,
        `data-sidecar-hash mismatch: HTML has ${opts.storedHash}, sidecar is ${opts.sidecarHash}`
      )
    );
  }
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

// Regex-free control-char scan (avoids eslint no-control-regex): reject the pipe
// plus every C0 control (includes tab/newline/carriage-return) and DEL.
function hasUnsafeTitleChar(title) {
  if (title.includes("|")) {
    return true;
  }
  for (let index = 0; index < title.length; index += 1) {
    const code = title.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

// Strict: consumers copy the value verbatim into ## Tasks routing, so leniency
// (trim/upper-case) would let a stray "  m " through and break size routing.
function isValidSize(value) {
  return typeof value === "string" && VALID_SIZES.has(value);
}

function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function extractSidecarHash(htmlText) {
  const match = String(htmlText).match(/data-sidecar-hash="(sha256:[0-9a-f]+)"/i);
  return match ? match[1] : null;
}

function loadSidecarBytes(filePath) {
  return fs.readFileSync(filePath);
}

function parseArgs(argv) {
  const opts = { json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--sidecar") {
      opts.sidecarPath = requireValue(argv, ++index, arg);
    } else if (arg === "--html") {
      opts.htmlPath = requireValue(argv, ++index, arg);
    } else if (arg === "--slug") {
      opts.expectedSlug = requireValue(argv, ++index, arg);
    } else if (arg === "--json") {
      opts.json = true;
    } else if (arg === "--help" || arg === "-h") {
      opts.help = true;
    } else {
      throw new Error(`unknown argument ${arg}`);
    }
  }
  return opts;
}

function usage() {
  return [
    "Usage: node scripts/rfc-sidecar-check.js --sidecar PATH [--html PATH] [--slug NAME] [--json]",
    "",
    "Validates the RFC JSON sidecar at {pm_dir}/backlog/rfcs/{slug}.json.",
    "--html verifies the HTML's data-sidecar-hash matches the sidecar bytes.",
    "--slug asserts the sidecar's slug field equals NAME.",
    `Required schema_version: ${SCHEMA_VERSION}`,
  ].join("\n");
}

function main(argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = parseArgs(argv);
    if (opts.help) {
      process.stdout.write(usage() + "\n");
      return 0;
    }
  } catch (err) {
    process.stderr.write(`${err.message}\n\n${usage()}\n`);
    return 2;
  }

  if (!opts.sidecarPath) {
    process.stderr.write(`--sidecar is required\n\n${usage()}\n`);
    return 2;
  }

  const sidecarPath = path.resolve(opts.sidecarPath);
  let sidecarBytes;
  try {
    sidecarBytes = loadSidecarBytes(sidecarPath);
  } catch (err) {
    const result = {
      ok: false,
      issues: [issue(sidecarPath, `unable to read RFC sidecar: ${err.message}`)],
    };
    printResult(result, opts.json, "RFC sidecar check");
    return 1;
  }

  let sidecar;
  try {
    sidecar = JSON.parse(sidecarBytes.toString("utf8"));
  } catch (err) {
    const result = {
      ok: false,
      issues: [issue(sidecarPath, `unable to parse RFC sidecar JSON: ${err.message}`)],
    };
    printResult(result, opts.json, "RFC sidecar check");
    return 1;
  }

  const validateOpts = {};
  if (opts.expectedSlug !== undefined && opts.expectedSlug !== null) {
    validateOpts.expectedSlug = opts.expectedSlug;
  }
  if (opts.htmlPath !== undefined && opts.htmlPath !== null) {
    const htmlPath = path.resolve(opts.htmlPath);
    let htmlText;
    try {
      htmlText = fs.readFileSync(htmlPath, "utf8");
    } catch (err) {
      const result = {
        ok: false,
        issues: [issue(htmlPath, `unable to read RFC HTML: ${err.message}`)],
      };
      printResult(result, opts.json, "RFC sidecar check");
      return 1;
    }
    validateOpts.htmlPath = opts.htmlPath;
    validateOpts.storedHash = extractSidecarHash(htmlText);
    validateOpts.sidecarHash = `sha256:${sha256Hex(sidecarBytes)}`;
  }

  const result = validateRfcSidecar(sidecar, sidecarPath, validateOpts);
  printResult(result, opts.json, "RFC sidecar check");
  return result.ok ? 0 : 1;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  SCHEMA_VERSION,
  SUPPORTED_SCHEMA_VERSIONS,
  TEST_STRATEGY_FIELDS,
  VALID_SIZES,
  validateRfcSidecar,
  extractSidecarHash,
  sha256Hex,
  loadSidecarBytes,
  parseArgs,
  main,
};
