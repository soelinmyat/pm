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
