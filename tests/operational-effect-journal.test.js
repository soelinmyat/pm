"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const {
  createEffectPlan,
  effectJournalPath,
  runOperationalEffect,
  serializationLockPath,
  sharedResourceSerialization,
} = require("../scripts/lib/operational-effect-journal.js");
const { writeJsonAtomic } = require("../scripts/lib/atomic-file.js");

function stateDir(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-effect-journal-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function input(root) {
  return {
    pmStateDir: root,
    workflow: "setup",
    effect: "update-config",
    authorityAction: "update_config",
    authorityActions: ["update_config"],
    serializationScope: { resource: "config", file: ".pm/config.json" },
    target: { file: ".pm/config.json", field: "integrations.linear.enabled" },
    intent: { value_sha256: `sha256:${"a".repeat(64)}` },
    precondition: { config_sha256: `sha256:${"b".repeat(64)}` },
    recovery: {
      code: "inspect-config-effect",
      command: "/pm:setup status",
    },
  };
}

function waitForFile(filePath, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (fs.existsSync(filePath)) return resolve();
      if (Date.now() >= deadline) return reject(new Error(`timed out waiting for ${filePath}`));
      setTimeout(poll, 10);
    };
    poll();
  });
}

function collectChild(child) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) return reject(new Error(`worker exited ${code}: ${stderr}`));
      resolve(JSON.parse(stdout));
    });
  });
}

test("effect plans have stable identity without folding mutable preconditions into the key", (t) => {
  const root = stateDir(t);
  const first = createEffectPlan(input(root));
  const second = createEffectPlan({
    ...input(root),
    precondition: { config_sha256: `sha256:${"c".repeat(64)}` },
  });
  assert.equal(first.effect_id, second.effect_id);
  assert.equal(first.idempotency_key, second.idempotency_key);
  assert.notDeepEqual(first.precondition, second.precondition);
});

test("a verified effect is observed and reused without replay", (t) => {
  const root = stateDir(t);
  let mutations = 0;
  const execute = () =>
    runOperationalEffect({
      ...input(root),
      mutate() {
        mutations += 1;
        return { receipt: { config_sha256: `sha256:${"d".repeat(64)}` } };
      },
      observe() {
        return {
          state: "verified",
          receipt: { config_sha256: `sha256:${"d".repeat(64)}` },
        };
      },
    });

  const first = execute();
  const second = execute();
  assert.equal(first.state, "verified");
  assert.equal(second.state, "verified");
  assert.equal(second.replayed, true);
  assert.deepEqual(second.verified_receipt, first.verified_receipt);
  assert.equal(mutations, 1);
  assert.equal(fs.statSync(first.journal_path).mode & 0o777, 0o600);
});

test("an ambiguous replay preserves the verified receipt and never mutates again", (t) => {
  const root = stateDir(t);
  let mutations = 0;
  let readable = true;
  const execute = () =>
    runOperationalEffect({
      ...input(root),
      mutate() {
        mutations += 1;
        return { receipt: { config_sha256: "verified-value" } };
      },
      observe() {
        return readable
          ? { state: "verified", receipt: { config_sha256: "verified-value" } }
          : { state: "ambiguous", reason: "target is temporarily unreadable" };
      },
    });

  const verified = execute();
  readable = false;
  const replay = execute();
  const journal = JSON.parse(fs.readFileSync(verified.journal_path, "utf8"));

  assert.equal(replay.state, "ambiguous");
  assert.equal(replay.replayed, true);
  assert.equal(mutations, 1);
  assert.equal(journal.state, "verified");
  assert.deepEqual(journal.verified_receipt, verified.verified_receipt);
});

test("an interrupted attempting journal observes success before any retry", (t) => {
  const root = stateDir(t);
  const plan = createEffectPlan(input(root));
  const journalPath = effectJournalPath(root, plan.effect_id);
  writeJsonAtomic(
    journalPath,
    {
      schema_version: 1,
      ...plan,
      state: "attempting",
      attempts: [
        {
          attempt: 1,
          state: "attempting",
          started_at: "2026-07-15T00:00:00.000Z",
          completed_at: null,
          error: null,
        },
      ],
      verified_receipt: null,
      recovery: input(root).recovery,
      updated_at: "2026-07-15T00:00:00.000Z",
    },
    { fileMode: 0o600, dirMode: 0o700 }
  );

  let mutations = 0;
  const result = runOperationalEffect({
    ...input(root),
    mutate() {
      mutations += 1;
      return { receipt: { config_sha256: `sha256:${"d".repeat(64)}` } };
    },
    observe() {
      return {
        state: "verified",
        receipt: { config_sha256: `sha256:${"d".repeat(64)}` },
      };
    },
  });
  assert.equal(result.state, "verified");
  assert.equal(result.recovered, true);
  assert.equal(mutations, 0);
});

