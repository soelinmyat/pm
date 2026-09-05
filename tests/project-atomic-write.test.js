"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const projectWriter = require("../scripts/lib/project-atomic-write");
const { writeProjectDirectoryAtomic, writeProjectJsonAtomic, writeProjectTextAtomic } =
  projectWriter;

const writerModule = path.join(__dirname, "..", "scripts", "lib", "project-atomic-write.js");

test("project writer atomically replaces or exclusively creates inside anchored directories", (t) => {
  assert.deepEqual(Object.keys(projectWriter).sort(), [
    "writeProjectDirectoryAtomic",
    "writeProjectFileAtomic",
    "writeProjectJsonAtomic",
    "writeProjectTextAtomic",
  ]);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-project-write-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const created = writeProjectJsonAtomic(
    root,
    ".pm/review/report.json",
    { version: 1 },
    { fileMode: 0o600 }
  );
  assert.equal(created.committed, true);
  assert.equal(typeof created.directory_synced, "boolean");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, ".pm/review/report.json"))), {
    version: 1,
  });
  writeProjectTextAtomic(root, ".pm/review/report.json", "replacement", { fileMode: 0o600 });
  assert.equal(fs.readFileSync(path.join(root, ".pm/review/report.json"), "utf8"), "replacement");
  assert.throws(
    () =>
      writeProjectTextAtomic(root, ".pm/review/report.json", "forbidden", {
        replace: false,
      }),
    /EEXIST|file exists/i
  );
});

test("project directory writer publishes an exclusive attested bundle", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-project-directory-write-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const state = writeProjectDirectoryAtomic(
    root,
    ".pm/captures/capture-1",
    [
      ["capture.json", '{"version":1}\n'],
      ["capture.png", Buffer.from([0, 1, 2, 255])],
    ],
    { commitFile: "capture.json", fileMode: 0o600, directoryMode: 0o700, maxBytes: 1024 }
  );
  assert.equal(state.committed, true);
  assert.equal(typeof state.directory_synced, "boolean");
  assert.equal(
    fs.readFileSync(path.join(root, ".pm/captures/capture-1/capture.json"), "utf8"),
    '{"version":1}\n'
  );
  assert.deepEqual(
    fs.readFileSync(path.join(root, ".pm/captures/capture-1/capture.png")),
    Buffer.from([0, 1, 2, 255])
  );
  assert.throws(
    () =>
      writeProjectDirectoryAtomic(
        root,
        ".pm/captures/capture-1",
        [["capture.json", "replacement"]],
        { commitFile: "capture.json" }
      ),
    /already exists/
  );
});

test("project directory writer rejects an ancestor swap before its child anchors the root", (t) => {
  if (process.platform === "win32")
    return t.skip("directory symlink setup requires privileges on Windows");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-project-directory-race-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "pm-project-directory-outside-"));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(root, "evidence"));
  assert.throws(
    () =>
      writeProjectDirectoryAtomic(root, "evidence/capture-1", [["capture.json", "unsafe"]], {
        commitFile: "capture.json",
        beforeSpawn() {
          fs.renameSync(path.join(root, "evidence"), path.join(root, "evidence-original"));
          fs.symlinkSync(outside, path.join(root, "evidence"), "dir");
        },
      }),
    /not a real directory/
  );
  assert.equal(fs.existsSync(path.join(outside, "capture-1")), false);
  assert.equal(fs.existsSync(path.join(root, "evidence-original", "capture-1")), false);
});

