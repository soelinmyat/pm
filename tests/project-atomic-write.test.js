"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const projectWriter = require("../scripts/lib/project-atomic-write");
const { readProjectInput } = require("../scripts/lib/safe-project-output");
const { writeProjectDirectoryAtomic, writeProjectJsonAtomic, writeProjectTextAtomic } =
  projectWriter;

const writerModule = path.join(__dirname, "..", "scripts", "lib", "project-atomic-write.js");

function bundleNames(root, parent = "evidence") {
  const directory = path.join(root, parent);
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory)
    .filter((name) => name.startsWith(".pm-dir-bundle-"))
    .sort();
}

async function waitForFile(file, message) {
  const deadline = Date.now() + 5_000;
  while (!fs.existsSync(file) && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(fs.existsSync(file), true, message);
}

test("project directory writer publishes one immutable managed bundle and reconciles exact retries", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-project-managed-bundle-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files = [
    ["a.json", "lower"],
    ["Z.json", "upper"],
    ["capture.png", Buffer.from([0, 1, 2, 255])],
    ["capture.json", '{"version":1}\n'],
  ];
  const state = writeProjectDirectoryAtomic(root, "evidence/capture-1", files, {
    commitFile: "capture.json",
    fileMode: 0o600,
    directoryMode: 0o700,
    maxBytes: 1024,
  });

  const canonical = path.join(root, "evidence", "capture-1");
  assert.equal(state.committed, true);
  assert.equal(fs.lstatSync(canonical).isSymbolicLink(), true);
  const target = fs.readlinkSync(canonical);
  assert.match(target, /^\.pm-dir-bundle-[a-f0-9]{32}-[a-f0-9]{48}$/);
  assert.equal(path.basename(target), target);
  const bundle = path.join(root, "evidence", target);
  assert.equal(fs.lstatSync(bundle).isDirectory(), true);
  assert.equal(fs.lstatSync(bundle).isSymbolicLink(), false);
  assert.equal(fs.readFileSync(path.join(canonical, "capture.json"), "utf8"), '{"version":1}\n');
  assert.deepEqual(
    readProjectInput(root, "evidence/capture-1/capture.png", 1024, {
      allowManagedDirectoryPointers: true,
    }).bytes,
    Buffer.from([0, 1, 2, 255])
  );
  const captureHash = `sha256:${crypto
    .createHash("sha256")
    .update('{"version":1}\n')
    .digest("hex")}`;
  assert.throws(
    () =>
      writeProjectTextAtomic(root, "evidence/untrusted-attestation.txt", "blocked", {
        attestations: [
          {
            path: "evidence/capture-1/capture.json",
            sha256: captureHash,
            maxBytes: 1024,
          },
        ],
      }),
    /project path contains symlink/
  );
  const attested = writeProjectTextAtomic(root, "evidence/managed-attestation.txt", "accepted", {
    attestations: [
      {
        path: "evidence/capture-1/capture.json",
        sha256: captureHash,
        maxBytes: 1024,
        allowManagedDirectoryPointers: true,
      },
    ],
  });
  assert.equal(attested.committed, true);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(bundle, ".pm-directory-pointer.json"), "utf8")
  );
  assert.equal(manifest.kind, "pm-managed-directory-bundle");
  assert.equal(manifest.target_basename, target);
  assert.deepEqual(
    manifest.files.map((file) => file.name),
    ["Z.json", "a.json", "capture.json", "capture.png"]
  );
  assert.equal(bundleNames(root).length, 1);

  const retried = writeProjectDirectoryAtomic(root, "evidence/capture-1", files, {
    commitFile: "capture.json",
    maxBytes: 1024,
  });
  assert.equal(retried.committed, true);
  assert.equal(bundleNames(root).length, 1, "an exact retry must reuse the published bundle");
  assert.throws(
    () =>
      writeProjectDirectoryAtomic(
        root,
        "evidence/capture-1",
        [["capture.json", '{"version":1}\n']],
        { commitFile: "capture.json" }
      ),
    /already exists/
  );
  assert.equal(
    bundleNames(root).length,
    1,
    "a subset retry must not accept a managed bundle with extra files"
  );
  assert.throws(
    () =>
      writeProjectDirectoryAtomic(root, "evidence/capture-1", [["capture.json", "different"]], {
        commitFile: "capture.json",
      }),
    /already exists/
  );
  assert.equal(bundleNames(root).length, 1, "a mismatched duplicate must fail before staging");

  for (const reserved of [
    ".pm-directory-pointer.json",
    ".pm-directory-pointer.json.candidate",
    ".pm-directory-owner.json",
    ".pm-directory-owner.json.candidate",
  ]) {
    assert.throws(
      () =>
        writeProjectDirectoryAtomic(root, `evidence/${reserved.slice(1)}`, [[reserved, "unsafe"]], {
          commitFile: reserved,
        }),
      /reserved for writer ownership/
    );
  }
});

test("project directory writer enforces the managed bundle safety ceiling", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-project-managed-budget-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(
    () =>
      writeProjectDirectoryAtomic(root, "evidence/capture-1", [["capture.json", "small"]], {
        commitFile: "capture.json",
        maxBytes: 128 * 1024 * 1024 + 1,
      }),
    /byte budget is invalid/
  );
  assert.deepEqual(bundleNames(root), []);
});

