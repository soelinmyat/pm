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
const { buildReviewTarget, changedFileInventory } = require("../scripts/review-target");
const { findingId } = require("../scripts/lib/review-contract");
const {
  expectedPriorReportPath,
  expectedReviewPath,
  reviewPathContext,
  reviewRootFromTargetPath,
} = require("../scripts/lib/review-paths");
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
  const targetPath = ".pm/dev-sessions/example/review/round-2/target.json";
  const reviewRoot = reviewRootFromTargetPath(targetPath, 2);
  assert.equal(reviewRoot, ".pm/dev-sessions/example/review");
  assert.equal(
    expectedReviewPath(reviewRoot, 2, "result", { workerId: "reviewer-3" }),
    ".pm/dev-sessions/example/review/round-2/results/reviewer-3.json"
  );
  assert.equal(
    expectedReviewPath(reviewRoot, 2, "report", { outcome: "failed" }),
    ".pm/dev-sessions/example/review/round-2/report.json"
  );
  assert.equal(
    expectedReviewPath(reviewRoot, 2, "report", { outcome: "passed" }),
    ".pm/dev-sessions/example/review/report.json"
  );
  assert.equal(
    expectedPriorReportPath(reviewRoot, 2),
    ".pm/dev-sessions/example/review/round-1/report.json"
  );
  assert.throws(
    () => reviewRootFromTargetPath(".pm/dev-sessions/example/review/target.json", 2),
    /round-2\/target\.json/
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
  const targetPath = ".pm/dev-sessions/example/review/round-2/target.json";
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
    reportPath: ".pm/dev-sessions/example/review/round-2/draft-report.json",
    humanReportPath: ".pm/dev-sessions/example/review/round-2/draft-report.html",
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

  const decisionsPath = ".pm/dev-sessions/example/review/round-1/decisions.json";
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
  const draftReport = ".pm/dev-sessions/example/review/round-1/draft-report.json";
  const draftHtml = ".pm/dev-sessions/example/review/round-1/draft-report.html";
  const draft = generate(fixture, {
    reportPath: draftReport,
    htmlPath: draftHtml,
    reportStage: "draft",
  });
  assert.equal(draft.ok, true, JSON.stringify(draft.issues));
  renderReviewReport({ root: fixture.root, reportPath: draftReport, outputPath: draftHtml });

  const decisionsPath = ".pm/dev-sessions/example/review/round-1/decisions.json";
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

function makeFixture({ maxWorkers, deleteFile = false, runScoped = false }) {
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
