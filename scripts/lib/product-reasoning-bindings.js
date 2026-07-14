"use strict";

const crypto = require("node:crypto");
const { readProjectInput } = require("./safe-project-output");

const MAX_BINDING_FILE_BYTES = 16 * 1024 * 1024;
const MAX_BINDING_TOTAL_BYTES = 64 * 1024 * 1024;

function verifyArtifactBindings(root, bindings, options = {}) {
  const maxFileBytes = options.maxFileBytes ?? MAX_BINDING_FILE_BYTES;
  const maxTotalBytes = options.maxTotalBytes ?? MAX_BINDING_TOTAL_BYTES;
  const cache = options.cache || new Map();
  const issues = [];
  let remaining = maxTotalBytes;
  for (const binding of bindings || []) {
    let input = cache.get(binding.path);
    if (!input) {
      if (remaining <= 0) {
        issues.push(`${binding.path}: aggregate binding bytes exceed 64 MiB`);
        break;
      }
      const limit = Math.min(maxFileBytes, remaining);
      try {
        input = readProjectInput(root, binding.path, limit);
      } catch (error) {
        const aggregate = remaining < maxFileBytes && /input exceeds/.test(error.message);
        issues.push(
          `${binding.path}: ${aggregate ? "aggregate binding bytes exceed 64 MiB" : error.message}`
        );
        if (aggregate) break;
        continue;
      }
      remaining -= input.bytes.length;
      cache.set(binding.path, input);
    }
    const observed = `sha256:${crypto.createHash("sha256").update(input.bytes).digest("hex")}`;
    if (observed !== binding.sha256)
      issues.push(`${binding.path}: SHA-256 does not match current bytes`);
  }
  return issues;
}

module.exports = {
  MAX_BINDING_FILE_BYTES,
  MAX_BINDING_TOTAL_BYTES,
  verifyArtifactBindings,
};
