"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { buildCanonicalReport, checkReview, expandFromReport } = require("../scripts/review-check");
const { renderReviewReport } = require("../scripts/review-report");
const { buildReviewTarget, changedFileInventory } = require("../scripts/review-target");
const { findingId } = require("../scripts/lib/review-contract");
const {
  expectedPriorReportPath,
  expectedReviewPath,
  reviewPathContext,
  reviewRootFromTargetPath,
} = require("../scripts/lib/review-paths");
const { renderArtifact, resolveBrowser } = require("../scripts/artifact-render-check");
const { safeProjectInput, safeProjectOutput } = require("../scripts/lib/safe-project-output");

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

test("a fresh run keeps evidence run-scoped while publishing the pass canonically", () => {
  const fixture = makeFixture({ maxWorkers: 3, runScoped: true });
  const generated = generate(fixture);
  assert.equal(generated.ok, true, JSON.stringify(generated.issues));
  assert.match(fixture.targetPath, /review\/runs\/review-test\/round-1\/target\.json$/);
  assert.equal(generated.report.human_report.path, fixture.htmlPath);
  assert.equal(fixture.reportPath, ".pm/dev-sessions/example/review/report.json");
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

test("target creation refuses dirty source and inventory remains bound to committed bytes", () => {
  const fixture = makeFixture({ maxWorkers: 2 });
  const committed = changedFileInventory(
    fixture.root,
    fixture.target.source.base_commit,
    fixture.target.source.commit
  );
  fs.writeFileSync(path.join(fixture.root, "src/example.js"), "module.exports = { value: 999 };\n");
  assert.deepEqual(
    changedFileInventory(
      fixture.root,
      fixture.target.source.base_commit,
      fixture.target.source.commit
    ),
    committed
  );
  assert.throws(
    () => buildReviewTarget({ root: fixture.root, maxWorkers: 2 }),
    /requires a clean worktree/
  );
  const runContext = reviewPathContext(
    ".pm/dev-sessions/example/review/runs/remediation-run/round-1/target.json",
    1,
    "remediation-run"
  );
  assert.equal(runContext.evidenceRoot, ".pm/dev-sessions/example/review/runs/remediation-run");
  assert.equal(runContext.canonicalRoot, ".pm/dev-sessions/example/review");
  assert.equal(
    expectedReviewPath(runContext.evidenceRoot, 1, "report", {
      outcome: "passed",
      canonicalRoot: runContext.canonicalRoot,
    }),
    ".pm/dev-sessions/example/review/report.json"
  );
  assert.throws(
    () =>
      reviewPathContext(
        ".pm/dev-sessions/example/review/runs/wrong-run/round-1/target.json",
        1,
        "expected-run"
      ),
    /must equal run_id/
  );
});

test("target creation rejects oversized optional bindings before reading them", () => {
  const fixture = makeFixture({ maxWorkers: 2 });
  const oversized = path.join(fixture.root, ".pm/oversized-input.json");
  fs.mkdirSync(path.dirname(oversized), { recursive: true });
  fs.writeFileSync(oversized, "{}");
  fs.truncateSync(oversized, 64 * 1024 * 1024 + 1);
  assert.throws(
    () =>
      buildReviewTarget({
        root: fixture.root,
        maxWorkers: 2,
        acceptancePath: ".pm/oversized-input.json",
      }),
    /exceeds 64 MiB/
  );
  fs.truncateSync(oversized, 4 * 1024 * 1024 + 1);
  assert.throws(
    () =>
      buildReviewTarget({
        root: fixture.root,
        maxWorkers: 2,
        designCritiquePath: ".pm/oversized-input.json",
      }),
    /exceeds 4 MiB JSON/
  );
});

test("review paths bind each round and reserve the canonical root for passes", () => {
  const targetPath = ".pm/dev-sessions/example/review/runs/review-test/round-2/target.json";
  const reviewRoot = reviewRootFromTargetPath(targetPath, 2);
  assert.equal(reviewRoot, ".pm/dev-sessions/example/review/runs/review-test");
  assert.equal(
    expectedReviewPath(reviewRoot, 2, "result", { workerId: "reviewer-3" }),
    ".pm/dev-sessions/example/review/runs/review-test/round-2/results/reviewer-3.json"
  );
  assert.equal(
    expectedReviewPath(reviewRoot, 2, "report", { outcome: "failed" }),
    ".pm/dev-sessions/example/review/runs/review-test/round-2/report.json"
  );
  assert.equal(
    expectedReviewPath(reviewRoot, 2, "report", { outcome: "passed" }),
    ".pm/dev-sessions/example/review/runs/review-test/report.json"
  );
  assert.equal(
    expectedPriorReportPath(reviewRoot, 2),
    ".pm/dev-sessions/example/review/runs/review-test/round-1/report.json"
  );
  assert.throws(
    () => reviewRootFromTargetPath(".pm/dev-sessions/example/review/target.json", 2),
    /round-2\/target\.json/
  );
});

test("fresh review paths require an explicit run namespace", () => {
  assert.throws(
    () =>
      reviewPathContext(".pm/dev-sessions/example/review/round-1/target.json", 1, "review-test"),
    /runs\/\{run-id\}/
  );
});

test("review outputs reject symlinked path ancestors", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-review-output-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "pm-review-outside-"));
  fs.mkdirSync(path.join(root, ".pm"), { recursive: true });
  fs.symlinkSync(outside, path.join(root, ".pm", "linked"));
  assert.throws(() => safeProjectOutput(root, ".pm/linked/report.json"), /contains symlink/);
  fs.symlinkSync(path.join(outside, "missing"), path.join(root, ".pm", "dangling"));
  assert.throws(() => safeProjectOutput(root, ".pm/dangling/report.json"), /contains symlink/);
  fs.symlinkSync(path.join(outside, "missing-file"), path.join(root, ".pm", "final.json"));
  assert.throws(() => safeProjectOutput(root, ".pm/final.json"), /contains symlink/);
  fs.writeFileSync(path.join(outside, "evidence.json"), "{}\n");
  assert.throws(() => safeProjectInput(root, ".pm/linked/evidence.json"), /contains symlink/);
});

