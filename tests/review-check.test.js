"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { checkReview, expandFromReport } = require("../scripts/review-check");
const { renderReviewReport } = require("../scripts/review-report");
const { buildReviewTarget } = require("../scripts/review-target");
const { findingId } = require("../scripts/lib/review-contract");
const { resolveBrowser } = require("../scripts/artifact-render-check");

let installedBrowser = null;
try {
  installedBrowser = resolveBrowser();
} catch {
  installedBrowser = null;
}

test("complete adaptively allocated review evidence produces a current passing report", () => {
  const fixture = makeFixture({ maxWorkers: 3 });
  const generated = checkReview({
    root: fixture.root,
    targetPath: fixture.targetPath,
    resultPaths: fixture.resultPaths,
    reportPath: fixture.reportPath,
    humanReportPath: fixture.htmlPath,
    writeReport: true,
    verifyBrowser: false,
  });
  assert.equal(generated.ok, true, JSON.stringify(generated.issues, null, 2));
  renderReviewReport({
    root: fixture.root,
    reportPath: fixture.reportPath,
    outputPath: fixture.htmlPath,
  });
  const checked = checkReview({
    root: fixture.root,
    targetPath: fixture.targetPath,
    resultPaths: fixture.resultPaths,
    reportPath: fixture.reportPath,
    humanReportPath: fixture.htmlPath,
    verifyBrowser: false,
  });
  assert.equal(checked.ok, true, JSON.stringify(checked.issues, null, 2));
  assert.equal(checked.report.coverage.required.length, 5);
  assert.deepEqual(checked.report.coverage.not_applicable, ["design"]);
  const resumed = checkReview(
    expandFromReport({
      root: fixture.root,
      reportPath: fixture.reportPath,
      fromReport: true,
      verifyBrowser: false,
    })
  );
  assert.equal(resumed.ok, true, JSON.stringify(resumed.issues, null, 2));
});

test("missing a planned physical reviewer fails logical coverage", () => {
  const fixture = makeFixture({ maxWorkers: 3 });
  const result = checkReview({
    root: fixture.root,
    targetPath: fixture.targetPath,
    resultPaths: fixture.resultPaths.slice(1),
    reportPath: fixture.reportPath,
    humanReportPath: fixture.htmlPath,
    writeReport: true,
    verifyBrowser: false,
  });
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /missing planned reviewer|exactly one result/);
});

test("a source mutation makes target and reviewer evidence stale", () => {
  const fixture = makeFixture({ maxWorkers: 2 });
  fs.appendFileSync(path.join(fixture.root, "src/example.js"), "module.exports.extra = true;\n");
  git(fixture.root, ["add", "src/example.js"]);
  git(fixture.root, ["commit", "-qm", "mutate after review"]);
  const result = checkReview({
    root: fixture.root,
    targetPath: fixture.targetPath,
    resultPaths: fixture.resultPaths,
    reportPath: fixture.reportPath,
    humanReportPath: fixture.htmlPath,
    writeReport: true,
    verifyBrowser: false,
  });
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result.issues),
    /stale for current HEAD|current diff bytes|changed-file bytes/
  );
});

test("reviewer cannot emit a finding for an unassigned lens", () => {
  const fixture = makeFixture({ maxWorkers: 6 });
  const firstPath = path.join(fixture.root, fixture.resultPaths[0]);
  const first = JSON.parse(fs.readFileSync(firstPath, "utf8"));
  first.findings = [validFinding("edge")];
  fs.writeFileSync(firstPath, `${JSON.stringify(first, null, 2)}\n`);
  const result = checkReview({
    root: fixture.root,
    targetPath: fixture.targetPath,
    resultPaths: fixture.resultPaths,
    reportPath: fixture.reportPath,
    humanReportPath: fixture.htmlPath,
    writeReport: true,
    verifyBrowser: false,
  });
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /must be assigned to this reviewer/);
});

