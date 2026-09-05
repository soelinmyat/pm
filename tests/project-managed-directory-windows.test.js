"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { writeProjectDirectoryAtomic } = require("../scripts/lib/project-atomic-write");
const { readProjectInput } = require("../scripts/lib/safe-project-output");

test(
  "Windows publishes and safely reads an immutable managed capture bundle",
  { skip: process.platform !== "win32" },
  (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-managed-directory-windows-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const relative =
      ".pm/dev-sessions/windows-smoke/design-critique/round-1/capture-example-primary-desktop-r1";
    const files = [
      ["capture.png", Buffer.from([0x89, 0x50, 0x4e, 0x47])],
      ["accessibility-tree-raw.json", "{}\n"],
      ["dom-audit-raw.json", "{}\n"],
      ["network-ledger.json", "{}\n"],
      ["capture.json", '{"schema_version":2}\n'],
    ];

    const published = writeProjectDirectoryAtomic(root, relative, files, {
      commitFile: "capture.json",
      fileMode: 0o600,
      directoryMode: 0o700,
      maxBytes: 1024,
    });

    const canonical = path.join(root, relative);
    assert.equal(published.committed, true);
    assert.equal(fs.lstatSync(canonical).isSymbolicLink(), true);
    const target = fs.readlinkSync(canonical);
    assert.equal(path.isAbsolute(target), false);
    assert.equal(path.basename(target), target);
    assert.match(target, /^\.pm-dir-bundle-[a-f0-9]{32}-[a-f0-9]{48}$/);
    assert.equal(fs.lstatSync(path.join(path.dirname(canonical), target)).isDirectory(), true);

    const loaded = readProjectInput(root, `${relative}/capture.json`, 1024, {
      allowManagedDirectoryPointers: true,
      requireStablePath: true,
    });
    assert.equal(loaded.bytes.toString("utf8"), '{"schema_version":2}\n');
    assert.equal(loaded.managedDirectory.target, target);
    assert.equal(typeof loaded.stablePathIdentity, "string");

    const retried = writeProjectDirectoryAtomic(root, relative, files, {
      commitFile: "capture.json",
      maxBytes: 1024,
    });
    assert.equal(retried.committed, true);
    assert.equal(
      fs.readdirSync(path.dirname(canonical)).filter((entry) => entry.startsWith(".pm-dir-bundle-"))
        .length,
      1
    );
  }
);
