#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { checkQaReport } = require("./lib/qa-report-schema");
const { readBoundedJsonFile } = require("./lib/safe-json-file");

const MAX_SESSION_BYTES = 4 * 1024 * 1024;

function parseArgs(argv) {
  const options = { requirePassing: true };
  const fields = new Map([
    ["--session", "sessionPath"],
    ["--report", "reportPath"],
    ["--commit", "expectedCommit"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--allow-nonpassing") {
      options.requirePassing = false;
      continue;
    }
    if (argv[index] === "--qa-candidate") {
      if (options.qaCandidate) throw new Error("duplicate argument --qa-candidate");
      options.qaCandidate = "required";
      continue;
    }
    if (argv[index] === "--qa-history-anchor") {
      if (options.qaHistoryAnchor) throw new Error("duplicate argument --qa-history-anchor");
      options.qaHistoryAnchor = true;
      continue;
    }
    const field = fields.get(argv[index]);
    if (!field) throw new Error(`unknown argument ${argv[index]}`);
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`${argv[index - 1]} requires a value`);
    options[field] = value;
  }
  for (const field of ["sessionPath", "reportPath", "expectedCommit"]) {
    if (!options[field]) throw new Error(`missing required ${field}`);
  }
  if (options.qaCandidate && options.qaHistoryAnchor) {
    throw new Error("--qa-candidate and --qa-history-anchor are mutually exclusive");
  }
  return options;
}

function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    if (!path.isAbsolute(options.sessionPath)) {
      throw new Error("--session must be an absolute path");
    }
    let session;
    try {
      session = readBoundedJsonFile(options.sessionPath, MAX_SESSION_BYTES);
    } catch (error) {
      throw new Error(`cannot read --session ${options.sessionPath}: ${error.message}`);
    }
    const result = checkQaReport({
      session,
      reportPath: options.reportPath,
      expectedCommit: options.expectedCommit,
      requirePassing: options.requirePassing,
      qaCandidate:
        options.qaHistoryAnchor === true
          ? undefined
          : options.qaCandidate ||
            (session.status === "active" && session.phase === "qa" ? "required" : undefined),
      qaHistoryAnchor: options.qaHistoryAnchor,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.ok ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 2;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = { MAX_SESSION_BYTES, main, parseArgs };
