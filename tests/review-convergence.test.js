"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createConvergence,
  evaluateConvergence,
  markHeadMutation,
  recordConversationCheck,
  recordReviewSource,
  reviseRequirements,
} = require("../scripts/review-convergence");

const HEAD_A = "a".repeat(40);
const HEAD_B = "b".repeat(40);
const HEAD_64 = "c".repeat(64);
const HASH_A = `sha256:${"1".repeat(64)}`;
const HASH_B = `sha256:${"2".repeat(64)}`;
const START = "2026-08-09T10:00:00.000Z";
const DEADLINE = "2026-08-09T10:10:00.000Z";

function fresh() {
  return createConvergence({
    head: HEAD_A,
    requirementSetHash: HASH_A,
    requiredSources: ["pm-review", "codex", "human"],
    deadline: DEADLINE,
    now: START,
  });
}

test("converges only when every required source passes on one head and conversations are clear", () => {
  let state = fresh();
  for (const source of ["pm-review", "codex", "human"]) {
    state = recordReviewSource(state, {
      source,
      head: HEAD_A,
      outcome: "passed",
      at: "2026-08-09T10:01:00.000Z",
    });
  }
  assert.equal(evaluateConvergence(state, { now: "2026-08-09T10:02:00.000Z" }).status, "reviewing");

  state = recordConversationCheck(state, {
    head: HEAD_A,
    unresolved: 0,
    at: "2026-08-09T10:02:00.000Z",
  });
  state = evaluateConvergence(state, { now: "2026-08-09T10:02:00.000Z" });
  assert.equal(state.status, "review-converged");
  assert.equal(state.head, HEAD_A);
  assert.equal(state.requirement_set_hash, HASH_A);
});

test("convergence timestamps require strict RFC3339 date-times", () => {
  assert.throws(
    () =>
      createConvergence({
        head: HEAD_A,
        requirementSetHash: HASH_A,
        requiredSources: ["pm-review"],
        deadline: DEADLINE,
        now: "August 9, 2026 10:00:00",
      }),
    /RFC3339/
  );
  assert.equal(
    createConvergence({
      head: HEAD_A,
      requirementSetHash: HASH_A,
      requiredSources: ["pm-review"],
      deadline: "2026-08-09T18:10:00+08:00",
      now: "2026-08-09T18:00:00+08:00",
    }).created_at,
    "2026-08-09T18:00:00+08:00"
  );
  assert.equal(
    createConvergence({
      head: HEAD_64,
      requirementSetHash: HASH_A,
      requiredSources: ["pm-review"],
      deadline: DEADLINE,
      now: START,
    }).head,
    HEAD_64
  );
});

test("blocking findings and unresolved conversations return the exact head to reviewing", () => {
  let state = fresh();
  state = recordReviewSource(state, {
    source: "pm-review",
    head: HEAD_A,
    outcome: "blocking",
    finding: "P1 regression",
    at: "2026-08-09T10:01:00.000Z",
  });
  assert.equal(state.status, "reviewing");
  assert.equal(state.sources["pm-review"].outcome, "blocking");

  state = recordConversationCheck(state, {
    head: HEAD_A,
    unresolved: 2,
    at: "2026-08-09T10:02:00.000Z",
  });
  assert.equal(evaluateConvergence(state, { now: "2026-08-09T10:03:00.000Z" }).status, "reviewing");
});

test("a recorded blocker remains reviewing after the deadline", () => {
  let state = fresh();
  state = recordReviewSource(state, {
    source: "pm-review",
    head: HEAD_A,
    outcome: "blocking",
    finding: "P1 regression",
    at: "2026-08-09T10:01:00.000Z",
  });
  state = evaluateConvergence(state, { now: "2026-08-09T10:11:00.000Z" });
  assert.equal(state.status, "reviewing");
  assert.equal(state.awaiting_decision, null);
  assert.throws(
    () =>
      reviseRequirements(state, {
        approver: "maintainer@example.com",
        reason: "remove a blocking reviewer",
        requirementSetHash: HASH_B,
        requiredSources: ["codex", "human"],
        deadline: "2026-08-09T10:20:00.000Z",
        at: "2026-08-09T10:12:00.000Z",
      }),
    /awaiting-decision/
  );
});

