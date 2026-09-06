#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  saveExecutionPolicy,
  userPolicyPath,
  selectExecutionProfile,
  validateExecutionPolicy,
} = require("./lib/execution-policy");
const profiles = require("../skills/dev/references/model-profiles.json");
const registries = {
  dev: profiles,
  review: profiles,
  rfc: require("../skills/rfc/references/model-profiles.json"),
  groom: require("./lib/groom-runtime-profile").PROFILES,
};

function validateRegisteredPolicy(value) {
  validateExecutionPolicy(value);
  for (const [workflow, registry] of Object.entries(registries)) {
    for (const provider of ["codex", "claude"]) {
      const selection = value.workflows[workflow]?.[provider] || value.defaults[provider];
      if (
        selection &&
        !Object.values(registry.profiles).some(
          (p) => p.provider === provider && p.model === selection.model
        )
      )
        throw new Error(`unsupported ${provider} model ${selection.model} for ${workflow}`);
    }
  }
  return value;
}

function main(argv = process.argv.slice(2)) {
  const command = argv.shift();
  const options = {};
  while (argv.length) {
    const key = argv.shift();
    if (key === "--user") options.user = true;
    else if (["--source-dir", "--input"].includes(key) && argv[0])
      options[key.slice(2)] = argv.shift();
    else throw new Error(`unknown or incomplete argument: ${key}`);
  }
  if (!["show", "set"].includes(command))
    throw new Error(
      "Usage: pm-execution-policy <show|set> [--user|--source-dir <path>] [--input <json>]"
    );
  if (options.user && options["source-dir"])
    throw new Error("choose either --user or --source-dir");
  const sourceDir = path.resolve(options["source-dir"] || process.cwd());
  const file = options.user
    ? userPolicyPath()
    : path.join(sourceDir, ".pm", "execution-policy.json");
  if (command === "set") {
    if (!options.input) throw new Error("set requires --input; model changes are explicit");
    const value = JSON.parse(fs.readFileSync(options.input, "utf8"));
    validateRegisteredPolicy(value);
    saveExecutionPolicy(file, value);
  }
  const resolved = {};
  for (const [workflow, registry] of Object.entries(registries)) {
    resolved[workflow] = {};
    for (const provider of ["codex", "claude"])
      resolved[workflow][provider] = selectExecutionProfile({
        data: registry,
        provider,
        workflow,
        sourceDir: options.user ? undefined : sourceDir,
      });
  }
  process.stdout.write(`${JSON.stringify({ path: file, resolved }, null, 2)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}
module.exports = { main, validateRegisteredPolicy };
