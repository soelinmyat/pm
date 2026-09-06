#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { requireValue } = require("./lib/check-cli");
const { buildPrototypeIdentity } = require("./lib/dev-work-units");
const { findGitRoot } = require("./loop-git");

function parseArgs(argv) {
  const options = { repoRoot: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--path") options.prototypePath = requireValue(argv, ++index, arg);
    else if (arg === "--repo-root") options.repoRoot = requireValue(argv, ++index, arg);
    else if (arg === "--json") options.json = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  return options;
}

function usage() {
  return [
    "Usage: node scripts/prototype-identity.js --path PROJECT_RELATIVE_PATH [--repo-root PATH] [--json]",
    "",
    "Builds a deterministic bounded prototype identity for design_context.prototype.",
    "Single-file prototypes bind that file. Multi-file index.html prototypes bind the complete tree.",
  ].join("\n");
}

function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
    if (options.help) {
      process.stdout.write(`${usage()}\n`);
      return 0;
    }
    if (!options.prototypePath) throw new Error("--path is required");
    const requestedRoot = path.resolve(options.repoRoot || process.cwd());
    const repoRoot = findGitRoot(requestedRoot);
    const identity = buildPrototypeIdentity(options.prototypePath, repoRoot);
    process.stdout.write(`${JSON.stringify(identity, null, 2)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`prototype-identity: ${error.message}\n\n${usage()}\n`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = { main, parseArgs, usage };
