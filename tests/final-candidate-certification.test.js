"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { certifyFinalCandidate } = require("../scripts/delivery-attestation");

test("finalization freezes one head, runs the complete plan once, and is idempotent", () => {
  let runs = 0;
  const state = {
    route: "optimized",
    review: { outcome: "passed", commit: "c".repeat(40), findings: 0 },
    head: "c".repeat(40),
    generation: 2,
    complete_commands: ["mobile", "shared"],
  };
  const first = certifyFinalCandidate(state, {
    runComplete: () => {
      runs++;
      return { outcome: "passed", evidence: ["gate.json"] };
    },
  });
  assert.equal(first.ready, true);
  assert.equal(runs, 1);
  const second = certifyFinalCandidate(
    { ...state, certification: first.certification },
    {
      runComplete: () => {
        runs++;
      },
    }
  );
  assert.equal(second.ready, true);
  assert.equal(runs, 1);
});

test("late mutation or finding revokes final readiness and returns to review", () => {
  const base = {
    route: "optimized",
    review: { outcome: "passed", commit: "a".repeat(40), findings: 0 },
    head: "b".repeat(40),
    generation: 1,
    complete_commands: ["all"],
  };
  assert.equal(
    certifyFinalCandidate(base, {
      runComplete: () => {
        throw new Error("must not run");
      },
    }).next,
    "review"
  );
  assert.equal(
    certifyFinalCandidate(
      { ...base, head: base.review.commit, review: { ...base.review, findings: 1 } },
      { runComplete: () => {} }
    ).next,
    "review"
  );
});
