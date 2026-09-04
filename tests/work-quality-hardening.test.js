"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { scoreProposal } = require("../scripts/proposal-quality-check");

const ROOT = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");
const fixture = (name) => JSON.parse(read(path.join("tests", "fixtures", "proposals", name)));

test("UI skill runtime executes a concise craft loop and its deepest critique methods", () => {
  const design = read("skills/groom/steps/05-design.md");
  for (const expectation of [
    /visual language/i,
    /design intent/i,
    /hierarchy/i,
    /two materially different compositions/i,
    /primary action/i,
    /density/i,
    /typography/i,
    /desktop and narrow/i,
    /inspect.*visually/i,
    /refine.*once/i,
    /objective defect.*subjective craft/is,
  ])
    assert.match(design, expectation);

  const groomReview = read("skills/groom/steps/07-review.md");
  assert.match(groomReview, /team-reviewers\.md/);
  assert.match(groomReview, /prototype.*designer/is);

  const critique = read("skills/design-critique/steps/03-critique.md");
  assert.match(critique, /design-critique-reviewer\.md/);
  assert.match(critique, /design-critique-fresh-eyes\.md/);
  assert.match(critique, /objective.*subjective/is);

  const capture = read("skills/dev/references/design-critique-capture-guide.md");
  assert.match(capture, /normalized audit envelope/i);
  assert.match(capture, /accessibility-tree/);
  assert.match(capture, /dom-audit/);
});

test("UI contracts preserve approved design intent and first-class interaction coverage", () => {
  const handoff = read("skills/groom/steps/10-handoff.md");
  for (const expectation of [
    /design requirements/i,
    /prototype.*(?:path|identity|hash)/is,
    /critical states/i,
    /visual invariants/i,
  ])
    assert.match(handoff, expectation);

  const rfcUnits = read("scripts/lib/rfc-work-units.js");
  const devUnits = read("scripts/lib/dev-work-units.js");
  assert.match(rfcUnits, /design_context/);
  assert.match(devUnits, /design_context/);

  const checker = read("scripts/design-critique-check.js");
  for (const state of ["loading", "success", "focus", "disabled", "keyboard", "modal"])
    assert.match(checker, new RegExp(`["]${state}["]`));
});

test("Product proposal quality has non-compensatory substantive minimums", () => {
  for (const field of ["alternatives", "risks", "design_requirements"]) {
    const proposal = fixture("strong-v1.json");
    proposal[field] = [];
    const result = scoreProposal(proposal);
    assert.equal(result.quality_passed, false, `${field} cannot be compensated by other scores`);
    assert.equal(result.minimums[field].passed, false);
  }

  const reviewed = fixture("strong-v1.json");
  reviewed.lifecycle = "reviewed";
  reviewed.review.status = "passed";
  reviewed.question_reviews = [];
  const result = scoreProposal(reviewed);
  assert.equal(result.quality_passed, false);
  assert.equal(result.minimums.question_reviews.passed, false);
});

test("Product research and idea ranking calibrate evidence and customer value", () => {
  const research = [
    read("skills/research/SKILL.md"),
    read("skills/research/steps/03-landscape.md"),
    read("skills/research/steps/04-competitor.md"),
    read("skills/research/steps/05-topic.md"),
  ].join("\n");
  for (const dimension of ["authority", "independence", "recency", "claim fit"])
    assert.match(research, new RegExp(dimension, "i"));
  assert.match(research, /three derivative sources/i);
  assert.match(research, /primary source/i);

  const ideate = read("skills/ideate/SKILL.md");
  const ranker = read("scripts/lib/product-reasoning-schema.js");
  for (const dimension of [
    "customer impact",
    "reach",
    "urgency",
    "expected outcome",
    "learning value",
    "confidence-adjusted",
  ])
    assert.match(`${ideate}\n${ranker}`, new RegExp(dimension.replace(" ", "[-_ ]"), "i"));
  assert.match(ranker, /weighted_total/);
});

test("Engineering guidance is consistent, project-neutral, and risk-aware", () => {
  const qaStep = read("skills/dev/steps/07-qa.md");
  const qa = read("skills/dev/references/qa.md");
  assert.match(`${qaStep}\n${qa}`, /qa\/report\.json/);
  assert.doesNotMatch(qa, /Append structured report to .*session\.json/i);
  assert.doesNotMatch(qa, /append to existing `## QA`/i);
  assert.match(
    `${qaStep}\n${qa}`,
    /no unresolved (?:critical or high|high(?:-severity)?).*finding/i
  );

  const tdd = read("skills/dev/references/tdd.md");
  for (const productPath of [/apps\/api/i, /apps\/mobile/i, /apps\/display/i])
    assert.doesNotMatch(tdd, productPath);
  assert.doesNotMatch(tdd, /Delete code\. Start over/i);
  for (const mode of [/characterization/i, /spike/i, /generated code/i, /legacy/i])
    assert.match(tdd, mode);

  const debugging = read("skills/dev/references/debugging.md");
  assert.doesNotMatch(debugging, /apps\/mobile/i);
  assert.doesNotMatch(debugging, /Rails gotchas/i);

  const ship = read("skills/ship/steps/05-create-pr.md");
  for (const context of [
    /Rationale/i,
    /Risks/i,
    /Rollout/i,
    /Rollback/i,
    /Limitations/i,
    /Acceptance evidence/i,
  ])
    assert.match(ship, context);
  const merge = read("skills/ship/steps/07-merge-loop.md");
  assert.match(merge, /pre-existing.*unrelated.*failure/is);
  assert.match(merge, /do not.*expand.*scope/is);
});

test("Engineering Review adds a dedicated security lens for risky Dev work", () => {
  const contract = read("scripts/lib/review-contract.js");
  const briefs = read("skills/review/references/reviewer-briefs.md");
  const dispatch = read("skills/review/steps/02-dispatch.md");
  assert.match(contract, /"security"/);
  assert.match(contract, /security_review_required/);
  assert.match(briefs, /`security`/);
  assert.match(briefs, /authorization|privacy|secret|dependency/i);
  assert.match(dispatch, /security.*risk/i);
});
