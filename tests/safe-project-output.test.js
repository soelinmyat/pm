"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  createProjectInputVerificationContext,
  readProjectInput,
  resolveManagedDirectoryPointerTarget,
} = require("../scripts/lib/safe-project-output");
const { writeProjectDirectoryAtomic } = require("../scripts/lib/project-atomic-write");

function readManagedProjectInput(root, relativePath, maxBytes, options = {}) {
  return readProjectInput(root, relativePath, maxBytes, {
    ...options,
    allowManagedDirectoryPointers: true,
  });
}

test("Windows managed pointer resolution accepts legacy and junction sibling targets", () => {
  const canonical = "capture-1";
  const canonicalHash = crypto.createHash("sha256").update(canonical).digest("hex");
  const target = `.pm-dir-bundle-${canonicalHash.slice(0, 32)}-${"0".repeat(48)}`;
  const pointer = `C:\\repo\\evidence\\${canonical}`;
  const expected = `C:\\repo\\evidence\\${target}`;

  assert.deepEqual(resolveManagedDirectoryPointerTarget(pointer, canonical, target, "win32"), {
    bundlePath: expected,
    targetBasename: target,
  });
  assert.deepEqual(resolveManagedDirectoryPointerTarget(pointer, canonical, expected, "win32"), {
    bundlePath: expected,
    targetBasename: target,
  });
  assert.deepEqual(
    resolveManagedDirectoryPointerTarget(
      `\\\\server\\share\\repo\\evidence\\${canonical}`,
      canonical,
      target,
      "win32"
    ),
    {
      bundlePath: `\\\\server\\share\\repo\\evidence\\${target}`,
      targetBasename: target,
    }
  );
  assert.throws(
    () =>
      resolveManagedDirectoryPointerTarget(pointer, canonical, `C:\\outside\\${target}`, "win32"),
    /unrecognized or escaping pointer/
  );
});

test("safe project input tolerates repeated sibling churn in stable ancestor directories", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-safe-sibling-churn-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const evidenceDir = path.join(root, "evidence");
  const target = path.join(evidenceDir, "item.json");
  const sibling = path.join(evidenceDir, "unrelated.lock");
  fs.mkdirSync(evidenceDir);
  fs.writeFileSync(target, '{"stable":true}\n');
  const canonicalTarget = fs.realpathSync(target);

  const originalOpen = fs.openSync;
  let churnCount = 0;
  fs.openSync = function churnBeforeOpen(file, ...args) {
    if (churnCount < 6 && path.resolve(String(file)) === canonicalTarget) {
      churnCount += 1;
      fs.writeFileSync(sibling, "coordination\n");
      fs.rmSync(sibling);
    }
    return Reflect.apply(originalOpen, fs, [file, ...args]);
  };
  try {
    const input = readProjectInput(root, "evidence/item.json", 1024);
    assert.equal(input.bytes.toString("utf8"), '{"stable":true}\n');
    assert.equal(churnCount, 6);
  } finally {
    fs.openSync = originalOpen;
  }
});

test("ancestor-churn retry stays bound to the first project topology", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-safe-retry-root-"));
  const parkedRoot = `${root}.original`;
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(parkedRoot, { recursive: true, force: true });
  });
  const evidenceDir = path.join(root, "evidence");
  const target = path.join(evidenceDir, "item.json");
  const sibling = path.join(evidenceDir, "unrelated.lock");
  fs.mkdirSync(evidenceDir);
  fs.writeFileSync(target, '{"source":"original"}\n');
  const canonicalTarget = fs.realpathSync(target);

  const originalOpen = fs.openSync;
  const originalClose = fs.closeSync;
  let targetDescriptor;
  let rootReplaced = false;
  fs.openSync = function churnBeforeOpen(file, ...args) {
    const descriptor = Reflect.apply(originalOpen, fs, [file, ...args]);
    if (targetDescriptor === undefined && path.resolve(String(file)) === canonicalTarget) {
      targetDescriptor = descriptor;
      fs.writeFileSync(sibling, "coordination\n");
      fs.rmSync(sibling);
    }
    return descriptor;
  };
  fs.closeSync = function replaceRootAfterFailedAttempt(descriptor, ...args) {
    const result = Reflect.apply(originalClose, fs, [descriptor, ...args]);
    if (!rootReplaced && descriptor === targetDescriptor) {
      rootReplaced = true;
      fs.renameSync(root, parkedRoot);
      fs.mkdirSync(path.join(root, "evidence"), { recursive: true });
      fs.writeFileSync(path.join(root, "evidence", "item.json"), '{"source":"replacement"}\n');
    }
    return result;
  };
  try {
    assert.throws(
      () => readProjectInput(root, "evidence/item.json", 1024, { requireStablePath: true }),
      /input changed during containment validation/
    );
    assert.equal(rootReplaced, true);
  } finally {
    fs.openSync = originalOpen;
    fs.closeSync = originalClose;
  }
});

