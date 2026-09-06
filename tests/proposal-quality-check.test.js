"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { validateProposal } = require("../scripts/lib/proposal-schema");
const { scoreProposal } = require("../scripts/proposal-quality-check");
const { reviewRowForTier } = require("./helpers/groom-review-fixture.js");

const fixtureRoot = path.join(__dirname, "fixtures", "proposals");

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(fixtureRoot, name), "utf8"));
}

test("blind calibration separates strong and weak proposals after both pass schema validation", () => {
  const candidates = [fixture("strong-v1.json"), fixture("weak-schema-valid-v1.json")]
    .map((proposal) => ({ proposal, validation: validateProposal(proposal) }))
    .sort((left, right) => left.proposal.id.localeCompare(right.proposal.id));
  for (const candidate of candidates)
    assert.equal(candidate.validation.ok, true, JSON.stringify(candidate.validation.issues));

  const scores = Object.fromEntries(
    candidates.map(({ proposal }) => [proposal.slug, scoreProposal(proposal)])
  );
  assert.equal(scores["structured-groom"].quality_passed, true);
  assert.equal(scores["generic-groom"].quality_passed, false);
  assert.ok(
    scores["structured-groom"].score - scores["generic-groom"].score >= 30,
    JSON.stringify(scores, null, 2)
  );
});

test("quality score is bounded, dimensioned, and does not replace schema eligibility", () => {
  const result = scoreProposal(fixture("strong-v1.json"));
  assert.equal(result.maximum, 100);
  assert.equal(
    Object.values(result.dimensions).reduce((sum, score) => sum + score, 0),
    result.score
  );
  assert.deepEqual(Object.keys(result.dimensions), [
    "evidence",
    "scope",
    "acceptance",
    "decisions",
    "experience",
    "traceability",
  ]);
});

test("quality gate requires a durable design context for downstream handoff", () => {
  const proposal = fixture("strong-v1.json");
  delete proposal.design_context;
  const result = scoreProposal(proposal);
  assert.equal(result.quality_passed, false);
  assert.equal(result.minimums.design_context.passed, false);
});

test("quality gate accepts honest nonvisual experience invariants without visual fiction", () => {
  const proposal = fixture("strong-v1.json");
  proposal.design_requirements = [
    {
      id: "design:cli-errors",
      requirement:
        "Return stable CLI exit codes with an actionable explanation for invalid and unavailable states.",
    },
  ];
  proposal.design_context = {
    design_requirements: proposal.design_requirements.map((row) => row.requirement),
    ui_impact: false,
    prototype: null,
    critical_states: ["success", "invalid input", "service unavailable"],
    experience_invariants: [
      "Every failure keeps a stable nonzero exit code and names the caller's next action.",
    ],
    visual_invariants: [],
  };
  const validation = validateProposal(proposal, { requireExperienceClassification: true });
  assert.equal(validation.ok, true, JSON.stringify(validation.issues));
  const result = scoreProposal(proposal);
  assert.equal(result.minimums.design_context.passed, true, result.minimums.design_context.reason);
  assert.equal(result.quality_passed, true);
});

test("quality gate rejects every index.html multi-file binding without a tree manifest", () => {
  const proposal = fixture("strong-v1.json");
  proposal.design_context.prototype = {
    path: "index.html",
    sha256: `sha256:${"a".repeat(64)}`,
  };
  const result = scoreProposal(proposal);
  assert.equal(result.minimums.design_context.passed, false);
  assert.match(result.minimums.design_context.reason, /complete prototype identity/i);
});

test("quality gate rejects reviewed proposals with partial or unbound tier review coverage", () => {
  const proposal = fixture("strong-v1.json");
  proposal.lifecycle = "reviewed";
  proposal.review_contract = {
    session_id: proposal.source.session_id,
    tier: "full",
    required_question_ids: ["problem-evidence", "scope", "acceptance"],
  };
  proposal.question_reviews = [reviewRowForTier("full", "problem-evidence")];
  let result = scoreProposal(proposal);
  assert.equal(result.quality_passed, false);
  assert.deepEqual(result.minimums.question_reviews.missing_question_ids, [
    "scope",
    "acceptance",
    "experience",
    "feasibility",
    "reversal",
  ]);

  delete proposal.review_contract;
  delete proposal.question_reviews[0].question_id;
  result = scoreProposal(proposal);
  assert.equal(result.quality_passed, false);
  assert.match(result.minimums.question_reviews.reason, /session-bound tier/);
});

test("quality gate rejects a six-row review that only restates prompts despite a 100-point proposal", () => {
  const proposal = fixture("strong-v1.json");
  proposal.lifecycle = "reviewed";
  proposal.review_contract = {
    session_id: proposal.source.session_id,
    tier: "full",
    required_question_ids: [
      "problem-evidence",
      "scope",
      "acceptance",
      "experience",
      "feasibility",
      "reversal",
    ],
  };
  proposal.question_reviews = proposal.review_contract.required_question_ids.map(
    (questionId, index) => {
      const row = reviewRowForTier("full", questionId, index);
      return {
        ...row,
        conclusion: row.question,
        rationale:
          "This generic rationale merely claims that the current review answer is adequate.",
        evidence: [
          {
            evidence_id: "evidence:baseline",
            locator: `F${(index % 2) + 1}`,
            relevance: "This evidence is directly relevant to this review conclusion.",
          },
        ],
      };
    }
  );

  const result = scoreProposal(proposal);
  assert.equal(result.score, 100);
  assert.equal(result.quality_passed, false);
  assert.equal(result.minimums.question_reviews.substantive, 0);
});

test("CLI resolves repo-relative prototype paths from the nearest git root by default", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "proposal-quality-root-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: repo });
    const proposal = fixture("strong-v1.json");
    const prototypePath = "pm/backlog/wireframes/structured-groom.html";
    const prototypeBytes = Buffer.from("<main>Bound prototype</main>\n");
    proposal.design_context.prototype = {
      path: prototypePath,
      sha256: `sha256:${crypto.createHash("sha256").update(prototypeBytes).digest("hex")}`,
    };
    const proposalPath = path.join(repo, "pm/backlog/proposals/structured-groom.json");
    fs.mkdirSync(path.dirname(proposalPath), { recursive: true });
    fs.mkdirSync(path.dirname(path.join(repo, prototypePath)), { recursive: true });
    fs.writeFileSync(path.join(repo, prototypePath), prototypeBytes);
    fs.writeFileSync(proposalPath, `${JSON.stringify(proposal, null, 2)}\n`);

    const run = spawnSync(
      process.execPath,
      [
        path.join(__dirname, "../scripts/proposal-quality-check.js"),
        "--proposal",
        proposalPath,
        "--json",
      ],
      { encoding: "utf8" }
    );
    assert.equal(run.status, 0, run.stderr || run.stdout);
    assert.equal(JSON.parse(run.stdout).quality_passed, true);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
