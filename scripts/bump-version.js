#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const repoRoot = path.join(__dirname, "..");
const configPath = path.join(repoRoot, "plugin.config.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function run(cmd) {
  return execSync(cmd, { cwd: repoRoot, encoding: "utf8" }).trim();
}

// --- Parse arguments ---
const arg = process.argv[2];

if (!arg || ["--help", "-h"].includes(arg)) {
  console.log(`Usage: node scripts/bump-version.js <patch|minor|major|x.y.z>

Examples:
  node scripts/bump-version.js patch   # 1.1.4 → 1.1.5
  node scripts/bump-version.js minor   # 1.1.4 → 1.2.0
  node scripts/bump-version.js major   # 1.1.4 → 2.0.0
  node scripts/bump-version.js 2.0.0   # explicit version

What it does:
  1. Updates version in plugin.config.json (source of truth)
  2. Runs generate-platform-files.js to sync all 3 platform manifests
  3. Stages all changed files
  4. Commits: "Bump version to vX.Y.Z"
  5. Creates git tag vX.Y.Z

After running, push via a PR branch (pre-push hook blocks direct main pushes).`);
  process.exit(0);
}

// --- Read current version ---
const config = readJson(configPath);
const current = config.version;
const [major, minor, patch] = current.split(".").map(Number);

// --- Compute next version ---
let next;
if (arg === "patch") {
  next = `${major}.${minor}.${patch + 1}`;
} else if (arg === "minor") {
  next = `${major}.${minor + 1}.0`;
} else if (arg === "major") {
  next = `${major + 1}.0.0`;
} else if (/^\d+\.\d+\.\d+$/.test(arg)) {
  next = arg;
} else {
  console.error(`ERROR: Invalid argument "${arg}". Use patch, minor, major, or x.y.z`);
  process.exit(1);
}

if (next === current) {
  console.error(`ERROR: Version is already ${current}. Nothing to do.`);
  process.exit(1);
}

console.log(`Bumping ${current} → ${next}\n`);

// --- Step 1: Update plugin.config.json ---
config.version = next;
writeJson(configPath, config);
console.log(`  ✓ plugin.config.json → ${next}`);

// --- Step 2: Sync platform files ---
run("node scripts/generate-platform-files.js");
console.log("  ✓ Platform files synced (generate-platform-files.js)");

// --- Step 3: Verify consistency ---
const manifests = [
  ".claude-plugin/plugin.json",
  ".codex-plugin/plugin.json",
  ".claude-plugin/marketplace.json",
];

for (const rel of manifests) {
  const abs = path.join(repoRoot, rel);
  const data = readJson(abs);
  const v = data.version || (data.plugins && data.plugins[0].version);
  if (v !== next) {
    console.error(`  ✗ ${rel} has version ${v}, expected ${next}`);
    process.exit(1);
  }
  console.log(`  ✓ ${rel} → ${next}`);
}

// --- Step 4: Stage and commit ---
run("git add plugin.config.json .claude-plugin/ .codex-plugin/");
run(`git commit -m "Bump version to v${next}"`);
console.log(`  ✓ Committed`);

// --- Step 5: Create tag ---
const existingTag = run(`git tag -l v${next}`);
if (existingTag) {
  console.error(`\n  ✗ Tag v${next} already exists. Delete it first if you want to re-tag.`);
  process.exit(1);
}
run(`git tag v${next}`);
console.log(`  ✓ Tagged v${next}`);

console.log(
  `\nDone. Push via PR branch:\n  git checkout -b release/v${next}\n  git push -u origin release/v${next}\n  gh pr create && gh pr merge --squash --auto`
);