test("safe project input rejects an oversized managed inventory before reading payloads", (t) => {
  if (process.platform === "win32") return t.skip("directory symlink setup requires privileges");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-safe-managed-budget-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const parent = path.join(root, "evidence");
  fs.mkdirSync(parent);
  const canonical = "capture-1";
  const nonce = "0".repeat(48);
  const canonicalHash = crypto.createHash("sha256").update(canonical).digest("hex");
  const target = `.pm-dir-bundle-${canonicalHash.slice(0, 32)}-${nonce}`;
  const bundle = path.join(parent, target);
  fs.mkdirSync(bundle);
  const bundleStat = fs.lstatSync(bundle, { bigint: true });
  fs.writeFileSync(
    path.join(bundle, ".pm-directory-pointer.json"),
    `${JSON.stringify({
      schema_version: 1,
      kind: "pm-managed-directory-bundle",
      canonical_basename_sha256: canonicalHash,
      target_basename: target,
      nonce,
      bundle_dev: bundleStat.dev.toString(),
      bundle_ino: bundleStat.ino.toString(),
      commit_file: "capture.json",
      files: [
        {
          name: "capture.json",
          size: 128 * 1024 * 1024 + 1,
          sha256: `sha256:${"0".repeat(64)}`,
        },
      ],
    })}\n`
  );
  fs.symlinkSync(target, path.join(parent, canonical), "dir");
  assert.throws(
    () => readManagedProjectInput(root, "evidence/capture-1/capture.json", 1),
    /payload inventory exceeds its safety budget/
  );
});

test("safe project input transparently reads a tightly branded managed directory pointer", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-safe-managed-pointer-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeProjectDirectoryAtomic(
    root,
    "evidence/capture-1",
    [
      ["capture.png", Buffer.from([1, 2, 3])],
      ["capture.json", "manifest"],
    ],
    { commitFile: "capture.json" }
  );

  const canonical = path.join(root, "evidence", "capture-1");
  assert.equal(fs.lstatSync(canonical).isSymbolicLink(), true);
  assert.throws(
    () => readProjectInput(root, "evidence/capture-1/capture.json", 1024),
    /project path contains symlink/
  );
  assert.equal(
    readManagedProjectInput(root, "evidence/capture-1/capture.json", 1024).bytes.toString("utf8"),
    "manifest"
  );
  assert.equal(
    typeof readManagedProjectInput(root, "evidence/capture-1/capture.json", 1024, {
      requireStablePath: true,
    }).stablePathIdentity,
    "string"
  );
});

test("managed directory verification context hashes the full bundle once across member reads", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-safe-managed-cache-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const payloads = new Map([
    ["capture.png", Buffer.alloc(128 * 1024 + 17, 1)],
    ["accessibility-tree-raw.json", Buffer.from('{"kind":"a11y"}\n')],
    ["dom-audit-raw.json", Buffer.from('{"kind":"dom"}\n')],
    ["network-ledger.json", Buffer.from('{"kind":"network"}\n')],
    ["capture.json", Buffer.from('{"kind":"manifest"}\n')],
  ]);
  writeProjectDirectoryAtomic(root, "evidence/capture-1", [...payloads], {
    commitFile: "capture.json",
  });

  const canonical = path.join(root, "evidence", "capture-1");
  const bundle = fs.realpathSync(canonical);
  const payloadPaths = new Set([...payloads.keys()].map((name) => path.join(bundle, name)));
  const bytesRead = new Map([...payloadPaths].map((file) => [file, 0]));
  const descriptorPaths = new Map();
  const originalOpen = fs.openSync;
  const originalRead = fs.readSync;
  const originalClose = fs.closeSync;
  fs.openSync = function trackManagedPayloadOpen(file, ...args) {
    const descriptor = Reflect.apply(originalOpen, fs, [file, ...args]);
    const resolved = path.resolve(String(file));
    if (payloadPaths.has(resolved)) descriptorPaths.set(descriptor, resolved);
    return descriptor;
  };
  fs.readSync = function trackManagedPayloadRead(descriptor, ...args) {
    const count = Reflect.apply(originalRead, fs, [descriptor, ...args]);
    const file = descriptorPaths.get(descriptor);
    if (file && count > 0) bytesRead.set(file, bytesRead.get(file) + count);
    return count;
  };
  fs.closeSync = function trackManagedPayloadClose(descriptor, ...args) {
    descriptorPaths.delete(descriptor);
    return Reflect.apply(originalClose, fs, [descriptor, ...args]);
  };

  try {
    const verificationContext = createProjectInputVerificationContext();
    for (const name of ["capture.json", "accessibility-tree-raw.json", "dom-audit-raw.json"]) {
      assert.deepEqual(
        readManagedProjectInput(root, `evidence/capture-1/${name}`, 1024 * 1024, {
          managedDirectoryVerificationContext: verificationContext,
        }).bytes,
        payloads.get(name)
      );
    }

    for (const [name, bytes] of payloads) {
      const expectedReads = [
        "capture.json",
        "accessibility-tree-raw.json",
        "dom-audit-raw.json",
      ].includes(name)
        ? 2
        : 1;
      assert.equal(bytesRead.get(path.join(bundle, name)), bytes.length * expectedReads, name);
    }

    readManagedProjectInput(root, "evidence/capture-1/network-ledger.json", 1024 * 1024, {
      managedDirectoryVerificationContext: verificationContext,
    });
    assert.equal(
      bytesRead.get(path.join(bundle, "network-ledger.json")),
      payloads.get("network-ledger.json").length * 2
    );
    assert.equal(
      bytesRead.get(path.join(bundle, "capture.png")),
      payloads.get("capture.png").length
    );
  } finally {
    fs.openSync = originalOpen;
    fs.readSync = originalRead;
    fs.closeSync = originalClose;
  }
});

