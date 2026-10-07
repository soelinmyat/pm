"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { reviewPathContext, expectedPriorReportPath } = require("../scripts/lib/review-paths");
const { buildCanonicalReport } = require("../scripts/review-check");

// An independently reviewed, authorized mechanical correction must not become
// a new product decision solely because this is the third observation.
test("scoped Review failures remain repairable at the former round cap", () => {
  const blocker = {
    id: "rv-test",
    owner: "review",
    disposition: "open",
    severity: "high",
    confidence: 95,
    disputed: false,
    decision_required: false,
    fix_kind: "mechanical",
    issue: "Wrong return branch",
  };
  const report = buildCanonicalReport(
    {
      run_id: "scoped-review",
      review_round: 3,
      iteration_cap: 3,
      recovery_policy: "scoped-diagnosis-v1",
      lenses: [],
    },
    { relative: "target.json", sha256: "a".repeat(64) },
    [],
    null,
    { findings: [blocker], unresolved_disagreements: [] },
    "report.html"
  );
  assert.equal(report.outcome, "failed");
  assert.deepEqual(report.auto_fix_eligible, [blocker.id]);
  assert.match(report.next_action, /diagnos/i);
});

test("Review evidence paths permit consecutive recovery rounds while retaining exact lineage", () => {
  const root = ".pm/dev-sessions/example/review/runs/scoped-review";
  assert.equal(reviewPathContext(`${root}/round-4/target.json`, 4).runId, "scoped-review");
  assert.equal(expectedPriorReportPath(root, 4), `${root}/round-3/report.json`);
  assert.throws(() => reviewPathContext(`${root}/round-04/target.json`, 4));
  assert.throws(() => reviewPathContext(`${root}/round-51/target.json`, 51));
});

const {
  validateScopedRecovery,
  reviewRecoveryEvidenceIds,
} = require("../scripts/lib/scoped-recovery");
const diagnosis = () => ({
  classification: "product-defect",
  observed: "Repeated desktop overflow remains.",
  cause: "Changing padding alone did not address the layout container.",
  change: "Replace the ad hoc wrapper with the incumbent grid component.",
  next_check: "Recapture the changed desktop and narrow states and rerun scoped checks.",
  evidence_ids: ["old-capture"],
  scope_assessment: "within-approved-scope",
});

test("recovery diagnosis cannot substitute new IDs or a scope claim for changed grounded work", () => {
  const valid = diagnosis();
  assert.deepEqual(validateScopedRecovery(valid, { evidenceIds: ["old-capture"] }), []);
  for (const variant of ["empty", "current", "unknown", "replay", "decision", "dispute"]) {
    const candidate = diagnosis();
    const context = { evidenceIds: ["old-capture"] };
    if (variant === "empty") candidate.change = " ";
    if (variant === "current") candidate.evidence_ids = ["new-capture"];
    if (variant === "unknown") candidate.approver = "invented";
    if (variant === "replay") {
      context.previousRecovery = { ...valid, change: valid.change.toUpperCase() };
    }
    if (variant === "decision") candidate.classification = "scope-risk-change";
    if (variant === "dispute") context.previousDecisionRequired = true;
    assert.ok(validateScopedRecovery(candidate, context).length > 0, variant);
  }
});

test("dependency-only recovery evidence binds the actual predecessor without inventing finding IDs", () => {
  const report = { outcome: "blocked", findings: [] };
  const binding = {
    path: ".pm/dev-sessions/example/review/runs/retained/round-4/report.json",
    sha256: "a".repeat(64),
  };
  const recovery = { classification: "external-dependency", scope_assessment: "decision-required" };
  const expected = `recovery-report:${binding.path}#sha256:${binding.sha256}`;
  assert.deepEqual(reviewRecoveryEvidenceIds(report, binding, recovery), [expected]);
  assert.deepEqual(
    reviewRecoveryEvidenceIds(
      { ...report, findings: [{ id: "rv-original-source" }] },
      binding,
      recovery
    ),
    ["rv-original-source"]
  );
  for (const classified of ["product-decision", "scope-risk-change", "product-defect"])
    assert.deepEqual(
      reviewRecoveryEvidenceIds(report, binding, { ...recovery, classification: classified }),
      []
    );
  assert.deepEqual(
    reviewRecoveryEvidenceIds({ ...report, outcome: "passed" }, binding, recovery),
    []
  );
  assert.deepEqual(
    reviewRecoveryEvidenceIds(report, { ...binding, sha256: "invented" }, recovery),
    []
  );
  assert.deepEqual(reviewRecoveryEvidenceIds(report, undefined, recovery), []);
  const ids = reviewRecoveryEvidenceIds(report, binding, recovery);
  assert.deepEqual(
    validateScopedRecovery({ ...diagnosis(), evidence_ids: ids }, { evidenceIds: ids }),
    []
  );
  assert.ok(
    validateScopedRecovery(
      { ...diagnosis(), evidence_ids: ids },
      { evidenceIds: ids, previousDecisionRequired: true }
    ).length > 0,
    "a report identity cannot grant product/risk authority"
  );
});

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createSession, validateSession } = require("../scripts/lib/dev-session-schema");

test("canonical session validation rejects resetting an unresolved anchored recovery count", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-recovery-session-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.name", "Recovery fixture"]);
  git(["config", "user.email", "fixture@example.com"]);
  fs.writeFileSync(path.join(root, "source.js"), "module.exports = 1;\n");
  git(["add", "source.js"]);
  git(["commit", "-qm", "fixture"]);
  const session = createSession({ slug: "count-reset", sourceDir: root });
  session.phase = "review";
  session.phase_attempt = 4;
  session.evidence.review = {
    commit: null,
    records: [],
    recorded_at: session.updated_at,
    recovery_history: [
      {
        attempt: 3,
        round: 3,
        run_id: "active-review",
        commit: git(["rev-parse", "HEAD"]),
        outcome: "failed",
        report: { path: ".pm/prior-report.json", sha256: "a".repeat(64) },
      },
    ],
  };
  assert.deepEqual(validateSession(session), []);
  session.phase_attempt = 1;
  assert.ok(
    validateSession(session).some((issue) => issue.path === "$.phase_attempt"),
    "a persisted attempt reset must not bypass the retained report anchor"
  );
});

test("a genuine recovery decision withholds automatic repair eligibility", () => {
  const blocker = {
    id: "rv-mechanical",
    owner: "review",
    disposition: "open",
    severity: "high",
    confidence: 99,
    disputed: false,
    decision_required: false,
    fix_kind: "mechanical",
    issue: "Contract failure",
  };
  const report = buildCanonicalReport(
    {
      run_id: "scoped-review",
      review_round: 4,
      iteration_cap: 3,
      recovery_policy: "scoped-diagnosis-v1",
      lenses: [],
      recovery: {
        ...diagnosis(),
        classification: "scope-risk-change",
        scope_assessment: "decision-required",
      },
    },
    { relative: "target.json", sha256: "a".repeat(64) },
    [],
    null,
    { findings: [blocker], unresolved_disagreements: [] },
    "report.html"
  );
  assert.equal(report.outcome, "blocked");
  assert.deepEqual(
    report.auto_fix_eligible,
    [],
    "a material decision cannot authorize even an otherwise eligible remedy"
  );
});
