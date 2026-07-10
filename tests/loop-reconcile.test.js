"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { parseFrontmatter } = require("../scripts/kb-frontmatter.js");
const {
  classifyStaleCard,
  parseArgs,
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
    { leases: [{ run_id: RUN_ID, expired: true }], transactions: [] },
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
  assert.deepEqual(applied.applied_changes, applied.proposed_changes);

  git(fixture.project, ["fetch", "origin"]);
  const remoteCard = git(fixture.project, ["show", "origin/main:pm/backlog/stale.md"]);
  const data = parseFrontmatter(remoteCard).data;
  assert.equal(data.status, "done");
  assert.equal(data.pr_merge_sha, "b".repeat(40));
  assert.equal(data.pr_merged_at, "2026-07-10T11:00:00Z");
  assert.match(git(fixture.project, ["log", "-1", "--format=%s", "origin/main"]), /reconcile/i);
});

test("CLI parsing keeps dry-run as the default and requires an explicit apply flag", () => {
  assert.equal(parseArgs([]).apply, false);
  assert.equal(parseArgs(["--apply"]).apply, true);
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
  const change = { operation: "resume-finalization" };
  Object.defineProperty(change, "_recovery", { value: recovery });
  let observed;
  const result = resumeRecovery("/unused/pm", change, {
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
