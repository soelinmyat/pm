"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const runtimeDir = path.join(root, "scripts", "lib", "workflow-runtime");

test("shared runtime modules do not import skill-owned policy", () => {
  const files = fs
    .readdirSync(runtimeDir)
    .filter((name) => name.endsWith(".js"))
    .sort();
  assert.deepEqual(files, [
    "authority.js",
    "capabilities.js",
    "effect-receipt.js",
    "model-profile.js",
    "prompt-packet.js",
    "records.js",
    "result-envelope.js",
    "structured-result.js",
  ]);
  for (const file of files) {
    const source = fs.readFileSync(path.join(runtimeDir, file), "utf8");
    assert.doesNotMatch(
      source,
      /(?:skills\/|dev-work|rfc-session|review-contract|design-critique)/,
      `${file} must not import skill-owned routing, approval, finding, artifact, or gate policy`
    );
  }
});

test("the project-file facade is the combined safe read/write boundary", () => {
  const projectFile = require("../scripts/lib/project-file");
  assert.deepEqual(Object.keys(projectFile).sort(), [
    "readProjectInput",
    "writeProjectFileAtomic",
    "writeProjectJsonAtomic",
    "writeProjectTextAtomic",
  ]);
  assert.equal(
    projectFile.readProjectInput,
    require("../scripts/lib/safe-project-output").readProjectInput
  );
  assert.equal(
    projectFile.writeProjectJsonAtomic,
    require("../scripts/lib/project-atomic-write").writeProjectJsonAtomic
  );
});

test("legacy Dev capability path is a compatibility export of the shared primitive", () => {
  assert.equal(
    require("../scripts/dev-runtime/capabilities"),
    require("../scripts/lib/workflow-runtime/capabilities")
  );
});

test("RFC lifecycle transitions use the shared common-field constructor", () => {
  const source = fs.readFileSync(
    path.join(root, "scripts", "lib", "rfc-session-schema.js"),
    "utf8"
  );
  assert.doesNotMatch(source, /\.history\.push\(\{/);
  assert.match(source, /createTransition/);
});
