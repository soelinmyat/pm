#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { writeJsonAtomic } = require("./lib/atomic-file");

function exists(file) {
  try {
    return fs.lstatSync(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function readJson(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.size > 65536)
    throw new Error(`expected bounded regular JSON file: ${file}`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function inspectRoot(root) {
  root = fs.realpathSync(root);
  const config = readJson(path.join(root, "plugin.config.json"));
  const manifest = readJson(path.join(root, ".codex-plugin", "plugin.json"));
  if (
    config.name !== "pm" ||
    manifest.name !== "pm" ||
    config.version !== manifest.version ||
    manifest.skills !== "./skills/"
  )
    throw new Error(`not a consistent native PM installation: ${root}`);
  const skills = {};
  for (const name of fs.readdirSync(path.join(root, "skills"))) {
    if (!/^[a-z][a-z0-9-]*$/.test(name)) continue;
    const entry = path.join(root, "skills", name, "SKILL.md");
    const stat = exists(entry);
    if (!stat?.isFile() || stat.size > 262144) continue;
    const real = fs.realpathSync(entry);
    if (!real.startsWith(`${root}${path.sep}`))
      throw new Error(`skill escapes installation: ${entry}`);
    skills[name] = crypto.createHash("sha256").update(fs.readFileSync(entry)).digest("hex");
  }
  return { root, version: config.version, skills };
}

function diagnose({ nativeRoot, fallbackRoot, aliasesDir }) {
  if (!nativeRoot)
    throw new Error("--native-root must identify the PM plugin observed in a fresh session");
  const native = inspectRoot(nativeRoot);
  const fallback = exists(fallbackRoot) ? inspectRoot(fallbackRoot) : null;
  const aliases = [];
  const ignored = [];
  if (exists(aliasesDir))
    for (const name of fs.readdirSync(aliasesDir).sort()) {
      if (!/^pm-[a-z][a-z0-9-]*$/.test(name)) continue;
      const alias = path.join(aliasesDir, name);
      const workflow = name.slice(3);
      const stat = fs.lstatSync(alias);
      const target = stat.isSymbolicLink() ? fs.readlinkSync(alias) : null;
      const expected = fallback ? path.join(fallback.root, "skills", workflow) : null;
      let actual;
      try {
        actual = fs.realpathSync(alias);
      } catch {
        actual = null;
      }
      if (target === null || !expected || actual !== expected || !fallback.skills[workflow]) {
        ignored.push({ name, reason: "not a verified PM fallback symlink" });
        continue;
      }
      aliases.push({
        name,
        workflow,
        path: alias,
        target,
        sha256: fallback.skills[workflow],
        native_available: Boolean(native.skills[workflow]),
      });
    }
  return {
    schema_version: 1,
    native,
    fallback,
    aliases,
    ignored,
    version_conflict: Boolean(aliases.length && fallback.version !== native.version),
    duplicate_workflows: aliases.filter((a) => a.native_available).map((a) => a.workflow),
    native_discovery_observed: false,
  };
}

function migrate(options) {
  if (options.nativeDiscovered !== true)
    throw new Error(
      "native discovery must be confirmed from a fresh host session with --native-discovered"
    );
  const result = diagnose(options);
  for (const alias of result.aliases)
    if (!alias.native_available)
      throw new Error(`native installation is missing ${alias.workflow}; preserve fallback`);
  if (!options.backupDir) throw new Error("migration requires a new --backup-dir");
  const backup = path.resolve(options.backupDir);
  if (exists(backup))
    throw new Error(
      "backup directory already exists; use its receipt to restore or choose a new directory"
    );
  fs.mkdirSync(path.dirname(backup), { recursive: true, mode: 0o700 });
  fs.mkdirSync(backup, { mode: 0o700 });
  const receipt = {
    schema_version: 1,
    kind: "pm-fallback-migration",
    created: new Date().toISOString(),
    aliases_dir: fs.realpathSync(options.aliasesDir),
    fallback_root: result.fallback?.root || null,
    native_root: result.native.root,
    native_version: result.native.version,
    entries: result.aliases.map(({ name, target }) => ({ name, target })),
    state: "prepared",
  };
  const receiptPath = path.join(backup, "receipt.json");
  writeJsonAtomic(receiptPath, receipt, { fileMode: 0o600 });
  try {
    for (const entry of receipt.entries) {
      const original = path.join(receipt.aliases_dir, entry.name);
      if (!fs.lstatSync(original).isSymbolicLink() || fs.readlinkSync(original) !== entry.target)
        throw new Error(`alias changed during migration: ${entry.name}`);
      fs.renameSync(original, path.join(backup, entry.name));
    }
    receipt.state = "migrated";
    writeJsonAtomic(receiptPath, receipt, { fileMode: 0o600 });
  } catch (error) {
    restore({ receiptPath });
    throw error;
  }
  return { ...receipt, receipt_path: receiptPath };
}

function restore({ receiptPath }) {
  receiptPath = path.resolve(receiptPath);
  const backup = fs.realpathSync(path.dirname(receiptPath));
  const receipt = readJson(receiptPath);
  if (
    receipt.schema_version !== 1 ||
    receipt.kind !== "pm-fallback-migration" ||
    !Array.isArray(receipt.entries) ||
    !path.isAbsolute(receipt.aliases_dir || "") ||
    !["prepared", "migrated", "restored"].includes(receipt.state)
  )
    throw new Error("invalid migration receipt");
  if (fs.realpathSync(receipt.aliases_dir) !== receipt.aliases_dir)
    throw new Error("invalid alias directory identity");
  const names = new Set();
  // Validate the complete restoration before any mutation. A crash can leave either
  // the original or backup symlink; never replace an occupied destination.
  for (const entry of receipt.entries) {
    if (
      !entry ||
      !/^pm-[a-z][a-z0-9-]*$/.test(entry.name) ||
      names.has(entry.name) ||
      typeof entry.target !== "string"
    )
      throw new Error("invalid migration entry");
    names.add(entry.name);
    const original = path.join(receipt.aliases_dir, entry.name);
    const saved = path.join(backup, entry.name);
    for (const candidate of [original, saved]) {
      const stat = exists(candidate);
      if (stat && (!stat.isSymbolicLink() || fs.readlinkSync(candidate) !== entry.target))
        throw new Error(`occupied or modified migration path: ${candidate}`);
    }
    if (!exists(original) && !exists(saved))
      throw new Error(`missing migration backup: ${entry.name}`);
  }
  for (const entry of receipt.entries) {
    const original = path.join(receipt.aliases_dir, entry.name);
    const saved = path.join(backup, entry.name);
    if (!exists(original)) fs.symlinkSync(entry.target, original, "dir");
    // Retain the backup for replay/forensics. Recheck the destination after the
    // exclusive create so a concurrent writer cannot turn restoration into a
    // false success or cause us to delete the only saved alias.
    if (!fs.lstatSync(original).isSymbolicLink() || fs.readlinkSync(original) !== entry.target)
      throw new Error(`occupied or modified migration path: ${original}`);
    if (
      exists(saved) &&
      (!fs.lstatSync(saved).isSymbolicLink() || fs.readlinkSync(saved) !== entry.target)
    )
      throw new Error(`modified migration backup: ${saved}`);
  }
  receipt.state = "restored";
  writeJsonAtomic(receiptPath, receipt, { fileMode: 0o600 });
  return receipt;
}

function main(argv = process.argv.slice(2)) {
  const command = argv.shift() || "diagnose";
  const options = {
    fallbackRoot: path.join(os.homedir(), ".agents/vendor/pm"),
    aliasesDir: path.join(os.homedir(), ".agents/skills"),
  };
  const flags = {
    "--native-root": "nativeRoot",
    "--fallback-root": "fallbackRoot",
    "--aliases-dir": "aliasesDir",
    "--backup-dir": "backupDir",
    "--receipt": "receiptPath",
  };
  while (argv.length) {
    const key = argv.shift();
    if (key === "--native-discovered") options.nativeDiscovered = true;
    else if (flags[key] && argv[0]) options[flags[key]] = path.resolve(argv.shift());
    else throw new Error(`unknown or incomplete argument: ${key}`);
  }
  if (!["diagnose", "migrate", "restore"].includes(command))
    throw new Error(
      "Usage: pm-installations <diagnose|migrate|restore> --native-root <path> [--native-discovered --backup-dir <new-path>] [--receipt <path>]"
    );
  const result =
    command === "migrate"
      ? migrate(options)
      : command === "restore"
        ? restore(options)
        : diagnose(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`pm-installations: ${error.message}\n`);
    process.exitCode = 2;
  }
}
module.exports = { diagnose, inspectRoot, migrate, restore, main };
