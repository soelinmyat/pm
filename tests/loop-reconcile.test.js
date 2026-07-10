"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { parseFrontmatter } = require("../scripts/kb-frontmatter.js");
const {
  buildPlan,
  classifyStaleCard,
  parseArgs,
  recoveryMutationManifest,
  resumeRecovery,
  runReconcile,
} = require("../scripts/loop-reconcile.js");

const NOW = new Date("2026-07-10T12:00:00Z");
const RUN_ID = "loop-12345678-1234-4123-8123-123456789abc";
const RUN_ID_2 = "loop-22345678-1234-4123-8123-123456789abc";

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function card(overrides = {}) {
  const data = {
    id: "PM-404",
    title: "Stale card",
    status: "in-progress",
    loop_run_id: RUN_ID,
    ...overrides,
  };
  return {
    id: data.id,
    data,
    content: "---\nid: PM-404\nstatus: in-progress\n---\nbody\n",
    relativePath: "pm/backlog/stale.md",
    revision: "sha256:" + "a".repeat(64),
  };
}

function transaction(overrides = {}) {
  return {
    run_id: RUN_ID,
    state: "finalized",
    event: {
      schema_version: 1,
      run_id: RUN_ID,
      card_id: "PM-404",
      stage: "dev",
      terminal: true,
      status: "failed",
      outcome: "dev-failed",
    },
    recovery: null,
    lease: null,
    lease_expired: false,
    ...overrides,
  };
}

function storedPr(state = "in-progress") {
  return card({
    status: state,
    branch: "loop/pm-404",
    prs: ["#42"],
    pr_repo: "openai/pm",
    pr_number: "42",
    pr_url: "https://github.com/openai/pm/pull/42",
    pr_base: "main",
    pr_head_oid: "a".repeat(40),
    pr_created_at: "2026-07-10T10:01:00Z",
    pr_dispatch_at: "2026-07-10T10:00:00Z",
  });
}

test("classification uses recovery, durable outcomes, verified PRs, and lease evidence in precedence order", () => {
  const recovery = classifyStaleCard(
    card(),
    {
      leases: [{ run_id: RUN_ID, expired: true }],
      transactions: [
        transaction({
          state: "recovery-ready",
          recovery: {
            run_id: RUN_ID,
            card_id: "PM-404",
            stage: "dev",
            terminal_event: { terminal: true, status: "completed" },
          },
          lease: { run_id: RUN_ID },
          lease_expired: true,
        }),
      ],
    },
    {}
  );
  assert.equal(recovery.classification, "recovery-ready");
  assert.equal(recovery.operation, "resume-finalization");
  assert.equal(recovery.run_id, RUN_ID);

  const ambiguousRecovery = classifyStaleCard(
    card(),
    {
      leases: [{ run_id: RUN_ID, expired: true }],
      transactions: [transaction({ state: "ambiguous", recovery: { run_id: RUN_ID } })],
    },
    {}
  );
  assert.equal(ambiguousRecovery.classification, "recovery-ambiguous");
  assert.equal(ambiguousRecovery.operation, "none");

  const blocked = classifyStaleCard(
    card(),
    {
      leases: [],
      transactions: [
        transaction({
          event: {
            run_id: RUN_ID,
            card_id: "PM-404",
            terminal: true,
            status: "blocked",
            blocker: { reason: "Database unavailable", remediation: "Start the database." },
          },
        }),
      ],
    },
    {}
  );
  assert.equal(blocked.classification, "durable-blocker");
  assert.equal(blocked.next_status, "needs-human");

  const terminal = classifyStaleCard(card(), { leases: [], transactions: [transaction()] }, {});
  assert.equal(terminal.classification, "durable-terminal-outcome");
  assert.equal(terminal.next_status, "needs-human");

  const active = classifyStaleCard(
    card(),
    { leases: [{ run_id: RUN_ID, expired: false }], transactions: [] },
    {}
  );
  assert.equal(active.classification, "active-lease");
  assert.equal(active.operation, "none");

  const open = classifyStaleCard(
    storedPr(),
    { leases: [], transactions: [] },
    {
      inspectPullRequest: () => ({ ok: true, state: "OPEN", pr: { number: 42 } }),
      expectedRepository: "openai/pm",
      expectedBase: "main",
    }
  );
  assert.equal(open.classification, "verified-open-pr");
  assert.equal(open.next_status, "shipping");

  const merged = classifyStaleCard(
    storedPr("shipping"),
    { leases: [], transactions: [] },
    {
      inspectPullRequest: () => ({
        ok: true,
        state: "MERGED",
        pr: { number: 42 },
        merge: { merge_sha: "b".repeat(40), merged_at: "2026-07-10T11:00:00Z" },
      }),
      expectedRepository: "openai/pm",
      expectedBase: "main",
    }
  );
  assert.equal(merged.classification, "verified-merged-pr");
  assert.equal(merged.next_status, "done");

  const expired = classifyStaleCard(
    card({ loop_run_id: "" }),
    { leases: [{ run_id: RUN_ID, card_id: "PM-404", expired: true }], transactions: [] },
    {}
  );
  assert.equal(expired.classification, "expired-lease");
  assert.equal(expired.next_status, "needs-human");

  const unknown = classifyStaleCard(
    storedPr(),
    { leases: [], transactions: [] },
    {
      inspectPullRequest: () => ({ ok: false, state: "UNKNOWN", reason: "GitHub unavailable" }),
      expectedRepository: "openai/pm",
      expectedBase: "main",
    }
  );
  assert.equal(unknown.classification, "unverified");
  assert.equal(unknown.operation, "none");
  assert.match(unknown.remediation, /retry.*GitHub/i);
});