test("a blocker cannot be cleared by a later result on the same head", () => {
  let state = fresh();
  state = recordReviewSource(state, {
    source: "pm-review",
    head: HEAD_A,
    outcome: "blocking",
    finding: "P1 regression",
    at: "2026-08-09T10:01:00.000Z",
  });
  assert.throws(
    () =>
      recordReviewSource(state, {
        source: "pm-review",
        head: HEAD_A,
        outcome: "passed",
        at: "2026-08-09T10:02:00.000Z",
      }),
    /head mutation|blocker/
  );
});

test("stale observations cannot replace newer blockers or unresolved conversations", () => {
  let state = fresh();
  state = recordReviewSource(state, {
    source: "pm-review",
    head: HEAD_A,
    outcome: "blocking",
    finding: "new blocker",
    at: "2026-08-09T10:04:00.000Z",
  });
  assert.throws(
    () =>
      recordReviewSource(state, {
        source: "pm-review",
        head: HEAD_A,
        outcome: "passed",
        at: "2026-08-09T10:03:00.000Z",
      }),
    /stale observation/
  );
  state = recordConversationCheck(state, {
    head: HEAD_A,
    unresolved: 2,
    at: "2026-08-09T10:05:00.000Z",
  });
  assert.throws(
    () =>
      recordConversationCheck(state, {
        head: HEAD_A,
        unresolved: 0,
        at: "2026-08-09T10:04:30.000Z",
      }),
    /stale observation/
  );
  const repeated = recordConversationCheck(state, {
    head: HEAD_A,
    unresolved: 2,
    at: "2026-08-09T10:05:00.000Z",
  });
  assert.deepEqual(repeated, state);
  assert.equal(evaluateConvergence(state, { now: "2026-08-09T10:06:00.000Z" }).status, "reviewing");
});

test("a head mutation invalidates all source results and requires affected review again", () => {
  let state = fresh();
  state = recordReviewSource(state, {
    source: "pm-review",
    head: HEAD_A,
    outcome: "passed",
    at: "2026-08-09T10:01:00.000Z",
  });
  state = recordConversationCheck(state, {
    head: HEAD_A,
    unresolved: 0,
    at: "2026-08-09T10:02:00.000Z",
  });
  state = markHeadMutation(state, {
    head: HEAD_B,
    reason: "review fix",
    deadline: "2026-08-09T10:20:00.000Z",
    at: "2026-08-09T10:05:00.000Z",
  });
  assert.equal(state.head, HEAD_B);
  assert.equal(state.status, "reviewing");
  assert.equal(state.sources["pm-review"].outcome, "pending");
  assert.equal(state.conversations.checked, false);
  assert.throws(
    () =>
      recordReviewSource(state, {
        source: "pm-review",
        head: HEAD_A,
        outcome: "passed",
        at: "2026-08-09T10:06:00.000Z",
      }),
    /head does not match/
  );
});

test("timeout, silence, and unavailable sources enter bounded awaiting-decision and never pass", () => {
  const silent = evaluateConvergence(fresh(), { now: "2026-08-09T10:11:00.000Z" });
  assert.equal(silent.status, "awaiting-decision");
  assert.deepEqual(silent.awaiting_decision.sources, [
    "codex",
    "human",
    "pm-review",
    "pr-conversations",
  ]);
  assert.match(silent.awaiting_decision.reason, /deadline/);

  let unavailable = fresh();
  unavailable = recordReviewSource(unavailable, {
    source: "codex",
    head: HEAD_A,
    outcome: "unavailable",
    finding: "service unavailable",
    at: "2026-08-09T10:01:00.000Z",
  });
  assert.equal(unavailable.status, "awaiting-decision");
  assert.equal(
    evaluateConvergence(unavailable, { now: "2026-08-09T10:02:00.000Z" }).status,
    "awaiting-decision"
  );
  assert.throws(
    () => evaluateConvergence(silent, { now: "2026-08-09T10:09:00.000Z" }),
    /stale evaluation/
  );
});

