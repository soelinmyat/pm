"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const { parseFrontmatter } = require("../scripts/kb-frontmatter.js");
const {
  CANONICAL_CARD_STATUSES,
  buildContractFailureResult,
  buildStageTransition,
  isDispatchableStatus,
} = require("../scripts/loop-card-state.js");

const RUN_ID = "loop-123e4567-e89b-42d3-a456-426614174000";
const NOW = new Date("2026-07-10T10:00:00Z");
const CARD = [
  "---",
  "type: backlog",
  "id: PM-108",
  "title: Reliable loop",
  "kind: proposal",
  "status: planned",
  "priority: high",
  "implementation_approved: true",
  "approved_by: PM Test",
  "approved_at: 2026-07-10",
  "---",
  "",
  "Keep this body byte-for-byte.",
  "",
].join("\n");
const REVISION = crypto.createHash("sha256").update(CARD).digest("hex");

function pr(overrides = {}) {
  return {
    type: "pull-request",
    repo: "openai/pm",
    number: 342,
    url: "https://github.com/openai/pm/pull/342",
    base: "main",
    head: "loop/pm-108",
    head_oid: "a".repeat(40),
    created_at: "2026-07-10T10:01:00Z",
    ...overrides,
  };
}

function result(stage, status, overrides = {}) {
  return {
    version: 1,
    run_id: RUN_ID,
    card_id: "PM-108",
    stage,
    status,
    summary: `${stage} ${status}`,
    gates: [],
    usage: { input_tokens: null, output_tokens: null, total_tokens: null },
    ...overrides,
  };
}

function transition(stageResult, overrides = {}) {
  return buildStageTransition({
    result: stageResult,
    cardContent: CARD,
    cardRelativePath: "pm/backlog/pm-108.md",
    expectedCardRevision: REVISION,
    pmRelative: "pm",
    runId: RUN_ID,
    logPath: ".pm/loop-runs/loop-123/stdout.log",
    dispatchAt: "2026-07-10T10:00:00.000Z",
    now: NOW,
    shipPollHorizonSeconds: 3600,
    ...overrides,
  });
}

function frontmatter(mapped) {
  assert.equal(mapped.ok, true, JSON.stringify(mapped));
  return parseFrontmatter(mapped.transition.card_write.content).data;
}

test("needs-human is canonical and explicitly non-dispatchable", () => {
  assert.ok(CANONICAL_CARD_STATUSES.includes("needs-human"));
  assert.equal(isDispatchableStatus("needs-human"), false);
  assert.equal(isDispatchableStatus("planned"), true);
  assert.equal(isDispatchableStatus("shipping"), true);
});

test("dev shipped maps only verified PR metadata into shipping", () => {
  const mapped = transition(result("dev", "shipped", { artifacts: pr() }));
  const data = frontmatter(mapped);

  assert.equal(data.status, "shipping");
  assert.equal(data.branch, "loop/pm-108");
  assert.deepEqual(data.prs, ["#342"]);
  assert.equal(data.pr_dispatch_at, "2026-07-10T10:00:00.000Z");
  assert.equal(data.loop_run_id, RUN_ID);
  assert.equal(mapped.event.status, "completed");
  assert.equal(mapped.event.outcome, "dev-shipped");
  assert.deepEqual(mapped.transition.artifact_writes, []);
});

test("blocked maps bounded blocker, remediation, run, and log metadata to needs-human", () => {
  const mapped = transition(
    result("dev", "blocked", {
      blocker: {
        code: "db-unreachable",
        reason: "Database health check failed",
        remediation: "Start the database and retry the card.",
      },
    })
  );
  const data = frontmatter(mapped);

  assert.equal(data.status, "needs-human");
  assert.equal(data.blocker_code, "db-unreachable");
  assert.equal(data.blocker_reason, "Database health check failed");
  assert.equal(data.blocker_remediation, "Start the database and retry the card.");
  assert.equal(data.loop_run_id, RUN_ID);
  assert.equal(data.loop_log_path, ".pm/loop-runs/loop-123/stdout.log");
  assert.equal(mapped.event.status, "blocked");
});