test("a unique same-card recovery outranks stale run identity and ambiguous evidence fails closed", () => {
  const newerRecovery = transaction({
    run_id: RUN_ID_2,
    state: "recovery-ready",
    recovery: {
      run_id: RUN_ID_2,
      card_id: "PM-404",
      stage: "dev",
      terminal_event: { terminal: true, status: "completed" },
    },
  });
  const selected = classifyStaleCard(
    card({ loop_run_id: RUN_ID }),
    {
      leases: [{ run_id: RUN_ID_2, card_id: "PM-404", expired: true }],
      transactions: [transaction(), newerRecovery],
    },
    {}
  );
  assert.equal(selected.classification, "recovery-ready");
  assert.equal(selected.run_id, RUN_ID_2);

  const multiple = classifyStaleCard(
    card(),
    {
      leases: [],
      transactions: [
        newerRecovery,
        transaction({
          state: "recovery-ready",
          recovery: { run_id: RUN_ID, card_id: "PM-404", stage: "dev" },
        }),
      ],
    },
    {}
  );
  assert.equal(multiple.classification, "recovery-ambiguous");
  assert.equal(multiple.operation, "none");

  const malformed = classifyStaleCard(
    card(),
    {
      leases: [{ run_id: RUN_ID, card_id: "PM-404", expired: true }],
      transactions: [transaction({ state: "ambiguous", recovery: null })],
    },
    {}
  );
  assert.equal(malformed.classification, "recovery-ambiguous");
  assert.equal(malformed.operation, "none");
});

test("durable history without an exact card run ID cannot authorize a mutation", () => {
  const result = classifyStaleCard(
    card({ loop_run_id: "" }),
    { leases: [], transactions: [transaction()] },
    {}
  );
  assert.equal(result.classification, "unverified");
  assert.equal(result.operation, "none");
});

test("invalid stored pull-request artifacts fail closed before remote inspection", () => {
  let inspected = false;
  const invalid = storedPr();
  invalid.data.branch = "../unsafe";
  const rejected = classifyStaleCard(
    invalid,
    { leases: [], transactions: [] },
    {
      expectedRepository: "openai/pm",
      expectedBase: "main",
      inspectPullRequest() {
        inspected = true;
        return { ok: true, state: "MERGED" };
      },
    }
  );
  assert.equal(rejected.classification, "unverified");
  assert.equal(inspected, false);
});