test("project directory writer never replaces a concurrently-created empty destination", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-project-directory-exclusive-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "evidence", "round"), { recursive: true });
  const preload = path.join(root, "reserve-destination-preload.cjs");
  fs.writeFileSync(
    preload,
    `
      const fs = require("node:fs");
      const originalMkdir = fs.mkdirSync;
      let reserved = false;
      fs.mkdirSync = function(target, options) {
        if (
          !reserved &&
          process.argv.includes("--child-directory") &&
          target === "capture-1"
        ) {
          reserved = true;
          originalMkdir.call(fs, target, options);
        }
        return originalMkdir.call(fs, target, options);
      };
    `
  );
  const script = `
    const [root, writer] = process.argv.slice(1);
    const { writeProjectDirectoryAtomic } = require(writer);
    writeProjectDirectoryAtomic(
      root,
      "evidence/round/capture-1",
      [["capture.json", "must-not-publish"]],
      { commitFile: "capture.json" }
    );
  `;
  const result = spawnSync(process.execPath, ["-e", script, root, writerModule], {
    encoding: "utf8",
    env: { ...process.env, NODE_OPTIONS: `--require=${preload}` },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /EEXIST|file exists/i);
  const destination = path.join(root, "evidence", "round", "capture-1");
  assert.equal(fs.lstatSync(destination).isDirectory(), true);
  assert.deepEqual(fs.readdirSync(destination), []);
});

test("project directory writer preserves committed state after the commit marker", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-project-directory-marker-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "evidence"));
  const preload = path.join(root, "marker-fsync-preload.cjs");
  fs.writeFileSync(
    preload,
    `
      const fs = require("node:fs");
      const originalOpen = fs.openSync;
      let directoryOpens = 0;
      fs.openSync = function(file, ...args) {
        if (process.argv.includes("--child-directory-files") && file === ".") {
          directoryOpens += 1;
          if (directoryOpens === 2) {
            const error = new Error("injected post-marker sync failure");
            error.code = "EIO";
            throw error;
          }
        }
        return originalOpen.call(fs, file, ...args);
      };
    `
  );
  const script = `
    const [root, writer] = process.argv.slice(1);
    const { writeProjectDirectoryAtomic } = require(writer);
    try {
      writeProjectDirectoryAtomic(root, "evidence/capture-1", [
        ["capture.png", Buffer.from([1, 2, 3])],
        ["capture.json", "committed-manifest"]
      ], { commitFile: "capture.json" });
    } catch (error) {
      process.stdout.write(JSON.stringify({ message: error.message, committed: error.committed }));
    }
  `;
  const result = spawnSync(process.execPath, ["-e", script, root, writerModule], {
    encoding: "utf8",
    env: { ...process.env, NODE_OPTIONS: `--require=${preload}` },
  });
  assert.equal(result.status, 0, result.stderr);
  const failure = JSON.parse(result.stdout);
  assert.equal(failure.committed, true);
  assert.match(failure.message, /committed.*do not retry/i);
  assert.equal(
    fs.readFileSync(path.join(root, "evidence", "capture-1", "capture.json"), "utf8"),
    "committed-manifest"
  );
});