test("managed directory verification context rejects sibling mutation between member reads", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-safe-managed-cache-mutation-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeProjectDirectoryAtomic(
    root,
    "evidence/capture-1",
    [
      ["capture.png", Buffer.from([1, 2, 3])],
      ["capture.json", "manifest"],
      ["network-ledger.json", "network"],
    ],
    { commitFile: "capture.json" }
  );
  const verificationContext = createProjectInputVerificationContext();
  readManagedProjectInput(root, "evidence/capture-1/capture.json", 1024, {
    managedDirectoryVerificationContext: verificationContext,
  });

  const canonical = path.join(root, "evidence", "capture-1");
  const bundle = path.join(path.dirname(canonical), fs.readlinkSync(canonical));
  fs.writeFileSync(path.join(bundle, "capture.png"), Buffer.from([9, 8, 7]));
  assert.throws(
    () =>
      readManagedProjectInput(root, "evidence/capture-1/network-ledger.json", 1024, {
        managedDirectoryVerificationContext: verificationContext,
      }),
    /changed after verified bundle inspection/
  );
});

test("safe project input rejects managed bundle mutation and outside hardlinks", (t) => {
  for (const scenario of ["same-size", "hardlink", "manifest-hardlink"]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `pm-safe-managed-${scenario}-`));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    writeProjectDirectoryAtomic(
      root,
      "evidence/capture-1",
      [
        ["capture.png", Buffer.from([1, 2, 3])],
        ["capture.json", "manifest"],
      ],
      { commitFile: "capture.json" }
    );
    const canonical = path.join(root, "evidence", "capture-1");
    const bundle = path.join(root, "evidence", fs.readlinkSync(canonical));
    if (scenario === "same-size") {
      fs.writeFileSync(path.join(bundle, "capture.png"), Buffer.from([9, 8, 7]));
      assert.throws(
        () => readManagedProjectInput(root, "evidence/capture-1/capture.json", 1024),
        /differs from its inventory/
      );
    } else if (scenario === "hardlink") {
      fs.linkSync(path.join(bundle, "capture.png"), path.join(root, "outside-link.png"));
      assert.throws(
        () => readManagedProjectInput(root, "evidence/capture-1/capture.json", 1024),
        /non-regular entry/
      );
    } else {
      fs.linkSync(
        path.join(bundle, ".pm-directory-pointer.json"),
        path.join(root, "outside-manifest-link.json")
      );
      assert.throws(
        () => readManagedProjectInput(root, "evidence/capture-1/capture.json", 1024),
        /manifest is not a bounded regular file/
      );
    }
  }
});

test("safe project input rejects unbranded and escaping directory symlinks", (t) => {
  if (process.platform === "win32") return t.skip("directory symlink setup requires privileges");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-safe-managed-brand-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "pm-safe-managed-brand-outside-"));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(root, "evidence"));
  fs.writeFileSync(path.join(outside, "capture.json"), "outside");
  fs.symlinkSync(outside, path.join(root, "evidence", "ordinary"), "dir");
  fs.symlinkSync("../outside", path.join(root, "evidence", "escaping"), "dir");
  assert.throws(
    () => readManagedProjectInput(root, "evidence/ordinary/capture.json", 1024),
    /project path contains symlink/
  );
  assert.throws(
    () => readManagedProjectInput(root, "evidence/escaping/capture.json", 1024),
    /project path contains symlink/
  );
});