test("recovery observes the interrupted attempt's original precondition", (t) => {
  const root = stateDir(t);
  const original = input(root);
  const plan = createEffectPlan(original);
  const journalPath = effectJournalPath(root, plan.effect_id);
  writeJsonAtomic(
    journalPath,
    {
      schema_version: 1,
      ...plan,
      state: "attempting",
      attempts: [{ attempt: 1, state: "attempting", started_at: "2026-07-15T00:00:00Z" }],
      verified_receipt: null,
      recovery: original.recovery,
      updated_at: "2026-07-15T00:00:00Z",
    },
    { fileMode: 0o600, dirMode: 0o700 }
  );

  let observedPrecondition;
  const result = runOperationalEffect({
    ...original,
    precondition: { config_sha256: `sha256:${"c".repeat(64)}` },
    mutate() {
      assert.fail("an ambiguous interrupted attempt must not retry");
    },
    observe({ journal }) {
      observedPrecondition = journal.precondition;
      return { state: "ambiguous", reason: "cannot reconstruct the prior effect" };
    },
  });

  assert.equal(result.state, "ambiguous");
  assert.deepEqual(observedPrecondition, plan.precondition);
});

test("shared resource serialization is independent of caller state directories", (t) => {
  const root = stateDir(t);
  const resource = path.join(root, "shared-repository");
  fs.mkdirSync(resource);
  const left = sharedResourceSerialization("knowledge-base-git", resource);
  const right = sharedResourceSerialization("knowledge-base-git", path.join(resource, "."));

  assert.equal(left.root, right.root);
  assert.deepEqual(left.scope, right.scope);
  assert.equal(
    serializationLockPath(left.root, left.scope),
    serializationLockPath(right.root, right.scope)
  );
});

test("missing action-specific authority blocks before mutation", (t) => {
  const root = stateDir(t);
  let mutated = false;
  const result = runOperationalEffect({
    ...input(root),
    authorityActions: ["some_other_action"],
    mutate() {
      mutated = true;
    },
    observe() {
      return { state: "absent" };
    },
  });
  assert.equal(result.state, "blocked");
  assert.equal(result.recovery.code, "authority-required");
  assert.equal(mutated, false);
});

test("an indeterminate observation remains ambiguous and never retries", (t) => {
  const root = stateDir(t);
  let mutations = 0;
  const plan = createEffectPlan(input(root));
  const journalPath = effectJournalPath(root, plan.effect_id);
  writeJsonAtomic(
    journalPath,
    {
      schema_version: 1,
      ...plan,
      state: "attempting",
      attempts: [
        {
          attempt: 1,
          state: "attempting",
          started_at: "2026-07-15T00:00:00.000Z",
          completed_at: null,
          error: null,
        },
      ],
      verified_receipt: null,
      recovery: input(root).recovery,
      updated_at: "2026-07-15T00:00:00.000Z",
    },
    { fileMode: 0o600, dirMode: 0o700 }
  );
  const result = runOperationalEffect({
    ...input(root),
    mutate() {
      mutations += 1;
    },
    observe() {
      return { state: "ambiguous", reason: "target cannot be read" };
    },
  });
  assert.equal(result.state, "ambiguous");
  assert.equal(result.recovery.code, "inspect-config-effect");
  assert.equal(mutations, 0);
});

test("concurrent processes share one mutation attempt and the contender replays it", async (t) => {
  const root = stateDir(t);
  const markerPath = path.join(root, "mutation-started");
  const releasePath = path.join(root, "release");
  const mutationPath = path.join(root, "mutations.log");
  const workerPath = path.join(__dirname, "fixtures", "operational-effect-worker.js");
  const args = [workerPath, root, markerPath, releasePath, mutationPath];

  const first = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
  const firstResult = collectChild(first);
  await waitForFile(markerPath);
  const second = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
  const secondResult = collectChild(second);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(fs.readFileSync(mutationPath, "utf8").trim().split("\n").length, 1);
  fs.writeFileSync(releasePath, "release");

  const [left, right] = await Promise.all([firstResult, secondResult]);
  assert.equal(left.state, "verified");
  assert.equal(right.state, "verified");
  assert.equal(right.replayed, true);
  assert.equal(fs.readFileSync(mutationPath, "utf8").trim().split("\n").length, 1);
});

