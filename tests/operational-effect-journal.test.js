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
  assert.equal(mutations, 1);
  assert.equal(fs.statSync(first.journal_path).mode & 0o777, 0o600);
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

test("a lock left by a dead process is reclaimed before mutation", (t) => {
  const root = stateDir(t);
  const plan = createEffectPlan(input(root));
  const journalPath = effectJournalPath(root, plan.effect_id);
  fs.mkdirSync(path.dirname(journalPath), { recursive: true });
  fs.writeFileSync(
    `${journalPath}.lock`,
    JSON.stringify({ pid: 2147483647, acquired_at: "2026-07-15T00:00:00.000Z" })
  );
  let mutations = 0;
  const result = runOperationalEffect({
    ...input(root),
    observe() {
      return mutations
        ? { state: "verified", receipt: { config_sha256: "done" } }
        : { state: "absent", safe_to_retry: true };
    },
    mutate() {
      mutations += 1;
    },
  });
  assert.equal(result.state, "verified");
  assert.equal(mutations, 1);
  assert.equal(fs.existsSync(`${journalPath}.lock`), false);
});
