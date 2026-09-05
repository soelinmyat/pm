"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
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
  assert.throws(
    () =>
      writeProjectDirectoryAtomic(root, ".pm/captures/capture-2", [["capture.json", "safe"]], {
        commitFile: ".pm-directory-owner.json",
      }),
    /reserved for writer ownership/
  );
  assert.throws(
    () =>
      writeProjectDirectoryAtomic(
        root,
        ".pm/captures/capture-2",
        [
          [".pm-directory-owner.json", "forged"],
          ["capture.json", "unsafe"],
        ],
        { commitFile: "capture.json" }
      ),
    /reserved for writer ownership/
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

test("project directory writer protects a live lease and recovers interrupted or PID-reused ownership", async (t) => {
  if (process.platform === "win32") return t.skip("signal and process-liveness semantics differ");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-project-directory-lease-"));
  const readyPath = path.join(root, "writer-ready.json");
  const preload = path.join(root, "pause-directory-writer.cjs");
  fs.writeFileSync(
    preload,
    `
      const fs = require("node:fs");
      const childProcess = require("node:child_process");
      const originalOpen = fs.openSync;
      const originalRead = fs.readFileSync;
      const originalSpawn = childProcess.spawnSync;
      let paused = false;
      fs.readFileSync = function(target, ...args) {
        if (String(target) === "/proc/sys/kernel/random/boot_id") return "live-writer-test-boot\\n";
        return originalRead.call(fs, target, ...args);
      };
      childProcess.spawnSync = function(command, args, options) {
        const invocation = Array.isArray(args) ? args.join(" ") : "";
        if (command === "/usr/sbin/sysctl" && invocation.includes("kern.boottime"))
          return { status: 0, stdout: "{ sec = 1900000000, usec = 0 }\\n", stderr: "" };
        if (command === "powershell.exe" && invocation.includes("Win32_OperatingSystem"))
          return { status: 0, stdout: "1900000000\\n", stderr: "" };
        return originalSpawn.call(childProcess, command, args, options);
      };
      fs.openSync = function(file, ...args) {
        if (
          !paused &&
          process.argv.includes("--child-directory") &&
          file === "capture.png"
        ) {
          paused = true;
          process.title = "pm-live-writer-title-changed";
          fs.writeFileSync(process.env.PM_TEST_WRITER_READY, JSON.stringify({ pid: process.pid }));
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
        }
        return originalOpen.call(fs, file, ...args);
      };
    `
  );
  const script = `
    const [root, writer] = process.argv.slice(1);
    const { writeProjectDirectoryAtomic } = require(writer);
    writeProjectDirectoryAtomic(root, "evidence/capture-1", [
      ["capture.png", Buffer.from([1, 2, 3])],
      ["capture.json", "interrupted-manifest"]
    ], { commitFile: "capture.json" });
  `;
  const active = spawn(process.execPath, ["-e", script, root, writerModule], {
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_OPTIONS: `--require=${preload}`,
      PM_TEST_WRITER_READY: readyPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let writerPid = null;
  t.after(() => {
    if (writerPid)
      try {
        process.kill(writerPid, "SIGKILL");
      } catch {
        // The interrupted writer was already reaped.
      }
    if (active.exitCode === null && active.signalCode === null) active.kill("SIGKILL");
    fs.rmSync(root, { recursive: true, force: true });
  });

  const deadline = Date.now() + 5_000;
  while (!fs.existsSync(readyPath) && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(fs.existsSync(readyPath), true, "writer did not establish its owner lease");
  writerPid = JSON.parse(fs.readFileSync(readyPath, "utf8")).pid;
  const destination = path.join(root, "evidence", "capture-1");
  const liveLeasePath = path.join(destination, ".pm-directory-owner.json");
  assert.equal(fs.existsSync(liveLeasePath), true);
  assert.equal(JSON.parse(fs.readFileSync(liveLeasePath, "utf8")).commit_file, "capture.json");
  assert.match(
    JSON.parse(fs.readFileSync(liveLeasePath, "utf8")).boot_token,
    /^(?:linux-boot|bsd-boot-numeric|windows-boot):/
  );
  const sameBootPreload = path.join(root, "same-strong-identity.cjs");
  fs.writeFileSync(
    sameBootPreload,
    `
      const fs = require("node:fs");
      const childProcess = require("node:child_process");
      const originalRead = fs.readFileSync;
      const originalSpawn = childProcess.spawnSync;
      fs.readFileSync = function(target, ...args) {
        if (String(target) === "/proc/sys/kernel/random/boot_id") return "live-writer-test-boot\\n";
        return originalRead.call(fs, target, ...args);
      };
      childProcess.spawnSync = function(command, args, options) {
        const invocation = Array.isArray(args) ? args.join(" ") : "";
        if (command === "/usr/sbin/sysctl" && invocation.includes("kern.boottime"))
          return { status: 0, stdout: "{ sec = 1900000000, usec = 0 }\\n", stderr: "" };
        if (command === "powershell.exe" && invocation.includes("Win32_OperatingSystem"))
          return { status: 0, stdout: "1900000000\\n", stderr: "" };
        return originalSpawn.call(childProcess, command, args, options);
      };
    `
  );
  const weakProbePreload = path.join(root, "unavailable-strong-identity.cjs");
  fs.writeFileSync(
    weakProbePreload,
    `
      const fs = require("node:fs");
      const os = require("node:os");
      const childProcess = require("node:child_process");
      const originalRead = fs.readFileSync;
      const originalSpawn = childProcess.spawnSync;
      fs.readFileSync = function(target, ...args) {
        if (String(target) === "/proc/sys/kernel/random/boot_id") {
          const error = new Error("boot identity unavailable");
          error.code = "EACCES";
          throw error;
        }
        return originalRead.call(fs, target, ...args);
      };
      childProcess.spawnSync = function(command, args, options) {
        const invocation = Array.isArray(args) ? args.join(" ") : "";
        if (
          (command === "/usr/sbin/sysctl" && invocation.includes("kern.boottime")) ||
          (command === "powershell.exe" && invocation.includes("Win32_OperatingSystem"))
        ) return { status: null, stdout: "", stderr: "", error: new Error("identity unavailable") };
        return originalSpawn.call(childProcess, command, args, options);
      };
      os.uptime = () => 1_000;
    `
  );
  const liveRetryScript = `
    const [root, writer] = process.argv.slice(1);
    try {
      require(writer).writeProjectDirectoryAtomic(
        root,
        "evidence/capture-1",
        [["capture.json", "racing"]],
        { commitFile: "capture.json" }
      );
      process.stdout.write(JSON.stringify({ unexpected: "passed" }));
    } catch (error) {
      process.stdout.write(JSON.stringify({ message: error.message }));
    }
  `;
  const sameBootRetry = spawnSync(process.execPath, ["-e", liveRetryScript, root, writerModule], {
    encoding: "utf8",
    env: { ...process.env, NODE_OPTIONS: `--require=${sameBootPreload}` },
  });
  assert.equal(sameBootRetry.status, 0, sameBootRetry.stderr);
  assert.match(JSON.parse(sameBootRetry.stdout).message, /reserved by live writer/);
  const liveRetry = spawnSync(process.execPath, ["-e", liveRetryScript, root, writerModule], {
    encoding: "utf8",
    env: { ...process.env, NODE_OPTIONS: `--require=${weakProbePreload}` },
  });
  assert.equal(liveRetry.status, 0, liveRetry.stderr);
  assert.match(JSON.parse(liveRetry.stdout).message, /reserved by live writer/);
  assert.equal(fs.existsSync(destination), true);

  const unknownIdentityLease = JSON.parse(fs.readFileSync(liveLeasePath, "utf8"));
  unknownIdentityLease.process_start_token = `unknown-process:${crypto
    .createHash("sha256")
    .update("not-a-proven-process-identity")
    .digest("hex")}`;
  fs.writeFileSync(liveLeasePath, `${JSON.stringify(unknownIdentityLease)}\n`);
  const unknownIdentityRetry = spawnSync(
    process.execPath,
    ["-e", liveRetryScript, root, writerModule],
    {
      encoding: "utf8",
      env: { ...process.env, NODE_OPTIONS: `--require=${sameBootPreload}` },
    }
  );
  assert.equal(unknownIdentityRetry.status, 0, unknownIdentityRetry.stderr);
  assert.match(JSON.parse(unknownIdentityRetry.stdout).message, /reserved by live writer/);
  assert.equal(fs.existsSync(destination), true);

  const activeExit = new Promise((resolve) => active.once("exit", resolve));
  process.kill(writerPid, "SIGKILL");
  await activeExit;
  writerPid = null;

  const leasePath = liveLeasePath;
  const reusedPidLease = JSON.parse(fs.readFileSync(leasePath, "utf8"));
  reusedPidLease.pid = process.pid;
  const bootKind =
    process.platform === "linux"
      ? "linux-boot"
      : process.platform === "win32"
        ? "windows-boot"
        : "bsd-boot-numeric";
  reusedPidLease.boot_token = `${bootKind}:${crypto
    .createHash("sha256")
    .update("previous-test-boot")
    .digest("hex")}`;
  reusedPidLease.process_start_token = null;
  reusedPidLease.created_at_ms = Date.now() - 10 * 60 * 1000;
  fs.writeFileSync(leasePath, `${JSON.stringify(reusedPidLease)}\n`);

  const rebootPreload = path.join(root, "simulate-reboot.cjs");
  fs.writeFileSync(
    rebootPreload,
    `
      const fs = require("node:fs");
      const childProcess = require("node:child_process");
      const originalRead = fs.readFileSync;
      const originalSpawn = childProcess.spawnSync;
      fs.readFileSync = function(target, ...args) {
        if (String(target) === "/proc/sys/kernel/random/boot_id") return "current-test-boot\\n";
        return originalRead.call(fs, target, ...args);
      };
      childProcess.spawnSync = function(command, args, options) {
        const invocation = Array.isArray(args) ? args.join(" ") : "";
        if (command === "/usr/sbin/sysctl" && invocation.includes("kern.boottime"))
          return { status: 0, stdout: "{ sec = 2000000000, usec = 0 }\\n", stderr: "" };
        if (command === "powershell.exe" && invocation.includes("Win32_OperatingSystem"))
          return { status: 0, stdout: "2000000000\\n", stderr: "" };
        return originalSpawn.call(childProcess, command, args, options);
      };
    `
  );
  const retryScript = `
    const [root, writer] = process.argv.slice(1);
    const state = require(writer).writeProjectDirectoryAtomic(root, "evidence/capture-1", [
      ["capture.png", Buffer.from([4, 5, 6])],
      ["capture.json", "recovered-manifest"]
    ], { commitFile: "capture.json" });
    process.stdout.write(JSON.stringify(state));
  `;
  const retry = spawnSync(process.execPath, ["-e", retryScript, root, writerModule], {
    encoding: "utf8",
    env: { ...process.env, NODE_OPTIONS: `--require=${rebootPreload}` },
  });
  assert.equal(retry.status, 0, retry.stderr);
  assert.equal(JSON.parse(retry.stdout).committed, true);
  assert.equal(fs.existsSync(path.join(destination, ".pm-directory-owner.json")), false);
  assert.equal(
    fs.readFileSync(path.join(destination, "capture.json"), "utf8"),
    "recovered-manifest"
  );
  assert.deepEqual(fs.readFileSync(path.join(destination, "capture.png")), Buffer.from([4, 5, 6]));
});

test("project directory writer derives stable BSD identities across timezone changes", (t) => {
  const roots = [];
  t.after(() => {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
  });
  const observed = [];
  for (const timezone of ["UTC", "Asia/Singapore"]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-project-directory-bsd-identity-"));
    roots.push(root);
    const identityEnvironmentPath = path.join(root, "identity-environment.json");
    const preload = path.join(root, "bsd-identity-preload.cjs");
    fs.writeFileSync(
      preload,
      `
        Object.defineProperty(process, "platform", { value: "darwin" });
        const fs = require("node:fs");
        const childProcess = require("node:child_process");
        const originalSpawn = childProcess.spawnSync;
        const originalUnlink = fs.unlinkSync;
        childProcess.spawnSync = function(command, args, options = {}) {
          const invocation = Array.isArray(args) ? args.join(" ") : "";
          if (command === "/usr/sbin/sysctl" && invocation.includes("kern.boottime")) {
            const suffix = process.env.TZ === "UTC"
              ? "Sun Nov 15 22:13:20 UTC 2023"
              : "Mon Nov 16 06:13:20 +08 2023";
            return {
              status: 0,
              stdout: "{ sec = 1700000000, usec = 123456 } " + suffix + "\\n",
              stderr: ""
            };
          }
          if (command === "/bin/ps" && invocation.includes("lstart=")) {
            fs.writeFileSync(
              process.env.PM_TEST_IDENTITY_ENVIRONMENT,
              JSON.stringify({
                LC_ALL: options.env && options.env.LC_ALL,
                LANG: options.env && options.env.LANG,
                TZ: options.env && options.env.TZ
              })
            );
            const stable = options.env && options.env.LC_ALL === "C" &&
              options.env.LANG === "C" && options.env.TZ === "UTC";
            return {
              status: 0,
              stdout: stable ? "Mon Jan  1 00:00:00 2024\\n" : "localized process time\\n",
              stderr: ""
            };
          }
          return originalSpawn.call(childProcess, command, args, options);
        };
        fs.unlinkSync = function(target, ...args) {
          if (
            process.argv.includes("--child-directory") &&
            target === ".pm-directory-owner.json"
          ) {
            const error = new Error("retain lease for identity inspection");
            error.code = "EIO";
            throw error;
          }
          return originalUnlink.call(fs, target, ...args);
        };
      `
    );
    const script = `
      const fs = require("node:fs");
      const path = require("node:path");
      const [root, writer, identityEnvironmentPath] = process.argv.slice(1);
      try {
        require(writer).writeProjectDirectoryAtomic(
          root,
          "evidence/capture-1",
          [["capture.json", "committed-marker"]],
          { commitFile: "capture.json" }
        );
      } catch (error) {
        const lease = JSON.parse(
          fs.readFileSync(path.join(root, "evidence/capture-1/.pm-directory-owner.json"), "utf8")
        );
        process.stdout.write(JSON.stringify({
          committed: error.committed === true,
          bootToken: lease.boot_token,
          processToken: lease.process_start_token,
          identityEnvironment: JSON.parse(fs.readFileSync(identityEnvironmentPath, "utf8"))
        }));
      }
    `;
    const result = spawnSync(
      process.execPath,
      ["-e", script, root, writerModule, identityEnvironmentPath],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          TZ: timezone,
          NODE_OPTIONS: `--require=${preload}`,
          PM_TEST_IDENTITY_ENVIRONMENT: identityEnvironmentPath,
        },
      }
    );
    assert.equal(result.status, 0, result.stderr);
    observed.push(JSON.parse(result.stdout));
  }

  const expectedBootToken = `bsd-boot-numeric:${crypto
    .createHash("sha256")
    .update("1700000000:123456")
    .digest("hex")}`;
  const expectedProcessToken = `bsd-process-utc:${crypto
    .createHash("sha256")
    .update("Mon Jan  1 00:00:00 2024")
    .digest("hex")}`;
  for (const result of observed) {
    assert.equal(result.committed, true);
    assert.equal(result.bootToken, expectedBootToken);
    assert.equal(result.processToken, expectedProcessToken);
    assert.deepEqual(result.identityEnvironment, { LC_ALL: "C", LANG: "C", TZ: "UTC" });
  }
});

test("project directory writer does not reclaim a foreign directory after a pre-mkdir crash", async (t) => {
  if (process.platform === "win32") return t.skip("signal and process-liveness semantics differ");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-project-directory-prelease-"));
  const readyPath = path.join(root, "prelease-ready.json");
  const preload = path.join(root, "pause-before-destination-mkdir.cjs");
  fs.writeFileSync(
    preload,
    `
      const fs = require("node:fs");
      const originalMkdir = fs.mkdirSync;
      let paused = false;
      fs.mkdirSync = function(directory, ...args) {
        if (
          !paused &&
          process.argv.includes("--child-directory") &&
          directory === "capture-1"
        ) {
          paused = true;
          fs.writeFileSync(process.env.PM_TEST_PRELEASE_READY, JSON.stringify({ pid: process.pid }));
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
        }
        return originalMkdir.call(fs, directory, ...args);
      };
    `
  );
  const script = `
    const [root, writer] = process.argv.slice(1);
    require(writer).writeProjectDirectoryAtomic(root, "evidence/capture-1", [
      ["capture.png", Buffer.from([1, 2, 3])],
      ["capture.json", "interrupted-before-lease"]
    ], { commitFile: "capture.json" });
  `;
  const active = spawn(process.execPath, ["-e", script, root, writerModule], {
    env: {
      ...process.env,
      NODE_OPTIONS: `--require=${preload}`,
      PM_TEST_PRELEASE_READY: readyPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let writerPid = null;
  t.after(() => {
    if (writerPid)
      try {
        process.kill(writerPid, "SIGKILL");
      } catch {
        // The interrupted writer was already reaped.
      }
    if (active.exitCode === null && active.signalCode === null) active.kill("SIGKILL");
    fs.rmSync(root, { recursive: true, force: true });
  });
  const deadline = Date.now() + 5_000;
  while (!fs.existsSync(readyPath) && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(fs.existsSync(readyPath), true, "writer did not reach the pre-lease window");
  writerPid = JSON.parse(fs.readFileSync(readyPath, "utf8")).pid;
  const destination = path.join(root, "evidence", "capture-1");
  assert.equal(fs.existsSync(destination), false);
  const reservationName = fs
    .readdirSync(path.join(root, "evidence"))
    .find((name) => name.startsWith(".pm-dir-reservation-") && name.endsWith(".json"));
  assert.ok(reservationName);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(root, "evidence", reservationName), "utf8")).commit_file,
    "capture.json"
  );
  assert.throws(
    () =>
      writeProjectDirectoryAtomic(root, "evidence/capture-1", [["capture.json", "racing"]], {
        commitFile: "capture.json",
      }),
    /reserved by live writer/
  );

  const activeExit = new Promise((resolve) => active.once("exit", resolve));
  process.kill(writerPid, "SIGKILL");
  await activeExit;
  writerPid = null;
  assert.throws(
    () =>
      writeProjectDirectoryAtomic(
        root,
        "evidence/capture-1",
        [["other.json", "must-not-rebind-stale-reservation"]],
        { commitFile: "other.json" }
      ),
    /reservation targets another commit marker/
  );
  assert.equal(fs.existsSync(destination), false);
  assert.equal(fs.existsSync(path.join(root, "evidence", reservationName)), true);
  fs.mkdirSync(destination);
  const foreignIdentity = fs.statSync(destination);
  assert.throws(
    () =>
      writeProjectDirectoryAtomic(
        root,
        "evidence/capture-1",
        [["capture.json", "must-not-replace-foreign-directory"]],
        { commitFile: "capture.json" }
      ),
    /already exists without a recoverable owner lease/
  );
  const preservedIdentity = fs.statSync(destination);
  assert.equal(preservedIdentity.dev, foreignIdentity.dev);
  assert.equal(preservedIdentity.ino, foreignIdentity.ino);
  assert.deepEqual(fs.readdirSync(destination), []);
});

test("project directory writer fails closed after a kill during owner-lease creation", async (t) => {
  if (process.platform === "win32") return t.skip("signal and process-liveness semantics differ");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-project-directory-partial-lease-"));
  const readyPath = path.join(root, "partial-lease-ready.json");
  const preload = path.join(root, "pause-during-owner-lease.cjs");
  fs.writeFileSync(
    preload,
    `
      const fs = require("node:fs");
      const originalOpen = fs.openSync;
      const originalWrite = fs.writeSync;
      let ownerDescriptor;
      let paused = false;
      fs.openSync = function(file, ...args) {
        const descriptor = originalOpen.call(fs, file, ...args);
        if (
          process.argv.includes("--child-directory") &&
          file === ".pm-directory-owner.json"
        ) ownerDescriptor = descriptor;
        return descriptor;
      };
      fs.writeSync = function(descriptor, buffer, offset, length, position) {
        if (!paused && descriptor === ownerDescriptor) {
          paused = true;
          const written = originalWrite.call(
            fs,
            descriptor,
            buffer,
            offset,
            Math.min(16, length),
            position
          );
          fs.writeFileSync(
            process.env.PM_TEST_PARTIAL_LEASE_READY,
            JSON.stringify({ pid: process.pid, written })
          );
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
          return written;
        }
        return originalWrite.call(fs, descriptor, buffer, offset, length, position);
      };
    `
  );
  const script = `
    const [root, writer] = process.argv.slice(1);
    require(writer).writeProjectDirectoryAtomic(root, "evidence/capture-1", [
      ["capture.png", Buffer.from([1, 2, 3])],
      ["capture.json", "interrupted-during-lease"]
    ], { commitFile: "capture.json" });
  `;
  const active = spawn(process.execPath, ["-e", script, root, writerModule], {
    env: {
      ...process.env,
      NODE_OPTIONS: `--require=${preload}`,
      PM_TEST_PARTIAL_LEASE_READY: readyPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let writerPid = null;
  t.after(() => {
    if (writerPid)
      try {
        process.kill(writerPid, "SIGKILL");
      } catch {
        // The interrupted writer was already reaped.
      }
    if (active.exitCode === null && active.signalCode === null) active.kill("SIGKILL");
    fs.rmSync(root, { recursive: true, force: true });
  });
  const deadline = Date.now() + 5_000;
  while (!fs.existsSync(readyPath) && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(fs.existsSync(readyPath), true, "writer did not partially write its owner lease");
  const ready = JSON.parse(fs.readFileSync(readyPath, "utf8"));
  writerPid = ready.pid;
  assert.equal(ready.written > 0 && ready.written <= 16, true);
  const destination = path.join(root, "evidence", "capture-1");
  const partialLease = fs.readFileSync(path.join(destination, ".pm-directory-owner.json"));
  assert.equal(partialLease.length, ready.written);
  assert.throws(
    () =>
      writeProjectDirectoryAtomic(root, "evidence/capture-1", [["capture.json", "racing"]], {
        commitFile: "capture.json",
      }),
    /reserved by live writer/
  );

  const activeExit = new Promise((resolve) => active.once("exit", resolve));
  process.kill(writerPid, "SIGKILL");
  await activeExit;
  writerPid = null;
  assert.throws(
    () =>
      writeProjectDirectoryAtomic(
        root,
        "evidence/capture-1",
        [["capture.json", "must-not-reclaim-partial-lease"]],
        { commitFile: "capture.json" }
      ),
    /already exists without a recoverable owner lease/
  );
  assert.deepEqual(
    fs.readFileSync(path.join(destination, ".pm-directory-owner.json")),
    partialLease
  );
  assert.equal(fs.existsSync(path.join(destination, "capture.json")), false);
});

test("project directory writer recovers after a contending reservation and original owner both die", async (t) => {
  if (process.platform === "win32") return t.skip("signal and process-liveness semantics differ");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-project-directory-double-crash-"));
  const ownerReadyPath = path.join(root, "owner-ready.json");
  const contenderReadyPath = path.join(root, "contender-ready.json");
  const ownerPreload = path.join(root, "pause-original-owner.cjs");
  const contenderPreload = path.join(root, "pause-contender-inspection.cjs");
  fs.writeFileSync(
    ownerPreload,
    `
      const fs = require("node:fs");
      const originalOpen = fs.openSync;
      let paused = false;
      fs.openSync = function(file, ...args) {
        if (!paused && process.argv.includes("--child-directory") && file === "capture.png") {
          paused = true;
          fs.writeFileSync(process.env.PM_TEST_OWNER_READY, JSON.stringify({ pid: process.pid }));
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
        }
        return originalOpen.call(fs, file, ...args);
      };
    `
  );
  fs.writeFileSync(
    contenderPreload,
    `
      const fs = require("node:fs");
      const originalOpen = fs.openSync;
      let paused = false;
      fs.openSync = function(file, ...args) {
        if (
          !paused &&
          process.argv.includes("--child-directory") &&
          typeof file === "string" &&
          file.endsWith("capture-1/.pm-directory-owner.json")
        ) {
          paused = true;
          fs.writeFileSync(process.env.PM_TEST_CONTENDER_READY, JSON.stringify({ pid: process.pid }));
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
        }
        return originalOpen.call(fs, file, ...args);
      };
    `
  );
  const ownerScript = `
    const [root, writer] = process.argv.slice(1);
    require(writer).writeProjectDirectoryAtomic(root, "evidence/capture-1", [
      ["capture.png", Buffer.from([1, 2, 3])],
      ["capture.json", "original-owner"]
    ], { commitFile: "capture.json" });
  `;
  const contenderScript = `
    const [root, writer] = process.argv.slice(1);
    require(writer).writeProjectDirectoryAtomic(
      root,
      "evidence/capture-1",
      [["capture.json", "contender"]],
      { commitFile: "capture.json" }
    );
  `;
  const owner = spawn(process.execPath, ["-e", ownerScript, root, writerModule], {
    env: {
      ...process.env,
      NODE_OPTIONS: `--require=${ownerPreload}`,
      PM_TEST_OWNER_READY: ownerReadyPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let ownerPid = null;
  let contender = null;
  let contenderPid = null;
  t.after(() => {
    for (const pid of [ownerPid, contenderPid])
      if (pid)
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // The interrupted child was already reaped.
        }
    for (const child of [owner, contender])
      if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    fs.rmSync(root, { recursive: true, force: true });
  });
  let deadline = Date.now() + 5_000;
  while (!fs.existsSync(ownerReadyPath) && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(fs.existsSync(ownerReadyPath), true, "original owner did not establish its lease");
  ownerPid = JSON.parse(fs.readFileSync(ownerReadyPath, "utf8")).pid;

  contender = spawn(process.execPath, ["-e", contenderScript, root, writerModule], {
    env: {
      ...process.env,
      NODE_OPTIONS: `--require=${contenderPreload}`,
      PM_TEST_CONTENDER_READY: contenderReadyPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  deadline = Date.now() + 5_000;
  while (!fs.existsSync(contenderReadyPath) && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(
    fs.existsSync(contenderReadyPath),
    true,
    "contender did not retain its sibling reservation"
  );
  contenderPid = JSON.parse(fs.readFileSync(contenderReadyPath, "utf8")).pid;
  assert.equal(
    fs
      .readdirSync(path.join(root, "evidence"))
      .some((name) => name.startsWith(".pm-dir-reservation-")),
    true
  );

  const contenderExit = new Promise((resolve) => contender.once("exit", resolve));
  process.kill(contenderPid, "SIGKILL");
  await contenderExit;
  contenderPid = null;
  const ownerExit = new Promise((resolve) => owner.once("exit", resolve));
  process.kill(ownerPid, "SIGKILL");
  await ownerExit;
  ownerPid = null;

  const recovered = writeProjectDirectoryAtomic(
    root,
    "evidence/capture-1",
    [["capture.json", "recovered-after-double-crash"]],
    { commitFile: "capture.json" }
  );
  assert.equal(recovered.committed, true);
  assert.equal(
    fs.readFileSync(path.join(root, "evidence", "capture-1", "capture.json"), "utf8"),
    "recovered-after-double-crash"
  );
});

test("project directory writer preserves committed state when killed after marker publication", async (t) => {
  if (process.platform === "win32") return t.skip("signal and process-liveness semantics differ");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-project-directory-marker-kill-"));
  const readyPath = path.join(root, "marker-linked.json");
  const preload = path.join(root, "pause-after-marker-link.cjs");
  fs.writeFileSync(
    preload,
    `
      const fs = require("node:fs");
      const originalLink = fs.linkSync;
      let paused = false;
      fs.linkSync = function(source, destination, ...args) {
        const result = originalLink.call(fs, source, destination, ...args);
        if (
          !paused &&
          process.argv.includes("--child-directory") &&
          destination === "capture.json"
        ) {
          paused = true;
          fs.writeFileSync(process.env.PM_TEST_MARKER_LINKED, JSON.stringify({ pid: process.pid }));
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
        }
        return result;
      };
    `
  );
  const script = `
    const [root, writer] = process.argv.slice(1);
    try {
      require(writer).writeProjectDirectoryAtomic(root, "evidence/capture-1", [
        ["capture.png", Buffer.from([1, 2, 3])],
        ["capture.json", "committed-before-kill"]
      ], { commitFile: "capture.json" });
    } catch (error) {
      process.stdout.write(JSON.stringify({ committed: error.committed === true, message: error.message }));
    }
  `;
  let stdout = "";
  const active = spawn(process.execPath, ["-e", script, root, writerModule], {
    env: {
      ...process.env,
      NODE_OPTIONS: `--require=${preload}`,
      PM_TEST_MARKER_LINKED: readyPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  active.stdout.setEncoding("utf8");
  active.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  let writerPid = null;
  t.after(() => {
    if (writerPid)
      try {
        process.kill(writerPid, "SIGKILL");
      } catch {
        // The interrupted writer was already reaped.
      }
    if (active.exitCode === null && active.signalCode === null) active.kill("SIGKILL");
    fs.rmSync(root, { recursive: true, force: true });
  });
  const deadline = Date.now() + 5_000;
  while (!fs.existsSync(readyPath) && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(fs.existsSync(readyPath), true, "writer did not publish the marker");
  writerPid = JSON.parse(fs.readFileSync(readyPath, "utf8")).pid;
  const activeExit = new Promise((resolve) => active.once("exit", resolve));
  process.kill(writerPid, "SIGKILL");
  await activeExit;
  writerPid = null;

  const failure = JSON.parse(stdout);
  assert.equal(failure.committed, true);
  assert.match(failure.message, /committed.*do not retry/i);
  assert.equal(
    fs.readFileSync(path.join(root, "evidence", "capture-1", "capture.json"), "utf8"),
    "committed-before-kill"
  );
  assert.throws(
    () =>
      writeProjectDirectoryAtomic(root, "evidence/capture-1", [["capture.json", "replacement"]], {
        commitFile: "capture.json",
      }),
    /already exists/
  );
});

test("project directory writer reconciles a complete bundle after child reporting fails", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-project-directory-reporting-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const preload = path.join(root, "fail-child-reporting.cjs");
  fs.writeFileSync(
    preload,
    `
      if (process.argv.includes("--child-directory")) {
        process.stdout.write = function() {
          const error = new Error("injected child reporting failure");
          error.code = "EPIPE";
          throw error;
        };
      }
    `
  );
  const script = `
    const [root, writer] = process.argv.slice(1);
    try {
      require(writer).writeProjectDirectoryAtomic(
        root,
        "evidence/capture-1",
        [
          ["capture.png", Buffer.from([1, 2, 3])],
          ["capture.json", "committed-before-reporting-failed"]
        ],
        { commitFile: "capture.json" }
      );
      process.stdout.write(JSON.stringify({ unexpected: "passed" }));
    } catch (error) {
      process.stdout.write(JSON.stringify({
        committed: error.committed === true,
        message: error.message
      }));
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
    fs.readFileSync(path.join(root, "evidence/capture-1/capture.json"), "utf8"),
    "committed-before-reporting-failed"
  );
  assert.deepEqual(
    fs.readFileSync(path.join(root, "evidence/capture-1/capture.png")),
    Buffer.from([1, 2, 3])
  );
});

test("project directory writer reports unknown non-retryable state for a tampered bundle", async (t) => {
  if (process.platform === "win32") return t.skip("signal and process-liveness semantics differ");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-project-directory-marker-unknown-"));
  const readyPath = path.join(root, "tampered-bundle-ready.json");
  const preload = path.join(root, "tamper-payload-after-marker-link.cjs");
  fs.writeFileSync(
    preload,
    `
      const fs = require("node:fs");
      const originalLink = fs.linkSync;
      let paused = false;
      fs.linkSync = function(source, destination, ...args) {
        const result = originalLink.call(fs, source, destination, ...args);
        if (
          !paused &&
          process.argv.includes("--child-directory") &&
          destination === "capture.json"
        ) {
          paused = true;
          fs.writeFileSync("capture.png", "EVIL");
          fs.writeFileSync(process.env.PM_TEST_MARKER_UNKNOWN, JSON.stringify({ pid: process.pid }));
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
        }
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
        [
          ["capture.png", "GOOD"],
          ["capture.json", "expected-marker"]
        ],
        { commitFile: "capture.json" }
      );
    } catch (error) {
      process.stdout.write(JSON.stringify({
        committed: error.committed ?? null,
        commitState: error.commitState ?? null,
        retryable: error.retryable ?? null,
        message: error.message
      }));
    }
  `;
  let stdout = "";
  const active = spawn(process.execPath, ["-e", script, root, writerModule], {
    env: {
      ...process.env,
      NODE_OPTIONS: `--require=${preload}`,
      PM_TEST_MARKER_UNKNOWN: readyPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  active.stdout.setEncoding("utf8");
  active.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  let writerPid = null;
  t.after(() => {
    if (writerPid)
      try {
        process.kill(writerPid, "SIGKILL");
      } catch {
        // The interrupted writer was already reaped.
      }
    if (active.exitCode === null && active.signalCode === null) active.kill("SIGKILL");
    fs.rmSync(root, { recursive: true, force: true });
  });
  const deadline = Date.now() + 5_000;
  while (!fs.existsSync(readyPath) && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(fs.existsSync(readyPath), true, "writer did not reach the bundle-tamper window");
  writerPid = JSON.parse(fs.readFileSync(readyPath, "utf8")).pid;
  const activeExit = new Promise((resolve) => active.once("exit", resolve));
  process.kill(writerPid, "SIGKILL");
  await activeExit;
  writerPid = null;

  const failure = JSON.parse(stdout);
  assert.equal(failure.committed, null);
  assert.equal(failure.commitState, "unknown");
  assert.equal(failure.retryable, false);
  assert.match(failure.message, /commit state is unknown.*do not retry/i);
  assert.equal(
    fs.readFileSync(path.join(root, "evidence", "capture-1", "capture.png"), "utf8"),
    "EVIL"
  );
  assert.equal(
    fs.readFileSync(path.join(root, "evidence", "capture-1", "capture.json"), "utf8"),
    "expected-marker"
  );
});

test("project directory writer durably orders marker publication before lease removal", async (t) => {
  if (process.platform === "win32") return t.skip("signal and process-liveness semantics differ");
  const roots = [];
  const liveChildren = [];
  t.after(() => {
    for (const child of liveChildren)
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
  });

  for (const boundary of ["before", "after"]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `pm-project-directory-lease-${boundary}-`));
    roots.push(root);
    const readyPath = path.join(root, "lease-boundary-ready.json");
    const preload = path.join(root, "pause-at-lease-removal.cjs");
    fs.writeFileSync(
      preload,
      `
        const fs = require("node:fs");
        const originalOpen = fs.openSync;
        const originalFsync = fs.fsyncSync;
        const originalLink = fs.linkSync;
        const originalUnlink = fs.unlinkSync;
        let markerPublished = false;
        let markerDirectoryDescriptor;
        let markerSynced = false;
        let paused = false;
        fs.linkSync = function(source, destination, ...args) {
          const result = originalLink.call(fs, source, destination, ...args);
          if (process.argv.includes("--child-directory") && destination === "capture.json")
            markerPublished = true;
          return result;
        };
        fs.openSync = function(file, ...args) {
          const descriptor = originalOpen.call(fs, file, ...args);
          if (process.argv.includes("--child-directory") && markerPublished && file === ".")
            markerDirectoryDescriptor = descriptor;
          return descriptor;
        };
        fs.fsyncSync = function(descriptor, ...args) {
          const result = originalFsync.call(fs, descriptor, ...args);
          if (descriptor === markerDirectoryDescriptor) markerSynced = true;
          return result;
        };
        fs.unlinkSync = function(target, ...args) {
          if (
            !paused &&
            process.argv.includes("--child-directory") &&
            target === ".pm-directory-owner.json"
          ) {
            paused = true;
            let result;
            if (process.env.PM_TEST_LEASE_BOUNDARY === "after")
              result = originalUnlink.call(fs, target, ...args);
            fs.writeFileSync(
              process.env.PM_TEST_LEASE_BOUNDARY_READY,
              JSON.stringify({ pid: process.pid, markerSynced })
            );
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
            if (process.env.PM_TEST_LEASE_BOUNDARY === "before")
              return originalUnlink.call(fs, target, ...args);
            return result;
          }
          return originalUnlink.call(fs, target, ...args);
        };
      `
    );
    const script = `
      const [root, writer] = process.argv.slice(1);
      try {
        require(writer).writeProjectDirectoryAtomic(root, "evidence/capture-1", [
          ["capture.png", Buffer.from([1, 2, 3])],
          ["capture.json", "durable-before-lease-removal"]
        ], { commitFile: "capture.json" });
      } catch (error) {
        process.stdout.write(JSON.stringify({ committed: error.committed === true, message: error.message }));
      }
    `;
    let stdout = "";
    const active = spawn(process.execPath, ["-e", script, root, writerModule], {
      env: {
        ...process.env,
        NODE_OPTIONS: `--require=${preload}`,
        PM_TEST_LEASE_BOUNDARY: boundary,
        PM_TEST_LEASE_BOUNDARY_READY: readyPath,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    liveChildren.push(active);
    active.stdout.setEncoding("utf8");
    active.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    const deadline = Date.now() + 5_000;
    while (!fs.existsSync(readyPath) && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(
      fs.existsSync(readyPath),
      true,
      `${boundary}: writer did not reach the lease-removal boundary`
    );
    const ready = JSON.parse(fs.readFileSync(readyPath, "utf8"));
    assert.equal(ready.markerSynced, true, `${boundary}: marker was not durable first`);
    const destination = path.join(root, "evidence", "capture-1");
    assert.equal(
      fs.existsSync(path.join(destination, ".pm-directory-owner.json")),
      boundary === "before"
    );
    assert.equal(
      fs.readFileSync(path.join(destination, "capture.json"), "utf8"),
      "durable-before-lease-removal"
    );

    const activeExit = new Promise((resolve) => active.once("exit", resolve));
    process.kill(ready.pid, "SIGKILL");
    await activeExit;
    const failure = JSON.parse(stdout);
    assert.equal(failure.committed, true, `${boundary}: ${failure.message}`);
    assert.match(failure.message, /committed.*do not retry/i);
    assert.throws(
      () =>
        writeProjectDirectoryAtomic(root, "evidence/capture-1", [["capture.json", "replacement"]], {
          commitFile: "capture.json",
        }),
      /already exists/
    );
    if (boundary === "before") {
      assert.throws(
        () =>
          writeProjectDirectoryAtomic(
            root,
            "evidence/capture-1",
            [["other.json", "must-not-replace-committed-bundle"]],
            { commitFile: "other.json" }
          ),
        /owner lease targets another commit marker/
      );
      assert.equal(
        fs.readFileSync(path.join(destination, "capture.json"), "utf8"),
        "durable-before-lease-removal"
      );
      assert.equal(fs.existsSync(path.join(destination, "other.json")), false);
    }
  }
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
      const originalLink = fs.linkSync;
      let markerPublished = false;
      fs.linkSync = function(source, destination, ...args) {
        const result = originalLink.call(fs, source, destination, ...args);
        if (process.argv.includes("--child-directory") && destination === "capture.json")
          markerPublished = true;
        return result;
      };
      fs.openSync = function(file, ...args) {
        if (process.argv.includes("--child-directory") && markerPublished && file === ".") {
          const error = new Error("injected post-marker sync failure");
          error.code = "EIO";
          throw error;
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
  assert.equal(
    fs.existsSync(path.join(root, "evidence", "capture-1", ".pm-directory-owner.json")),
    true,
    "the owner lease must remain when marker durability is not confirmed"
  );
});

test("project directory writer retains and reuses a precommit directory after marker failure", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-project-directory-marker-write-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "evidence"));
  const preload = path.join(root, "marker-write-preload.cjs");
  fs.writeFileSync(
    preload,
    `
      const fs = require("node:fs");
      const originalOpen = fs.openSync;
      const originalWrite = fs.writeSync;
      const originalFsync = fs.fsyncSync;
      let markerDescriptor;
      fs.openSync = function(file, ...args) {
        const descriptor = originalOpen.call(fs, file, ...args);
        if (
          process.argv.includes("--child-directory") &&
          typeof file === "string" &&
          file.startsWith(".capture.json.tmp-")
        ) markerDescriptor = descriptor;
        return descriptor;
      };
      fs.writeSync = function(target, ...args) {
        if (process.env.PM_TEST_MARKER_FAILURE === "write" && target === markerDescriptor) {
          const error = new Error("injected marker write failure");
          error.code = "EIO";
          throw error;
        }
        return originalWrite.call(fs, target, ...args);
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
  let destinationIdentity = null;
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
    const destination = path.join(root, "evidence", "capture-1");
    assert.equal(fs.existsSync(destination), true);
    assert.equal(fs.existsSync(path.join(destination, ".pm-directory-owner.json")), true);
    assert.equal(fs.existsSync(path.join(destination, "capture.json")), false);
    const observed = fs.statSync(destination);
    if (destinationIdentity) {
      assert.equal(observed.dev, destinationIdentity.dev);
      assert.equal(observed.ino, destinationIdentity.ino);
    } else destinationIdentity = observed;
  }

  const recovered = writeProjectDirectoryAtomic(
    root,
    "evidence/capture-1",
    [["capture.json", "retry-succeeded"]],
    { commitFile: "capture.json" }
  );
  assert.equal(recovered.committed, true);
  const recoveredIdentity = fs.statSync(path.join(root, "evidence", "capture-1"));
  assert.equal(recoveredIdentity.dev, destinationIdentity.dev);
  assert.equal(recoveredIdentity.ino, destinationIdentity.ino);
  assert.equal(
    fs.readFileSync(path.join(root, "evidence", "capture-1", "capture.json"), "utf8"),
    "retry-succeeded"
  );
  assert.equal(
    fs.existsSync(path.join(root, "evidence", "capture-1", ".pm-directory-owner.json")),
    false
  );
});

test("project directory recovery preserves a swapped pathname and a late commit marker", (t) => {
  const roots = [];
  t.after(() => {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
  });

  for (const scenario of ["path-swap", "marker-insert"]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `pm-project-directory-${scenario}-`));
    roots.push(root);
    fs.mkdirSync(path.join(root, "evidence"));
    const destination = path.join(root, "evidence", "capture-1");
    const seedPreload = path.join(root, "retain-precommit-directory.cjs");
    fs.writeFileSync(
      seedPreload,
      `
        const fs = require("node:fs");
        const originalOpen = fs.openSync;
        const originalWrite = fs.writeSync;
        let markerDescriptor;
        fs.openSync = function(file, ...args) {
          const descriptor = originalOpen.call(fs, file, ...args);
          if (
            process.argv.includes("--child-directory") &&
            typeof file === "string" &&
            file.startsWith(".capture.json.tmp-")
          ) markerDescriptor = descriptor;
          return descriptor;
        };
        fs.writeSync = function(descriptor, ...args) {
          if (descriptor === markerDescriptor) {
            const error = new Error("injected pre-publication marker failure");
            error.code = "EIO";
            throw error;
          }
          return originalWrite.call(fs, descriptor, ...args);
        };
      `
    );
    const script = `
      const [root, writer] = process.argv.slice(1);
      try {
        require(writer).writeProjectDirectoryAtomic(root, "evidence/capture-1", [
          ["capture.png", "partial-payload"],
          ["capture.json", "requested-marker"]
        ], { commitFile: "capture.json" });
        process.stdout.write(JSON.stringify({ unexpected: "passed" }));
      } catch (error) {
        process.stdout.write(JSON.stringify({
          committed: error.committed === true,
          message: error.message
        }));
      }
    `;
    const seed = spawnSync(process.execPath, ["-e", script, root, writerModule], {
      encoding: "utf8",
      env: { ...process.env, NODE_OPTIONS: `--require=${seedPreload}` },
    });
    assert.equal(seed.status, 0, `${scenario}: ${seed.stderr}`);
    assert.equal(JSON.parse(seed.stdout).committed, false);
    const staleIdentity = fs.statSync(destination);
    assert.equal(fs.existsSync(path.join(destination, ".pm-directory-owner.json")), true);

    const recoveryPreload = path.join(root, `${scenario}-during-recovery.cjs`);
    if (scenario === "path-swap") {
      fs.writeFileSync(
        recoveryPreload,
        `
          const fs = require("node:fs");
          const path = require("node:path");
          const originalOpendir = fs.opendirSync;
          const originalRename = fs.renameSync;
          let swapped = false;
          fs.opendirSync = function(directory, ...args) {
            if (
              !swapped &&
              process.argv.includes("--child-directory") &&
              directory === "." &&
              path.basename(process.cwd()) === "capture-1"
            ) {
              swapped = true;
              const destination = path.join(process.env.PM_TEST_ROOT, "evidence", "capture-1");
              const original = path.join(process.env.PM_TEST_ROOT, "evidence", "owned-original");
              originalRename.call(fs, destination, original);
              fs.mkdirSync(destination);
              fs.writeFileSync(path.join(destination, "foreign.txt"), "foreign-data");
            }
            return originalOpendir.call(fs, directory, ...args);
          };
        `
      );
    } else {
      fs.writeFileSync(
        recoveryPreload,
        `
          const fs = require("node:fs");
          const path = require("node:path");
          const originalUnlink = fs.unlinkSync;
          let inserted = false;
          fs.unlinkSync = function(target, ...args) {
            if (
              !inserted &&
              process.argv.includes("--child-directory") &&
              target === "capture.png" &&
              path.basename(process.cwd()) === "capture-1"
            ) {
              inserted = true;
              fs.writeFileSync("capture.json", "foreign-commit-marker");
            }
            return originalUnlink.call(fs, target, ...args);
          };
        `
      );
    }

    const recovery = spawnSync(process.execPath, ["-e", script, root, writerModule], {
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_OPTIONS: `--require=${recoveryPreload}`,
        PM_TEST_ROOT: root,
      },
    });
    assert.equal(recovery.status, 0, `${scenario}: ${recovery.stderr}`);
    const failure = JSON.parse(recovery.stdout);
    assert.equal(failure.committed, false, `${scenario}: ${failure.message}`);
    assert.equal(failure.unexpected, undefined);
    assert.equal(
      fs.readdirSync(path.join(root, "evidence")).some((name) => name.startsWith(".pm-dir-stale-")),
      false
    );

    if (scenario === "path-swap") {
      assert.equal(fs.readFileSync(path.join(destination, "foreign.txt"), "utf8"), "foreign-data");
      const preservedForeign = fs.statSync(destination);
      assert.notEqual(preservedForeign.ino, staleIdentity.ino);
      const ownedOriginal = fs.statSync(path.join(root, "evidence", "owned-original"));
      assert.equal(ownedOriginal.dev, staleIdentity.dev);
      assert.equal(ownedOriginal.ino, staleIdentity.ino);
      assert.match(failure.message, /destination changed at its published path/);
    } else {
      const retainedIdentity = fs.statSync(destination);
      assert.equal(retainedIdentity.dev, staleIdentity.dev);
      assert.equal(retainedIdentity.ino, staleIdentity.ino);
      assert.equal(
        fs.readFileSync(path.join(destination, "capture.json"), "utf8"),
        "foreign-commit-marker"
      );
      assert.match(failure.message, /already exists/);
    }
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
          process.argv.includes("--child-directory") &&
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

test("directory reconciliation syncs a marker published before child death", (t) => {
  if (process.platform === "win32") return t.skip("signal semantics differ on Windows");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-project-directory-reconcile-sync-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const syncReceipt = path.join(root, "reconciliation-synced");
  const preload = path.join(root, "die-after-marker-publication.cjs");
  fs.writeFileSync(
    preload,
    `
      const fs = require("node:fs");
      const path = require("node:path");
      const originalLink = fs.linkSync;
      const originalOpen = fs.openSync;
      const originalFsync = fs.fsyncSync;
      let reconciliationDescriptor = null;
      fs.linkSync = function(source, destination, ...args) {
        const result = originalLink.call(fs, source, destination, ...args);
        if (process.argv.includes("--child-directory") && destination === "capture.json") {
          process.kill(process.pid, "SIGKILL");
        }
        return result;
      };
      fs.openSync = function(target, ...args) {
        const descriptor = originalOpen.call(fs, target, ...args);
        if (
          !process.argv.includes("--child-directory") &&
          path.isAbsolute(String(target)) &&
          String(target).endsWith(path.join("evidence", "capture-1"))
        ) reconciliationDescriptor = descriptor;
        return descriptor;
      };
      fs.fsyncSync = function(descriptor, ...args) {
        const result = originalFsync.call(fs, descriptor, ...args);
        if (descriptor === reconciliationDescriptor) {
          fs.writeFileSync(process.env.PM_TEST_SYNC_RECEIPT, "synced");
        }
        return result;
      };
    `
  );
  const script = `
    const [root, writer] = process.argv.slice(1);
    try {
      require(writer).writeProjectDirectoryAtomic(root, "evidence/capture-1", [
        ["capture.png", Buffer.from([1, 2, 3])],
        ["capture.json", "published-marker"]
      ], { commitFile: "capture.json" });
      process.stdout.write(JSON.stringify({ unexpected: "passed" }));
    } catch (error) {
      process.stdout.write(JSON.stringify({ committed: error.committed, message: error.message }));
    }
  `;
  const result = spawnSync(process.execPath, ["-e", script, root, writerModule], {
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_OPTIONS: `--require=${preload}`,
      PM_TEST_SYNC_RECEIPT: syncReceipt,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const failure = JSON.parse(result.stdout);
  assert.equal(failure.unexpected, undefined);
  assert.equal(failure.committed, true);
  assert.match(failure.message, /committed.*do not retry/i);
  assert.equal(fs.readFileSync(syncReceipt, "utf8"), "synced");
  assert.equal(
    fs.readFileSync(path.join(root, "evidence", "capture-1", "capture.json"), "utf8"),
    "published-marker"
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