test("pull-request evidence fails closed when the source default branch is unresolved", () => {
  let inspected = false;
  const result = classifyStaleCard(
    storedPr(),
    { leases: [], transactions: [] },
    {
      expectedRepository: "openai/pm",
      expectedBase: "",
      inspectPullRequest() {
        inspected = true;
        return { ok: true, state: "OPEN" };
      },
    }
  );
  assert.equal(result.classification, "unverified");
  assert.equal(inspected, false);
});

function makeFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-loop-reconcile-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const origin = path.join(root, "origin.git");
  const project = path.join(root, "project");
  fs.mkdirSync(origin, { recursive: true });
  git(root, ["init", "--bare", "--initial-branch=main", origin]);
  git(root, ["clone", origin, project]);
  git(project, ["config", "user.name", "PM Reconcile Test"]);
  git(project, ["config", "user.email", "pm-reconcile@example.com"]);
  const pmDir = path.join(project, "pm");
  fs.mkdirSync(path.join(pmDir, "backlog"), { recursive: true });
  fs.mkdirSync(path.join(pmDir, "loop", "events"), { recursive: true });
  fs.writeFileSync(
    path.join(pmDir, "backlog", "stale.md"),
    [
      "---",
      'id: "PM-404"',
      'title: "Stale card"',
      "kind: task",
      "status: shipping",
      'branch: "loop/pm-404"',
      'prs: ["#42"]',
      'pr_repo: "openai/pm"',
      'pr_number: "42"',
      'pr_url: "https://github.com/openai/pm/pull/42"',
      'pr_base: "main"',
      `pr_head_oid: "${"a".repeat(40)}"`,
      'pr_created_at: "2026-07-10T10:01:00Z"',
      'pr_dispatch_at: "2026-07-10T10:00:00Z"',
      `loop_run_id: "${RUN_ID}"`,
      "---",
      "",
      "body",
      "",
    ].join("\n")
  );
  fs.writeFileSync(path.join(project, "README.md"), "fixture\n");
  git(project, ["add", "README.md", "pm"]);
  git(project, ["commit", "-m", "fixture"]);
  git(project, ["push", "-u", "origin", "main"]);
  git(origin, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  return { root, origin, project, pmDir };
}

function mergedInspector() {
  return {
    ok: true,
    state: "MERGED",
    pr: { number: 42 },
    merge: { merge_sha: "b".repeat(40), merged_at: "2026-07-10T11:00:00Z" },
  };
}

test("dry-run is the default and prints the exact proposal without changing the PM remote", (t) => {
  const fixture = makeFixture(t);
  const before = git(fixture.project, ["rev-parse", "origin/main"]);
  const result = runReconcile(fixture.project, {
    pmDir: fixture.pmDir,
    now: NOW,
    expectedRepository: "openai/pm",
    expectedBase: "main",
    inspectPullRequest: mergedInspector,
  });
  git(fixture.project, ["fetch", "origin"]);
  const after = git(fixture.project, ["rev-parse", "origin/main"]);

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.mode, "dry-run");
  assert.equal(result.applied_changes.length, 0);
  assert.equal(result.proposed_changes.length, 1);
  assert.deepEqual(result.proposed_changes[0].changes, [
    { field: "status", before: "shipping", after: "done" },
    { field: "pr_merge_sha", before: "", after: "b".repeat(40) },
    { field: "pr_merged_at", before: "", after: "2026-07-10T11:00:00Z" },
  ]);
  assert.equal(after, before);
});

test("planning reads finalized durable outcome events, not only incomplete transactions", (t) => {
  const fixture = makeFixture(t);
  fs.writeFileSync(
    path.join(fixture.pmDir, "backlog", "failed.md"),
    [
      "---",
      'id: "PM-405"',
      'title: "Failed stale card"',
      "kind: task",
      "status: in-progress",
      `loop_run_id: "${RUN_ID_2}"`,
      "---",
      "",
      "body",
      "",
    ].join("\n")
  );
  fs.writeFileSync(
    path.join(fixture.pmDir, "loop", "events", `${RUN_ID_2}.json`),
    JSON.stringify({
      schema_version: 1,
      run_id: RUN_ID_2,
      card_id: "PM-405",
      stage: "dev",
      terminal: true,
      status: "failed",
      outcome: "dev-failed",
      summary: "Tests failed before a PR was created.",
    })
  );
  git(fixture.project, ["add", "pm/backlog/failed.md", `pm/loop/events/${RUN_ID_2}.json`]);
  git(fixture.project, ["commit", "-m", "durable failed outcome"]);
  git(fixture.project, ["push"]);

  const result = runReconcile(fixture.project, {
    pmDir: fixture.pmDir,
    now: NOW,
    expectedRepository: "openai/pm",
    expectedBase: "main",
    inspectPullRequest: mergedInspector,
  });
  const failed = result.classifications.find((entry) => entry.card_id === "PM-405");
  assert.equal(failed.classification, "durable-terminal-outcome", JSON.stringify(failed));
  assert.equal(failed.next_status, "needs-human");
  assert.ok(result.proposed_changes.some((entry) => entry.card_id === "PM-405"));
});

