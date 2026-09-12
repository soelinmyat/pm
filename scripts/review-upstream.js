#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const {
  readProjectInput,
  writeProjectFileAtomic,
  writeProjectJsonAtomic,
} = require("./lib/project-file");
const { reviewPathContext } = require("./lib/review-paths");
const { MAX_JSON_BYTES } = require("./lib/review-limits");

const digest = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

function upstreamPaths(targetPath, target) {
  reviewPathContext(targetPath, target.review_round, target.run_id);
  const directory = path.posix.join(path.posix.dirname(targetPath), "upstream");
  return {
    snapshot: `${directory}/design-critique.json`,
    recovery: `${directory}/design-critique-recovery.json`,
  };
}

function exactDesign(root, relative, expected) {
  const input = readProjectInput(root, relative, MAX_JSON_BYTES);
  if (digest(input.bytes) !== expected.sha256)
    throw new Error("historical design evidence must match the original SHA-256");
  const value = JSON.parse(input.bytes.toString("utf8"));
  if (value.commit !== expected.commit || value.outcome !== expected.outcome)
    throw new Error("historical design evidence must match the original commit and outcome");
  return input;
}

function writeImmutable(root, relative, bytes) {
  try {
    writeProjectFileAtomic(root, relative, bytes, {
      replace: false,
      fileMode: 0o600,
      directoryMode: 0o700,
    });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const existing = readProjectInput(root, relative, MAX_JSON_BYTES);
    if (!existing.bytes.equals(bytes))
      throw new Error("refusing to replace immutable upstream evidence");
  }
}

function snapshotDesign(root, targetPath, target) {
  const design = target.upstream?.design_critique;
  if (!design) return;
  const input = exactDesign(root, design.path, design);
  const { snapshot } = upstreamPaths(targetPath, target);
  writeImmutable(root, snapshot, input.bytes);
  target.upstream.design_critique = { ...design, path: snapshot };
}

function recoverDesign(root, targetPath, archivePath) {
  const input = readProjectInput(root, targetPath, MAX_JSON_BYTES);
  const target = JSON.parse(input.bytes.toString("utf8"));
  const design = target.upstream?.design_critique;
  if (!design) throw new Error("target has no original design evidence binding");
  const paths = upstreamPaths(targetPath, target);
  if (design.path === paths.snapshot)
    throw new Error("immutable upstream snapshots do not require legacy recovery");
  const archive = exactDesign(root, archivePath, design);
  const record = {
    schema_version: 1,
    target: { path: targetPath, sha256: digest(input.bytes) },
    original: design,
    archive: { path: archivePath, sha256: design.sha256 },
    snapshot: { path: paths.snapshot, sha256: design.sha256 },
  };
  writeImmutable(root, paths.snapshot, archive.bytes);
  // An explicit recovery is an audit event; never overwrite an earlier record.
  writeProjectJsonAtomic(root, paths.recovery, record, {
    replace: false,
    fileMode: 0o600,
    directoryMode: 0o700,
  });
  return { path: paths.recovery, record };
}

function recoveredDesign(root, targetPath, target) {
  const paths = upstreamPaths(targetPath, target);
  let input;
  try {
    input = readProjectInput(root, paths.recovery, MAX_JSON_BYTES);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  const record = JSON.parse(input.bytes.toString("utf8"));
  const targetInput = readProjectInput(root, targetPath, MAX_JSON_BYTES);
  const design = target.upstream.design_critique;
  const expected = {
    schema_version: 1,
    target: { path: targetPath, sha256: digest(targetInput.bytes) },
    original: design,
    archive: { path: record.archive?.path, sha256: design.sha256 },
    snapshot: { path: paths.snapshot, sha256: design.sha256 },
  };
  if (JSON.stringify(record) !== JSON.stringify(expected))
    throw new Error("historical design recovery record does not match the original target binding");
  exactDesign(root, record.archive.path, design);
  return JSON.parse(exactDesign(root, paths.snapshot, design).bytes.toString("utf8"));
}

function main(argv) {
  try {
    const options = {};
    if (argv.shift() !== "recover")
      throw new Error("expected recover --root PATH --target PATH --archive PATH");
    while (argv.length) {
      const key = argv.shift();
      if (!["--root", "--target", "--archive"].includes(key) || !argv.length || options[key])
        throw new Error("invalid recovery arguments");
      options[key] = argv.shift();
    }
    if (!options["--target"] || !options["--archive"])
      throw new Error("target and archive are required");
    const result = recoverDesign(
      options["--root"] || process.cwd(),
      options["--target"],
      options["--archive"]
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main(process.argv.slice(2));
module.exports = { exactDesign, recoveredDesign, recoverDesign, snapshotDesign };