test("safe project input rejects a managed pointer whose absolute target escapes its parent", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-safe-managed-sibling-root-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "pm-safe-managed-sibling-outside-"));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  const parent = path.join(root, "evidence");
  fs.mkdirSync(parent);
  const canonicalBasename = "capture-1";
  const canonicalHash = crypto.createHash("sha256").update(canonicalBasename).digest("hex");
  const target = `.pm-dir-bundle-${canonicalHash.slice(0, 32)}-${"0".repeat(48)}`;
  const outsideBundle = path.join(outside, target);
  fs.mkdirSync(outsideBundle);
  fs.symlinkSync(
    outsideBundle,
    path.join(parent, canonicalBasename),
    process.platform === "win32" ? "junction" : "dir"
  );

  assert.throws(
    () => readManagedProjectInput(root, "evidence/capture-1/capture.json", 1024),
    /unrecognized or escaping pointer/
  );
});

test("safe project input detects a managed pointer swap during physical open", (t) => {
  if (process.platform === "win32") return t.skip("directory symlink setup requires privileges");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-safe-managed-pointer-swap-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const id of ["capture-1", "capture-2"])
    writeProjectDirectoryAtomic(root, `evidence/${id}`, [["capture.json", "same"]], {
      commitFile: "capture.json",
    });
  const canonical = path.join(root, "evidence", "capture-1");
  const replacementTarget = fs.readlinkSync(path.join(root, "evidence", "capture-2"));
  const physical = fs.realpathSync(
    path.join(root, "evidence", fs.readlinkSync(canonical), "capture.json")
  );
  const originalOpen = fs.openSync;
  let physicalOpens = 0;
  fs.openSync = function swapPointer(file, ...args) {
    if (path.resolve(String(file)) === path.resolve(physical) && ++physicalOpens === 2) {
      fs.unlinkSync(canonical);
      fs.symlinkSync(replacementTarget, canonical, "dir");
    }
    return Reflect.apply(originalOpen, fs, [file, ...args]);
  };
  try {
    assert.throws(
      () => readManagedProjectInput(root, "evidence/capture-1/capture.json", 1024),
      /managed pointer|unrecognized managed pointer|containment validation/
    );
    assert.equal(physicalOpens >= 2, true);
  } finally {
    fs.openSync = originalOpen;
  }
});

test("safe project input detects a managed backing-directory swap during physical open", (t) => {
  if (process.platform === "win32") return t.skip("directory rename semantics differ on Windows");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-safe-managed-target-swap-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeProjectDirectoryAtomic(root, "evidence/capture-1", [["capture.json", "same"]], {
    commitFile: "capture.json",
  });
  const canonical = path.join(root, "evidence", "capture-1");
  const bundle = path.join(root, "evidence", fs.readlinkSync(canonical));
  const parked = `${bundle}.parked`;
  const physical = fs.realpathSync(path.join(bundle, "capture.json"));
  const originalOpen = fs.openSync;
  let physicalOpens = 0;
  fs.openSync = function swapTarget(file, ...args) {
    if (path.resolve(String(file)) === path.resolve(physical) && ++physicalOpens === 2) {
      fs.renameSync(bundle, parked);
      fs.cpSync(parked, bundle, { recursive: true });
    }
    return Reflect.apply(originalOpen, fs, [file, ...args]);
  };
  try {
    assert.throws(
      () => readManagedProjectInput(root, "evidence/capture-1/capture.json", 1024),
      /target changed|manifest shape or binding|containment validation/
    );
    assert.equal(physicalOpens >= 2, true);
  } finally {
    fs.openSync = originalOpen;
  }
});

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

test("descriptor-bound input rejects a pre-open FIFO replacement without blocking", (t) => {
  if (process.platform === "win32") {
    t.skip("POSIX FIFO regression");
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-safe-input-fifo-race-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fifoProbe = path.join(root, "fifo-probe");
  try {
    execFileSync("mkfifo", [fifoProbe]);
    fs.unlinkSync(fifoProbe);
  } catch {
    t.skip("mkfifo is unavailable");
    return;
  }
  const file = path.join(root, "evidence.json");
  fs.writeFileSync(file, '{"inside":true}\n');
  const canonicalFile = fs.realpathSync(file);

  const originalOpen = fs.openSync;
  let swapped = false;
  fs.openSync = function swapToFifoBeforeOpen(openPath, flags, ...args) {
    if (!swapped && path.resolve(String(openPath)) === canonicalFile) {
      swapped = true;
      fs.unlinkSync(file);
      execFileSync("mkfifo", [file]);
      assert.notEqual(
        flags & fs.constants.O_NONBLOCK,
        0,
        "descriptor open must be non-blocking before inspecting a raced file type"
      );
    }
    return Reflect.apply(originalOpen, fs, [openPath, flags, ...args]);
  };
  try {
    assert.throws(
      () => readProjectInput(root, "evidence.json", 1024, { requireStablePath: true }),
      /input must be an existing regular file/
    );
    assert.equal(swapped, true);
  } finally {
    fs.openSync = originalOpen;
  }
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