test("different effect identities serialize on one mutable resource", async (t) => {
  const root = stateDir(t);
  const markerPath = path.join(root, "mutation-started");
  const releasePath = path.join(root, "release");
  const mutationPath = path.join(root, "mutations.log");
  const workerPath = path.join(__dirname, "fixtures", "operational-effect-worker.js");
  const args = [workerPath, root, markerPath, releasePath, mutationPath];
  const first = collectChild(
    spawn(process.execPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PM_TEST_EFFECT_VALUE: "left" },
    })
  );
  await waitForFile(markerPath);
  const second = collectChild(
    spawn(process.execPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PM_TEST_EFFECT_VALUE: "right" },
    })
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepEqual(fs.readFileSync(mutationPath, "utf8").trim().split("\n"), ["left"]);
  fs.writeFileSync(releasePath, "release");
  const results = await Promise.all([first, second]);
  assert.deepEqual(
    results.map((result) => result.state),
    ["verified", "verified"]
  );
  assert.deepEqual(fs.readFileSync(mutationPath, "utf8").trim().split("\n"), ["left", "right"]);
});

test("distinct journals serialize through one shared resource lock root", async (t) => {
  const root = stateDir(t);
  const leftState = path.join(root, "consumer-left");
  const rightState = path.join(root, "consumer-right");
  const sharedRoot = path.join(root, "shared-locks");
  const markerPath = path.join(root, "mutation-started");
  const releasePath = path.join(root, "release");
  const mutationPath = path.join(root, "mutations.log");
  const workerPath = path.join(__dirname, "fixtures", "operational-effect-worker.js");
  const first = collectChild(
    spawn(process.execPath, [workerPath, leftState, markerPath, releasePath, mutationPath], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PM_TEST_EFFECT_VALUE: "left",
        PM_TEST_SERIALIZATION_ROOT: sharedRoot,
      },
    })
  );
  await waitForFile(markerPath);
  const second = collectChild(
    spawn(process.execPath, [workerPath, rightState, markerPath, releasePath, mutationPath], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PM_TEST_EFFECT_VALUE: "right",
        PM_TEST_SERIALIZATION_ROOT: sharedRoot,
      },
    })
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepEqual(fs.readFileSync(mutationPath, "utf8").trim().split("\n"), ["left"]);
  fs.writeFileSync(releasePath, "release");
  const results = await Promise.all([first, second]);
  assert.deepEqual(
    results.map((result) => result.state),
    ["verified", "verified"]
  );
  assert.deepEqual(fs.readFileSync(mutationPath, "utf8").trim().split("\n"), ["left", "right"]);
});

test("a lock left by a dead process fails closed with explicit recovery", (t) => {
  const root = stateDir(t);
  const plan = createEffectPlan(input(root));
  const journalPath = effectJournalPath(root, plan.effect_id);
  fs.mkdirSync(path.dirname(journalPath), { recursive: true });
  const lockPath = serializationLockPath(root, input(root).serializationScope);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(
    lockPath,
    JSON.stringify({ pid: 2147483647, acquired_at: "2026-07-15T00:00:00.000Z" })
  );
  let mutations = 0;
  const result = runOperationalEffect({
    ...input(root),
    lockTimeoutMs: 0,
    observe() {
      return mutations
        ? { state: "verified", receipt: { config_sha256: "done" } }
        : { state: "absent", safe_to_retry: true };
    },
    mutate() {
      mutations += 1;
    },
  });
  assert.equal(result.state, "blocked");
  assert.equal(result.recovery.code, "effect-lock-recovery-required");
  assert.equal(mutations, 0);
  assert.equal(fs.existsSync(lockPath), true);
});

test("multiple contenders never mutate through one dead lock", async (t) => {
  const root = stateDir(t);
  const plan = createEffectPlan({
    pmStateDir: root,
    workflow: "test",
    effect: "exclusive-mutation",
    authorityAction: "mutate_fixture",
    target: { file: "fixture" },
    intent: { value: "done" },
    precondition: { value: "absent" },
    recovery: { code: "inspect-fixture", command: "retry fixture" },
  });
  const journalPath = effectJournalPath(root, plan.effect_id);
  fs.mkdirSync(path.dirname(journalPath), { recursive: true });
  const lockPath = serializationLockPath(root, {
    resource: "fixture",
    file: "fixture",
  });
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(
    lockPath,
    JSON.stringify({ pid: 2147483647, token: "dead-owner", acquired_at: "2026-07-15T00:00:00Z" })
  );
  const markerPath = path.join(root, "mutation-started");
  const releasePath = path.join(root, "release");
  const mutationPath = path.join(root, "mutations.log");
  fs.writeFileSync(releasePath, "release");
  const workerPath = path.join(__dirname, "fixtures", "operational-effect-worker.js");
  const args = [workerPath, root, markerPath, releasePath, mutationPath];
  const workers = Array.from({ length: 3 }, () =>
    collectChild(
      spawn(process.execPath, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PM_TEST_LOCK_TIMEOUT_MS: "0" },
      })
    )
  );
  const results = await Promise.all(workers);
  assert.deepEqual(
    results.map((result) => result.state),
    ["blocked", "blocked", "blocked"]
  );
  assert.equal(fs.existsSync(mutationPath), false);
});