test("project directory writer cleans retryably when marker durability fails before publication", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-project-directory-marker-write-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "evidence"));
  const preload = path.join(root, "marker-write-preload.cjs");
  fs.writeFileSync(
    preload,
    `
      const fs = require("node:fs");
      const originalOpen = fs.openSync;
      const originalWriteFile = fs.writeFileSync;
      const originalFsync = fs.fsyncSync;
      let markerDescriptor;
      fs.openSync = function(file, ...args) {
        const descriptor = originalOpen.call(fs, file, ...args);
        if (
          process.argv.includes("--child-directory-files") &&
          typeof file === "string" &&
          file.startsWith(".capture.json.tmp-")
        ) markerDescriptor = descriptor;
        return descriptor;
      };
      fs.writeFileSync = function(target, ...args) {
        if (process.env.PM_TEST_MARKER_FAILURE === "write" && target === markerDescriptor) {
          const error = new Error("injected marker write failure");
          error.code = "EIO";
          throw error;
        }
        return originalWriteFile.call(fs, target, ...args);
      };
      fs.fsyncSync = function(descriptor, ...args) {
        if (process.env.PM_TEST_MARKER_FAILURE === "fsync" && descriptor === markerDescriptor) {
          const error = new Error("injected marker fsync failure");
          error.code = "EIO";
          throw error;
        }
        return originalFsync.call(fs, descriptor, ...args);
      };
    `
  );
  const script = `
    const [root, writer] = process.argv.slice(1);
    const { writeProjectDirectoryAtomic } = require(writer);
    try {
      writeProjectDirectoryAtomic(root, "evidence/capture-1", [
        ["capture.png", Buffer.from([1, 2, 3])],
        ["capture.json", "must-not-commit"]
      ], { commitFile: "capture.json" });
      process.stdout.write(JSON.stringify({ unexpected: "passed" }));
    } catch (error) {
      process.stdout.write(JSON.stringify({ message: error.message, committed: error.committed === true }));
    }
  `;
  for (const failureMode of ["write", "fsync"]) {
    const result = spawnSync(process.execPath, ["-e", script, root, writerModule], {
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_OPTIONS: `--require=${preload}`,
        PM_TEST_MARKER_FAILURE: failureMode,
      },
    });
    assert.equal(result.status, 0, `${failureMode}: ${result.stderr}`);
    const failure = JSON.parse(result.stdout);
    assert.equal(failure.committed, false, `${failureMode}: ${failure.message}`);
    assert.equal(failure.unexpected, undefined);
    assert.equal(fs.existsSync(path.join(root, "evidence", "capture-1")), false);
  }
});

test("anchored directory commit remains confined when its published ancestor is swapped", (t) => {
  if (process.platform === "win32")
    return t.skip("directory symlink setup requires privileges on Windows");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-project-directory-commit-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "pm-project-directory-commit-outside-"));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(root, "evidence", "round"), { recursive: true });
  fs.writeFileSync(path.join(outside, "sentinel.txt"), "outside-sentinel");
  const preload = path.join(root, "swap-directory-preload.cjs");
  fs.writeFileSync(
    preload,
    `
      const fs = require("node:fs");
      const path = require("node:path");
      const originalOpen = fs.openSync;
      let swapped = false;
      fs.openSync = function(file, ...args) {
        if (
          !swapped &&
          process.argv.includes("--child-directory-files") &&
          typeof file === "string" &&
          file.startsWith(".capture.json.tmp-")
        ) {
          swapped = true;
          fs.renameSync(
            path.join(process.env.PM_TEST_ROOT, "evidence", "round"),
            path.join(process.env.PM_TEST_ROOT, "evidence", "round-original")
          );
          fs.symlinkSync(
            process.env.PM_TEST_OUTSIDE,
            path.join(process.env.PM_TEST_ROOT, "evidence", "round"),
            "dir"
          );
        }
        return originalOpen.call(fs, file, ...args);
      };
    `
  );
  const script = `
    const [root, writer] = process.argv.slice(1);
    const { writeProjectDirectoryAtomic } = require(writer);
    writeProjectDirectoryAtomic(root, "evidence/round/capture-1", [
      ["capture.json", "inside-manifest"],
      ["capture.png", Buffer.from([1, 2, 3])]
    ], { commitFile: "capture.json" });
  `;
  const result = spawnSync(process.execPath, ["-e", script, root, writerModule], {
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_OPTIONS: `--require=${preload}`,
      PM_TEST_ROOT: root,
      PM_TEST_OUTSIDE: outside,
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /committed but path attestation failed/);
  assert.equal(fs.readFileSync(path.join(outside, "sentinel.txt"), "utf8"), "outside-sentinel");
  assert.equal(fs.existsSync(path.join(outside, "capture-1")), false);
  assert.equal(
    fs.readFileSync(
      path.join(root, "evidence", "round-original", "capture-1", "capture.json"),
      "utf8"
    ),
    "inside-manifest"
  );
});

