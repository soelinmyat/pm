#!/usr/bin/env node
"use strict";

// CLI for the Design Director path's mechanical checks: scope, tokens and
// neighbours. Exit 0 means every hit is fixed or explained, or the session
// declares no surfaces and the result is advisory. Exit 1 means an item is
// unexplained. Exit 2 means the check could not run.

const fs = require("node:fs");
const path = require("node:path");
const { requireValue } = require("./lib/check-cli");
const { gitExec } = require("./lib/git-env");
const { CHECKS_PATH, runMechanicalChecks } = require("./lib/design-director-mechanical");

function usage() {
  return [
    "Usage: design-director-mechanical.js --session <absolute session.json> [--commit <sha>]",
    "                                     [--base <ref>] [--json]",
    "",
    `Dispositions, UI-file overrides and neighbour screenshots are read from`,
    `.pm/dev-sessions/{slug}/${CHECKS_PATH}. Without --commit the check runs at HEAD.`,
    "Without --base the diff starts where the branch left the default branch.",
  ].join("\n");
}

function parseArgs(argv) {
  const options = { json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--json") options.json = true;
    else if (["--session", "--commit", "--base"].includes(flag)) {
      options[flag.slice(2)] = requireValue(argv, index + 1, flag);
      index += 1;
    } else throw new Error(`unknown argument ${flag}`);
  }
  if (!options.session) throw new Error("--session is required");
  return options;
}

function summary(result) {
  const lines = [];
  if (!result.enforced)
    lines.push("The session has no declared surfaces: results are advisory and do not fail.");
  const { scope, tokens, neighbours } = result;
  lines.push(
    scope.status === "no-surfaces"
      ? "Scope: no declared surfaces."
      : `Scope: ${scope.status}, ${scope.outside.length} UI file(s) outside the declared surfaces.`
  );
  lines.push(
    `Tokens: ${tokens.status}, ${tokens.open} unexplained raw value(s) in ${tokens.scanned_files} UI file(s).`
  );
  lines.push(
    neighbours.status === "none"
      ? "Neighbours: no screenshots supplied."
      : `Neighbours: ${neighbours.status}. ${neighbours.screens
          .map(
            (screen) =>
              `${screen.screen}: ${screen.error ? "unreadable" : screen.comparison.result}${
                screen.comparison?.changed_pixels ? ` (${screen.comparison.changed_pixels} px)` : ""
              }`
          )
          .join("; ")}`
  );
  for (const item of result.issues) lines.push(`- ${item.check}: ${item.message}`);
  lines.push(
    result.ok ? "Mechanical checks pass." : "Mechanical checks fail: fix or explain each item."
  );
  return `${lines.join("\n")}\n`;
}

function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    return 2;
  }
  let result;
  try {
    const session = JSON.parse(fs.readFileSync(path.resolve(options.session), "utf8"));
    const root = fs.realpathSync(session?.source?.worktree);
    const commit = gitExec(root, [
      "rev-parse",
      "--verify",
      `${options.commit || "HEAD"}^{commit}`,
    ]).trim();
    result = runMechanicalChecks({ root, session, commit, base: options.base });
  } catch (error) {
    process.stderr.write(`cannot run the mechanical checks: ${error.message}\n`);
    return 2;
  }
  process.stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` : summary(result));
  return result.ok ? 0 : 1;
}

if (require.main === module) process.exitCode = main();

module.exports = { main };
