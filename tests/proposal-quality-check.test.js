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