test("project writer rejects an ancestor swap before its child anchors the root", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-project-write-race-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "pm-project-write-outside-"));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(root, "review"));
  fs.writeFileSync(path.join(outside, "report.json"), "outside-sentinel");
  assert.throws(
    () =>
      writeProjectTextAtomic(root, "review/report.json", "unsafe", {
        beforeSpawn() {
          fs.renameSync(path.join(root, "review"), path.join(root, "review-original"));
          fs.symlinkSync(outside, path.join(root, "review"), "dir");
        },
      }),
    /not a real directory/
  );
  assert.equal(fs.readFileSync(path.join(outside, "report.json"), "utf8"), "outside-sentinel");
});

test("project writer verifies input attestations inside the anchored child", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-project-write-attestation-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "inputs"));
  fs.writeFileSync(path.join(root, "inputs", "source.json"), '{"version":1}\n');
  const expected = `sha256:${crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(root, "inputs", "source.json")))
    .digest("hex")}`;
  assert.throws(
    () =>
      writeProjectTextAtomic(root, "output/result.json", "unsafe", {
        attestations: [{ path: "inputs/source.json", sha256: expected, maxBytes: 1024 }],
        beforeSpawn() {
          fs.writeFileSync(path.join(root, "inputs", "source.json"), '{"version":2}\n');
        },
      }),
    /atomic write attestation changed/
  );
  assert.equal(fs.existsSync(path.join(root, "output", "result.json")), false);
});

test("project writer rejects a project-root path swap during input attestation", (t) => {
  if (process.platform === "win32") return t.skip("directory rename semantics differ on Windows");
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "pm-project-root-attestation-"));
  const root = path.join(parent, "project");
  const originalRoot = path.join(parent, "project-original");
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "inputs"), { recursive: true });
  fs.mkdirSync(path.join(root, "output"));
  fs.writeFileSync(path.join(root, "inputs", "source.json"), '{"version":1}\n');
  const expected = `sha256:${crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(root, "inputs", "source.json")))
    .digest("hex")}`;
  const preload = path.join(parent, "swap-root-preload.cjs");
  fs.writeFileSync(
    preload,
    `
      const fs = require("node:fs");
      const path = require("node:path");
      const originalOpen = fs.openSync;
      let swapped = false;
      fs.openSync = function(file, ...args) {
        if (
          !swapped &&
          process.argv.includes("--child") &&
          typeof file === "string" &&
          file.endsWith("/inputs/source.json")
        ) {
          swapped = true;
          fs.renameSync(process.env.PM_TEST_ROOT, process.env.PM_TEST_ORIGINAL_ROOT);
          fs.mkdirSync(path.join(process.env.PM_TEST_ROOT, "inputs"), { recursive: true });
          fs.writeFileSync(process.env.PM_TEST_INPUT, '{"version":1}\\n');
        }
        return originalOpen.call(fs, file, ...args);
      };
    `
  );
  const script = `
    const [root, writer, expected] = process.argv.slice(1);
    const { writeProjectTextAtomic } = require(writer);
    writeProjectTextAtomic(root, "output/result.json", "unsafe", {
      attestations: [{ path: "inputs/source.json", sha256: expected, maxBytes: 1024 }]
    });
  `;
  const result = spawnSync(process.execPath, ["-e", script, root, writerModule, expected], {
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_OPTIONS: `--require=${preload}`,
      PM_TEST_ROOT: root,
      PM_TEST_ORIGINAL_ROOT: originalRoot,
      PM_TEST_INPUT: path.join(root, "inputs", "source.json"),
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /project root changed during input attestation/);
  assert.equal(fs.existsSync(path.join(originalRoot, "output", "result.json")), false);
  assert.equal(fs.existsSync(path.join(root, "output", "result.json")), false);
});

