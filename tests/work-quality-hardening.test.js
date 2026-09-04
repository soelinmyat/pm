"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { scoreProposal } = require("../scripts/proposal-quality-check");
const { PROFILES: GROOM_PROFILES } = require("../scripts/lib/groom-runtime-profile");

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

test("shared writing guidance defers to the current prototype and proposal contracts", () => {
  const writing = read("references/writing.md");
  assert.match(writing, /owning skill's artifact contract/i);
  assert.match(writing, /canonical\s+JSON with generated HTML and Markdown projections/i);
  assert.match(writing, /prototype-format\.md/);
  assert.match(writing, /single-file wireframe is self-contained/i);
  assert.match(writing, /multi-file wireframe.*complete.*tree manifest/is);
  assert.doesNotMatch(writing, /Never HTML\s+for proposals/i);
  assert.doesNotMatch(writing, /Clear labels, flow arrows/i);
  assert.doesNotMatch(writing, /metadata lives in frontmatter of the parent markdown/i);
});

test("designer persona honors the caller contract without manufacturing a finding quota", () => {
  const persona = read("agents/designer.md");
  const primary = read("skills/dev/references/design-critique-reviewer.md");
  assert.match(persona, /dispatch(?:ing)? (?:brief|contract).*output/is);
  assert.match(persona, /structured JSON/i);
  assert.match(persona, /applicable states/i);
  assert.match(persona, /dispatch\/scope.*capture matrix/is);
  assert.match(persona, /evidence gap.*unknown/is);
  assert.match(persona, /0-3 specific positives/i);
  assert.doesNotMatch(persona, /For each interactive element, check:/i);
  assert.doesNotMatch(persona, /Check across 3 viewports:/i);
  assert.doesNotMatch(persona, /8-10 findings/i);
  assert.match(persona, /zero findings/i);
  assert.match(primary, /Return only the Primary `result` object/i);
});

test("prototype fidelity reuses any usable visual system without inventing one", () => {
  const prototype = read("skills/groom/references/prototype-format.md");
  assert.match(prototype, /usable existing visual system/i);
  assert.match(
    prototype,
    /Tailwind theme, CSS variables\/tokens\/theme, or established styled component primitives/i
  );
  assert.match(prototype, /reproduce the relevant shipped pattern faithfully and offline/i);
  assert.match(prototype, /never invent missing tokens/i);
  assert.match(prototype, /component-primitives/);
  assert.doesNotMatch(prototype, /tailwind\.config\.\*.*AND token files.*mockup/i);
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
  assert.match(ship, /existing PR.*body/is);
  assert.match(ship, /body.*exact.*PR_BODY_FILE/is);
  assert.match(ship, /explicit.*author.*gh pr edit/is);
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
  assert.match(
    briefs,
    /source, contract, test, or trace locator.*lockfile\/manifest source lines/is
  );
  assert.doesNotMatch(briefs, /source, contract, test, dependency, or trace locator/i);
  assert.match(dispatch, /security.*risk/i);
});

test("Model profiles keep Sol default and add explicit Astra comparative coverage", () => {
  const dev = JSON.parse(read("skills/dev/references/model-profiles.json"));
  const rfc = JSON.parse(read("skills/rfc/references/model-profiles.json"));
  const suite = JSON.parse(read("evals/quality/suite.json"));

  assert.equal(dev.profiles[dev.defaults.codex].model, "gpt-5.6-sol");
  assert.equal(rfc.profiles[rfc.defaults.codex].model, "gpt-5.6-sol");
  assert.equal(dev.profiles["codex-astra"].model, "gpt-6-astra");
  assert.equal(dev.profiles["codex-astra"].effort, "high");
  assert.equal(rfc.profiles["gpt-6-astra-high"].model, "gpt-6-astra");
  assert.equal(rfc.profiles["gpt-6-astra-high"].effort, "high");
  assert.equal(GROOM_PROFILES.profiles["gpt-6-astra-high"].model, "gpt-6-astra");
  assert.equal(GROOM_PROFILES.profiles["gpt-6-astra-high"].effort, "high");
  assert.ok(suite.profiles.some((profile) => profile.id === "astra-high"));
  assert.equal(suite.minimum_repeats, 3);
});

test("Design Critique capability benchmark keeps defect truth outside candidate scenarios", () => {
  const oracle = JSON.parse(read("evals/capabilities/design-critique/oracle.json"));
  assert.equal(oracle.minimum_repeats, 3);
  assert.ok(oracle.cases.some((item) => item.clean_control === true));
  for (const item of oracle.cases.filter((entry) => !entry.clean_control)) {
    assert.ok(item.defects.length >= 3 && item.defects.length <= 6);
    assert.ok(item.fixture_ref.startsWith("evals/quality/fixtures/design-critique/"));
  }

  const generator = read("scripts/evals/generate-quality-scenarios.js");
  assert.doesNotMatch(generator, /fixed export action overlaps heading/i);
  assert.doesNotMatch(generator, /action is off-screen/i);
  assert.match(generator, /design-critique\/responsive-report\.html/);
});
