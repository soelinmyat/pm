"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { allocateLenses, findingId, mergeSignals } = require("../scripts/lib/review-contract");

const ALL = ["bug", "design", "edge", "reuse", "quality", "efficiency"];

test("adaptive allocation covers every logical lens exactly once", () => {
  for (const maxWorkers of [1, 2, 3, 4, 5, 6, 10]) {
    const allocation = allocateLenses(ALL, maxWorkers, "codex-workhorse");
    const assigned = allocation.flatMap((worker) => worker.lenses);
    assert.deepEqual([...assigned].sort(), [...ALL].sort());
    assert.equal(new Set(assigned).size, ALL.length);
    assert.equal(allocation.length, Math.min(maxWorkers, ALL.length));
    if (maxWorkers >= 3) {
      assert.deepEqual(allocation.find((worker) => worker.lenses.includes("bug")).lenses, ["bug"]);
      assert.deepEqual(allocation.find((worker) => worker.lenses.includes("edge")).lenses, [
        "edge",
      ]);
    }
  }
});

test("finding identity is deterministic across evidence order but changes with location", () => {
  const finding = sampleFinding();
  const reversed = { ...finding, evidence: [...finding.evidence].reverse() };
  assert.equal(findingId(finding), findingId(reversed));
  assert.equal(findingId(finding), findingId({ ...finding, category: "edge" }));
  const saltedSource = structuredClone(finding);
  saltedSource.evidence[0].sha256 = "f".repeat(64);
  assert.equal(findingId(finding), findingId(saltedSource));
  assert.notEqual(findingId(finding), findingId({ ...finding, line_start: 11 }));
});

test("merge retains independent signals and exposes material disagreement", () => {
  const first = { ...sampleFinding(), id: findingId(sampleFinding()), reviewer_id: "worker-bug" };
  const second = {
    ...first,
    reviewer_id: "worker-edge",
    severity: "low",
    owner: "qa",
    fix: "Exercise the live flow in QA.",
  };
  const merged = mergeSignals([first, second], []);
  assert.equal(merged.findings.length, 1);
  assert.equal(merged.findings[0].signals.length, 2);
  assert.equal(merged.findings[0].disputed, true);
  assert.equal(merged.unresolved_disagreements.length, 1);

  const decided = mergeSignals(
    [first, second],
    [
      {
        finding_id: first.id,
        approver: "Maintainer",
        action: "keep-review",
        rationale: "The defect is statically reproducible and belongs to Review.",
        decided_at: "2026-07-12T00:00:00Z",
      },
    ]
  );
  assert.equal(decided.unresolved_disagreements.length, 0);
  assert.equal(decided.findings[0].owner, "review");
});

test("decision requirement disagreement is material and remains decision-bound", () => {
  const first = { ...sampleFinding(), id: findingId(sampleFinding()), reviewer_id: "worker-a" };
  const second = { ...first, reviewer_id: "worker-b", decision_required: true };
  const merged = mergeSignals([first, second], []);
  assert.equal(merged.findings[0].disputed, true);
  assert.equal(merged.findings[0].decision_required, true);
  assert.deepEqual(merged.unresolved_disagreements, [first.id]);
});

function sampleFinding() {
  return {
    category: "bug",
    severity: "high",
    confidence: 96,
    file: "src/example.js",
    line_start: 10,
    line_end: 12,
    rule: "stale-cache",
    issue: "The mutation leaves the cached value stale.",
    impact: "Readers observe the pre-mutation value.",
    fix: "Invalidate the cache after the write.",
    fix_kind: "behavioral",
    verify: "node --test tests/example.test.js",
    evidence: [
      { kind: "source", ref: "src/example.js:10" },
      { kind: "test", ref: "tests/example.test.js:20" },
    ],
    owner: "review",
    disposition: "open",
    decision_required: false,
  };
}
