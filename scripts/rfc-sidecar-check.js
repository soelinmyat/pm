#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

// The RFC sidecar is the machine-readable twin of the human-render RFC HTML.
// Machine consumers (dev intake, groom re-discovery, rfc review child cards)
// read this JSON instead of grepping HTML anchors. Schema stays in lockstep
// with the .issue-detail cards and Test Strategy blocks the HTML renders.
const SCHEMA_VERSION = 2;
const VALID_SIZES = new Set(["XS", "S", "M", "L", "XL"]);
const TEST_STRATEGY_FIELDS = [
  "test_levels",
  "new_infrastructure",
  "regression_surface",
  "verification_commands",
  "open_questions",
];
const DEFAULT_SIDECAR_PATH = "{pm_dir}/backlog/rfcs/{slug}.json";

function validateRfcSidecar(sidecar, sidecarPath = DEFAULT_SIDECAR_PATH) {
  if (!sidecar || typeof sidecar !== "object" || Array.isArray(sidecar)) {
    return { ok: false, issues: [issue(sidecarPath, "RFC sidecar must be an object")] };
  }
  const issues = [];
  if (sidecar.schema_version !== SCHEMA_VERSION) {
    issues.push(issue(sidecarPath, `schema_version must equal ${SCHEMA_VERSION}`));
  }
  validateIssues(sidecar.issues, sidecarPath, issues);
  validateTestStrategy(sidecar.test_strategy, sidecarPath, issues);
  return { ok: issues.length === 0, issues };
}

function validateIssues(list, sidecarPath, issues) {
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
    if (!Number.isInteger(entry.num) || entry.num <= 0) {
      issues.push(issue(where, "num must be a positive integer"));
    } else if (seenNums.has(entry.num)) {
      issues.push(issue(where, `duplicate issue num ${entry.num}`));
    } else {
      seenNums.add(entry.num);
    }
    if (!isNonEmptyString(entry.title)) {
      issues.push(issue(where, "title must be a non-empty string"));
    }
    if (!isValidSize(entry.size)) {
      issues.push(issue(where, `size must be one of ${[...VALID_SIZES].join(", ")}`));
    }
    if ("test_hooks" in entry && !Array.isArray(entry.test_hooks)) {
      issues.push(issue(where, "test_hooks must be an array"));
    }
  });
}

function validateTestStrategy(strategy, sidecarPath, issues) {
  if (!strategy || typeof strategy !== "object" || Array.isArray(strategy)) {
    issues.push(issue(sidecarPath, "test_strategy must be an object"));
    return;
  }
  for (const field of TEST_STRATEGY_FIELDS) {
    if (!isNonEmptyString(strategy[field])) {
      issues.push(issue(sidecarPath, `test_strategy.${field} must be a non-empty string`));
    }
  }
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isValidSize(value) {
  return typeof value === "string" && VALID_SIZES.has(value.trim().toUpperCase());
}

function loadSidecar(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function parseArgs(argv) {
  const opts = { json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--sidecar") {
      opts.sidecarPath = requireValue(argv, ++index, arg);
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

function requireValue(argv, index, flag) {
  if (index >= argv.length || argv[index].startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return argv[index];
}

function usage() {
  return [
    "Usage: node scripts/rfc-sidecar-check.js --sidecar PATH [--json]",
    "",
    "Validates the RFC JSON sidecar at {pm_dir}/backlog/rfcs/{slug}.json.",
    `Required schema_version: ${SCHEMA_VERSION}`,
  ].join("\n");
}

function issue(file, message) {
  return { file: toRel(file), message };
}

function toRel(file) {
  return path.relative(process.cwd(), file).split(path.sep).join("/") || file;
}

function printResult(result, json) {
  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }
  if (result.ok) {
    process.stdout.write("RFC sidecar check passed.\n");
    return;
  }
  process.stdout.write("RFC sidecar check failed:\n");
  for (const found of result.issues) {
    process.stdout.write(`- ${found.file}: ${found.message}\n`);
  }
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
  let sidecar;
  try {
    sidecar = loadSidecar(sidecarPath);
  } catch (err) {
    const result = {
      ok: false,
      issues: [issue(sidecarPath, `unable to read RFC sidecar: ${err.message}`)],
    };
    printResult(result, opts.json);
    return 1;
  }

  const result = validateRfcSidecar(sidecar, sidecarPath);
  printResult(result, opts.json);
  return result.ok ? 0 : 1;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  SCHEMA_VERSION,
  TEST_STRATEGY_FIELDS,
  VALID_SIZES,
  validateRfcSidecar,
  loadSidecar,
  parseArgs,
  main,
};