test("project directory writer reports unsupported parent reconciliation sync", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-project-managed-parent-sync-"));
  const preload = path.join(root, "unsupported-parent-sync.cjs");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(
    preload,
    `
      const fs = require("node:fs");
      const path = require("node:path");
      const originalOpen = fs.openSync;
      fs.openSync = function(target, ...args) {
        if (
          !process.argv.includes("--child-directory") &&
          path.basename(String(target)) === "evidence" &&
          fs.lstatSync(target).isDirectory()
        ) {
          const error = new Error("simulated unsupported directory sync");
          error.code = "EPERM";
          throw error;
        }
        return originalOpen.call(fs, target, ...args);
      };
    `
  );
  const script = `
    const [root, writer] = process.argv.slice(1);
    const state = require(writer).writeProjectDirectoryAtomic(
      root,
      "evidence/capture-1",
      [["capture.json", "durable-as-supported"]],
      { commitFile: "capture.json" }
    );
    process.stdout.write(JSON.stringify(state));
  `;
  const result = spawnSync(process.execPath, ["-e", script, root, writerModule], {
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_OPTIONS: `--require=${preload}`,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const state = JSON.parse(result.stdout);
  assert.equal(state.committed, true);
  assert.equal(state.directory_synced, false);
  assert.equal(state.directory_sync_error, "EPERM");
  assert.equal(
    fs.readFileSync(path.join(root, "evidence", "capture-1", "capture.json"), "utf8"),
    "durable-as-supported"
  );
});

test("project directory writer never replaces pre-existing real or arbitrary-symlink entries", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-project-managed-foreign-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "pm-project-managed-outside-"));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(root, "evidence", "capture-1"), { recursive: true });
  const foreignDirectory = fs.lstatSync(path.join(root, "evidence", "capture-1"));
  assert.throws(
    () =>
      writeProjectDirectoryAtomic(root, "evidence/capture-1", [["capture.json", "unsafe"]], {
        commitFile: "capture.json",
      }),
    /already exists/
  );
  const preservedDirectory = fs.lstatSync(path.join(root, "evidence", "capture-1"));
  assert.equal(preservedDirectory.dev, foreignDirectory.dev);
  assert.equal(preservedDirectory.ino, foreignDirectory.ino);
  assert.deepEqual(fs.readdirSync(path.join(root, "evidence", "capture-1")), []);
  assert.deepEqual(bundleNames(root), []);

  if (process.platform !== "win32") {
    fs.mkdirSync(path.join(outside, "foreign"));
    fs.symlinkSync(outside, path.join(root, "evidence", "capture-2"), "dir");
    const linkText = fs.readlinkSync(path.join(root, "evidence", "capture-2"));
    assert.throws(
      () =>
        writeProjectDirectoryAtomic(root, "evidence/capture-2", [["capture.json", "unsafe"]], {
          commitFile: "capture.json",
        }),
      /already exists/
    );
    assert.equal(fs.readlinkSync(path.join(root, "evidence", "capture-2")), linkText);
    assert.deepEqual(fs.readdirSync(outside), ["foreign"]);
    assert.deepEqual(bundleNames(root), []);
  }
});

