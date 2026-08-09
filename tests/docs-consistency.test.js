"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const FILES = [
  "README.md",
  ".codex/INSTALL.md",
  "commands/dev.md",
  "commands/review.md",
  "commands/ship.md",
];

test("public delivery surfaces make the same zero-edit safe-routing promise", () => {
  for (const relative of FILES) {
    const text = fs.readFileSync(path.join(ROOT, relative), "utf8");
    assert.match(text, /zero consumer edits/i, relative);
    assert.match(text, /automatically discovers?/i, relative);
    assert.match(text, /comprehensive/i, relative);
    assert.match(
      text,
      /explicit(?:ly)?\s+authorized\s+machine-readable\s+candidate-publication\s+policy/i,
      relative
    );
    assert.match(text, /PM_DELIVERY_COMPREHENSIVE=1/, relative);
  }
});

test("telemetry documentation names bounded private fields and exclusions", () => {
  const text = fs.readFileSync(path.join(ROOT, "references/telemetry.md"), "utf8");
  for (const phrase of [
    "environment-preflight",
    "active-command",
    "review-wait",
    "ci-queue",
    "ci-run",
    "merge-wait",
    "invalidation",
    "reuse",
    "final-certification",
    "512 events",
    "1 MiB",
    "0600",
  ])
    assert.match(text, new RegExp(phrase, "i"), phrase);
  assert.match(text, /never records?.*command output/i);
});

test("candidate contract marks effects before publication and supports both Git object formats", () => {
  const text = fs.readFileSync(
    path.join(ROOT, "skills/ship/references/review-candidate-contract.md"),
    "utf8"
  );
  const marker = text.indexOf("Record `candidate-effect`");
  const publish = text.indexOf("Publish the exact head");
  assert.ok(marker >= 0 && publish >= 0 && marker < publish);
  assert.match(text, /40- or 64-character Git object ID/);
  assert.doesNotMatch(text, /one 40-character feature-head SHA/);
});

test("optimized Ship prepares the version before review and finalizes before CI", () => {
  const review = fs.readFileSync(path.join(ROOT, "skills/ship/steps/03-review.md"), "utf8");
  const push = fs.readFileSync(path.join(ROOT, "skills/ship/steps/04-push.md"), "utf8");
  const createPr = fs.readFileSync(path.join(ROOT, "skills/ship/steps/05-create-pr.md"), "utf8");
  const ci = fs.readFileSync(path.join(ROOT, "skills/ship/steps/06-ci-monitor.md"), "utf8");

  const prepare = review.indexOf("npm run prepare-release");
  const candidateReview = review.indexOf("Run `pm:review` in branch mode", prepare);
  assert.ok(prepare >= 0 && candidateReview > prepare, "version preparation must precede review");
  const refreshedPlan = review.indexOf("repository-delivery-plan.js", prepare);
  assert.ok(
    refreshedPlan > prepare && refreshedPlan < candidateReview,
    "head-bound delivery inputs must be regenerated after preparation"
  );
  assert.match(review, /never prepare or commit a version mutation after convergence/i);

  const converged = createPr.indexOf("`review-converged`");
  const finalize = createPr.indexOf("release-transaction.js finalize-candidate", converged);
  const advance = createPr.indexOf("**Advance:**", finalize);
  assert.ok(converged >= 0 && finalize > converged && advance > finalize);
  assert.match(createPr, /prepared commit.*exact converged head/is);
  assert.match(createPr, /--certification ".*ship\/final-certification\.json"/);
  assert.doesNotMatch(createPr, /repository-gate-certification\.json/);
  assert.match(push, /release-transaction\.js` (?:`)?plan.*push/is);
  assert.match(push, /release-transaction\.js` (?:`)?begin.*push/is);
  assert.match(push, /release-transaction\.js` (?:`)?reconcile.*push/is);
  assert.match(createPr, /release-transaction\.js` (?:`)?plan.*create-pr/is);
  assert.match(createPr, /release-transaction\.js` (?:`)?begin.*create-pr/is);
  assert.match(createPr, /release-transaction\.js` (?:`)?reconcile.*create-pr/is);
  assert.match(ci, /before monitoring CI.*final-candidate attestation/is);
});