test("Review-owned blockers fail while QA-owned findings become non-blocking handoffs", () => {
  const blocked = makeFixture({ maxWorkers: 6 });
  const reviewFinding = validFinding("bug");
  setFindingForLens(blocked, "bug", reviewFinding);
  const failed = generate(blocked);
  assert.equal(failed.ok, true, JSON.stringify(failed.issues));
  assert.equal(failed.report.outcome, "failed");
  assert.deepEqual(failed.report.blockers, [reviewFinding.id]);

  const handedOff = makeFixture({ maxWorkers: 6 });
  const qaFinding = { ...validFinding("edge"), owner: "qa" };
  qaFinding.id = findingId(qaFinding);
  setFindingForLens(handedOff, "edge", qaFinding);
  const passed = generate(handedOff);
  assert.equal(passed.ok, true, JSON.stringify(passed.issues));
  assert.equal(passed.report.outcome, "passed");
  assert.deepEqual(passed.report.handoffs.qa, [qaFinding.id]);
});

test("material reviewer disagreement blocks until an explicit decision", () => {
  const fixture = makeFixture({ maxWorkers: 6 });
  const bug = validFinding("bug");
  const edge = {
    ...bug,
    category: "edge",
    severity: "low",
    owner: "qa",
    impact: "The live flow may recover differently than the static path suggests.",
  };
  edge.id = findingId(edge);
  assert.equal(edge.id, bug.id);
  setFindingForLens(fixture, "bug", bug);
  setFindingForLens(fixture, "edge", edge);
  const blocked = generate(fixture);
  assert.equal(blocked.ok, true, JSON.stringify(blocked.issues));
  assert.equal(blocked.report.outcome, "blocked");
  assert.deepEqual(blocked.report.unresolved_disagreements, [bug.id]);

  const decisionsPath = ".pm/dev-sessions/example/review/decisions.json";
  write(fixture.root, decisionsPath, {
    schema_version: 1,
    run_id: fixture.target.run_id,
    review_round: 1,
    target: binding(fixture.root, fixture.targetPath),
    decisions: [
      {
        finding_id: bug.id,
        approver: "Maintainer",
        action: "handoff-qa",
        rationale: "The disputed behavior depends on the live runtime flow.",
        decided_at: "2026-07-12T00:05:00Z",
      },
    ],
    checked_at: "2026-07-12T00:05:00Z",
  });
  const decided = generate(fixture, { decisionsPath });
  assert.equal(decided.ok, true, JSON.stringify(decided.issues));
  assert.equal(decided.report.outcome, "passed");
  assert.deepEqual(decided.report.handoffs.qa, [bug.id]);
});

test(
  "real Chromium verifies first-screen Review markers and their visible text",
  { skip: !installedBrowser && "Chromium is not installed" },
  () => {
    const fixture = makeFixture({ maxWorkers: 3 });
    const generated = generate(fixture);
    renderReviewReport({
      root: fixture.root,
      reportPath: fixture.reportPath,
      outputPath: fixture.htmlPath,
    });
    const checked = checkReview({
      root: fixture.root,
      targetPath: fixture.targetPath,
      resultPaths: fixture.resultPaths,
      reportPath: fixture.reportPath,
      humanReportPath: fixture.htmlPath,
      browserPath: installedBrowser,
    });
    assert.equal(generated.ok, true, JSON.stringify(generated.issues));
    assert.equal(checked.ok, true, JSON.stringify(checked.issues, null, 2));

    const htmlFile = path.join(fixture.root, fixture.htmlPath);
    const html = fs.readFileSync(htmlFile, "utf8");
    fs.writeFileSync(
      htmlFile,
      html
        .replace("</style>", "[data-hide]{display:none}</style>")
        .replace(
          generated.report.next_action,
          `<span data-hide>${generated.report.next_action}</span><span>Proceed anyway</span>`
        )
    );
    const hidden = checkReview({
      root: fixture.root,
      targetPath: fixture.targetPath,
      resultPaths: fixture.resultPaths,
      reportPath: fixture.reportPath,
      humanReportPath: fixture.htmlPath,
      browserPath: installedBrowser,
    });
    assert.equal(hidden.ok, false);
    assert.match(JSON.stringify(hidden.issues), /matching text in the first screenful/);
  }
);

