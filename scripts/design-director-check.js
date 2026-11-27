#!/usr/bin/env node
"use strict";

// CLI for the Design Director report check. Exit 0 means the report is
// complete, current and consistent with its verdict, whether that verdict is
// an approval or a rejection. Only an approved report can pass the gate.

const fs = require("node:fs");
const path = require("node:path");
const { requireValue } = require("./lib/check-cli");
const { gitExec } = require("./lib/git-env");
const { checkDesignDirector } = require("./lib/design-director-report");

function usage() {
  return [
    "Usage: design-director-check.js --report <report.json> [--root <dir>] [--commit <sha>]",
    "                                [--run-id <session run_id>] [--json]",
    "",
    "The report lives at",
    ".pm/dev-sessions/{slug}/design-critique/director/{run}/review-{N}/report.json.",
    "Without --commit, the report must have been made at the current HEAD.",
    "Without --root, the project is the Git work tree containing the current directory.",
  ].join("\n");
}

function parseArgs(argv) {
  const options = { json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--json") options.json = true;
    else if (["--report", "--root", "--commit", "--run-id"].includes(flag)) {
      options[flag === "--run-id" ? "runId" : flag.slice(2)] = requireValue(argv, index + 1, flag);
      index += 1;
    } else throw new Error(`unknown argument ${flag}`);
  }
  if (!options.report) throw new Error("--report is required");
  return options;
}

function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    return 2;
  }
  // Resolve the project root and the report through symlinks, so the check
  // works from a subdirectory and with the absolute path the docs give.
  let root;
  let reportPath;
  try {
    const start = path.resolve(options.root || process.cwd());
    root = fs.realpathSync(
      options.root ? start : gitExec(start, ["rev-parse", "--show-toplevel"]).trim()
    );
    reportPath = path.isAbsolute(options.report)
      ? path.relative(root, fs.realpathSync(options.report))
      : options.report;
  } catch (error) {
    process.stderr.write(`cannot locate the project or report: ${error.message}\n`);
    return 2;
  }
  let commit = options.commit;
  if (!commit) {
    try {
      commit = gitExec(root, ["rev-parse", "HEAD"]).trim();
    } catch (error) {
      process.stderr.write(`cannot resolve HEAD in ${root}: ${error.message}\n`);
      return 2;
    }
  }
  const result = checkDesignDirector({ root, reportPath, commit, runId: options.runId });
  if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else if (result.ok) {
    process.stdout.write(
      `Design Director report is valid: ${result.verdict}, review ${result.review}, round ${result.round}.\n`
    );
    if (result.verdict === "reject")
      process.stdout.write(
        `${result.parks ? "The work parks." : "Fix and review again."} Blocking: ${result.blockers.join("; ")}\n`
      );
    if (result.follow_ups.length)
      process.stdout.write(`Follow-ups to file: ${result.follow_ups.join(", ")}\n`);
  } else for (const item of result.issues) process.stderr.write(`${item.path}: ${item.message}\n`);
  return result.ok ? 0 : 1;
}

if (require.main === module) process.exitCode = main();

module.exports = { main };