test("project writer compares the replace target after temporary output is durable", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-project-write-cas-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "output"));
  const target = path.join(root, "output", "result.json");
  fs.writeFileSync(target, '{"version":1}\n');
  const expected = `sha256:${crypto
    .createHash("sha256")
    .update(fs.readFileSync(target))
    .digest("hex")}`;
  const preload = path.join(root, "mutate-after-fsync.cjs");
  fs.writeFileSync(
    preload,
    `
      const fs = require("node:fs");
      const originalFsync = fs.fsyncSync;
      let mutated = false;
      fs.fsyncSync = function(descriptor) {
        const result = originalFsync.call(fs, descriptor);
        if (!mutated && process.argv.includes("--child")) {
          mutated = true;
          fs.writeFileSync(process.env.PM_TEST_CAS_TARGET, '{"version":2}\\n');
        }
        return result;
      };
    `
  );
  const script = `
    const [root, writer, expected] = process.argv.slice(1);
    const { writeProjectTextAtomic } = require(writer);
    writeProjectTextAtomic(root, "output/result.json", '{"version":3}\\n', {
      finalAttestation: { path: "output/result.json", sha256: expected, maxBytes: 1024 }
    });
  `;
  const result = spawnSync(process.execPath, ["-e", script, root, writerModule, expected], {
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_OPTIONS: `--require=${preload}`,
      PM_TEST_CAS_TARGET: target,
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /atomic write attestation changed/);
  assert.equal(fs.readFileSync(target, "utf8"), '{"version":2}\n');
});

test("anchored rename stays in the opened directory when its project path is swapped", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-project-write-commit-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "pm-project-write-commit-outside-"));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(root, "review"));
  fs.writeFileSync(path.join(outside, "report.html"), "outside-sentinel");
  const preload = path.join(root, "swap-preload.cjs");
  fs.writeFileSync(
    preload,
    `
      const fs = require("node:fs");
      const path = require("node:path");
      const originalRename = fs.renameSync;
      let swapped = false;
      fs.renameSync = function(source, destination) {
        if (!swapped && process.argv.includes("--child") && destination === "report.html") {
          swapped = true;
          originalRename(path.join(process.env.PM_TEST_ROOT, "review"), path.join(process.env.PM_TEST_ROOT, "review-original"));
          fs.symlinkSync(process.env.PM_TEST_OUTSIDE, path.join(process.env.PM_TEST_ROOT, "review"), "dir");
        }
        return originalRename(source, destination);
      };
    `
  );
  const script = `
    const [root, writer] = process.argv.slice(1);
    const { writeProjectTextAtomic } = require(writer);
    writeProjectTextAtomic(root, "review/report.html", "inside-report");
  `;
  const result = spawnSync(process.execPath, ["-e", script, root, writerModule], {
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_OPTIONS: `--require=${preload}`,
      PM_TEST_ROOT: root,
      PM_TEST_OUTSIDE: outside,
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /committed but path attestation failed/);
  assert.equal(fs.readFileSync(path.join(outside, "report.html"), "utf8"), "outside-sentinel");
  assert.equal(
    fs.readFileSync(path.join(root, "review-original", "report.html"), "utf8"),
    "inside-report"
  );
});