test("later round target creation requires an intervening source commit", () => {
  const fixture = makeFixture({ maxWorkers: 6 });
  setFindingForLens(fixture, "bug", validFinding("bug"));
  assert.equal(
    generate(fixture, { reportPath: fixture.roundReportPath, htmlPath: fixture.roundHtmlPath }).ok,
    true
  );
  assert.throws(
    () =>
      buildReviewTarget({
        root: fixture.root,
        maxWorkers: 3,
        profile: "codex-workhorse",
        runId: "review-test",
        round: 2,
        priorReportPath: fixture.roundReportPath,
      }),
    /require a source mutation/
  );
});

test("later targets reject a copied prior report outside the preceding round path", () => {
  const fixture = makeFixture({ maxWorkers: 6 });
  setFindingForLens(fixture, "bug", validFinding("bug"));
  const roundOne = generate(fixture, {
    reportPath: fixture.roundReportPath,
    htmlPath: fixture.roundHtmlPath,
  });
  assert.equal(roundOne.ok, true, JSON.stringify(roundOne.issues));

  fs.writeFileSync(path.join(fixture.root, "src/example.js"), "module.exports = { value: 3 };\n");
  git(fixture.root, ["add", "src/example.js"]);
  git(fixture.root, ["commit", "-qm", "round two source"]);
  const targetPath = ".pm/dev-sessions/example/review/runs/review-test/round-2/target.json";
  const target = buildReviewTarget({
    root: fixture.root,
    maxWorkers: 3,
    profile: "codex-workhorse",
    runId: fixture.target.run_id,
    round: 2,
    priorReportPath: fixture.roundReportPath,
  });
  const copied = ".pm/dev-sessions/example/review/copied-prior.json";
  fs.copyFileSync(
    path.join(fixture.root, fixture.roundReportPath),
    path.join(fixture.root, copied)
  );
  target.prior_report = binding(fixture.root, copied);
  write(fixture.root, targetPath, target);
  const result = checkReview({
    root: fixture.root,
    targetPath,
    resultPaths: fixture.resultPaths,
    reportPath: ".pm/dev-sessions/example/review/runs/review-test/round-2/draft-report.json",
    humanReportPath: ".pm/dev-sessions/example/review/runs/review-test/round-2/draft-report.html",
    reportStage: "draft",
    writeReport: true,
    verifyBrowser: false,
  });
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /round-1\/report\.json/);
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

test("malformed evidence returns structured issues instead of throwing", () => {
  const fixture = makeFixture({ maxWorkers: 6 });
  const firstPath = path.join(fixture.root, fixture.resultPaths[0]);
  const first = JSON.parse(fs.readFileSync(firstPath, "utf8"));
  const finding = validFinding(first.lenses[0]);
  finding.evidence = [null];
  first.findings = [finding];
  first.verdicts[0].outcome = "findings";
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
  assert.match(JSON.stringify(result.issues), /evidence\[0\].*must be an object/);
});

test("malformed reviewer result shapes return issues instead of throwing during path checks", () => {
  for (const malformed of [null, "truncated", { schema_version: 1 }]) {
    const fixture = makeFixture({ maxWorkers: 3 });
    fs.writeFileSync(
      path.join(fixture.root, fixture.resultPaths[0]),
      `${JSON.stringify(malformed)}\n`
    );
    let result;
    assert.doesNotThrow(() => {
      result = checkReview({
        root: fixture.root,
        targetPath: fixture.targetPath,
        resultPaths: fixture.resultPaths,
        reportPath: fixture.reportPath,
        humanReportPath: fixture.htmlPath,
        writeReport: true,
        verifyBrowser: false,
      });
    });
    assert.equal(result.ok, false);
    assert.match(
      JSON.stringify(result.issues),
      /must be an object|worker_id|schema, run, and round/
    );
  }
});

test("malformed target containers and finding rows fail with structured issues", () => {
  for (const mutation of [
    (target) => (target.lenses = "all"),
    (target) => (target.allocation = { worker_id: "reviewer-1" }),
    (target) => (target.allocation = [null]),
  ]) {
    const fixture = makeFixture({ maxWorkers: 3 });
    mutation(fixture.target);
    write(fixture.root, fixture.targetPath, fixture.target);
    let result;
    assert.doesNotThrow(() => {
      result = generate(fixture);
    });
    assert.equal(result.ok, false);
    assert.match(JSON.stringify(result.issues), /target\.(lenses|allocation)/);
  }
  for (const malformed of [null, "truncated", 7]) {
    const fixture = makeFixture({ maxWorkers: 3 });
    const resultPath = path.join(fixture.root, fixture.resultPaths[0]);
    const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
    result.findings = [malformed];
    result.verdicts[0].outcome = "findings";
    fs.writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
    let checked;
    assert.doesNotThrow(() => {
      checked = generate(fixture);
    });
    assert.equal(checked.ok, false);
    assert.match(JSON.stringify(checked.issues), /must be an object/);
  }
});

test("malformed decision entries return structured issues instead of crashing synthesis", () => {
  for (const malformed of [null, "truncated", 7]) {
    const fixture = makeFixture({ maxWorkers: 3 });
    const decisionsPath = ".pm/dev-sessions/example/review/runs/review-test/round-1/decisions.json";
    write(fixture.root, decisionsPath, {
      schema_version: 1,
      run_id: fixture.target.run_id,
      review_round: 1,
      target: binding(fixture.root, fixture.targetPath),
      decisions: [malformed],
      checked_at: "2026-07-12T00:00:00Z",
    });
    let result;
    assert.doesNotThrow(() => {
      result = generate(fixture, { decisionsPath });
    });
    assert.equal(result.ok, false);
    assert.match(JSON.stringify(result.issues), /must be an object/);
  }
});

test("checker mirrors the target builder's 500-file review budget", () => {
  const fixture = makeFixture({ maxWorkers: 3 });
  const original = fixture.target.changed_files[0];
  fixture.target.changed_files = Array.from({ length: 501 }, (_, index) => ({
    ...original,
    path: `src/generated-${index}.js`,
  }));
  write(fixture.root, fixture.targetPath, fixture.target);
  const result = generate(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /500-file budget/);
});

test("reuse findings require both changed and reusable source locators", () => {
  const fixture = makeFixture({ maxWorkers: 6 });
  const finding = validFinding("reuse");
  setFindingForLens(fixture, "reuse", finding);
  const result = generate(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /changed-source and reusable-source locators/);

  finding.evidence.push({ kind: "source", ref: "skills/dev/references/model-profiles.json:1" });
  finding.id = findingId(finding);
  const valid = makeFixture({ maxWorkers: 6 });
  setFindingForLens(valid, "reuse", finding);
  const accepted = generate(valid, {
    reportPath: valid.roundReportPath,
    htmlPath: valid.roundHtmlPath,
  });
  assert.equal(accepted.ok, true, JSON.stringify(accepted.issues));
});

test("bug findings require corroboration and trace evidence requires a locator", () => {
  const fixture = makeFixture({ maxWorkers: 6 });
  const finding = validFinding("bug");
  finding.evidence = [{ kind: "source", ref: "src/example.js:1" }];
  finding.id = findingId(finding);
  setFindingForLens(fixture, "bug", finding);
  const uncorroborated = generate(fixture);
  assert.equal(uncorroborated.ok, false);
  assert.match(JSON.stringify(uncorroborated.issues), /bug requires source plus/);

  const trace = makeFixture({ maxWorkers: 6 });
  write(trace.root, ".pm/trace.json", { event: "observed" });
  finding.evidence.push({ kind: "trace", ref: "artifact:.pm/trace.json" });
  finding.id = findingId(finding);
  setFindingForLens(trace, "bug", finding);
  const missingLocator = generate(trace);
  assert.equal(missingLocator.ok, false);
  assert.match(JSON.stringify(missingLocator.issues), /artifact:<project-path>#locator/);

  const bound = makeFixture({ maxWorkers: 6 });
  write(bound.root, ".pm/trace.json", { event: "observed" });
  const traceBytes = fs.readFileSync(path.join(bound.root, ".pm/trace.json"));
  const tracedFinding = validFinding("bug");
  tracedFinding.evidence = [
    { kind: "source", ref: "src/example.js:1" },
    {
      kind: "trace",
      ref: "artifact:.pm/trace.json#observed",
      sha256: crypto.createHash("sha256").update(traceBytes).digest("hex"),
    },
  ];
  tracedFinding.id = findingId(tracedFinding);
  setFindingForLens(bound, "bug", tracedFinding);
  assert.equal(
    generate(bound, { reportPath: bound.roundReportPath, htmlPath: bound.roundHtmlPath }).ok,
    true
  );
  const tampered = JSON.parse(fs.readFileSync(path.join(bound.root, bound.resultPaths[0]), "utf8"));
  const signal = tampered.findings[0];
  if (signal) signal.evidence[1].sha256 = "0".repeat(64);
  fs.writeFileSync(
    path.join(bound.root, bound.resultPaths[0]),
    `${JSON.stringify(tampered, null, 2)}\n`
  );
  const drifted = generate(bound, {
    reportPath: bound.roundReportPath,
    htmlPath: bound.roundHtmlPath,
  });
  assert.equal(drifted.ok, false);
  assert.match(JSON.stringify(drifted.issues), /does not match artifact bytes/);
});

test("Git-backed evidence rejects irrelevant SHA-256 identity salt", () => {
  const fixture = makeFixture({ maxWorkers: 6 });
  const finding = validFinding("bug");
  finding.evidence[0].sha256 = "f".repeat(64);
  finding.id = findingId(finding);
  setFindingForLens(fixture, "bug", finding);
  const checked = generate(fixture);
  assert.equal(checked.ok, false);
  assert.match(JSON.stringify(checked.issues), /Git-backed evidence must not include sha256/);
});

test("deleted source evidence is checked against frozen base line bounds", () => {
  const fixture = makeFixture({ maxWorkers: 6, deleteFile: true });
  const finding = validFinding("edge");
  finding.file = "src/deleted.js";
  finding.line_start = 99;
  finding.line_end = 99;
  finding.evidence = [{ kind: "source", ref: "src/deleted.js:99" }];
  finding.id = findingId(finding);
  setFindingForLens(fixture, "edge", finding);
  const result = generate(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /line range exceeds file length/);
});

test("Review-owned blockers fail while QA-owned findings become non-blocking handoffs", () => {
  const blocked = makeFixture({ maxWorkers: 6 });
  const reviewFinding = validFinding("bug");
  setFindingForLens(blocked, "bug", reviewFinding);
  const failed = generate(blocked, {
    reportPath: blocked.roundReportPath,
    htmlPath: blocked.roundHtmlPath,
  });
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
  const blocked = generate(fixture, {
    reportPath: fixture.roundReportPath,
    htmlPath: fixture.roundHtmlPath,
  });
  assert.equal(blocked.ok, true, JSON.stringify(blocked.issues));
  assert.equal(blocked.report.outcome, "blocked");
  assert.deepEqual(blocked.report.unresolved_disagreements, [bug.id]);
  renderReviewReport({
    root: fixture.root,
    reportPath: fixture.roundReportPath,
    outputPath: fixture.roundHtmlPath,
  });
  const disputedHtml = fs.readFileSync(path.join(fixture.root, fixture.roundHtmlPath), "utf8");
  assert.match(disputedHtml, /owner qa/);
  assert.match(disputedHtml, /disposition open/);
  assert.match(disputedHtml, /fix behavioral/);
  assert.match(disputedHtml, /decision required no/);

  const decisionsPath = ".pm/dev-sessions/example/review/runs/review-test/round-1/decisions.json";
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
  renderReviewReport({
    root: fixture.root,
    reportPath: fixture.reportPath,
    outputPath: fixture.htmlPath,
  });
  const html = fs.readFileSync(path.join(fixture.root, fixture.htmlPath), "utf8");
  assert.match(html, /handoff-qa/);
  assert.match(html, /Maintainer/);
  assert.match(html, /depends on the live runtime flow/);
});

test("draft synthesis remains replaceable until a non-passing decision is finalized", () => {
  const fixture = makeFixture({ maxWorkers: 6 });
  const bug = validFinding("bug");
  setFindingForLens(fixture, "bug", bug);
  const draftReport = ".pm/dev-sessions/example/review/runs/review-test/round-1/draft-report.json";
  const draftHtml = ".pm/dev-sessions/example/review/runs/review-test/round-1/draft-report.html";
  const draft = generate(fixture, {
    reportPath: draftReport,
    htmlPath: draftHtml,
    reportStage: "draft",
  });
  assert.equal(draft.ok, true, JSON.stringify(draft.issues));
  renderReviewReport({ root: fixture.root, reportPath: draftReport, outputPath: draftHtml });

  const decisionsPath = ".pm/dev-sessions/example/review/runs/review-test/round-1/decisions.json";
  write(fixture.root, decisionsPath, {
    schema_version: 1,
    run_id: fixture.target.run_id,
    review_round: 1,
    target: binding(fixture.root, fixture.targetPath),
    decisions: [
      {
        finding_id: bug.id,
        approver: "Maintainer",
        action: "defer",
        rationale: "Track this blocker outside the current delivery window.",
        decided_at: "2026-07-12T00:06:00Z",
      },
    ],
    checked_at: "2026-07-12T00:06:00Z",
  });
  const final = generate(fixture, {
    decisionsPath,
    reportPath: fixture.roundReportPath,
    htmlPath: fixture.roundHtmlPath,
    reportStage: "final",
  });
  assert.equal(final.ok, true, JSON.stringify(final.issues));
  assert.equal(final.report.outcome, "blocked");
  assert.equal(final.report.findings[0].decision.action, "defer");
});

test("blocked reports surface deferred blockers and stop at the iteration cap", () => {
  const deferred = { ...validFinding("bug"), disposition: "deferred" };
  const deferredReport = buildCanonicalReport(
    { run_id: "review-test", review_round: 1, iteration_cap: 3, lenses: [] },
    { relative: "target.json", sha256: "a".repeat(64) },
    [],
    null,
    { findings: [deferred], unresolved_disagreements: [] },
    "report.html"
  );
  assert.equal(deferredReport.outcome, "blocked");
  assert.equal(deferredReport.top_issue, deferred.issue);
  assert.deepEqual(deferredReport.blockers, [deferred.id]);

  const blocker = validFinding("bug");
  const capReport = buildCanonicalReport(
    { run_id: "review-test", review_round: 3, iteration_cap: 3, lenses: [] },
    { relative: "target.json", sha256: "b".repeat(64) },
    [],
    null,
    { findings: [blocker], unresolved_disagreements: [] },
    "report.html"
  );
  assert.equal(capReport.outcome, "blocked");
  assert.match(capReport.next_action, /three-round cap/);
  assert.deepEqual(capReport.auto_fix_eligible, []);
});

test("later rounds reject a shallow hand-written prior report", () => {
  const fixture = makeFixture({ maxWorkers: 6 });
  setFindingForLens(fixture, "bug", validFinding("bug"));
  assert.equal(
    generate(fixture, {
      reportPath: fixture.roundReportPath,
      htmlPath: fixture.roundHtmlPath,
    }).ok,
    true
  );
  write(fixture.root, fixture.roundReportPath, {
    run_id: "review-test",
    review_round: 1,
    outcome: "failed",
  });
  fs.writeFileSync(path.join(fixture.root, "src/example.js"), "module.exports = { value: 3 };\n");
  git(fixture.root, ["add", "src/example.js"]);
  git(fixture.root, ["commit", "-qm", "round two source"]);
  assert.throws(
    () =>
      buildReviewTarget({
        root: fixture.root,
        maxWorkers: 3,
        profile: "codex-workhorse",
        runId: "review-test",
        round: 2,
        priorReportPath: fixture.roundReportPath,
      }),
    /valid source commit/
  );
});

test("prior-round evidence remains valid after the cited source is removed", () => {
  const fixture = makeFixture({ maxWorkers: 6 });
  setFindingForLens(fixture, "bug", validFinding("bug"));
  const roundOne = generate(fixture, {
    reportPath: fixture.roundReportPath,
    htmlPath: fixture.roundHtmlPath,
  });
  assert.equal(roundOne.ok, true, JSON.stringify(roundOne.issues));
  renderReviewReport({
    root: fixture.root,
    reportPath: fixture.roundReportPath,
    outputPath: fixture.roundHtmlPath,
  });
  fs.rmSync(path.join(fixture.root, "src/example.js"));
  git(fixture.root, ["add", "-A"]);
  git(fixture.root, ["commit", "-qm", "remove cited source"]);
  const target = buildReviewTarget({
    root: fixture.root,
    maxWorkers: 3,
    profile: "codex-workhorse",
    runId: "review-test",
    round: 2,
    priorReportPath: fixture.roundReportPath,
  });
  const targetPath = ".pm/dev-sessions/example/review/runs/review-test/round-2/target.json";
  write(fixture.root, targetPath, target);
  const checked = checkReview({
    root: fixture.root,
    targetPath,
    resultPaths: [],
    reportPath: ".pm/dev-sessions/example/review/runs/review-test/round-2/draft-report.json",
    humanReportPath: ".pm/dev-sessions/example/review/runs/review-test/round-2/draft-report.html",
    reportStage: "draft",
    writeReport: true,
    verifyBrowser: false,
  });
  assert.equal(checked.ok, false);
  assert.doesNotMatch(JSON.stringify(checked.issues), /target\.prior_report|frozen evidence/);
  assert.match(JSON.stringify(checked.issues), /missing planned reviewer/);
});

test("renderer escapes reviewer text without treating data as template syntax", () => {
  const fixture = makeFixture({ maxWorkers: 6 });
  const finding = validFinding("bug");
  finding.issue = "The <Component> exposes {{PLUGIN_VERSION}} as user data.";
  finding.id = findingId(finding);
  setFindingForLens(fixture, "bug", finding);
  const generated = generate(fixture, {
    reportPath: fixture.roundReportPath,
    htmlPath: fixture.roundHtmlPath,
  });
  assert.equal(generated.ok, true, JSON.stringify(generated.issues));
  assert.doesNotThrow(() =>
    renderReviewReport({
      root: fixture.root,
      reportPath: fixture.roundReportPath,
      outputPath: fixture.roundHtmlPath,
    })
  );
  const html = fs.readFileSync(path.join(fixture.root, fixture.roundHtmlPath), "utf8");
  assert.match(html, /The &lt;Component&gt; exposes {{PLUGIN_VERSION}} as user data\./);
});

test(
  "real Chromium keeps long reviewer-controlled prose inside the narrow viewport",
  {
    skip:
      (process.env.PM_SKIP_BROWSER_TESTS && "browser tests explicitly disabled") ||
      (!installedBrowser && "Chromium is not installed"),
  },
  () => {
    const fixture = makeFixture({ maxWorkers: 6 });
    const finding = validFinding("quality");
    const token = "A".repeat(900);
    finding.issue = token;
    finding.impact = token;
    finding.fix = token;
    finding.id = findingId(finding);
    setFindingForLens(fixture, "quality", finding);
    const generated = generate(fixture, {
      reportPath: fixture.roundReportPath,
      htmlPath: fixture.roundHtmlPath,
    });
    assert.equal(generated.ok, true, JSON.stringify(generated.issues));
    renderReviewReport({
      root: fixture.root,
      reportPath: fixture.roundReportPath,
      outputPath: fixture.roundHtmlPath,
    });
    assert.doesNotThrow(() =>
      renderArtifact({
        htmlPath: path.join(fixture.root, fixture.roundHtmlPath),
        outputDir: path.join(fixture.root, ".pm/long-token-render"),
        browserPath: installedBrowser,
      })
    );
    const negativeHtml = path.join(fixture.root, ".pm/long-token-negative.html");
    fs.writeFileSync(
      negativeHtml,
      fs
        .readFileSync(path.join(fixture.root, fixture.roundHtmlPath), "utf8")
        .replaceAll("overflow-wrap:anywhere", "overflow-wrap:normal")
    );
    assert.throws(
      () =>
        renderArtifact({
          htmlPath: negativeHtml,
          outputDir: path.join(fixture.root, ".pm/long-token-negative-render"),
          browserPath: installedBrowser,
        }),
      /horizontal document overflow/
    );
  }
);

test(
  "real Chromium verifies first-screen Review markers and their visible text",
  {
    skip:
      (process.env.PM_SKIP_BROWSER_TESTS && "browser tests explicitly disabled") ||
      (!installedBrowser && "Chromium is not installed"),
  },
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

function makeFixture({ maxWorkers, deleteFile = false, runScoped = true }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-review-check-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, "skills/dev/references"), { recursive: true });
  fs.writeFileSync(path.join(root, ".gitignore"), ".pm/\n");
  fs.writeFileSync(path.join(root, "src/example.js"), "module.exports = { value: 1 };\n");
  if (deleteFile)
    fs.writeFileSync(path.join(root, "src/deleted.js"), "module.exports = 'delete me';\n");
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
  if (deleteFile) fs.rmSync(path.join(root, "src/deleted.js"));
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "change"]);

  const target = buildReviewTarget({
    root,
    maxWorkers,
    profile: "codex-workhorse",
    runId: "review-test",
  });
  const evidenceRoot = runScoped
    ? ".pm/dev-sessions/example/review/runs/review-test"
    : ".pm/dev-sessions/example/review";
  const targetPath = `${evidenceRoot}/round-1/target.json`;
  write(root, targetPath, target);
  const targetBinding = binding(root, targetPath);
  const resultPaths = target.allocation.map((worker) => {
    const resultPath = `${evidenceRoot}/round-1/results/${worker.worker_id}.json`;
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
    roundReportPath: `${evidenceRoot}/round-1/report.json`,
    roundHtmlPath: `${evidenceRoot}/round-1/report.html`,
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
  if (category === "bug")
    finding.evidence.push({ kind: "contract", ref: "skills/dev/references/model-profiles.json:1" });
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
    reportPath: overrides.reportPath || fixture.reportPath,
    humanReportPath: overrides.htmlPath || fixture.htmlPath,
    decisionsPath: overrides.decisionsPath,
    reportStage: overrides.reportStage,
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
