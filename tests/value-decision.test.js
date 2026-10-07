"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

function validate(value, options = {}) {
  // Load inside the test so an absent contract is an observed test failure,
  // rather than a runner/setup failure during the test-first cycle.
  const { validateValueDecision } = require("../scripts/lib/value-decision.js");
  return validateValueDecision(value, {
    evidenceIds: ["evidence:workflow", "evidence:contrary", "evidence:search"],
    assumptionIds: ["assumption:demand", "assumption:adoption"],
    ...options,
  });
}

function claim(statement, evidenceIds = [], assumptionIds = []) {
  return { statement, evidence_ids: evidenceIds, assumption_ids: assumptionIds };
}

// Synthetic decision: the workflow observation supports a usability outcome;
// it deliberately does not establish a buyer, willingness to pay or retention.
function fixture() {
  return {
    schema_version: 1,
    beneficiary: claim("Occasional managers reviewing pending requests", ["evidence:workflow"]),
    buyer: {
      status: "unknown",
      ...claim("Who authorizes purchase is unknown from the checked workflow evidence."),
    },
    user_outcome: claim("Managers find a pending request and retain context after returning.", [
      "evidence:workflow",
    ]),
    commercial_hypothesis: claim(
      "Reducing abandoned reviews may support adoption; purchase demand remains unverified.",
      ["evidence:workflow"],
      ["assumption:demand"]
    ),
    counterevidence: {
      status: "found",
      statement: "A manager prefers the existing list and may not need another entry point.",
      evidence_ids: ["evidence:contrary"],
    },
    uncertainties: [
      claim(
        "The improvement may not influence the buyer's purchase decision.",
        [],
        ["assumption:demand"]
      ),
    ],
    recommendation: {
      decision: "test-first",
      rationale: "Observe the proposed journey before committing to a commercial claim.",
      evidence_ids: ["evidence:workflow", "evidence:contrary"],
      assumption_ids: ["assumption:demand"],
    },
    discriminating_test: {
      action: "Have an occasional manager enter, review, leave and return using a mocked preview.",
      observable_result: "The manager locates the request and explains its state on return.",
      reversal_condition: "Defer the entry-point change if the existing route is clearer.",
      evidence_ids: ["evidence:workflow"],
      assumption_ids: ["assumption:adoption"],
    },
  };
}

function messages(result) {
  return result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n");
}

test("accepts a cited test-first recommendation with an explicitly unknown buyer", () => {
  const value = fixture();
  const before = JSON.stringify(value);
  const result = validate(value);
  assert.equal(result.ok, true, messages(result));
  assert.deepEqual(result.issues, []);
  assert.equal(JSON.stringify(value), before, "validation must not rewrite the judgment");
});

test("build and defer remain decisions, and identified or inapplicable buyers need a basis", () => {
  for (const decision of ["build", "defer"]) {
    for (const status of ["identified", "not-applicable"]) {
      const value = fixture();
      value.recommendation.decision = decision;
      value.buyer = {
        status,
        ...claim(
          status === "identified" ? "Operations director" : "An internal operational workflow",
          ["evidence:workflow"]
        ),
      };
      assert.equal(validate(value).ok, true, `${decision}/${status}`);
      value.buyer.evidence_ids = [];
      assert.match(messages(validate(value)), /buyer.*cite at least one/i);
    }
  }
});

test("absent historical briefs are readable, while required absence and present null are invalid", () => {
  assert.deepEqual(validate(undefined), { ok: true, issues: [] });
  assert.match(messages(validate(undefined, { required: true })), /value_decision.*required/);
  for (const present of [null, [], "unknown", false]) {
    assert.match(messages(validate(present)), /must be an object/);
  }
});

test("definitive beneficiary, outcome and commercial claims cannot be uncited", () => {
  for (const field of ["beneficiary", "user_outcome", "commercial_hypothesis"]) {
    const value = fixture();
    value[field] = claim("This feature improves the customer outcome.");
    const result = validate(value);
    assert.equal(result.ok, false, field);
    assert.match(messages(result), new RegExp(`${field}.*cite at least one`, "i"));
  }
});

test("commercial inference retains an explicit assumption even when workflow evidence exists", () => {
  const value = fixture();
  value.commercial_hypothesis.assumption_ids = [];
  assert.match(
    messages(validate(value)),
    /commercial_hypothesis.assumption_ids.*hypothesis.*assumption/i
  );
});