test("failed and noop preserve the pre-claim card bytes while durably recording outcomes", () => {
  for (const status of ["failed", "noop"]) {
    const mapped = transition(result("dev", status));
    assert.equal(mapped.ok, true, JSON.stringify(mapped));
    assert.equal(mapped.transition.card_write.content, CARD);
    assert.equal(mapped.event.status, status);
    assert.equal(mapped.event.outcome, `dev-${status}`);
  }
});

test("ship terminals map merged, ready-for-human, waiting, failed, and noop deterministically", () => {
  const merged = transition(
    result("ship", "merged", {
      artifacts: pr({
        merge_sha: "b".repeat(40),
        merged_at: "2026-07-10T10:05:00Z",
      }),
    })
  );
  assert.equal(frontmatter(merged).status, "done");
  assert.equal(merged.event.outcome, "ship-merged");

  const ready = transition(result("ship", "ready-for-human", { artifacts: pr() }));
  assert.equal(frontmatter(ready).status, "needs-human");
  assert.equal(frontmatter(ready).blocker_code, "merge-approval-required");

  const waiting = transition(
    result("ship", "waiting", {
      artifacts: pr(),
      retry_after: "2026-07-10T10:30:00Z",
    })
  );
  assert.equal(frontmatter(waiting).status, "shipping");
  assert.equal(frontmatter(waiting).retry_after, "2026-07-10T10:30:00Z");

  const tooLate = transition(
    result("ship", "waiting", {
      artifacts: pr(),
      retry_after: "2026-07-10T12:00:00Z",
    })
  );
  assert.equal(tooLate.ok, false);
  assert.match(tooLate.reason, /poll horizon/);

  for (const status of ["failed", "noop"]) {
    const mapped = transition(result("ship", status));
    assert.equal(mapped.transition.card_write.content, CARD);
    assert.equal(mapped.event.status, status);
  }
});

test("RFC and research artifacts copy only to worker-selected allowlisted destinations", () => {
  const document = {
    type: "document",
    kind: "rfc",
    relative_path: "artifacts/pm-108.html",
    sha256: "c".repeat(64),
    media_type: "text/html",
  };
  const rfc = transition(result("rfc", "needs-approval", { artifacts: document }), {
    verifiedArtifact: { content: Buffer.from("<h1>RFC</h1>"), sha256: document.sha256 },
  });
  const rfcData = frontmatter(rfc);
  assert.equal(rfcData.status, "needs-human");
  assert.equal(rfcData.blocker_code, "rfc-approval-required");
  assert.equal(rfcData.artifact_path, "pm/backlog/rfcs/pm-108.html");
  assert.deepEqual(rfc.allowedArtifactPaths, ["pm/backlog/rfcs/pm-108.html"]);
  assert.equal(rfc.transition.artifact_writes[0].content, "<h1>RFC</h1>");

  const researchArtifact = {
    ...document,
    kind: "research",
    relative_path: "artifacts/findings.md",
    media_type: "text/markdown",
  };
  const research = transition(
    result("research", "artifact-ready", { artifacts: researchArtifact }),
    { verifiedArtifact: { content: Buffer.from("# Findings\n"), sha256: document.sha256 } }
  );
  assert.equal(frontmatter(research).blocker_code, "research-review-required");
  assert.equal(frontmatter(research).artifact_path, "pm/evidence/research/findings.md");
});

test("failed-contract creates a non-dispatchable transition with bounded evidence", () => {
  const contractResult = buildContractFailureResult({
    runId: RUN_ID,
    cardId: "PM-108",
    stage: "dev",
    code: "result-missing",
    reason: "Engine exited 0 without a result file",
    remediation: "Inspect the preserved workspace and logs.",
  });
  const mapped = transition(contractResult);
  const data = frontmatter(mapped);

  assert.equal(data.status, "needs-human");
  assert.equal(data.blocker_code, "failed-contract");
  assert.match(data.blocker_reason, /result-missing/);
  assert.equal(mapped.event.status, "failed-contract");
});
