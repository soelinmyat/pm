"use strict";

// Shared CLI helpers for PM "check" scripts (rfc-sidecar-check.js, dev-gate-check.js).
//
// IMPORTANT: .githooks/pre-push runs dev-gate-check.js as an isolated `git show`
// copy in a temp dir, so this file is staged next to it there (preserving the
// ./lib/ relative path). Any check script that requires this lib MUST be
// mirrored the same way in that hook. Keep this file dependency-free — node
// builtins only — so the isolated run has nothing else to resolve.
//
// ponytail: follow-up — scripts/evals/check.js and scripts/evals/score.js still
// carry their own issue()/toRel(); fold them in when those scripts are next
// touched (they are not run in the isolated pre-push path, so no rush).

const path = require("node:path");

function issue(file, message) {
  return { file: toRel(file), message };
}

function toRel(file) {
  return path.relative(process.cwd(), file).split(path.sep).join("/") || file;
}

function requireValue(argv, index, flag) {
  if (index >= argv.length || argv[index].startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return argv[index];
}

function printResult(result, json, name) {
  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }
  if (result.ok) {
    process.stdout.write(`${name} passed.\n`);
    return;
  }
  process.stdout.write(`${name} failed:\n`);
  for (const found of result.issues) {
    process.stdout.write(`- ${found.file}: ${found.message}\n`);
  }
}

module.exports = { issue, toRel, requireValue, printResult };
