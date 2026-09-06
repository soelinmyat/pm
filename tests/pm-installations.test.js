"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { diagnose, migrate, restore } = require("../scripts/pm-installations");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-installs-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fallbackRoot = path.join(root, "vendor");
  const nativeRoot = path.join(root, "native");
  const aliasesDir = path.join(root, "skills");
  for (const [dir, version] of [
    [fallbackRoot, "1.13.49"],
    [nativeRoot, "1.13.52"],
  ]) {
    fs.mkdirSync(path.join(dir, "skills", "research"), { recursive: true });
    fs.mkdirSync(path.join(dir, ".codex-plugin"));
    fs.writeFileSync(path.join(dir, "plugin.config.json"), JSON.stringify({ name: "pm", version }));
    fs.writeFileSync(
      path.join(dir, ".codex-plugin", "plugin.json"),
      JSON.stringify({ name: "pm", version, skills: "./skills/" })
    );
    fs.writeFileSync(
      path.join(dir, "skills", "research", "SKILL.md"),
      `---\nname: research\n---\n${version}\n`
    );
  }
  fs.mkdirSync(aliasesDir);
  fs.symlinkSync(
    path.join(fallbackRoot, "skills", "research"),
    path.join(aliasesDir, "pm-research")
  );
  fs.mkdirSync(path.join(aliasesDir, "pm-unrelated"));
  return { fallbackRoot, nativeRoot, aliasesDir, backupDir: path.join(root, "backup") };
}

test("diagnostic reports mixed versions and source hashes without mutation", (t) => {
  const options = fixture(t);
  const before = fs.readdirSync(options.aliasesDir);
  const result = diagnose(options);
  assert.equal(result.version_conflict, true);
  assert.equal(result.aliases[0].workflow, "research");
  assert.notEqual(result.aliases[0].sha256, result.native.skills.research);
  assert.deepEqual(fs.readdirSync(options.aliasesDir), before);
});

test("migration requires observed native discovery and restores only unchanged backups", (t) => {
  const options = fixture(t);
  assert.throws(() => migrate(options), /native discovery/);
  const receipt = migrate({ ...options, nativeDiscovered: true });
  assert.equal(receipt.entries.length, 1);
  assert.equal(fs.existsSync(path.join(options.aliasesDir, "pm-research")), false);
  assert.equal(fs.existsSync(path.join(options.aliasesDir, "pm-unrelated")), true);
  restore({ receiptPath: path.join(options.backupDir, "receipt.json") });
  assert.equal(
    fs.realpathSync(path.join(options.aliasesDir, "pm-research")),
    fs.realpathSync(path.join(options.fallbackRoot, "skills", "research"))
  );
});

test("migration never disables regular directories, foreign aliases, or absent native workflows", (t) => {
  const options = fixture(t);
  fs.symlinkSync(options.nativeRoot, path.join(options.aliasesDir, "pm-foreign"));
  fs.rmSync(path.join(options.nativeRoot, "skills", "research", "SKILL.md"));
  assert.throws(() => migrate({ ...options, nativeDiscovered: true }), /native.*research/);
  assert.equal(fs.lstatSync(path.join(options.aliasesDir, "pm-research")).isSymbolicLink(), true);
  assert.equal(fs.lstatSync(path.join(options.aliasesDir, "pm-foreign")).isSymbolicLink(), true);
});

test("restore refuses an occupied destination and tampered receipt paths before any write", (t) => {
  const options = fixture(t);
  migrate({ ...options, nativeDiscovered: true });
  const receiptPath = path.join(options.backupDir, "receipt.json");
  fs.mkdirSync(path.join(options.aliasesDir, "pm-research"));
  assert.throws(() => restore({ receiptPath }), /occupied/);
  fs.rmdirSync(path.join(options.aliasesDir, "pm-research"));
  const receipt = JSON.parse(fs.readFileSync(receiptPath));
  receipt.entries[0].name = "../outside";
  fs.writeFileSync(receiptPath, JSON.stringify(receipt));
  assert.throws(() => restore({ receiptPath }), /invalid/);
});

test("restore preserves backups if a foreign destination appears after validation", (t) => {
  const options = fixture(t);
  migrate({ ...options, nativeDiscovered: true });
  const receiptPath = path.join(options.backupDir, "receipt.json");
  const original = fs.realpathSync(options.aliasesDir) + "/pm-research";
  const lstat = fs.lstatSync;
  let reads = 0;
  fs.lstatSync = function (candidate, ...args) {
    if (String(candidate) === original && ++reads === 3) fs.mkdirSync(original);
    return lstat.call(fs, candidate, ...args);
  };
  try {
    assert.throws(() => restore({ receiptPath }), /occupied|modified|EEXIST/);
  } finally {
    fs.lstatSync = lstat;
  }
  assert.equal(fs.lstatSync(path.join(options.backupDir, "pm-research")).isSymbolicLink(), true);
  assert.equal(JSON.parse(fs.readFileSync(receiptPath)).state, "migrated");
});
