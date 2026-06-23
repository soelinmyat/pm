"use strict";

function isFlag(value) {
  return typeof value === "string" && value.startsWith("-");
}

function parseCliArgs(argv, spec, defaults = {}) {
  const args = { ...defaults };
  const positionals = [];

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const option = spec[token];
    if (!option) {
      throw new Error(`Unknown option: ${token}`);
    }

    const key = option.key || token.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    if (option.type === "boolean") {
      args[key] = option.value === undefined ? true : option.value;
      continue;
    }

    const value = argv[index + 1];
    if (value === undefined || isFlag(value)) {
      throw new Error(`Missing value for ${token}`);
    }
    args[key] = value;
    index++;
  }

  return { args, positionals };
}

module.exports = {
  parseCliArgs,
};
