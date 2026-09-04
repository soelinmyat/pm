#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { checkQaReport } = require("./lib/qa-report-schema");

function parseArgs(argv) {
  const options = {};
  const fields = new Map([
    ["--session", "sessionPath"],
    ["--report", "reportPath"],
    ["--commit", "expectedCommit"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const field = fields.get(argv[index]);
    if (!field) throw new Error(`unknown argument ${argv[index]}`);
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`${argv[index - 1]} requires a value`);
    options[field] = value;
  }
  for (const field of ["sessionPath", "reportPath", "expectedCommit"]) {
    if (!options[field]) throw new Error(`missing required ${field}`);
  }
  return options;
}

function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    if (!path.isAbsolute(options.sessionPath)) {
      throw new Error("--session must be an absolute path");
    }
    if (fs.lstatSync(options.sessionPath).isSymbolicLink()) {
      throw new Error("--session cannot be a symbolic link");
    }
    const session = JSON.parse(fs.readFileSync(options.sessionPath, "utf8"));
    const result = checkQaReport({
      session,
      reportPath: options.reportPath,
      expectedCommit: options.expectedCommit,
      requirePassing: true,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.ok ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 2;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = { main, parseArgs };