test("a missing required conversation check times out instead of lingering or passing", () => {
  let state = fresh();
  for (const source of ["pm-review", "codex", "human"]) {
    state = recordReviewSource(state, {
      source,
      head: HEAD_A,
      outcome: "passed",
      at: "2026-08-09T10:03:00.000Z",
    });
  }
  state = evaluateConvergence(state, { now: "2026-08-09T10:11:00.000Z" });
  assert.equal(state.status, "awaiting-decision");
  assert.deepEqual(state.awaiting_decision.sources, ["pr-conversations"]);
  assert.match(state.awaiting_decision.reason, /conversation check/);
});

test("an unavailable source can resume and converge without silently changing requirements", () => {
  let state = fresh();
  state = recordReviewSource(state, {
    source: "codex",
    head: HEAD_A,
    outcome: "unavailable",
    finding: "temporary outage",
    at: "2026-08-09T10:01:00.000Z",
  });
  for (const source of ["pm-review", "codex", "human"]) {
    state = recordReviewSource(state, {
      source,
      head: HEAD_A,
      outcome: "passed",
      at: "2026-08-09T10:03:00.000Z",
    });
  }
  state = recordConversationCheck(state, {
    head: HEAD_A,
    unresolved: 0,
    at: "2026-08-09T10:04:00.000Z",
  });
  state = evaluateConvergence(state, { now: "2026-08-09T10:04:00.000Z" });
  assert.equal(state.status, "review-converged");
  assert.equal(state.requirement_set_hash, HASH_A);
});

test("requirement revision is audited and allowed only from awaiting-decision", () => {
  assert.throws(
    () =>
      reviseRequirements(fresh(), {
        approver: "maintainer@example.com",
        reason: "reviewer retired",
        requirementSetHash: HASH_B,
        requiredSources: ["pm-review", "human"],
        deadline: "2026-08-09T10:20:00.000Z",
        at: "2026-08-09T10:05:00.000Z",
      }),
    /awaiting-decision/
  );

  const awaiting = evaluateConvergence(fresh(), { now: "2026-08-09T10:11:00.000Z" });
  assert.throws(
    () =>
      reviseRequirements(awaiting, {
        approver: "maintainer@example.com",
        reason: "stale approval",
        requirementSetHash: HASH_B,
        requiredSources: ["pm-review", "human"],
        deadline: "2026-08-09T10:20:00.000Z",
        at: "2026-08-09T10:10:00.000Z",
      }),
    /stale transition/
  );
  const revised = reviseRequirements(awaiting, {
    approver: "maintainer@example.com",
    reason: "reviewer retired",
    requirementSetHash: HASH_B,
    requiredSources: ["pm-review", "human"],
    deadline: "2026-08-09T10:20:00.000Z",
    at: "2026-08-09T10:12:00.000Z",
  });
  assert.equal(revised.status, "reviewing");
  assert.equal(revised.requirement_set_hash, HASH_B);
  assert.deepEqual(revised.required_sources, ["human", "pm-review"]);
  assert.deepEqual(revised.requirement_revisions[0], {
    approver: "maintainer@example.com",
    reason: "reviewer retired",
    previous_requirement_set_hash: HASH_A,
    requirement_set_hash: HASH_B,
    required_sources: ["human", "pm-review"],
    at: "2026-08-09T10:12:00.000Z",
  });
});

test("head reset rejects a transition older than current convergence state", () => {
  const state = evaluateConvergence(fresh(), { now: "2026-08-09T10:03:00.000Z" });
  assert.throws(
    () =>
      markHeadMutation(state, {
        head: HEAD_B,
        reason: "late callback",
        deadline: "2026-08-09T10:20:00.000Z",
        at: "2026-08-09T10:02:00.000Z",
      }),
    /stale transition/
  );
});