test("project directory writer preserves a foreign entry won at final pointer publication", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-project-managed-final-race-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "evidence"));
  const preload = path.join(root, "foreign-pointer-winner.cjs");
  fs.writeFileSync(
    preload,
    `
      const fs = require("node:fs");
      const originalSymlink = fs.symlinkSync;
      const originalMkdir = fs.mkdirSync;
      let raced = false;
      fs.symlinkSync = function(target, destination, ...args) {
        if (!raced && process.argv.includes("--child-directory") && destination === "capture-1") {
          raced = true;
          originalMkdir.call(fs, destination);
        }
        return originalSymlink.call(fs, target, destination, ...args);
      };
    `
  );
  const script = `
    const [root, writer] = process.argv.slice(1);
    require(writer).writeProjectDirectoryAtomic(
      root,
      "evidence/capture-1",
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
  const destination = path.join(root, "evidence", "capture-1");
  assert.equal(fs.lstatSync(destination).isDirectory(), true);
  assert.equal(fs.lstatSync(destination).isSymbolicLink(), false);
  assert.deepEqual(fs.readdirSync(destination), []);
  assert.equal(bundleNames(root).length, 1, "unpublished race loser remains quarantined");
});

test("project directory writer retries after death before pointer publication", async (t) => {
  if (process.platform === "win32") return t.skip("signal semantics differ on Windows");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-project-managed-prepublish-death-"));
  const ready = path.join(root, "pointer-ready.json");
  const preload = path.join(root, "pause-before-pointer.cjs");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(
    preload,
    `
      const fs = require("node:fs");
      const originalSymlink = fs.symlinkSync;
      let paused = false;
      fs.symlinkSync = function(target, destination, ...args) {
        if (!paused && process.argv.includes("--child-directory") && destination === "capture-1") {
          paused = true;
          fs.writeFileSync(process.env.PM_TEST_READY, JSON.stringify({ pid: process.pid, target }));
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
        }
        return originalSymlink.call(fs, target, destination, ...args);
      };
    `
  );
  const script = `
    const [root, writer] = process.argv.slice(1);
    require(writer).writeProjectDirectoryAtomic(root, "evidence/capture-1", [
      ["capture.png", Buffer.from([1, 2, 3])],
      ["capture.json", "recovered"]
    ], { commitFile: "capture.json" });
  `;
  const active = spawn(process.execPath, ["-e", script, root, writerModule], {
    env: { ...process.env, NODE_OPTIONS: `--require=${preload}`, PM_TEST_READY: ready },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let childPid = null;
  t.after(() => {
    if (childPid)
      try {
        process.kill(childPid, "SIGKILL");
      } catch {
        // Already reaped.
      }
    if (active.exitCode === null && active.signalCode === null) active.kill("SIGKILL");
  });
  await waitForFile(ready, "directory child did not reach final pointer publication");
  childPid = JSON.parse(fs.readFileSync(ready, "utf8")).pid;
  assert.equal(fs.existsSync(path.join(root, "evidence", "capture-1")), false);
  assert.equal(bundleNames(root).length, 1);
  const exited = new Promise((resolve) => active.once("exit", resolve));
  process.kill(childPid, "SIGKILL");
  await exited;
  childPid = null;

  const recovered = writeProjectDirectoryAtomic(
    root,
    "evidence/capture-1",
    [
      ["capture.png", Buffer.from([1, 2, 3])],
      ["capture.json", "recovered"],
    ],
    { commitFile: "capture.json" }
  );
  assert.equal(recovered.committed, true);
  assert.equal(
    fs.readFileSync(path.join(root, "evidence", "capture-1", "capture.json"), "utf8"),
    "recovered"
  );
  assert.equal(bundleNames(root).length, 2, "the crash orphan must not block retry");
});

test("project directory writer retries after death during private manifest creation", async (t) => {
  if (process.platform === "win32") return t.skip("signal semantics differ on Windows");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-project-managed-manifest-death-"));
  const ready = path.join(root, "manifest-ready.json");
  const preload = path.join(root, "pause-during-manifest.cjs");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(
    preload,
    `
      const fs = require("node:fs");
      const originalOpen = fs.openSync;
      const originalWrite = fs.writeSync;
      let manifestDescriptor;
      let paused = false;
      fs.openSync = function(file, ...args) {
        const descriptor = originalOpen.call(fs, file, ...args);
        if (process.argv.includes("--child-directory") && file === ".pm-directory-pointer.json")
          manifestDescriptor = descriptor;
        return descriptor;
      };
      fs.writeSync = function(descriptor, buffer, offset, length, position) {
        if (!paused && descriptor === manifestDescriptor) {
          paused = true;
          const written = originalWrite.call(fs, descriptor, buffer, offset, Math.min(16, length), position);
          fs.writeFileSync(process.env.PM_TEST_READY, JSON.stringify({ pid: process.pid, written }));
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
          return written;
        }
        return originalWrite.call(fs, descriptor, buffer, offset, length, position);
      };
    `
  );
  const script = `
    const [root, writer] = process.argv.slice(1);
    require(writer).writeProjectDirectoryAtomic(
      root,
      "evidence/capture-1",
      [["capture.json", "recovered"]],
      { commitFile: "capture.json" }
    );
  `;
  const active = spawn(process.execPath, ["-e", script, root, writerModule], {
    env: { ...process.env, NODE_OPTIONS: `--require=${preload}`, PM_TEST_READY: ready },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let childPid = null;
  t.after(() => {
    if (childPid)
      try {
        process.kill(childPid, "SIGKILL");
      } catch {
        // Already reaped.
      }
    if (active.exitCode === null && active.signalCode === null) active.kill("SIGKILL");
  });
  await waitForFile(ready, "directory child did not partially write its private manifest");
  const observed = JSON.parse(fs.readFileSync(ready, "utf8"));
  childPid = observed.pid;
  assert.equal(observed.written > 0 && observed.written <= 16, true);
  assert.equal(fs.existsSync(path.join(root, "evidence", "capture-1")), false);
  const exited = new Promise((resolve) => active.once("exit", resolve));
  process.kill(childPid, "SIGKILL");
  await exited;
  childPid = null;

  const recovered = writeProjectDirectoryAtomic(
    root,
    "evidence/capture-1",
    [["capture.json", "recovered"]],
    { commitFile: "capture.json" }
  );
  assert.equal(recovered.committed, true);
  assert.equal(
    fs.readFileSync(path.join(root, "evidence", "capture-1", "capture.json"), "utf8"),
    "recovered"
  );
});

test("project directory writer reconciles death immediately after pointer publication", (t) => {
  if (process.platform === "win32") return t.skip("signal semantics differ on Windows");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-project-managed-postpublish-death-"));
  const preload = path.join(root, "die-after-pointer.cjs");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(
    preload,
    `
      const fs = require("node:fs");
      const originalSymlink = fs.symlinkSync;
      fs.symlinkSync = function(target, destination, ...args) {
        const result = originalSymlink.call(fs, target, destination, ...args);
        if (process.argv.includes("--child-directory") && destination === "capture-1")
          process.kill(process.pid, "SIGKILL");
        return result;
      };
    `
  );
  const script = `
    const [root, writer] = process.argv.slice(1);
    try {
      require(writer).writeProjectDirectoryAtomic(
        root,
        "evidence/capture-1",
        [["capture.json", "published"]],
        { commitFile: "capture.json" }
      );
      process.stdout.write(JSON.stringify({ unexpected: true }));
    } catch (error) {
      process.stdout.write(JSON.stringify({ committed: error.committed, message: error.message }));
    }
  `;
  const result = spawnSync(process.execPath, ["-e", script, root, writerModule], {
    encoding: "utf8",
    env: { ...process.env, NODE_OPTIONS: `--require=${preload}` },
  });
  assert.equal(result.status, 0, result.stderr);
  const failure = JSON.parse(result.stdout);
  assert.equal(failure.unexpected, undefined);
  assert.equal(failure.committed, true);
  assert.match(failure.message, /committed.*do not retry/i);
  assert.equal(
    fs.readFileSync(path.join(root, "evidence", "capture-1", "capture.json"), "utf8"),
    "published"
  );
  assert.equal(
    writeProjectDirectoryAtomic(root, "evidence/capture-1", [["capture.json", "published"]], {
      commitFile: "capture.json",
    }).committed,
    true
  );
  assert.equal(bundleNames(root).length, 1);
});

test("project directory writer cold-retries after its whole invocation dies post-publication", (t) => {
  if (process.platform === "win32") return t.skip("signal semantics differ on Windows");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-project-managed-cold-retry-"));
  const preload = path.join(root, "die-with-parent-after-pointer.cjs");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(
    preload,
    `
      const fs = require("node:fs");
      const originalSymlink = fs.symlinkSync;
      fs.symlinkSync = function(target, destination, ...args) {
        const result = originalSymlink.call(fs, target, destination, ...args);
        if (process.argv.includes("--child-directory") && destination === "capture-1") {
          const wrapperPid = process.ppid;
          try { process.kill(wrapperPid, "SIGKILL"); } finally { process.kill(process.pid, "SIGKILL"); }
        }
        return result;
      };
    `
  );
  const script = `
    const [root, writer] = process.argv.slice(1);
    require(writer).writeProjectDirectoryAtomic(
      root,
      "evidence/capture-1",
      [["capture.json", "cold-recovered"]],
      { commitFile: "capture.json" }
    );
  `;
  const killed = spawnSync(process.execPath, ["-e", script, root, writerModule], {
    encoding: "utf8",
    env: { ...process.env, NODE_OPTIONS: `--require=${preload}` },
  });
  assert.equal(killed.signal, "SIGKILL");
  assert.equal(
    fs.readFileSync(path.join(root, "evidence", "capture-1", "capture.json"), "utf8"),
    "cold-recovered"
  );
  assert.equal(bundleNames(root).length, 1);

  const recovered = writeProjectDirectoryAtomic(
    root,
    "evidence/capture-1",
    [["capture.json", "cold-recovered"]],
    { commitFile: "capture.json" }
  );
  assert.equal(recovered.committed, true);
  assert.equal(bundleNames(root).length, 1);
});

test("project directory writer serializes concurrent exact publishers", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-project-managed-concurrent-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const script = `
    const [root, writer] = process.argv.slice(1);
    const state = require(writer).writeProjectDirectoryAtomic(
      root,
      "evidence/capture-1",
      [["capture.json", "same"]],
      { commitFile: "capture.json" }
    );
    process.stdout.write(JSON.stringify(state));
  `;
  const children = [0, 1].map(() =>
    spawn(process.execPath, ["-e", script, root, writerModule], {
      stdio: ["ignore", "pipe", "pipe"],
    })
  );
  const results = await Promise.all(
    children.map(
      (child) =>
        new Promise((resolve) => {
          let stdout = "";
          let stderr = "";
          child.stdout.on("data", (chunk) => (stdout += chunk));
          child.stderr.on("data", (chunk) => (stderr += chunk));
          child.once("exit", (code) => resolve({ code, stdout, stderr }));
        })
    )
  );
  for (const result of results) {
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).committed, true);
  }
  assert.equal(bundleNames(root).length, 1);
  assert.equal(
    fs.readFileSync(path.join(root, "evidence", "capture-1", "capture.json"), "utf8"),
    "same"
  );
});

test("project directory writer serializes differing publishers without leaking a loser", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-project-managed-conflict-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const script = `
    const [root, writer, content] = process.argv.slice(1);
    const state = require(writer).writeProjectDirectoryAtomic(
      root,
      "evidence/capture-1",
      [["capture.json", content]],
      { commitFile: "capture.json" }
    );
    process.stdout.write(JSON.stringify(state));
  `;
  const children = ["alpha", "beta"].map((content) =>
    spawn(process.execPath, ["-e", script, root, writerModule, content], {
      stdio: ["ignore", "pipe", "pipe"],
    })
  );
  const results = await Promise.all(
    children.map(
      (child) =>
        new Promise((resolve) => {
          let stdout = "";
          let stderr = "";
          child.stdout.on("data", (chunk) => (stdout += chunk));
          child.stderr.on("data", (chunk) => (stderr += chunk));
          child.once("exit", (code) => resolve({ code, stdout, stderr }));
        })
    )
  );
  assert.deepEqual(results.map((result) => result.code).sort(), [0, 1]);
  assert.match(results.find((result) => result.code === 1).stderr, /already exists/);
  assert.equal(JSON.parse(results.find((result) => result.code === 0).stdout).committed, true);
  assert.equal(bundleNames(root).length, 1);
  assert.match(
    fs.readFileSync(path.join(root, "evidence", "capture-1", "capture.json"), "utf8"),
    /^(?:alpha|beta)$/
  );
});

test("project directory writer rejects same-size mutation and hardlinks before publication", (t) => {
  for (const scenario of ["same-size", "hardlink", "manifest-hardlink"]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `pm-project-managed-${scenario}-`));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const preload = path.join(root, `${scenario}.cjs`);
    const outsideLink = path.join(root, "outside-link.bin");
    fs.writeFileSync(
      preload,
      `
        const fs = require("node:fs");
        const originalOpen = fs.openSync;
        const originalReaddir = fs.readdirSync;
        let attacked = false;
        fs.openSync = function(file, ...args) {
          if (
            !attacked &&
            process.argv.includes("--child-directory") &&
            file === ".pm-directory-pointer.json" &&
            process.env.PM_TEST_SCENARIO !== "manifest-hardlink"
          ) {
            attacked = true;
            if (process.env.PM_TEST_SCENARIO === "same-size")
              fs.writeFileSync("capture.png", Buffer.from([9, 8, 7]));
            else if (process.env.PM_TEST_SCENARIO === "hardlink")
              fs.linkSync("capture.png", process.env.PM_TEST_OUTSIDE_LINK);
          }
          return originalOpen.call(fs, file, ...args);
        };
        fs.readdirSync = function(directory, ...args) {
          if (
            !attacked &&
            process.env.PM_TEST_SCENARIO === "manifest-hardlink" &&
            process.argv.includes("--child-directory") &&
            directory === "." &&
            fs.existsSync(".pm-directory-pointer.json")
          ) {
            attacked = true;
            fs.linkSync(".pm-directory-pointer.json", process.env.PM_TEST_OUTSIDE_LINK);
          }
          return originalReaddir.call(fs, directory, ...args);
        };
      `
    );
    const script = `
      const [root, writer] = process.argv.slice(1);
      require(writer).writeProjectDirectoryAtomic(root, "evidence/capture-1", [
        ["capture.png", Buffer.from([1, 2, 3])],
        ["capture.json", "manifest"]
      ], { commitFile: "capture.json" });
    `;
    const result = spawnSync(process.execPath, ["-e", script, root, writerModule], {
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_OPTIONS: `--require=${preload}`,
        PM_TEST_SCENARIO: scenario,
        PM_TEST_OUTSIDE_LINK: outsideLink,
      },
    });
    assert.notEqual(result.status, 0, scenario);
    assert.match(result.stderr, /bundle file (?:metadata )?changed/i);
    assert.equal(fs.existsSync(path.join(root, "evidence", "capture-1")), false);
    assert.equal(bundleNames(root).length, 1);
  }
});

test("managed-pointer reconciliation rejects a project-root replacement", (t) => {
  if (process.platform === "win32") return t.skip("directory rename semantics differ on Windows");
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "pm-managed-root-swap-"));
  const root = path.join(parent, "project");
  const original = path.join(parent, "project-original");
  const replacement = path.join(parent, "project-replacement");
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  fs.mkdirSync(root);
  writeProjectDirectoryAtomic(root, "evidence/capture-1", [["capture.json", "same"]], {
    commitFile: "capture.json",
  });
  fs.cpSync(root, replacement, { recursive: true, dereference: false, verbatimSymlinks: true });
  const preload = path.join(parent, "swap-root.cjs");
  fs.writeFileSync(
    preload,
    `
      const fs = require("node:fs");
      const originalLstat = fs.lstatSync;
      let swapped = false;
      fs.lstatSync = function(target, ...args) {
        if (!swapped && process.argv.includes("--child-directory") && target === "capture-1") {
          swapped = true;
          fs.renameSync(process.env.PM_TEST_ROOT, process.env.PM_TEST_ORIGINAL);
          fs.renameSync(process.env.PM_TEST_REPLACEMENT, process.env.PM_TEST_ROOT);
        }
        return originalLstat.call(fs, target, ...args);
      };
    `
  );
  const script = `
    const [root, writer] = process.argv.slice(1);
    require(writer).writeProjectDirectoryAtomic(
      root,
      "evidence/capture-1",
      [["capture.json", "same"]],
      { commitFile: "capture.json" }
    );
  `;
  const result = spawnSync(process.execPath, ["-e", script, root, writerModule], {
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_OPTIONS: `--require=${preload}`,
      PM_TEST_ROOT: root,
      PM_TEST_ORIGINAL: original,
      PM_TEST_REPLACEMENT: replacement,
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /project root or destination parent changed before pointer reconciliation/
  );
  assert.equal(
    fs.readFileSync(path.join(original, "evidence", "capture-1", "capture.json"), "utf8"),
    "same"
  );
  assert.equal(
    fs.readFileSync(path.join(root, "evidence", "capture-1", "capture.json"), "utf8"),
    "same"
  );
});

test("managed-pointer publication rejects a non-root ancestor replacement", (t) => {
  if (process.platform === "win32") return t.skip("directory rename semantics differ on Windows");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-managed-parent-swap-"));
  const destinationParent = path.join(root, "evidence", "round");
  const originalParent = path.join(root, "evidence", "round-original");
  const preload = path.join(root, "swap-parent.cjs");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(destinationParent, { recursive: true });
  fs.writeFileSync(
    preload,
    `
      const fs = require("node:fs");
      const originalSymlink = fs.symlinkSync;
      let swapped = false;
      fs.symlinkSync = function(target, destination, ...args) {
        if (!swapped && process.argv.includes("--child-directory") && destination === "capture-1") {
          swapped = true;
          fs.renameSync(process.env.PM_TEST_PARENT, process.env.PM_TEST_ORIGINAL_PARENT);
          fs.mkdirSync(process.env.PM_TEST_PARENT);
        }
        return originalSymlink.call(fs, target, destination, ...args);
      };
    `
  );
  const script = `
    const [root, writer] = process.argv.slice(1);
    require(writer).writeProjectDirectoryAtomic(
      root,
      "evidence/round/capture-1",
      [["capture.json", "anchored"]],
      { commitFile: "capture.json" }
    );
  `;
  const result = spawnSync(process.execPath, ["-e", script, root, writerModule], {
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_OPTIONS: `--require=${preload}`,
      PM_TEST_PARENT: destinationParent,
      PM_TEST_ORIGINAL_PARENT: originalParent,
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /committed.*do not retry/i);
  assert.deepEqual(fs.readdirSync(destinationParent), []);
  assert.equal(
    fs.readFileSync(path.join(originalParent, "capture-1", "capture.json"), "utf8"),
    "anchored"
  );
});

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

test("project writer normalizes portable separators before child publication and attestation", (t) => {
  if (path.sep === "\\") return t.skip("POSIX separator regression");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-project-write-separators-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "inputs"));
  fs.writeFileSync(path.join(root, "inputs", "source.json"), "source");
  const sourceSha = `sha256:${crypto.createHash("sha256").update("source").digest("hex")}`;

  const result = writeProjectTextAtomic(root, "review\\report.json", "portable", {
    attestations: [{ path: "inputs\\source.json", sha256: sourceSha, maxBytes: 1024 }],
  });

  assert.equal(result.path, path.join(fs.realpathSync(root), "review", "report.json"));
  assert.equal(fs.readFileSync(path.join(root, "review", "report.json"), "utf8"), "portable");
  assert.equal(fs.existsSync(path.join(root, "review\\report.json")), false);
});

test("project writer syncs a concurrently-created ancestor after observing it missing", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-project-write-ancestor-race-"));
  const syncReceipt = path.join(root, "ancestor-sync-receipt");
  const preload = path.join(root, "ancestor-race-preload.cjs");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(
    preload,
    `
      const fs = require("node:fs");
      const originalLstat = fs.lstatSync;
      const originalMkdir = fs.mkdirSync;
      const originalOpen = fs.openSync;
      const originalFsync = fs.fsyncSync;
      const originalWriteFile = fs.writeFileSync;
      let missingInjected = false;
      let parentDescriptor = null;
      fs.lstatSync = function(target, ...args) {
        if (
          !missingInjected &&
          process.argv.includes("--child") &&
          process.cwd() === process.env.PM_TEST_ANCESTOR_ROOT &&
          target === "shared"
        ) {
          missingInjected = true;
          const error = new Error("simulated missing ancestor");
          error.code = "ENOENT";
          throw error;
        }
        return originalLstat.call(fs, target, ...args);
      };
      fs.mkdirSync = function(target, ...args) {
        if (
          process.argv.includes("--child") &&
          process.cwd() === process.env.PM_TEST_ANCESTOR_ROOT &&
          target === "shared"
        ) {
          originalMkdir.call(fs, target, ...args);
          const error = new Error("simulated concurrent ancestor winner");
          error.code = "EEXIST";
          throw error;
        }
        return originalMkdir.call(fs, target, ...args);
      };
      fs.openSync = function(target, ...args) {
        const descriptor = originalOpen.call(fs, target, ...args);
        if (
          process.argv.includes("--child") &&
          process.cwd() === process.env.PM_TEST_ANCESTOR_ROOT &&
          target === "."
        ) parentDescriptor = descriptor;
        return descriptor;
      };
      fs.fsyncSync = function(descriptor, ...args) {
        const result = originalFsync.call(fs, descriptor, ...args);
        if (descriptor === parentDescriptor) {
          originalWriteFile.call(fs, process.env.PM_TEST_ANCESTOR_SYNC_RECEIPT, "synced");
        }
        return result;
      };
    `
  );
  const script = `
    const [root, writer] = process.argv.slice(1);
    require(writer).writeProjectTextAtomic(root, "shared/result.json", "durable");
  `;
  const result = spawnSync(process.execPath, ["-e", script, root, writerModule], {
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_OPTIONS: `--require=${preload}`,
      PM_TEST_ANCESTOR_ROOT: fs.realpathSync(root),
      PM_TEST_ANCESTOR_SYNC_RECEIPT: syncReceipt,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(syncReceipt, "utf8"), "synced");
  assert.equal(fs.readFileSync(path.join(root, "shared", "result.json"), "utf8"), "durable");
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
  assert.match(
    result.stderr,
    /project root changed during input attestation|input changed during containment validation/
  );
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

test("project writer serializes competing final attestations for one target", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-project-write-cas-lock-"));
  const target = path.join(root, "output", "result.json");
  const firstReady = path.join(root, "first-ready");
  const secondReady = path.join(root, "second-ready");
  const releaseFirst = path.join(root, "release-first");
  const children = [];
  t.after(() => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.mkdirSync(path.dirname(target));
  fs.writeFileSync(target, "base-version");
  const expected = `sha256:${crypto.createHash("sha256").update("base-version").digest("hex")}`;
  const script = `
    const fs = require("node:fs");
    const [root, writer, content, ready, release, expected] = process.argv.slice(1);
    try {
      const state = require(writer).writeProjectTextAtomic(root, "output/result.json", content, {
        finalAttestation: {
          path: "output/result.json",
          sha256: expected,
          maxBytes: 1024
        },
        beforeSpawn() {
          fs.writeFileSync(ready, "ready");
          if (release !== "-") {
            const signal = new Int32Array(new SharedArrayBuffer(4));
            const deadline = Date.now() + 15_000;
            while (!fs.existsSync(release) && Date.now() < deadline) {
              Atomics.wait(signal, 0, 0, 20);
            }
            if (!fs.existsSync(release)) throw new Error("timed out waiting for CAS test release");
          }
        }
      });
      process.stdout.write(JSON.stringify({ ok: true, committed: state.committed }));
    } catch (error) {
      process.stdout.write(JSON.stringify({
        ok: false,
        committed: error.committed,
        message: error.message
      }));
    }
  `;
  const launch = (content, ready, release) => {
    const child = spawn(
      process.execPath,
      ["-e", script, root, writerModule, content, ready, release, expected],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    children.push(child);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const completed = new Promise((resolve) => {
      child.once("exit", (code, signal) => resolve({ code, signal, stdout, stderr }));
    });
    return { child, completed };
  };
  const waitForPath = async (targetPath, label) => {
    const deadline = Date.now() + 5_000;
    while (!fs.existsSync(targetPath) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(fs.existsSync(targetPath), true, `${label} was not reached`);
  };

  const first = launch("first-writer", firstReady, releaseFirst);
  await waitForPath(firstReady, "first locked writer");
  const second = launch("second-writer", secondReady, "-");
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(
    fs.existsSync(secondReady),
    false,
    "contender entered while the target lock was held"
  );
  fs.writeFileSync(releaseFirst, "release");

  const [firstResult, secondResult] = await Promise.all([first.completed, second.completed]);
  assert.equal(firstResult.code, 0, firstResult.stderr);
  assert.equal(secondResult.code, 0, secondResult.stderr);
  const firstState = JSON.parse(firstResult.stdout);
  const secondState = JSON.parse(secondResult.stdout);
  assert.deepEqual(firstState, { ok: true, committed: true });
  assert.equal(secondState.ok, false);
  assert.equal(secondState.committed, false);
  assert.match(secondState.message, /atomic write attestation changed/);
  assert.equal(fs.existsSync(secondReady), true);
  assert.equal(fs.readFileSync(target, "utf8"), "first-writer");
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

test("project writer never deletes a foreign path swapped in after commit", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-project-write-post-commit-swap-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "review"));
  const preload = path.join(root, "post-commit-swap-preload.cjs");
  fs.writeFileSync(
    preload,
    `
      const fs = require("node:fs");
      const originalRename = fs.renameSync;
      const originalLstat = fs.lstatSync;
      let published = false;
      let swapped = false;
      fs.renameSync = function(source, destination, ...args) {
        const result = originalRename.call(fs, source, destination, ...args);
        if (process.argv.includes("--child") && destination === "report.json") published = true;
        return result;
      };
      fs.lstatSync = function(target, ...args) {
        if (
          published &&
          !swapped &&
          process.argv.includes("--child") &&
          target === "report.json"
        ) {
          swapped = true;
          originalRename.call(fs, "report.json", "committed-output.json");
          fs.writeFileSync("report.json", "foreign-sentinel");
        }
        return originalLstat.call(fs, target, ...args);
      };
    `
  );
  const script = `
    const [root, writer] = process.argv.slice(1);
    try {
      require(writer).writeProjectTextAtomic(root, "review/report.json", "intended-output");
      process.stdout.write(JSON.stringify({ unexpected: "passed" }));
    } catch (error) {
      process.stdout.write(JSON.stringify({ committed: error.committed, message: error.message }));
    }
  `;
  const result = spawnSync(process.execPath, ["-e", script, root, writerModule], {
    encoding: "utf8",
    env: { ...process.env, NODE_OPTIONS: `--require=${preload}` },
  });
  assert.equal(result.status, 0, result.stderr);
  const failure = JSON.parse(result.stdout);
  assert.equal(failure.unexpected, undefined);
  assert.equal(failure.committed, true);
  assert.match(failure.message, /committed.*do not retry/i);
  assert.equal(
    fs.readFileSync(path.join(root, "review", "report.json"), "utf8"),
    "foreign-sentinel"
  );
  assert.equal(
    fs.readFileSync(path.join(root, "review", "committed-output.json"), "utf8"),
    "intended-output"
  );
});

test("project writer reconciles file publication after its child dies before reporting", (t) => {
  if (process.platform === "win32") return t.skip("signal semantics differ on Windows");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-project-write-reporting-death-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "review"));
  const preload = path.join(root, "die-after-file-publication.cjs");
  fs.writeFileSync(
    preload,
    `
      const fs = require("node:fs");
      const originalLink = fs.linkSync;
      const originalRename = fs.renameSync;
      const terminate = (destination) => {
        if (process.argv.includes("--child") && /^report-(?:exclusive|replace)\\.json$/.test(destination)) {
          process.kill(process.pid, "SIGKILL");
        }
      };
      fs.linkSync = function(source, destination, ...args) {
        const result = originalLink.call(fs, source, destination, ...args);
        terminate(destination);
        return result;
      };
      fs.renameSync = function(source, destination, ...args) {
        const result = originalRename.call(fs, source, destination, ...args);
        terminate(destination);
        return result;
      };
    `
  );
  const script = `
    const [root, writer, relative, exclusive] = process.argv.slice(1);
    try {
      require(writer).writeProjectTextAtomic(root, relative, "durable-output", {
        replace: exclusive !== "true"
      });
      process.stdout.write(JSON.stringify({ unexpected: "passed" }));
    } catch (error) {
      process.stdout.write(JSON.stringify({
        committed: error.committed,
        retryable: error.retryable,
        message: error.message
      }));
    }
  `;
  for (const mode of ["replace", "exclusive"]) {
    const relative = `review/report-${mode}.json`;
    const result = spawnSync(
      process.execPath,
      ["-e", script, root, writerModule, relative, String(mode === "exclusive")],
      {
        encoding: "utf8",
        env: { ...process.env, NODE_OPTIONS: `--require=${preload}` },
      }
    );
    assert.equal(result.status, 0, `${mode}: ${result.stderr}`);
    const failure = JSON.parse(result.stdout);
    assert.equal(failure.unexpected, undefined);
    assert.equal(failure.committed, true);
    assert.match(failure.message, /committed.*do not retry/i);
    assert.equal(fs.readFileSync(path.join(root, relative), "utf8"), "durable-output");
  }
});

test("project writer preserves directory sync semantics while reconciling a committed rename", (t) => {
  if (process.platform === "win32") return t.skip("signal semantics differ on Windows");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-project-write-reconcile-fsync-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "review"));
  const preload = path.join(root, "die-after-rename-and-fail-parent-fsync.cjs");
  fs.writeFileSync(
    preload,
    `
      const fs = require("node:fs");
      const path = require("node:path");
      const originalOpen = fs.openSync;
      const originalRename = fs.renameSync;
      const reconciliationDirectory = path.join(fs.realpathSync(process.env.PM_TEST_ROOT), "review");
      fs.openSync = function(file, ...args) {
        if (
          !process.argv.includes("--child") &&
          path.resolve(file) === reconciliationDirectory
        ) {
          const error = new Error("injected reconciliation directory sync failure");
          error.code = process.env.PM_TEST_FSYNC_CODE;
          throw error;
        }
        return originalOpen.call(fs, file, ...args);
      };
      fs.renameSync = function(source, destination, ...args) {
        const result = originalRename.call(fs, source, destination, ...args);
        if (process.argv.includes("--child") && /^report-(?:eperm|enotsup|eio)\\.json$/.test(destination)) {
          process.kill(process.pid, "SIGKILL");
        }
        return result;
      };
    `
  );
  const script = `
    const [root, writer, relative] = process.argv.slice(1);
    try {
      require(writer).writeProjectTextAtomic(root, relative, "durable-output");
      process.stdout.write(JSON.stringify({ unexpected: "passed" }));
    } catch (error) {
      process.stdout.write(JSON.stringify({
        committed: error.committed,
        commitState: error.commitState,
        retryable: error.retryable,
        directorySynced: error.directorySynced,
        directorySyncError: error.directorySyncError,
        message: error.message
      }));
    }
  `;
  for (const code of ["EPERM", "ENOTSUP", "EIO"]) {
    const relative = `review/report-${code.toLowerCase()}.json`;
    const result = spawnSync(process.execPath, ["-e", script, root, writerModule, relative], {
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_OPTIONS: `--require=${preload}`,
        PM_TEST_ROOT: root,
        PM_TEST_FSYNC_CODE: code,
      },
    });
    assert.equal(result.status, 0, `${code}: ${result.stderr}`);
    const failure = JSON.parse(result.stdout);
    assert.equal(failure.unexpected, undefined);
    assert.equal(fs.readFileSync(path.join(root, relative), "utf8"), "durable-output");
    if (code === "EIO") {
      assert.equal(failure.committed, null);
      assert.equal(failure.commitState, "unknown");
      assert.equal(failure.retryable, false);
      assert.equal(failure.directorySynced, undefined);
      assert.equal(failure.directorySyncError, undefined);
      assert.match(
        failure.message,
        /could not be synced.*injected reconciliation directory sync failure/
      );
    } else {
      assert.equal(failure.committed, true);
      assert.equal(failure.commitState, undefined);
      assert.equal(failure.retryable, undefined);
      assert.equal(failure.directorySynced, false);
      assert.equal(failure.directorySyncError, code);
      assert.match(failure.message, /committed.*do not retry/i);
    }
  }
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
