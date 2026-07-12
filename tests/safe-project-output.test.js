"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { readProjectInput } = require("../scripts/lib/safe-project-output");

test("descriptor-bound input rejects final-file and ancestor symlink swaps", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-safe-input-race-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "pm-safe-input-outside-"));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(root, "evidence"), { recursive: true });
  fs.writeFileSync(path.join(root, "evidence", "item.json"), '{"inside":true}\n');
  fs.writeFileSync(path.join(outside, "item.json"), '{"outside":true}\n');

  withOpenSwap(
    path.join(root, "evidence", "item.json"),
    () => {
      fs.renameSync(
        path.join(root, "evidence", "item.json"),
        path.join(root, "evidence", "item.original.json")
      );
      fs.symlinkSync(path.join(outside, "item.json"), path.join(root, "evidence", "item.json"));
    },
    () => {
      assert.throws(
        () => readProjectInput(root, "evidence/item.json", 1024),
        /symlink|ELOOP|changed during containment/
      );
    }
  );
  fs.rmSync(path.join(root, "evidence", "item.json"), { force: true });
  fs.renameSync(
    path.join(root, "evidence", "item.original.json"),
    path.join(root, "evidence", "item.json")
  );

  withOpenSwap(
    path.join(root, "evidence", "item.json"),
    () => {
      fs.renameSync(path.join(root, "evidence"), path.join(root, "evidence.original"));
      fs.symlinkSync(outside, path.join(root, "evidence"), "dir");
    },
    () => {
      assert.throws(
        () => readProjectInput(root, "evidence/item.json", 1024),
        /symlink|changed during containment/
      );
    }
  );
});

test("descriptor-bound input reads the opened inode when the path is replaced before read", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-safe-input-inode-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "evidence.json");
  fs.writeFileSync(file, '{"version":"opened"}\n');
  const originalRead = fs.readSync;
  let swapped = false;
  fs.readSync = function patchedRead(...args) {
    if (!swapped) {
      swapped = true;
      fs.renameSync(file, path.join(root, "evidence.opened.json"));
      fs.writeFileSync(file, '{"version":"replacement"}\n');
    }
    return originalRead.apply(fs, args);
  };
  try {
    const loaded = readProjectInput(root, "evidence.json", 1024);
    assert.equal(loaded.bytes.toString("utf8"), '{"version":"opened"}\n');
  } finally {
    fs.readSync = originalRead;
  }
});

function withOpenSwap(target, swap, run) {
  const originalOpen = fs.openSync;
  const canonicalTarget = fs.realpathSync(target);
  let swapped = false;
  fs.openSync = function patchedOpen(file, ...args) {
    if (!swapped && path.resolve(file) === canonicalTarget) {
      swapped = true;
      swap();
    }
    return originalOpen.call(fs, file, ...args);
  };
  try {
    run();
  } finally {
    fs.openSync = originalOpen;
  }
}
