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

test("stable-path input rejects a leaf replacement during read", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-safe-input-stable-inode-"));
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
    assert.throws(
      () => readProjectInput(root, "evidence.json", 1024, { requireStablePath: true }),
      /input (?:path )?changed during bounded read/
    );
  } finally {
    fs.readSync = originalRead;
  }
});

test("descriptor-bound input rejects an ancestor changed to a symlink during read", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-safe-input-ancestor-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const evidence = path.join(root, "evidence");
  const original = path.join(root, "evidence.original");
  const attacker = path.join(root, "evidence.attacker");
  fs.mkdirSync(evidence);
  fs.mkdirSync(attacker);
  fs.writeFileSync(path.join(evidence, "item.json"), '{"inside":true}\n');
  fs.writeFileSync(path.join(attacker, "item.json"), '{"inside":true}\n');

  const originalRead = fs.readSync;
  let swapped = false;
  fs.readSync = function patchedRead(...args) {
    if (!swapped) {
      swapped = true;
      fs.renameSync(evidence, original);
      fs.symlinkSync(attacker, evidence, "dir");
    }
    return Reflect.apply(originalRead, fs, args);
  };
  try {
    assert.throws(
      () =>
        readProjectInput(root, "evidence/item.json", 1024, {
          requireStablePath: true,
        }),
      /project path contains symlink|input path changed during bounded read/
    );
    assert.equal(swapped, true);
  } finally {
    fs.readSync = originalRead;
  }
});

test("stable-path input rejects an OUTSIDE-vs-INSIDE ancestor weave", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-safe-input-weave-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "pm-safe-input-weave-outside-"));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  const ancestor = path.join(root, "evidence");
  const parked = path.join(root, "evidence.inside");
  const target = path.join(ancestor, "item.txt");
  fs.mkdirSync(ancestor);
  fs.writeFileSync(target, "INSIDE\n");
  fs.writeFileSync(path.join(outside, "item.txt"), "OUTSIDE\n");
  const canonicalTarget = fs.realpathSync(target);

  function exposeOutside(run) {
    fs.renameSync(ancestor, parked);
    fs.symlinkSync(outside, ancestor, "dir");
    try {
      return run();
    } finally {
      fs.unlinkSync(ancestor);
      fs.renameSync(parked, ancestor);
    }
  }

  const originalLstatSync = fs.lstatSync;
  const originalOpenSync = fs.openSync;
  let openedOutside = false;
  fs.lstatSync = function weaveLeafSample(file, ...args) {
    if (path.resolve(String(file)) !== canonicalTarget) {
      return Reflect.apply(originalLstatSync, fs, [file, ...args]);
    }
    return exposeOutside(() => Reflect.apply(originalLstatSync, fs, [file, ...args]));
  };
  fs.openSync = function weaveDescriptorOpen(file, ...args) {
    if (path.resolve(String(file)) !== canonicalTarget) {
      return Reflect.apply(originalOpenSync, fs, [file, ...args]);
    }
    return exposeOutside(() => {
      openedOutside = true;
      return Reflect.apply(originalOpenSync, fs, [file, ...args]);
    });
  };
  try {
    assert.throws(
      () => readProjectInput(root, "evidence/item.txt", 1024, { requireStablePath: true }),
      /input changed during containment validation/
    );
    assert.equal(openedOutside, true);
  } finally {
    fs.lstatSync = originalLstatSync;
    fs.openSync = originalOpenSync;
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