function makeFixture({ maxWorkers }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-review-check-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, "skills/dev/references"), { recursive: true });
  fs.writeFileSync(path.join(root, ".gitignore"), ".pm/\n");
  fs.writeFileSync(path.join(root, "src/example.js"), "module.exports = { value: 1 };\n");
  fs.writeFileSync(
    path.join(root, "skills/dev/references/model-profiles.json"),
    JSON.stringify({
      profiles: {
        "codex-workhorse": {
          provider: "codex",
          model: "gpt-5.6-sol",
          effort: "high",
          externalEffects: false,
        },
      },
    })
  );
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "base"]);
  const base = git(root, ["rev-parse", "HEAD"]).trim();
  const origin = `${root}-origin.git`;
  git(root, ["init", "-q", "--bare", origin]);
  execFileSync("git", ["--git-dir", origin, "symbolic-ref", "HEAD", "refs/heads/main"]);
  git(root, ["remote", "add", "origin", origin]);
  git(root, ["push", "-q", "origin", `${base}:refs/heads/main`]);
  fs.writeFileSync(path.join(root, "src/example.js"), "module.exports = { value: 2 };\n");
  git(root, ["add", "src/example.js"]);
  git(root, ["commit", "-qm", "change"]);

  const targetPath = ".pm/dev-sessions/example/review/target.json";
  const target = buildReviewTarget({
    root,
    maxWorkers,
    profile: "codex-workhorse",
    runId: "review-test",
  });
  write(root, targetPath, target);
  const targetBinding = binding(root, targetPath);
  const resultPaths = target.allocation.map((worker) => {
    const resultPath = `.pm/dev-sessions/example/review/results/${worker.worker_id}.json`;
    write(root, resultPath, {
      schema_version: 1,
      run_id: target.run_id,
      review_round: target.review_round,
      target: targetBinding,
      source: target.source,
      worker_id: worker.worker_id,
      profile: worker.profile,
      runtime: worker.runtime,
      lenses: worker.lenses,
      verdicts: worker.lenses.map((lens) => ({
        lens,
        outcome: "clean",
        summary: `No actionable ${lens} findings in the changed source.`,
      })),
      findings: [],
      checked_at: "2026-07-12T00:00:00Z",
    });
    return resultPath;
  });
  return {
    root,
    target,
    targetPath,
    resultPaths,
    reportPath: ".pm/dev-sessions/example/review/report.json",
    htmlPath: ".pm/dev-sessions/example/review/report.html",
  };
}

function validFinding(category) {
  const finding = {
    category,
    severity: "high",
    confidence: 95,
    file: "src/example.js",
    line_start: 1,
    line_end: 1,
    rule: "changed-export",
    issue: "The changed export violates its caller contract.",
    impact: "Callers receive the wrong value.",
    fix: "Restore the contract and add a regression test.",
    fix_kind: "behavioral",
    verify: "node --test tests/example.test.js",
    evidence: [{ kind: "source", ref: "src/example.js:1" }],
    owner: "review",
    disposition: "open",
    decision_required: false,
  };
  finding.id = findingId(finding);
  return finding;
}

function setFindingForLens(fixture, lens, finding) {
  const resultPath = fixture.resultPaths.find((relative) => {
    const result = JSON.parse(fs.readFileSync(path.join(fixture.root, relative), "utf8"));
    return result.lenses.includes(lens);
  });
  const absolute = path.join(fixture.root, resultPath);
  const result = JSON.parse(fs.readFileSync(absolute, "utf8"));
  result.findings.push(finding);
  result.verdicts.find((verdict) => verdict.lens === lens).outcome = "findings";
  result.verdicts.find((verdict) => verdict.lens === lens).summary = `Found ${finding.issue}`;
  fs.writeFileSync(absolute, `${JSON.stringify(result, null, 2)}\n`);
}

function generate(fixture, overrides = {}) {
  return checkReview({
    root: fixture.root,
    targetPath: fixture.targetPath,
    resultPaths: fixture.resultPaths,
    reportPath: fixture.reportPath,
    humanReportPath: fixture.htmlPath,
    decisionsPath: overrides.decisionsPath,
    writeReport: true,
    verifyBrowser: false,
  });
}

function write(root, relative, value) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function binding(root, relative) {
  const bytes = fs.readFileSync(path.join(root, relative));
  return { path: relative, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
}

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}