test("recovery plans expose bounded exact mutations without durable contents", (t) => {
  const fixture = makeFixture(t);
  const executionMap = new Map();
  const recovery = {
    run_id: RUN_ID,
    card_id: "PM-404",
    stage: "dev",
    expected_card_revision: "sha256:" + "a".repeat(64),
    config_fingerprint: "sha256:" + "b".repeat(64),
    result_hash: "sha256:" + "c".repeat(64),
    transition_hash: "sha256:" + "d".repeat(64),
    terminal_event_hash: "sha256:" + "e".repeat(64),
    terminal_event: { terminal: true, status: "completed", summary: "SECRET EVENT" },
    transition: {
      card_write: {
        relative_path: "pm/backlog/stale.md",
        expected_revision: "sha256:" + "a".repeat(64),
        content: "SECRET CARD CONTENT",
      },
      artifact_writes: [{ relative_path: "pm/evidence/recovered.md", content: "SECRET ARTIFACT" }],
    },
  };
  const plan = buildPlan(fixture.project, {
    pmDir: fixture.pmDir,
    now: NOW,
    expectedRepository: "openai/pm",
    expectedBase: "main",
    executionMap,
    scanSnapshotTransactions: () => [
      {
        run_id: RUN_ID,
        state: "recovery-ready",
        recovery,
        event: null,
        lease: { run_id: RUN_ID, card_id: "PM-404", stage: "dev" },
      },
    ],
  });
  assert.equal(plan.classifications[0].classification, "recovery-ready");
  assert.equal(plan.classifications[0].recovery.transition, undefined);
  assert.equal(executionMap.get(`pm/backlog/stale.md\0${RUN_ID}`), recovery);
  assert.deepEqual(
    plan.proposed_changes[0].changes.map((entry) => `${entry.operation}:${entry.path}`),
    [
      "write:pm/backlog/stale.md",
      "write:pm/evidence/recovered.md",
      `write:pm/loop/events/${RUN_ID}.json`,
      `delete:pm/loop/leases/dev-pm-404.json`,
      `delete:pm/loop/recovery/${RUN_ID}.json`,
    ]
  );
  const eventMutation = plan.proposed_changes[0].changes.find((entry) =>
    entry.path.includes("/loop/events/")
  );
  assert.match(eventMutation.content_sha256, /^sha256:[a-f0-9]{64}$/);
  assert.notEqual(eventMutation.content_sha256, recovery.terminal_event_hash);
  assert.doesNotMatch(JSON.stringify(plan), /SECRET/);
});

test("recovery mutation manifests fail closed on unbounded artifacts and paths", () => {
  const base = {
    run_id: RUN_ID,
    card_id: "PM-404",
    stage: "dev",
    terminal_event: { terminal: true, status: "completed" },
    terminal_event_hash: "sha256:" + "e".repeat(64),
    transition: {
      card_write: {
        relative_path: "pm/backlog/stale.md",
        expected_revision: "sha256:" + "a".repeat(64),
        content: "card",
      },
      artifact_writes: Array.from({ length: 65 }, (_, index) => ({
        relative_path: `pm/evidence/${index}.md`,
        content: "artifact",
      })),
    },
  };
  assert.equal(recoveryMutationManifest(base, "pm", NOW.toISOString()), null);
  assert.equal(
    recoveryMutationManifest(
      {
        ...base,
        transition: {
          ...base.transition,
          artifact_writes: [{ relative_path: `pm/${"x".repeat(600)}`, content: "artifact" }],
        },
      },
      "pm",
      NOW.toISOString()
    ),
    null
  );
});

