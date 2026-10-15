#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { requireValue } = require("./lib/check-cli");
const {
  createProjectRootAnchor,
  readProjectInput,
  writeProjectFileAtomic,
} = require("./lib/project-file");
const MAX_BYTES = 8 * 1024 * 1024;

function retainSource({ projectRoot, input, sha256 }) {
  if (!/^sha256:[a-f0-9]{64}$/.test(sha256 || ""))
    throw new Error("--sha256 requires an exact SHA-256 digest");
  const root = fs.realpathSync(path.resolve(projectRoot));
  const anchor = createProjectRootAnchor(root);
  const source = readProjectInput(root, input, MAX_BYTES, {
    projectRootAnchor: anchor,
    requireStablePath: true,
  });
  const observed = "sha256:" + crypto.createHash("sha256").update(source.bytes).digest("hex");
  if (observed !== sha256) throw new Error("source bytes do not match --sha256");
  const target = `.pm/proposal-sources/${sha256.slice(7)}`;
  writeProjectFileAtomic(root, target, source.bytes, {
    fileMode: 0o600,
    directoryMode: 0o700,
    maxBytes: MAX_BYTES,
    replace: false,
    acceptIdentical: true,
    attestations: [{ path: input, sha256: observed, maxBytes: MAX_BYTES }],
  });
  const retained = readProjectInput(root, target, MAX_BYTES, {
    projectRootAnchor: anchor,
    requireStablePath: true,
  });
  if (!retained.bytes.equals(source.bytes))
    throw new Error("retained source changed during validation");
  return { path: target, sha256, bytes: source.bytes.length };
}

function main(argv) {
  const options = { projectRoot: process.cwd() };
  const flags = { "--project-root": "projectRoot", "--input": "input", "--sha256": "sha256" };
  for (let index = 0; index < argv.length; index += 1) {
    const key = flags[argv[index]];
    if (!key) throw new Error(`unknown argument ${argv[index]}`);
    options[key] = requireValue(argv, ++index, argv[index - 1]);
  }
  if (!options.input) throw new Error("--input is required and must be project-relative");
  process.stdout.write(JSON.stringify(retainSource(options)) + "\n");
}
if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(error.message + "\n");
    process.exitCode = 1;
  }
}
module.exports = { retainSource };