test("directory sync errors report committed state without creating retry ambiguity", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-project-write-fsync-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const preload = path.join(root, "fsync-preload.cjs");
  fs.writeFileSync(
    preload,
    `
      const fs = require("node:fs");
      const originalOpen = fs.openSync;
      fs.openSync = function(file, ...args) {
        if (process.argv.includes("--child") && file === ".") {
          const error = new Error("injected directory sync failure");
          error.code = process.env.PM_TEST_FSYNC_CODE;
          throw error;
        }
        return originalOpen.call(fs, file, ...args);
      };
    `
  );
  const script = `
    const [root, writer, relative, exclusive] = process.argv.slice(1);
    const { writeProjectTextAtomic } = require(writer);
    const result = writeProjectTextAtomic(root, relative, "committed", { replace: exclusive !== "true" });
    process.stdout.write(JSON.stringify(result));
  `;
  for (const [index, code] of ["EPERM", "EISDIR", "ENOSYS"].entries()) {
    const relative = `review/report-${index}.json`;
    const result = spawnSync(
      process.execPath,
      ["-e", script, root, writerModule, relative, String(index % 2 === 1)],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          NODE_OPTIONS: `--require=${preload}`,
          PM_TEST_FSYNC_CODE: code,
        },
      }
    );
    assert.equal(result.status, 0, `${code}: ${result.stderr}`);
    const state = JSON.parse(result.stdout);
    assert.deepEqual(
      {
        committed: state.committed,
        directory_synced: state.directory_synced,
        directory_sync_error: state.directory_sync_error,
      },
      { committed: true, directory_synced: false, directory_sync_error: code }
    );
    assert.equal(fs.readFileSync(path.join(root, relative), "utf8"), "committed");
  }

  const eioRelative = "review/report-eio.json";
  const eio = spawnSync(process.execPath, ["-e", script, root, writerModule, eioRelative, "true"], {
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_OPTIONS: `--require=${preload}`,
      PM_TEST_FSYNC_CODE: "EIO",
    },
  });
  assert.notEqual(eio.status, 0);
  assert.match(eio.stderr, /committed but directory sync failed \(EIO\); do not retry/);
  assert.equal(fs.readFileSync(path.join(root, eioRelative), "utf8"), "committed");
});

test("post-commit cleanup failures retain committed do-not-retry state", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-project-write-cleanup-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const preload = path.join(root, "cleanup-preload.cjs");
  fs.writeFileSync(
    preload,
    `
      const fs = require("node:fs");
      let installed = false;
      const originalLink = fs.linkSync;
      const originalRename = fs.renameSync;
      const originalUnlink = fs.unlinkSync;
      const originalClose = fs.closeSync;
      fs.linkSync = function(...args) { const value = originalLink.apply(fs, args); installed = true; return value; };
      fs.renameSync = function(...args) { const value = originalRename.apply(fs, args); installed = true; return value; };
      fs.unlinkSync = function(...args) {
        if (process.argv.includes("--child") && installed && process.env.PM_TEST_CLEANUP === "unlink") {
          const error = new Error("injected temporary unlink failure"); error.code = "EIO"; throw error;
        }
        return originalUnlink.apply(fs, args);
      };
      fs.closeSync = function(...args) {
        if (process.argv.includes("--child") && installed && process.env.PM_TEST_CLEANUP === "close") {
          installed = false;
          const error = new Error("injected descriptor close failure"); error.code = "EIO"; throw error;
        }
        return originalClose.apply(fs, args);
      };
    `
  );
  const script = `
    const [root, writer, relative, exclusive] = process.argv.slice(1);
    const { writeProjectTextAtomic } = require(writer);
    try {
      writeProjectTextAtomic(root, relative, "committed", { replace: exclusive !== "true" });
      process.stdout.write(JSON.stringify({ unexpected: "passed" }));
    } catch (error) {
      process.stdout.write(JSON.stringify({ message: error.message, committed: error.committed }));
    }
  `;
  for (const [cleanup, exclusive] of [
    ["unlink", true],
    ["close", true],
    ["close", false],
  ]) {
    const relative = `review/${cleanup}-${exclusive ? "exclusive" : "replace"}.json`;
    const result = spawnSync(
      process.execPath,
      ["-e", script, root, writerModule, relative, String(exclusive)],
      {
        encoding: "utf8",
        env: { ...process.env, NODE_OPTIONS: `--require=${preload}`, PM_TEST_CLEANUP: cleanup },
      }
    );
    assert.equal(result.status, 0, result.stderr);
    const error = JSON.parse(result.stdout);
    assert.equal(error.committed, true, `${cleanup}/${exclusive}: ${error.message}`);
    assert.match(error.message, /committed.*do not retry/i);
    assert.equal(fs.readFileSync(path.join(root, relative), "utf8"), "committed");
  }
});