test("apply requires Git readiness, uses isolated PM transactions, and reports exact applied changes", (t) => {
  const fixture = makeFixture(t);
  const blocked = runReconcile(fixture.project, {
    pmDir: fixture.pmDir,
    now: NOW,
    apply: true,
    expectedRepository: "openai/pm",
    expectedBase: "main",
    inspectPullRequest: mergedInspector,
    checkGitReady: () => ({ ok: false, reason: "PM checkout has unsynced changes" }),
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, "git-not-ready");
  assert.deepEqual(blocked.applied_changes, []);

  let transactions = 0;
  const applied = runReconcile(fixture.project, {
    pmDir: fixture.pmDir,
    now: NOW,
    apply: true,
    expectedRepository: "openai/pm",
    expectedBase: "main",
    inspectPullRequest: mergedInspector,
    onTransaction: () => {
      transactions += 1;
    },
  });
  assert.equal(applied.ok, true, JSON.stringify(applied));
  assert.equal(applied.mode, "apply");
  assert.equal(transactions, 1);
  assert.equal(applied.applied_changes.length, 1);
  assert.deepEqual(applied.applied_changes[0].changes, applied.proposed_changes[0].changes);
  assert.match(applied.applied_changes[0].commit_oid, /^[a-f0-9]{40}$/);
  assert.ok(applied.applied_changes[0].paths.includes("pm/backlog/stale.md"));
  assert.ok(applied.applied_changes[0].paths.some((entry) => entry.includes("/loop/events/")));

  git(fixture.project, ["fetch", "origin"]);
  const remoteCard = git(fixture.project, ["show", "origin/main:pm/backlog/stale.md"]);
  const data = parseFrontmatter(remoteCard).data;
  assert.equal(data.status, "done");
  assert.equal(data.pr_merge_sha, "b".repeat(40));
  assert.equal(data.pr_merged_at, "2026-07-10T11:00:00Z");
  assert.match(git(fixture.project, ["log", "-1", "--format=%s", "origin/main"]), /reconcile/i);
});

test("apply pins the planned PM head and aborts when durable evidence changes", (t) => {
  const fixture = makeFixture(t);
  const result = runReconcile(fixture.project, {
    pmDir: fixture.pmDir,
    now: NOW,
    apply: true,
    expectedRepository: "openai/pm",
    expectedBase: "main",
    inspectPullRequest: mergedInspector,
    checkGitReady() {
      fs.writeFileSync(path.join(fixture.project, "README.md"), "concurrent durable change\n");
      git(fixture.project, ["add", "README.md"]);
      git(fixture.project, ["commit", "-m", "concurrent PM evidence"]);
      git(fixture.project, ["push"]);
      return { ok: true };
    },
  });
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.code, "apply-failed");
  assert.match(result.reason, /upstream|plan|conflict/i);
  assert.deepEqual(result.applied_changes, []);
  const remoteCard = git(fixture.project, ["show", "origin/main:pm/backlog/stale.md"]);
  assert.equal(parseFrontmatter(remoteCard).data.status, "shipping");
});

test("apply rejects symlink chains for card, lease, and event mutations", (t) => {
  const fixture = makeFixture(t);
  const escape = path.join(fixture.root, "escape-events");
  fs.mkdirSync(escape);
  fs.rmSync(path.join(fixture.pmDir, "loop", "events"), { recursive: true, force: true });
  fs.symlinkSync(escape, path.join(fixture.pmDir, "loop", "events"));
  git(fixture.project, ["add", "pm/loop/events"]);
  git(fixture.project, ["commit", "-m", "symlinked event path"]);
  git(fixture.project, ["push"]);

  assert.throws(
    () =>
      runReconcile(fixture.project, {
        pmDir: fixture.pmDir,
        now: NOW,
        expectedRepository: "openai/pm",
        expectedBase: "main",
        inspectPullRequest: mergedInspector,
      }),
    /symlink/i
  );

  assert.throws(
    () =>
      runReconcile(fixture.project, {
        pmDir: fixture.pmDir,
        now: NOW,
        apply: true,
        expectedRepository: "openai/pm",
        expectedBase: "main",
        inspectPullRequest: mergedInspector,
        checkGitReady: () => ({ ok: true }),
      }),
    /symlink/i
  );
  assert.deepEqual(fs.readdirSync(escape), []);
});

