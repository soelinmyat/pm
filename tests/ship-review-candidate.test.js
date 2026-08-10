"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { selectPublicationRoute } = require("../scripts/review-convergence");

const ROOT = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

test("candidate publication requires protected permission and exact adapter coverage", () => {
  const optimized = selectPublicationRoute({
    candidateRoute: true,
    protectedPermission: true,
    exactAdapterCoverage: true,
  });
  assert.deepEqual(optimized, {
    route: "review-candidate",
    publish_draft: true,
    enter_finalization: true,
    reason: "protected candidate-publication permission and exact adapter coverage are current",
  });

  for (const input of [
    { candidateRoute: true, protectedPermission: false, exactAdapterCoverage: true },
    { candidateRoute: true, protectedPermission: true, exactAdapterCoverage: false },
    { candidateRoute: false, protectedPermission: true, exactAdapterCoverage: true },
  ]) {
    const fallback = selectPublicationRoute(input);
    assert.equal(fallback.route, "comprehensive");
    assert.equal(fallback.publish_draft, false);
    assert.equal(fallback.enter_finalization, false);
    assert.match(fallback.reason, /comprehensive Ship/);
  }
});

test("explicit comprehensive delivery override always disables candidate publication", () => {
  const selected = selectPublicationRoute({
    candidateRoute: true,
    protectedPermission: true,
    exactAdapterCoverage: true,
    comprehensive: true,
  });
  assert.equal(selected.route, "comprehensive");
  assert.equal(selected.publish_draft, false);
});

test("PM_DELIVERY_COMPREHENSIVE disables candidate publication", (t) => {
  const previous = process.env.PM_DELIVERY_COMPREHENSIVE;
  process.env.PM_DELIVERY_COMPREHENSIVE = "1";
  t.after(() => {
    if (previous === undefined) delete process.env.PM_DELIVERY_COMPREHENSIVE;
    else process.env.PM_DELIVERY_COMPREHENSIVE = previous;
  });
  assert.equal(
    selectPublicationRoute({
      candidateRoute: true,
      protectedPermission: true,
      exactAdapterCoverage: true,
    }).route,
    "comprehensive"
  );
});

test("Ship instructions preserve comprehensive fallback and draft-only candidate authority", () => {
  const review = read("skills/ship/steps/03-review.md");
  const push = read("skills/ship/steps/04-push.md");
  const createPr = read("skills/ship/steps/05-create-pr.md");
  const contract = read("skills/ship/references/review-candidate-contract.md");

  assert.match(review, /protected.*candidate-publication permission/is);
  assert.match(review, /exact adapter coverage/is);
  assert.match(review, /existing comprehensive Ship/is);
  assert.match(review, /before.*candidate publication/is);
  assert.match(push, /draft-only candidate push/is);
  assert.match(push, /targeted repository-native checks/is);
  assert.match(createPr, /--draft/);
  assert.match(createPr, /never.*ready for review/is);
  assert.match(contract, /timeout.*never.*pass/is);
  assert.match(contract, /zero unresolved required conversations/is);
  assert.match(contract, /approver.*reason.*requirement-set hash/is);
});

test("every edited Ship step remains thick and advances explicitly", () => {
  for (const [file, next] of [
    ["skills/ship/steps/03-review.md", "Step 04"],
    ["skills/ship/steps/04-push.md", "Step 05"],
    ["skills/ship/steps/05-create-pr.md", "Step 6"],
  ]) {
    const text = read(file);
    for (const section of ["## Goal", "## How", "## Done-when"]) {
      assert.ok(text.includes(section), `${file} must contain ${section}`);
    }
    assert.match(text, new RegExp(`\\*\\*Advance:\\*\\* proceed to ${next}`));
  }
});
