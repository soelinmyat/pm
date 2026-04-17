"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const repoRoot = path.join(__dirname, "..");

function walk(dir, results = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, results);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push(fullPath);
    }
  }
  return results;
}

test("skill files reference session dirs only under {source_dir}/.pm/, never {pm_state_dir}/", () => {
  const searchDirs = [path.join(repoRoot, "skills"), path.join(repoRoot, "references")];
  const offenders = [];

  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const filePath of walk(dir)) {
      const lines = fs.readFileSync(filePath, "utf8").split("\n");
      lines.forEach((line, idx) => {
        if (/\{pm_state_dir\}[^`]*\b(rfc|groom|dev)-sessions\b/.test(line)) {
          offenders.push(`${path.relative(repoRoot, filePath)}:${idx + 1}  ${line.trim()}`);
        }
      });
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `Session directories must be rooted at {source_dir}/.pm/, not {pm_state_dir}/.\n` +
      `Offending lines:\n  ${offenders.join("\n  ")}`
  );
});