test("all cited IDs must exist in the enclosing proposal, including recommendation and test", () => {
  const mutations = [
    ["beneficiary", "evidence_ids", "evidence:missing"],
    ["buyer", "evidence_ids", "evidence:missing"],
    ["user_outcome", "assumption_ids", "assumption:missing"],
    ["commercial_hypothesis", "assumption_ids", "assumption:missing"],
    ["counterevidence", "evidence_ids", "evidence:missing"],
    ["recommendation", "evidence_ids", "evidence:missing"],
    ["discriminating_test", "assumption_ids", "assumption:missing"],
  ];
  for (const [field, refs, id] of mutations) {
    const value = fixture();
    value[field][refs] = [id];
    const result = validate(value);
    assert.equal(result.ok, false, `${field}.${refs}`);
    assert.match(messages(result), new RegExp(`${field}.${refs}.*unknown`, "i"));
  }
  const value = fixture();
  value.uncertainties[0].assumption_ids = ["assumption:missing"];
  assert.match(messages(validate(value)), /uncertainties\[0\].assumption_ids.*unknown/);
});

test("not-found counterevidence records the checked basis without claiming exhaustive certainty", () => {
  const value = fixture();
  value.counterevidence = {
    status: "not-found",
    statement: "No contrary signal in the supplied notes; buyer interviews were not available.",
    evidence_ids: ["evidence:search"],
  };
  assert.equal(validate(value).ok, true);
  value.counterevidence.evidence_ids = [];
  assert.match(messages(validate(value)), /counterevidence.evidence_ids.*checked evidence/i);
  value.counterevidence.evidence_ids = ["evidence:search"];
  value.uncertainties = [];
  assert.match(messages(validate(value)), /uncertainties.*non-empty array/i);
});

test("a recommendation and discriminating test require a cited rationale and reversal observation", () => {
  const value = fixture();
  value.recommendation.decision = "top-ranked";
  value.recommendation.evidence_ids = [];
  value.recommendation.assumption_ids = [];
  value.discriminating_test.reversal_condition = " ";
  value.discriminating_test.observable_result = "";
  value.discriminating_test.evidence_ids = [];
  value.discriminating_test.assumption_ids = [];
  const result = validate(value);
  assert.match(messages(result), /recommendation.decision.*build, test-first, defer/);
  assert.match(messages(result), /recommendation.*cite at least one/);
  assert.match(messages(result), /discriminating_test.reversal_condition.*non-empty/);
  assert.match(messages(result), /discriminating_test.observable_result.*non-empty/);
  assert.match(messages(result), /discriminating_test.*cite at least one/);
});

test("closed objects, required fields and schema version reject unbound extra claims", () => {
  const value = fixture();
  value.schema_version = 2;
  value.roi = "invented";
  value.beneficiary.probability = 0.95;
  value.buyer.email = "invented@example.test";
  value.commercial_hypothesis.validated = true;
  value.counterevidence.dismissed = true;
  value.uncertainties[0].resolved = true;
  value.recommendation.score = 100;
  value.discriminating_test.duration_days = 2;
  delete value.user_outcome.statement;
  const result = validate(value, { path: "$.decision_brief.value_decision" });
  assert.match(messages(result), /schema_version.*equal 1/);
  for (const field of [
    "roi",
    "probability",
    "email",
    "validated",
    "dismissed",
    "resolved",
    "score",
    "duration_days",
  ]) {
    assert.match(messages(result), new RegExp(`unknown field ${field}`));
  }
  assert.match(
    messages(result),
    /\$.decision_brief.value_decision.user_outcome.statement.*required/
  );
});

test("duplicate, noncanonical and control-character references cannot replace source IDs", () => {
  for (const ids of [
    ["evidence:workflow", "evidence:workflow"],
    ["../evidence.md"],
    ["https://example.test/evidence"],
    ["evidence:workflow\u0000"],
  ]) {
    const value = fixture();
    value.beneficiary.evidence_ids = ids;
    assert.equal(validate(value).ok, false, JSON.stringify(ids));
  }
  const value = fixture();
  value.user_outcome.statement = "Apparently valid\u0000text";
  assert.match(messages(validate(value)), /user_outcome.statement.*control characters/);
});

test("bounded fields and arrays reject oversized decision packets", () => {
  const value = fixture();
  value.beneficiary.statement = "x".repeat(4097);
  value.beneficiary.evidence_ids = Array.from(
    { length: 33 },
    (_, index) => `evidence:item-${index}`
  );
  value.uncertainties = Array.from({ length: 33 }, () => fixture().uncertainties[0]);
  const result = validate(value);
  assert.match(messages(result), /beneficiary.statement.*4096/);
  assert.match(messages(result), /beneficiary.evidence_ids.*32/);
  assert.match(messages(result), /uncertainties.*32/);
});

test("array and reference-context conventions accept sets but cannot ignore missing sources", () => {
  const value = fixture();
  assert.equal(
    validate(value, {
      evidenceIds: new Set(["evidence:workflow", "evidence:contrary", "evidence:search"]),
      assumptionIds: new Set(["assumption:demand", "assumption:adoption"]),
    }).ok,
    true
  );
  assert.match(messages(validate(value, { evidenceIds: undefined })), /unknown evidence id/);
  value.beneficiary.assumption_ids = "assumption:adoption";
  assert.match(messages(validate(value)), /beneficiary.assumption_ids.*array/);
});
