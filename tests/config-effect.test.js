"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const { applyConfigEffect, readConfig } = require("../scripts/config-effect.js");

function project(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-config-effect-"));
  const configPath = path.join(root, ".pm", "config.json");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(
    configPath,
    `${JSON.stringify({ config_schema: 2, untouched: { keep: true } }, null, 2)}\n`
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, configPath };
}

function childResult(child) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) reject(new Error(stderr));
      else resolve(JSON.parse(stdout));
    });
  });
}

function waitFor(filePath) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 3000;
    const poll = () => {
      if (fs.existsSync(filePath)) resolve();
      else if (Date.now() >= deadline) reject(new Error(`timed out waiting for ${filePath}`));
      else setTimeout(poll, 10);
    };
    poll();
  });
}

test("config effect preserves unrelated fields and returns a verified private receipt", (t) => {
  const value = project(t);
  const result = applyConfigEffect({
    projectDir: value.root,
    field: "integrations.linear.enabled",
    value: true,
    authorityActions: ["update_config"],
  });
  assert.equal(result.state, "verified");
  assert.equal(readConfig(value.configPath).untouched.keep, true);
  assert.equal(readConfig(value.configPath).integrations.linear.enabled, true);
  assert.equal(fs.statSync(value.configPath).mode & 0o777, 0o600);
  assert.match(result.verified_receipt.receipt.config_sha256, /^sha256:[a-f0-9]{64}$/);
});

test("repeating an already verified config intent does not rewrite the file", (t) => {
  const value = project(t);
  const request = {
    projectDir: value.root,
    field: "sync.enabled",
    value: false,
    authorityActions: ["update_config"],
  };
  const first = applyConfigEffect(request);
  const inode = fs.statSync(value.configPath).ino;
  const second = applyConfigEffect(request);
  assert.equal(first.state, "verified");
  assert.equal(second.replayed, true);
  assert.equal(fs.statSync(value.configPath).ino, inode);
});

test("config preimage drift blocks instead of overwriting concurrent changes", (t) => {
  const value = project(t);
  const result = applyConfigEffect({
    projectDir: value.root,
    field: "integrations.github.enabled",
    value: true,
    authorityActions: ["update_config"],
    beforeMutate() {
      const current = readConfig(value.configPath);
      current.concurrent = "preserve me";
      fs.writeFileSync(value.configPath, `${JSON.stringify(current, null, 2)}\n`);
    },
  });
  assert.equal(result.state, "blocked");
  assert.equal(result.recovery.code, "config-precondition-changed");
  const current = readConfig(value.configPath);
  assert.equal(current.concurrent, "preserve me");
  assert.equal(current.integrations, undefined);
});

test("differently keyed config effects serialize and preserve both updates", async (t) => {
  const value = project(t);
  const markerPath = path.join(value.root, "first-started");
  const releasePath = path.join(value.root, "release");
  const worker = path.join(__dirname, "fixtures", "config-effect-worker.js");
  const first = childResult(
    spawn(
      process.execPath,
      [worker, value.root, "integrations.linear.enabled", "left", markerPath, releasePath],
      {
        stdio: ["ignore", "pipe", "pipe"],
      }
    )
  );
  await waitFor(markerPath);
  const second = childResult(
    spawn(
      process.execPath,
      [worker, value.root, "integrations.github.enabled", "right", markerPath, releasePath],
      {
        stdio: ["ignore", "pipe", "pipe"],
      }
    )
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(readConfig(value.configPath).integrations, undefined);
  fs.writeFileSync(releasePath, "release");
  const results = await Promise.all([first, second]);
  assert.deepEqual(
    results.map((result) => result.state),
    ["verified", "verified"]
  );
  const config = readConfig(value.configPath);
  assert.equal(config.integrations.linear.enabled, "left");
  assert.equal(config.integrations.github.enabled, "right");
});

test("config field paths reject prototype keys and malformed segments", (t) => {
  const value = project(t);
  for (const field of ["__proto__.polluted", "a..b", "constructor.value", ".leading"]) {
    assert.throws(
      () =>
        applyConfigEffect({
          projectDir: value.root,
          field,
          value: true,
          authorityActions: ["update_config"],
        }),
      /config field/
    );
  }
});

test("one config effect can initialize and atomically apply a repo-link patch set", (t) => {
  const value = project(t);
  fs.rmSync(value.configPath);
  const result = applyConfigEffect({
    projectDir: value.root,
    initialConfig: {
      config_schema: 2,
      project_name: "pm-config-effect",
      source_repo: { type: "local", path: "../old-source" },
      preferences: { keep: true },
    },
    changes: [
      { operation: "set", field: "config_schema", value: 2 },
      {
        operation: "set",
        field: "pm_repo",
        value: { type: "local", path: "../../my-pm" },
      },
      { operation: "delete", field: "source_repo" },
    ],
    authorityActions: ["update_config"],
  });
  assert.equal(result.state, "verified");
  const config = readConfig(value.configPath);
  assert.equal(config.config_schema, 2);
  assert.deepEqual(config.pm_repo, { type: "local", path: "../../my-pm" });
  assert.equal(config.source_repo, undefined);
  assert.equal(config.preferences.keep, true);
});

test("config patch sets reject ancestor and descendant fields before writing", (t) => {
  const value = project(t);
  const before = fs.readFileSync(value.configPath);
  for (const changes of [
    [
      { operation: "set", field: "integrations", value: {} },
      { operation: "set", field: "integrations.linear.enabled", value: true },
    ],
    [
      { operation: "set", field: "integrations.linear.enabled", value: true },
      { operation: "delete", field: "integrations" },
    ],
    [
      { operation: "delete", field: "integrations.linear" },
      { operation: "set", field: "integrations", value: {} },
    ],
  ]) {
    assert.throws(
      () =>
        applyConfigEffect({
          projectDir: value.root,
          changes,
          authorityActions: ["update_config"],
        }),
      /overlapping config fields/
    );
    assert.deepEqual(fs.readFileSync(value.configPath), before);
  }
});
