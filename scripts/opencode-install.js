#!/usr/bin/env node
"use strict";

const { installConfig, buildInstallConfig } = require("./opencode-plugin");

function main(argv) {
  const options = {};
  let configPath = null,
    print = false;
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === "--print") print = true;
    else if (["--config", "--node"].includes(argv[index]) && argv[index + 1]) {
      const key = argv[index++];
      if (key === "--config") configPath = argv[index];
      else options.nodeExecutable = argv[index];
    } else
      throw new Error(
        "Usage: opencode-install --config <opencode.json> [--node <absolute-path>] | --print"
      );
  }
  if (print && configPath) throw new Error("--print and --config are mutually exclusive");
  if (print) return buildInstallConfig({}, options);
  if (!configPath)
    throw new Error("--config is required; choose project or global installation explicitly");
  return installConfig(configPath, options);
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(main(process.argv.slice(2)), null, 2));
  } catch (error) {
    console.error(`opencode-install: ${error.message}`);
    process.exitCode = 2;
  }
}
module.exports = { main };