test("ordinary card repairs are batched into one isolated PM transaction", (t) => {
  const fixture = makeFixture(t);
  const second = fs
    .readFileSync(path.join(fixture.pmDir, "backlog", "stale.md"), "utf8")
    .replace(/PM-404/g, "PM-406")
    .replace(/#42/g, "#43")
    .replace(/pull\/42/g, "pull/43")
    .replace('pr_number: "42"', 'pr_number: "43"');
  fs.writeFileSync(path.join(fixture.pmDir, "backlog", "second.md"), second);
  git(fixture.project, ["add", "pm/backlog/second.md"]);
  git(fixture.project, ["commit", "-m", "second stale card"]);
  git(fixture.project, ["push"]);

  let transactions = 0;
  const result = runReconcile(fixture.project, {
    pmDir: fixture.pmDir,
    now: NOW,
    apply: true,
    expectedRepository: "openai/pm",
    expectedBase: "main",
    inspectPullRequest: mergedInspector,
    onTransaction() {
      transactions += 1;
    },
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.proposed_changes.length, 2);
  assert.equal(result.applied_changes.length, 2);
  assert.equal(transactions, 1);
  assert.equal(result.applied_changes[0].commit_oid, result.applied_changes[1].commit_oid);
});

test("duplicate card IDs are classified as ambiguous and never proposed", (t) => {
  const fixture = makeFixture(t);
  const duplicate = fs
    .readFileSync(path.join(fixture.pmDir, "backlog", "stale.md"), "utf8")
    .replace('title: "Stale card"', 'title: "Duplicate stale card"')
    .replace('branch: "loop/pm-404"', 'branch: "loop/duplicate"');
  fs.writeFileSync(path.join(fixture.pmDir, "backlog", "duplicate.md"), duplicate);
  git(fixture.project, ["add", "pm/backlog/duplicate.md"]);
  git(fixture.project, ["commit", "-m", "duplicate card id"]);
  git(fixture.project, ["push"]);

  const plan = buildPlan(fixture.project, {
    pmDir: fixture.pmDir,
    now: NOW,
    expectedRepository: "openai/pm",
    expectedBase: "main",
    inspectPullRequest: mergedInspector,
  });
  assert.equal(plan.proposed_changes.length, 0);
  assert.equal(plan.classifications.length, 2);
  assert.ok(plan.classifications.every((entry) => entry.classification === "duplicate-card-id"));
});

test("CLI parsing keeps dry-run as the default and requires an explicit apply flag", () => {
  assert.equal(parseArgs([]).apply, false);
  assert.equal(parseArgs(["--dry-run"]).apply, false);
  assert.equal(parseArgs(["--apply"]).apply, true);
  assert.throws(() => parseArgs(["--apply", "--dry-run"]), /mutually exclusive/i);
  assert.throws(() => parseArgs(["--apply", "surprise"]), /Unexpected argument/);
});

test("apply-mode recovery resumes the exact durable run instead of executing the card", () => {
  const recovery = {
    run_id: RUN_ID,
    card_id: "PM-404",
    stage: "dev",
    terminal_event: { terminal: true, status: "completed", outcome: "dev-shipped" },
    transition: { artifact_writes: [] },
  };
  const change = {
    operation: "resume-finalization",
    run_id: RUN_ID,
    card_id: "PM-404",
  };
  let observed;
  const result = resumeRecovery("/unused/pm", change, recovery, {
    finalizeRun(pmDir, input) {
      observed = { pmDir, input };
      return { ok: true, pushed: true };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(observed.input.runId, RUN_ID);
  assert.equal(observed.input.cardId, "PM-404");
  assert.equal(observed.input.event, recovery.terminal_event);
});
