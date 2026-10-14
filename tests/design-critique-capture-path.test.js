"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isManagedCaptureMemberPath,
  isManagedCaptureRawPath,
} = require("../scripts/lib/design-critique-capture-path");

test("managed capture paths use the canonical session and capture layout", () => {
  for (const session of ["example", "ui_v2", "release.2_ui"]) {
    const base = `.pm/dev-sessions/${session}/design-critique/round-1/capture-primary-desktop`;
    assert.equal(isManagedCaptureMemberPath(`${base}/capture.png`), true);
    assert.equal(isManagedCaptureMemberPath(`${base}/capture.json`), true);
    assert.equal(isManagedCaptureRawPath(`${base}/dom-audit-raw.json`), true);
    assert.equal(isManagedCaptureRawPath(`${base}/accessibility-tree-raw.json`), true);
    assert.equal(isManagedCaptureRawPath(`${base}/capture.json`), false);
  }

  for (const invalid of [
    "evidence/capture-primary-desktop/capture.json",
    ".pm/dev-sessions/example/design-critique/round-3/capture-primary-desktop/capture.json",
    ".pm/dev-sessions/example/design-critique/round-1/not_a_slug/capture.json",
    ".pm/dev-sessions/example/design-critique/round-1/capture-primary-desktop/other.json",
    ".pm/dev-sessions/../design-critique/round-1/capture-primary-desktop/capture.json",
  ]) {
    assert.equal(isManagedCaptureMemberPath(invalid), false);
    assert.equal(isManagedCaptureRawPath(invalid), false);
  }
});

const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { writeProjectDirectoryAtomic } = require("../scripts/lib/project-atomic-write");
const { readProjectInput } = require("../scripts/lib/project-file");
for (const round of [1, 2, 50]) {
  test(`immutable managed capture paths admit bounded round ${round}`, () => {
    const base = `.pm/dev-sessions/example/design-critique/runs/dc_example/round-${round}/round-${round}/capture-primary-desktop-r${round}`;
    assert.equal(isManagedCaptureMemberPath(`${base}/capture.json`), true);
    assert.equal(isManagedCaptureRawPath(`${base}/dom-audit-raw.json`), true);
  });
}
test("immutable managed paths reject foreign members, round mismatch and overflow", () => {
  const base =
    ".pm/dev-sessions/example/design-critique/runs/dc_example/round-1/round-1/capture-primary-desktop-r1";
  for (const invalid of [
    base.replace("round-1/round-1", "round-1/round-2"),
    base.replaceAll("round-1", "round-51"),
    base.replace("dc_example", ".."),
    base.replace("capture-primary-desktop-r1", "capture-primary-desktop-r2"),
    base.replace("/runs/", "/foreign/"),
  ])
    assert.equal(isManagedCaptureMemberPath(`${invalid}/capture.json`), false);
  assert.equal(isManagedCaptureMemberPath(`${base}/foreign.json`), false);
});
test("immutable managed reads validate the actual branded bundle and reject mutation", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-immutable-bundle-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const base =
    ".pm/dev-sessions/example/design-critique/runs/dc_example/round-1/round-1/capture-primary-desktop-r1";
  writeProjectDirectoryAtomic(
    root,
    base,
    [
      ["capture.json", "manifest"],
      ["dom-audit-raw.json", "raw"],
    ],
    { commitFile: "capture.json" }
  );
  const file = `${base}/dom-audit-raw.json`;
  const read = () =>
    readProjectInput(root, file, 1024, {
      allowManagedDirectoryPointers: isManagedCaptureRawPath(file),
    });
  assert.equal(read().bytes.toString(), "raw");
  fs.writeFileSync(path.join(fs.realpathSync(path.join(root, base)), "dom-audit-raw.json"), "bad");
  assert.throws(read, /inventory|changed/);
});
