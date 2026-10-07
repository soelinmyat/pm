#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { requireValue } = require("./lib/check-cli");
const {
  adoptAppPreview,
  completeAppPreview,
  prepareAppPreview,
  verifyAppPreviewIdentity,
} = require("./lib/app-preview");

function parseArgs(argv) {
  const options = { command: argv[0], repoRoot: process.cwd() };
  if (argv[0] === "--help" || argv[0] === "-h") return { help: true };
  const keys = {
    "--repo-root": "repoRoot",
    "--source-root": "sourceRoot",
    "--target-root": "targetRoot",
    "--config": "config",
    "--candidate": "candidate",
    "--observations": "observations",
    "--identity": "identity",
  };
  const seen = new Set();
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (keys[arg] && !seen.has(arg)) {
      options[keys[arg]] = requireValue(argv, ++index, arg);
      seen.add(arg);
    } else throw new Error(`unknown or repeated argument ${arg}`);
  }
  if (options.help) return options;
  const required = {
    prepare: ["config", "sourceRoot"],
    complete: ["candidate", "observations", "sourceRoot"],
    verify: ["identity"],
    adopt: ["identity", "targetRoot"],
  }[options.command];
  if (!required) throw new Error("prepare, complete, verify or adopt is required");
  for (const key of required)
    if (!options[key]) throw new Error(`${key} is required for ${options.command}`);
  const allowed = ["command", "repoRoot", "sourceRoot", ...required];
  for (const key of Object.keys(options))
    if (!allowed.includes(key)) throw new Error(`${key} is not valid for ${options.command}`);
  return options;
}

function readJson(file) {
  const absolute = path.resolve(file);
  const stat = fs.lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024)
    throw new Error("preview input must be a regular bounded JSON file");
  return JSON.parse(fs.readFileSync(absolute, "utf8"));
}

function usage() {
  return [
    "Usage: node scripts/app-preview.js prepare --config FILE --source-root WORKTREE [--repo-root ARTIFACT_ROOT]",
    "       node scripts/app-preview.js complete --candidate FILE --observations FILE --source-root WORKTREE [--repo-root ARTIFACT_ROOT]",
    "       node scripts/app-preview.js verify --identity FILE [--source-root WORKTREE] [--repo-root ARTIFACT_ROOT]",
    "       node scripts/app-preview.js adopt --identity FILE --target-root DEV_WORKTREE [--source-root WORKTREE] [--repo-root ARTIFACT_ROOT]",
    "",
    "Emits JSON; prepare and complete never execute the launch recipe.",
    "Adopt checks an exact clean isolated base and stages only reviewed committed UI code, excluding fixtures.",
    "Preview evidence attests mocked journeys; it does not certify backend behavior.",
  ].join("\n");
}

function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    if (options.help) {
      process.stdout.write(`${usage()}\n`);
      return 0;
    }
    let result;
    if (options.command === "prepare")
      result = prepareAppPreview(readJson(options.config), options);
    else if (options.command === "complete")
      result = completeAppPreview(
        readJson(options.candidate),
        readJson(options.observations),
        options
      );
    else {
      const identity = readJson(options.identity);
      if (options.command === "adopt") result = adoptAppPreview(identity, options);
      else {
        verifyAppPreviewIdentity(identity, options);
        result = { valid: true, sha256: identity.sha256, backend_certified: false };
      }
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`app-preview: ${error.message}\n\n${usage()}\n`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = { main, parseArgs, usage };
