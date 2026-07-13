"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  buildCanonicalReport,
  checkReview,
  expandFromReport,
  findingRenderChars,
  validateFrozenTarget,
  validateRenderedReportMarkers,
  validateSignal,
} = require("../scripts/review-check");
const { renderReviewReport } = require("../scripts/review-report");
const {
  buildReviewTarget,
  changedFileInventory,
  readCommittedBlob,
  resolveTrustedBase,
} = require("../scripts/review-target");
const { changeAnchorText, findingId } = require("../scripts/lib/review-contract");
const {
  MAX_CHANGED_FILE_BYTES,
  MAX_EVIDENCE_BYTES_PER_CHECK,
  MAX_EVIDENCE_PER_FINDING,
  MAX_FINDING_PROSE_CHARS,
  MAX_FINDING_RENDER_CHARS_PER_ROUND,
  MAX_FINDINGS_PER_REVIEWER,
  MAX_FINDINGS_PER_ROUND,
  MAX_JSON_BYTES,
} = require("../scripts/lib/review-limits");
const { createSession } = require("../scripts/lib/dev-session-schema");
const {
  expectedPriorReportPath,
  expectedReviewPath,
  reviewPathContext,
  reviewRootFromTargetPath,
} = require("../scripts/lib/review-paths");
const { renderArtifact, resolveBrowser } = require("../scripts/artifact-render-check");
const projectWriter = require("../scripts/lib/project-atomic-write");
const { writeProjectTextAtomic } = projectWriter;
const { readProjectInput } = require("../scripts/lib/safe-project-output");

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
  assert.equal(checked.validated_human_report.path, fixture.htmlPath);
  assert.equal(
    checked.validated_human_report.sha256,
    crypto
      .createHash("sha256")
      .update(fs.readFileSync(path.join(fixture.root, fixture.htmlPath)))
      .digest("hex")
  );
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

test("trusted base resolves remote HEAD instead of a stale tracking ref", () => {
  const fixture = makeFixture({ maxWorkers: 2 });
  const localTracking = git(fixture.root, ["rev-parse", "origin/main"]).trim();
  const remote = `${fixture.root}-origin.git`;
  execFileSync("git", [
    "--git-dir",
    remote,
    "fetch",
    fixture.root,
    `${fixture.target.source.commit}:refs/review-test/new-main`,
  ]);
  execFileSync("git", [
    "--git-dir",
    remote,
    "update-ref",
    "refs/heads/main",
    fixture.target.source.commit,
  ]);
  assert.equal(git(fixture.root, ["rev-parse", "origin/main"]).trim(), localTracking);

  const trusted = resolveTrustedBase(fixture.root);
  assert.equal(trusted.ref, "origin/main");
  assert.equal(trusted.commit, fixture.target.source.commit);
  assert.notEqual(trusted.commit, localTracking);
});

test("trusted base resolves the named destination remote", () => {
  const fixture = makeFixture({ maxWorkers: 2 });
  const remote = `${fixture.root}-origin.git`;
  git(fixture.root, ["remote", "add", "upstream", remote]);
  const trusted = resolveTrustedBase(fixture.root, "upstream");
  assert.equal(trusted.ref, "upstream/main");
  assert.match(trusted.commit, /^[a-f0-9]{40}$/);
  assert.throws(() => resolveTrustedBase(fixture.root, "../remote"), /configured remote name/);
  git(fixture.root, ["remote", "add", "foo+bar", remote]);
  assert.equal(resolveTrustedBase(fixture.root, "foo+bar").ref, "foo+bar/main");
  git(fixture.root, ["remote", "add", "--", "-foo", remote]);
  assert.equal(resolveTrustedBase(fixture.root, "-foo").ref, "-foo/main");
  const target = buildReviewTarget({ root: fixture.root, remote: "upstream", maxWorkers: 2 });
  assert.equal(target.source.base_ref, "upstream/main");
});

test("named-remote target passes live end-to-end review validation", () => {
  const fixture = makeFixture({ maxWorkers: 2, remote: "upstream" });
  const checked = checkReview({
    root: fixture.root,
    targetPath: fixture.targetPath,
    resultPaths: fixture.resultPaths,
    reportPath: fixture.reportPath,
    humanReportPath: fixture.htmlPath,
    writeReport: true,
    verifyBrowser: false,
  });
  assert.equal(checked.ok, true, JSON.stringify(checked.issues, null, 2));
  assert.equal(checked.target.source.base_ref, "upstream/main");
});

test("frozen review uses three-dot merge-base semantics on diverged branches", () => {
  const fixture = makeFixture({ maxWorkers: 2, deleteFile: true });
  const control = `${fixture.root}-control`;
  execFileSync("git", ["clone", "-q", `${fixture.root}-origin.git`, control]);
  try {
    git(control, ["config", "user.email", "test@example.com"]);
    git(control, ["config", "user.name", "Test"]);
    fs.rmSync(path.join(control, "src/deleted.js"));
    git(control, ["add", "-A"]);
    git(control, ["commit", "-qm", "default branch also removes deleted source"]);
    git(control, ["push", "-q", "origin", "main"]);

    const target = buildReviewTarget({ root: fixture.root, maxWorkers: 2 });
    assert.equal(target.changed_files.find((item) => item.path === "src/deleted.js").status, "D");
    const issues = [];
    validateFrozenTarget(fixture.root, target, issues);
    const finding = {
      ...validFinding("bug"),
      file: "src/deleted.js",
      line_start: 1,
      line_end: 1,
      evidence: [
        { kind: "source", ref: "src/deleted.js:1" },
        { kind: "contract", ref: "skills/dev/references/model-profiles.json:1" },
      ],
      change_anchors: [
        {
          path: "src/deleted.js",
          side: "base",
          line_start: 1,
          line_end: 1,
          affected_ref: "src/deleted.js:1",
          relation: "Removing the source export causes the reported contract failure.",
        },
      ],
    };
    finding.id = findingId(finding);
    assert.equal(
      validateSignal(fixture.root, finding, "reviewer-1", ["bug"], target, "finding", issues),
      true
    );
    assert.deepEqual(issues, []);
  } finally {
    fs.rmSync(control, { recursive: true, force: true });
  }
});

test("base-side evidence resolves through a renamed file's old path", () => {
  const fixture = makeFixture({ maxWorkers: 2, renameFile: true });
  try {
    const renamed = fixture.target.changed_files.find(
      (item) => item.path === "src/renamed.js" && item.old_path === "src/old-name.js"
    );
    assert.ok(renamed, JSON.stringify(fixture.target.changed_files, null, 2));
    const finding = {
      ...validFinding("edge"),
      file: "src/renamed.js",
      line_start: 2,
      line_end: 2,
      rule: "rename-removed-contract",
      evidence: [{ kind: "source", ref: "src/old-name.js:2" }],
      change_anchors: [
        {
          path: "src/old-name.js",
          side: "base",
          line_start: 2,
          line_end: 2,
          affected_ref: "src/old-name.js:2",
          relation: "Removing the old renamed-file contract line causes the reported edge failure.",
        },
      ],
    };
    finding.id = findingId(finding);
    const issues = [];
    validateFrozenTarget(fixture.root, fixture.target, issues);
    validateSignal(
      fixture.root,
      finding,
      "reviewer-2",
      ["edge"],
      fixture.target,
      "finding",
      issues
    );
    assert.deepEqual(issues, []);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
    fs.rmSync(`${fixture.root}-origin.git`, { recursive: true, force: true });
  }
});

test("modified-file base anchors resolve evidence from the merge-base side", () => {
  const fixture = makeFixture({ maxWorkers: 2, removeLine: true });
  const finding = {
    ...validFinding("edge"),
    evidence: [{ kind: "source", ref: "src/example.js:2" }],
    change_anchors: [
      {
        path: "src/example.js",
        side: "base",
        line_start: 2,
        line_end: 2,
        affected_ref: "src/example.js:2",
        relation: "Removing the second source line causes the reported edge failure.",
      },
    ],
  };
  finding.id = findingId(finding);
  const issues = [];
  validateFrozenTarget(fixture.root, fixture.target, issues);
  validateSignal(fixture.root, finding, "reviewer-2", ["edge"], fixture.target, "finding", issues);
  assert.deepEqual(issues, []);
});

test("rename anchors cannot swap current and old path sides", () => {
  const fixture = makeFixture({ maxWorkers: 2, renameFile: true });
  const finding = {
    ...validFinding("edge"),
    file: "src/renamed.js",
    line_start: 2,
    line_end: 2,
    evidence: [{ kind: "source", ref: "src/old-name.js:2" }],
    change_anchors: [
      {
        path: "src/old-name.js",
        side: "head",
        line_start: 2,
        line_end: 2,
        affected_ref: "src/old-name.js:2",
        relation: "This deliberately binds a head anchor to the old rename path.",
      },
    ],
  };
  finding.id = findingId(finding);
  const issues = [];
  validateSignal(fixture.root, finding, "reviewer-2", ["edge"], fixture.target, "finding", issues);
  assert.match(JSON.stringify(issues), /head anchors must use the frozen current path/);
});

test("changed-hunk policy accepts a stable primary line only with a causal hunk anchor", () => {
  const fixture = makeFixture({ maxWorkers: 2, multiline: true });
  const target = fixture.target;
  const finding = {
    ...validFinding("bug"),
    line_start: 1,
    line_end: 1,
    evidence: [
      { kind: "source", ref: "src/example.js:1" },
      { kind: "source", ref: "src/example.js:2" },
      { kind: "contract", ref: "skills/dev/references/model-profiles.json:1" },
    ],
    change_anchors: [
      {
        path: "src/example.js",
        side: "head",
        line_start: 2,
        line_end: 2,
        affected_ref: "src/example.js:1",
        relation: "The changed export value alters the stable declaration's observable contract.",
      },
    ],
  };
  finding.id = findingId(finding);
  const accepted = [];
  validateFrozenTarget(fixture.root, target, accepted);
  assert.equal(
    validateSignal(fixture.root, finding, "reviewer-1", ["bug"], target, "finding", accepted),
    true
  );
  assert.deepEqual(accepted, []);

  finding.change_anchors = [
    {
      path: "src/example.js",
      side: "head",
      line_start: 1,
      line_end: 1,
      affected_ref: "src/example.js:1",
      relation: "The cited unchanged line is not the causal change.",
    },
  ];
  const rejected = [];
  validateSignal(fixture.root, finding, "reviewer-1", ["bug"], target, "finding", rejected);
  assert.match(JSON.stringify(rejected), /does not intersect a head changed hunk/);
});

test("changed-hunk policy authenticates additions, deletions, and non-textual path changes", () => {
  const fixture = makeFixture({ maxWorkers: 2, deleteFile: true });
  fs.writeFileSync(path.join(fixture.root, "src/added.js"), "module.exports = 'added';\n");
  fs.writeFileSync(path.join(fixture.root, "src/binary.dat"), Buffer.from([0, 1, 2, 3]));
  git(fixture.root, ["add", "src/added.js", "src/binary.dat"]);
  git(fixture.root, ["commit", "-qm", "add textual and binary sources"]);
  const target = buildReviewTarget({ root: fixture.root, maxWorkers: 2 });
  const frozenIssues = [];
  validateFrozenTarget(fixture.root, target, frozenIssues);
  assert.deepEqual(frozenIssues, []);

  for (const specimen of [
    {
      file: "src/added.js",
      evidence: "src/added.js:1",
      anchor: {
        path: "src/added.js",
        side: "head",
        line_start: 1,
        line_end: 1,
        affected_ref: "src/added.js:1",
        relation: "The added export creates the reported contract behavior.",
      },
    },
    {
      file: "src/deleted.js",
      evidence: "src/deleted.js:1",
      anchor: {
        path: "src/deleted.js",
        side: "base",
        line_start: 1,
        line_end: 1,
        affected_ref: "src/deleted.js:1",
        relation: "Removing the export creates the reported missing behavior.",
      },
    },
    {
      file: "src/added.js",
      evidence: "src/added.js:1",
      anchor: {
        path: "src/binary.dat",
        side: "path",
        affected_ref: "src/added.js:1",
        relation: "The binary payload is consumed by the added module at the affected locator.",
      },
    },
  ]) {
    const finding = {
      ...validFinding("bug"),
      file: specimen.file,
      evidence: [
        { kind: "source", ref: specimen.evidence },
        { kind: "contract", ref: "skills/dev/references/model-profiles.json:1" },
      ],
      change_anchors: [specimen.anchor],
    };
    finding.id = findingId(finding);
    const issues = [];
    assert.equal(
      validateSignal(fixture.root, finding, "reviewer-1", ["bug"], target, "finding", issues),
      true
    );
    assert.deepEqual(issues, []);
  }

  const crossFile = {
    ...validFinding("bug"),
    file: "src/added.js",
    evidence: [
      { kind: "source", ref: "src/added.js:1" },
      { kind: "source", ref: "src/example.js:1" },
      { kind: "contract", ref: "skills/dev/references/model-profiles.json:1" },
    ],
    change_anchors: [
      {
        path: "src/example.js",
        side: "head",
        line_start: 1,
        line_end: 1,
        affected_ref: "src/added.js:1",
        relation: "The changed producer value breaks the consumer at the affected locator.",
      },
    ],
  };
  crossFile.id = findingId(crossFile);
  const crossFileIssues = [];
  assert.equal(
    validateSignal(
      fixture.root,
      crossFile,
      "reviewer-1",
      ["bug"],
      target,
      "finding",
      crossFileIssues
    ),
    true
  );
  assert.deepEqual(crossFileIssues, []);

  const unrelated = {
    ...validFinding("bug"),
    file: "src/added.js",
    evidence: [
      { kind: "source", ref: "src/added.js:1" },
      { kind: "contract", ref: "skills/dev/references/model-profiles.json:1" },
    ],
    change_anchors: [
      {
        path: "src/example.js",
        side: "head",
        line_start: 1,
        line_end: 1,
        affected_ref: "src/added.js:1",
        relation: "Claims an unrelated changed export caused the added module defect.",
      },
    ],
  };
  unrelated.id = findingId(unrelated);
  const unrelatedIssues = [];
  validateSignal(
    fixture.root,
    unrelated,
    "reviewer-1",
    ["bug"],
    target,
    "finding",
    unrelatedIssues
  );
  assert.match(JSON.stringify(unrelatedIssues), /overlapping Git-backed evidence on the same path/);

  const unboundPath = {
    ...unrelated,
    change_anchors: [
      {
        path: "src/binary.dat",
        side: "path",
        affected_ref: "src/missing.js:1",
        relation: "Claims a cross-file effect without binding its affected locator.",
      },
    ],
  };
  const unboundIssues = [];
  validateSignal(
    fixture.root,
    unboundPath,
    "reviewer-1",
    ["bug"],
    target,
    "finding",
    unboundIssues
  );
  assert.match(JSON.stringify(unboundIssues), /must exactly bind the finding primary locator/);

  const oversizedRelation = {
    ...unrelated,
    change_anchors: [
      {
        path: "src/binary.dat",
        side: "path",
        affected_ref: "src/added.js:1",
        relation: "x".repeat(501),
      },
    ],
  };
  const oversizedRelationIssues = [];
  validateSignal(
    fixture.root,
    oversizedRelation,
    "reviewer-1",
    ["bug"],
    target,
    "finding",
    oversizedRelationIssues
  );
  assert.match(JSON.stringify(oversizedRelationIssues), /must not exceed 500 characters/);
});

test("legacy targets remain readable without change anchors", () => {
  const fixture = makeFixture({ maxWorkers: 2 });
  const target = structuredClone(fixture.target);
  delete target.relevance_policy;
  const finding = validFinding("bug");
  delete finding.change_anchors;
  const issues = [];
  validateFrozenTarget(fixture.root, target, issues);
  assert.equal(
    validateSignal(fixture.root, finding, "reviewer-1", ["bug"], target, "finding", issues),
    true
  );
  assert.deepEqual(issues, []);
});

test("legacy targets cannot publish an authoritative final passing report", () => {
  const fixture = makeFixture({ maxWorkers: 2 });
  const target = structuredClone(fixture.target);
  delete target.relevance_policy;
  write(fixture.root, fixture.targetPath, target);
  const targetBinding = binding(fixture.root, fixture.targetPath);
  for (const resultPath of fixture.resultPaths) {
    const absolute = path.join(fixture.root, resultPath);
    const result = JSON.parse(fs.readFileSync(absolute, "utf8"));
    result.target = targetBinding;
    fs.writeFileSync(absolute, `${JSON.stringify(result, null, 2)}\n`);
  }
  const checked = generate(fixture);
  assert.equal(checked.ok, false);
  assert.match(JSON.stringify(checked.issues), /legacy targets are inspection-only/);
});

test("Git-backed evidence rejects the phantom line after a trailing newline", () => {
  const fixture = makeFixture({ maxWorkers: 2 });
  const finding = validFinding("bug");
  finding.evidence.push({ kind: "source", ref: "src/example.js:2" });
  finding.id = findingId(finding);
  const issues = [];
  validateSignal(fixture.root, finding, "reviewer-1", ["bug"], fixture.target, "finding", issues);
  assert.match(JSON.stringify(issues), /line range exceeds file length 1/);
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

test("Dev-routed targets require the canonical sibling session and routed mode", () => {
  const fixture = makeFixture({ maxWorkers: 2 });
  const session = createSession({
    slug: "example",
    sourceDir: fixture.root,
    runId: "dev_example",
  });
  const canonical = ".pm/dev-sessions/example/session.json";
  write(fixture.root, canonical, session);
  const options = {
    root: fixture.root,
    maxWorkers: 2,
    runId: "bound-review",
    mode: "full",
    outPath: ".pm/dev-sessions/example/review/runs/bound-review/round-1/target.json",
    devSessionPath: canonical,
  };
  const target = buildReviewTarget(options);
  assert.equal(target.dev_context.slug, "example");
  assert.equal(target.dev_context.review_mode, "full");

  const alias = ".pm/dev-sessions/example/session-copy.json";
  write(fixture.root, alias, session);
  assert.throws(
    () => buildReviewTarget({ ...options, devSessionPath: alias }),
    /canonical sibling session\.json/
  );
  assert.throws(
    () =>
      buildReviewTarget({
        ...options,
        outPath: ".pm/dev-sessions/other/review/runs/bound-review/round-1/target.json",
      }),
    /slug must equal target namespace other/
  );
  assert.throws(
    () => buildReviewTarget({ ...options, mode: "code-scan" }),
    /review mode must equal the requested target mode/
  );
});

test("Design Critique bindings must attest the current review commit", () => {
  const fixture = makeFixture({ maxWorkers: 2 });
  const designPath = ".pm/design-critique/report.json";
  write(fixture.root, designPath, {
    commit: fixture.target.source.base_commit,
    outcome: "passed",
  });
  assert.throws(
    () =>
      buildReviewTarget({
        root: fixture.root,
        maxWorkers: 2,
        designCritiquePath: designPath,
      }),
    /must attest current HEAD/
  );

  write(fixture.root, designPath, {
    commit: fixture.target.source.commit,
    outcome: "passed",
  });
  const current = buildReviewTarget({
    root: fixture.root,
    maxWorkers: 2,
    designCritiquePath: designPath,
  });
  assert.equal(current.upstream.design_critique.commit, current.source.commit);
});

test("review checking rejects a target with stale Design Critique evidence", () => {
  const fixture = makeFixture({ maxWorkers: 2 });
  const designPath = ".pm/design-critique/report.json";
  write(fixture.root, designPath, {
    commit: fixture.target.source.base_commit,
    outcome: "passed",
  });
  fixture.target.upstream.design_critique = {
    ...binding(fixture.root, designPath),
    commit: fixture.target.source.base_commit,
    outcome: "passed",
  };
  write(fixture.root, fixture.targetPath, fixture.target);
  const result = generate(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /must attest the target source commit/);
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

test("review I/O rejects symlinked path ancestors", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-review-output-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "pm-review-outside-"));
  fs.mkdirSync(path.join(root, ".pm"), { recursive: true });
  fs.symlinkSync(outside, path.join(root, ".pm", "linked"));
  assert.throws(
    () => writeProjectTextAtomic(root, ".pm/linked/report.json", "unsafe"),
    /not a real directory/
  );
  fs.symlinkSync(path.join(outside, "missing"), path.join(root, ".pm", "dangling"));
  assert.throws(
    () => writeProjectTextAtomic(root, ".pm/dangling/report.json", "unsafe"),
    /not a real directory/
  );
  fs.writeFileSync(path.join(outside, "evidence.json"), "{}\n");
  assert.throws(() => readProjectInput(root, ".pm/linked/evidence.json"), /contains symlink/);
});

test("from-report reads once through a descriptor and rejects symlinked or oversized input", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-review-resume-"));
  const reportPath = ".pm/review/report.json";
  const absolute = path.join(root, reportPath);
  write(root, reportPath, {
    target: { path: ".pm/original-target.json" },
    results: [{ path: ".pm/original-result.json" }],
  });

  const originalReadSync = fs.readSync;
  let swapped = false;
  fs.readSync = function descriptorBoundRead(descriptor, ...args) {
    if (!swapped) {
      swapped = true;
      fs.renameSync(absolute, `${absolute}.opened`);
      write(root, reportPath, {
        target: { path: ".pm/replacement-target.json" },
        results: [{ path: ".pm/replacement-result.json" }],
      });
    }
    return originalReadSync.call(this, descriptor, ...args);
  };
  try {
    const expanded = expandFromReport({ root, reportPath, fromReport: true });
    assert.equal(expanded.targetPath, ".pm/original-target.json");
    assert.deepEqual(expanded.resultPaths, [".pm/original-result.json"]);
  } finally {
    fs.readSync = originalReadSync;
  }

  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "pm-review-resume-outside-"));
  write(outside, "report.json", {
    target: { path: ".pm/outside-target.json" },
    results: [{ path: ".pm/outside-result.json" }],
  });
  fs.symlinkSync(outside, path.join(root, ".pm/linked"));
  assert.throws(
    () => expandFromReport({ root, reportPath: ".pm/linked/report.json", fromReport: true }),
    /contains symlink/
  );

  fs.writeFileSync(path.join(root, ".pm/oversized.json"), Buffer.alloc(MAX_JSON_BYTES + 1));
  assert.throws(
    () => expandFromReport({ root, reportPath: ".pm/oversized.json", fromReport: true }),
    /input exceeds .*byte budget/
  );
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

test("target validation re-derives lens applicability from the frozen diff", () => {
  const fixture = makeFixture({ maxWorkers: 6 });
  const bugLens = fixture.target.lenses.find((item) => item.name === "bug");
  bugLens.applicable = false;
  bugLens.reason = "caller claimed this lens was unnecessary";
  write(fixture.root, fixture.targetPath, fixture.target);
  const rebound = binding(fixture.root, fixture.targetPath);
  for (const resultPath of fixture.resultPaths) {
    const absolute = path.join(fixture.root, resultPath);
    const result = JSON.parse(fs.readFileSync(absolute, "utf8"));
    result.target = rebound;
    fs.writeFileSync(absolute, `${JSON.stringify(result, null, 2)}\n`);
  }
  const checked = generate(fixture);
  assert.equal(checked.ok, false);
  assert.match(JSON.stringify(checked.issues), /lens bug applicability must match the frozen diff/);
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

test("evidence count and duplicate identities fail before locator resolution", () => {
  const duplicateFixture = makeFixture({ maxWorkers: 6 });
  const duplicate = validFinding("edge");
  const missing = {
    kind: "trace",
    ref: "artifact:.pm/missing-trace.json#event",
    sha256: "0".repeat(64),
  };
  duplicate.evidence = [missing, { ...missing }];
  duplicate.id = findingId(duplicate);
  let issues = [];
  validateSignal(
    duplicateFixture.root,
    duplicate,
    "reviewer-edge",
    ["edge"],
    duplicateFixture.target,
    "finding",
    issues
  );
  assert.match(JSON.stringify(issues), /duplicates evidence/);
  assert.doesNotMatch(JSON.stringify(issues), /ENOENT|cannot resolve frozen evidence/);

  const overFixture = makeFixture({ maxWorkers: 6 });
  const over = validFinding("edge");
  over.evidence = Array.from({ length: MAX_EVIDENCE_PER_FINDING + 1 }, (_, index) => ({
    kind: "trace",
    ref: `artifact:.pm/missing-trace.json#event-${index}`,
    sha256: "0".repeat(64),
  }));
  over.id = findingId(over);
  issues = [];
  validateSignal(
    overFixture.root,
    over,
    "reviewer-edge",
    ["edge"],
    overFixture.target,
    "finding",
    issues
  );
  assert.match(JSON.stringify(issues), new RegExp(`at most ${MAX_EVIDENCE_PER_FINDING}`));
  assert.doesNotMatch(JSON.stringify(issues), /ENOENT|cannot resolve frozen evidence/);
});

test("distinct artifact locators share one descriptor-bound read per check", () => {
  const fixture = makeFixture({ maxWorkers: 6 });
  const events = Array.from(
    { length: MAX_EVIDENCE_PER_FINDING - 1 },
    (_, index) => `event-${index}`
  );
  write(fixture.root, ".pm/trace.json", { events });
  const tracePath = path.join(fixture.root, ".pm/trace.json");
  const realTracePath = fs.realpathSync(tracePath);
  const sha256 = crypto.createHash("sha256").update(fs.readFileSync(tracePath)).digest("hex");
  const finding = validFinding("edge");
  finding.evidence = [
    { kind: "source", ref: "src/example.js:1" },
    ...events.map((event) => ({
      kind: "trace",
      ref: `artifact:.pm/trace.json#${event}`,
      sha256,
    })),
  ];
  finding.id = findingId(finding);

  const originalOpenSync = fs.openSync;
  let artifactOpens = 0;
  fs.openSync = function countedOpen(file, ...args) {
    if (path.resolve(String(file)) === realTracePath) artifactOpens += 1;
    return originalOpenSync.call(this, file, ...args);
  };
  const issues = [];
  try {
    validateSignal(
      fixture.root,
      finding,
      "reviewer-edge",
      ["edge"],
      fixture.target,
      "finding",
      issues
    );
  } finally {
    fs.openSync = originalOpenSync;
  }
  assert.deepEqual(issues, []);
  assert.equal(artifactOpens, 1);
});

test("review evidence aggregate bytes accept the exact boundary and reject one byte above", () => {
  const fixture = makeFixture({ maxWorkers: 6 });
  const tracePath = path.join(fixture.root, ".pm/evidence-boundary.bin");
  fs.mkdirSync(path.dirname(tracePath), { recursive: true });
  const primaryBytes = fixture.target.changed_files.find(
    (item) => item.path === "src/example.js"
  ).bytes;
  const exactArtifactBytes = MAX_EVIDENCE_BYTES_PER_CHECK - primaryBytes;

  function writeSizedTrace(bytes) {
    fs.writeFileSync(tracePath, "evidence-boundary");
    fs.truncateSync(tracePath, bytes);
    return crypto.createHash("sha256").update(fs.readFileSync(tracePath)).digest("hex");
  }

  function boundaryFinding(sha256) {
    const finding = validFinding("edge");
    finding.evidence = [
      { kind: "source", ref: "src/example.js:1" },
      {
        kind: "trace",
        ref: "artifact:.pm/evidence-boundary.bin#evidence-boundary",
        sha256,
      },
    ];
    finding.id = findingId(finding);
    return finding;
  }

  let issues = [];
  let finding = boundaryFinding(writeSizedTrace(exactArtifactBytes));
  validateSignal(
    fixture.root,
    finding,
    "reviewer-edge",
    ["edge"],
    fixture.target,
    "finding",
    issues
  );
  assert.deepEqual(issues, []);

  const freshTarget = structuredClone(fixture.target);
  finding = boundaryFinding(writeSizedTrace(exactArtifactBytes + 1));
  issues = [];
  validateSignal(fixture.root, finding, "reviewer-edge", ["edge"], freshTarget, "finding", issues);
  assert.match(JSON.stringify(issues), /aggregate byte budget/);
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
    (target) => (target.mode = "unknown"),
    (target) => (target.changed_files = { path: "src/example.js" }),
    (target) => (target.changed_files = [null]),
  ]) {
    const fixture = makeFixture({ maxWorkers: 3 });
    mutation(fixture.target);
    write(fixture.root, fixture.targetPath, fixture.target);
    let result;
    assert.doesNotThrow(() => {
      result = generate(fixture);
    });
    assert.equal(result.ok, false);
    assert.match(JSON.stringify(result.issues), /target\.(lenses|allocation|mode|changed_files)/);
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

test("reviewer finding floods fail closed before conflict synthesis", () => {
  const fixture = makeFixture({ maxWorkers: 3 });
  const resultPath = fixture.resultPaths[0];
  const absolute = path.join(fixture.root, resultPath);
  const result = JSON.parse(fs.readFileSync(absolute, "utf8"));
  result.findings = uniqueFindings(result.lenses[0], MAX_FINDINGS_PER_REVIEWER + 1);
  fs.writeFileSync(absolute, `${JSON.stringify(result)}\n`);
  const checked = generate(fixture);
  assert.equal(checked.ok, false);
  assert.match(
    JSON.stringify(checked.issues),
    new RegExp(`at most ${MAX_FINDINGS_PER_REVIEWER} findings`)
  );
});

test("reviewer, round, and rendered-text budgets accept their combined exact boundary", () => {
  const fixture = makeFixture({ maxWorkers: 3 });
  const resultPath = fixture.resultPaths[0];
  const absolute = path.join(fixture.root, resultPath);
  const result = JSON.parse(fs.readFileSync(absolute, "utf8"));
  const lens = result.lenses[0];
  result.findings = maximumRenderBudgetFindings(lens, "boundary");
  assert.equal(result.findings.length, MAX_FINDINGS_PER_ROUND);
  assert.equal(
    result.findings.reduce((sum, finding) => sum + findingRenderChars(finding), 0),
    MAX_FINDING_RENDER_CHARS_PER_ROUND
  );
  result.verdicts.find((verdict) => verdict.lens === lens).outcome = "findings";
  fs.writeFileSync(absolute, `${JSON.stringify(result)}\n`);

  const checked = generate(fixture, {
    reportPath: fixture.roundReportPath,
    htmlPath: fixture.roundHtmlPath,
  });
  assert.equal(checked.ok, true, JSON.stringify(checked.issues, null, 2));
  assert.equal(checked.report.findings.length, MAX_FINDINGS_PER_ROUND);
});

test("aggregate round finding floods fail even when each reviewer stays within budget", () => {
  const fixture = makeFixture({ maxWorkers: 6 });
  const firstCount = Math.ceil(MAX_FINDINGS_PER_ROUND / 2);
  const counts = [firstCount, MAX_FINDINGS_PER_ROUND - firstCount + 1];
  for (const [index, count] of counts.entries()) {
    const absolute = path.join(fixture.root, fixture.resultPaths[index]);
    const result = JSON.parse(fs.readFileSync(absolute, "utf8"));
    const lens = result.lenses[0];
    result.findings = uniqueFindings(lens, count, `round-${index}`);
    result.verdicts.find((verdict) => verdict.lens === lens).outcome = "findings";
    fs.writeFileSync(absolute, `${JSON.stringify(result)}\n`);
  }

  const checked = generate(fixture);
  assert.equal(checked.ok, false);
  assert.match(
    JSON.stringify(checked.issues),
    new RegExp(`round must contain at most ${MAX_FINDINGS_PER_ROUND} findings`)
  );
});

test("finding prose budgets reject one oversized field and aggregate wrapping text", () => {
  let fixture = makeFixture({ maxWorkers: 6 });
  const finding = validFinding("quality");
  finding.issue = "x".repeat(MAX_FINDING_PROSE_CHARS + 1);
  finding.id = findingId(finding);
  setFindingForLens(fixture, "quality", finding);
  let checked = generate(fixture);
  assert.equal(checked.ok, false);
  assert.match(
    JSON.stringify(checked.issues),
    new RegExp(`must not exceed ${MAX_FINDING_PROSE_CHARS} characters`)
  );

  fixture = makeFixture({ maxWorkers: 6 });
  const resultPath = fixture.resultPaths.find((relative) => {
    const result = JSON.parse(fs.readFileSync(path.join(fixture.root, relative), "utf8"));
    return result.lenses.includes("quality");
  });
  const absolute = path.join(fixture.root, resultPath);
  const result = JSON.parse(fs.readFileSync(absolute, "utf8"));
  result.findings = uniqueFindings("quality", 5, "text-budget").map((item) => {
    item.impact = "x".repeat(1_700);
    item.id = findingId(item);
    return item;
  });
  result.verdicts.find((verdict) => verdict.lens === "quality").outcome = "findings";
  fs.writeFileSync(absolute, `${JSON.stringify(result)}\n`);
  checked = generate(fixture);
  assert.equal(checked.ok, false);
  assert.match(
    JSON.stringify(checked.issues),
    new RegExp(`must not exceed ${MAX_FINDING_RENDER_CHARS_PER_ROUND} rendered characters`)
  );
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

test("changed-file aggregate byte budget accepts the boundary and fails closed above it", () => {
  const fixture = makeFixture({ maxWorkers: 3 });
  const committedBytes = fixture.target.changed_files[0].bytes;
  assert.equal(
    readCommittedBlob(
      fixture.root,
      fixture.target.source.commit,
      fixture.target.changed_files[0].path,
      committedBytes
    ).length,
    committedBytes
  );
  assert.throws(
    () =>
      readCommittedBlob(
        fixture.root,
        fixture.target.source.commit,
        fixture.target.changed_files[0].path,
        committedBytes - 1
      ),
    /aggregate committed-byte budget/
  );
  fixture.target.changed_files[0].bytes = MAX_CHANGED_FILE_BYTES;
  write(fixture.root, fixture.targetPath, fixture.target);
  let result = generate(fixture);
  assert.doesNotMatch(JSON.stringify(result.issues), /aggregate committed-byte budget/);

  fixture.target.changed_files[0].bytes = MAX_CHANGED_FILE_BYTES + 1;
  write(fixture.root, fixture.targetPath, fixture.target);
  result = generate(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /aggregate committed-byte budget/);
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

test("reviewer signals cannot dismiss their own findings", () => {
  const fixture = makeFixture({ maxWorkers: 6 });
  const finding = { ...validFinding("bug"), disposition: "dismissed" };
  finding.id = findingId(finding);
  setFindingForLens(fixture, "bug", finding);
  const checked = generate(fixture);
  assert.equal(checked.ok, false);
  assert.match(JSON.stringify(checked.issues), /only decisions may dismiss/);
});

test("upstream-gate evidence must attest the current review commit", () => {
  const stale = makeFixture({ maxWorkers: 6 });
  const gatePath = ".pm/gates/design-critique.json";
  write(stale.root, gatePath, {
    commit: stale.target.source.base_commit,
    outcome: "passed",
  });
  const staleFinding = validFinding("quality");
  staleFinding.evidence.push({
    kind: "upstream-gate",
    ref: gatePath,
    sha256: binding(stale.root, gatePath).sha256,
  });
  staleFinding.id = findingId(staleFinding);
  setFindingForLens(stale, "quality", staleFinding);
  const rejected = generate(stale, {
    reportPath: stale.roundReportPath,
    htmlPath: stale.roundHtmlPath,
  });
  assert.equal(rejected.ok, false);
  assert.match(JSON.stringify(rejected.issues), /commit must equal the target source commit/);

  const missing = makeFixture({ maxWorkers: 6 });
  write(missing.root, gatePath, { outcome: "passed" });
  const missingFinding = validFinding("quality");
  missingFinding.evidence.push({
    kind: "upstream-gate",
    ref: gatePath,
    sha256: binding(missing.root, gatePath).sha256,
  });
  missingFinding.id = findingId(missingFinding);
  setFindingForLens(missing, "quality", missingFinding);
  const unattested = generate(missing, {
    reportPath: missing.roundReportPath,
    htmlPath: missing.roundHtmlPath,
  });
  assert.equal(unattested.ok, false);
  assert.match(JSON.stringify(unattested.issues), /requires a valid commit attestation/);

  const current = makeFixture({ maxWorkers: 6 });
  write(current.root, gatePath, {
    commit: current.target.source.commit,
    outcome: "passed",
  });
  const currentFinding = validFinding("quality");
  currentFinding.evidence.push({
    kind: "upstream-gate",
    ref: gatePath,
    sha256: binding(current.root, gatePath).sha256,
  });
  currentFinding.id = findingId(currentFinding);
  setFindingForLens(current, "quality", currentFinding);
  const accepted = generate(current, {
    reportPath: current.roundReportPath,
    htmlPath: current.roundHtmlPath,
  });
  assert.equal(accepted.ok, true, JSON.stringify(accepted.issues));
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

test("reviewer signals cannot self-route Review-owned findings into non-blocking handoffs", () => {
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
  assert.equal(passed.ok, false);
  assert.match(JSON.stringify(passed.issues), /reviewer signals must remain Review-owned/);
});

test("material reviewer disagreement blocks until an explicit decision", () => {
  const fixture = makeFixture({ maxWorkers: 6 });
  const draftReport = ".pm/dev-sessions/example/review/runs/review-test/round-1/draft-report.json";
  const draftHtml = ".pm/dev-sessions/example/review/runs/review-test/round-1/draft-report.html";
  const bug = validFinding("bug");
  const edge = {
    ...bug,
    category: "edge",
    severity: "low",
    impact: "The live flow may recover differently than the static path suggests.",
  };
  edge.id = findingId(edge);
  assert.equal(edge.id, bug.id);
  setFindingForLens(fixture, "bug", bug);
  setFindingForLens(fixture, "edge", edge);
  const blocked = generate(fixture, {
    reportPath: draftReport,
    htmlPath: draftHtml,
    reportStage: "draft",
  });
  assert.equal(blocked.ok, true, JSON.stringify(blocked.issues));
  assert.equal(blocked.report.outcome, "blocked");
  assert.deepEqual(blocked.report.unresolved_disagreements, [bug.id]);
  renderReviewReport({
    root: fixture.root,
    reportPath: draftReport,
    outputPath: draftHtml,
  });
  const disputedHtml = fs.readFileSync(path.join(fixture.root, draftHtml), "utf8");
  assert.match(disputedHtml, /owner review/);
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
  const decided = generate(fixture, {
    decisionsPath,
    reportPath: draftReport,
    htmlPath: draftHtml,
    reportStage: "draft",
  });
  assert.equal(decided.ok, true, JSON.stringify(decided.issues));
  assert.equal(decided.report.outcome, "blocked");
  assert.deepEqual(decided.report.unresolved_disagreements, [bug.id]);
  assert.deepEqual(decided.report.handoffs.qa, []);
  renderReviewReport({
    root: fixture.root,
    reportPath: draftReport,
    outputPath: draftHtml,
  });
  const html = fs.readFileSync(path.join(fixture.root, draftHtml), "utf8");
  assert.match(html, /handoff-qa/);
  assert.match(html, /Maintainer/);
  assert.match(html, /depends on the live runtime flow/);
});

test("repository-local keep-review cannot clear a sub-blocker disagreement", () => {
  const fixture = makeFixture({ maxWorkers: 6 });
  const bug = {
    ...validFinding("bug"),
    severity: "medium",
    confidence: 70,
    fix: "Preserve the old return value for existing callers.",
  };
  bug.id = findingId(bug);
  const edge = {
    ...bug,
    category: "edge",
    fix: "Migrate every caller to the new return value.",
  };
  edge.id = findingId(edge);
  assert.equal(edge.id, bug.id);
  setFindingForLens(fixture, "bug", bug);
  setFindingForLens(fixture, "edge", edge);

  const decisionsPath = ".pm/dev-sessions/example/review/runs/review-test/round-1/decisions.json";
  write(fixture.root, decisionsPath, {
    schema_version: 1,
    run_id: fixture.target.run_id,
    review_round: 1,
    target: binding(fixture.root, fixture.targetPath),
    decisions: [
      {
        finding_id: bug.id,
        approver: "Claimed Maintainer",
        action: "keep-review",
        rationale: "A local row cannot authenticate resolution of incompatible fixes.",
        decided_at: "2026-07-12T00:05:30Z",
      },
    ],
    checked_at: "2026-07-12T00:05:30Z",
  });
  const result = generate(fixture, {
    decisionsPath,
    reportPath: ".pm/dev-sessions/example/review/runs/review-test/round-1/draft-report.json",
    htmlPath: ".pm/dev-sessions/example/review/runs/review-test/round-1/draft-report.html",
    reportStage: "draft",
  });
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.equal(result.report.outcome, "blocked");
  assert.deepEqual(result.report.blockers, []);
  assert.deepEqual(result.report.unresolved_disagreements, [bug.id]);
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

test("self-declared approver text cannot authorize blocker-reducing decisions", () => {
  for (const action of ["dismiss", "defer", "handoff-design", "handoff-qa"]) {
    const fixture = makeFixture({ maxWorkers: 6 });
    const bug = validFinding("bug");
    setFindingForLens(fixture, "bug", bug);
    const decisionsPath = ".pm/dev-sessions/example/review/runs/review-test/round-1/decisions.json";
    write(fixture.root, decisionsPath, {
      schema_version: 1,
      run_id: fixture.target.run_id,
      review_round: 1,
      target: binding(fixture.root, fixture.targetPath),
      decisions: [
        {
          finding_id: bug.id,
          approver: "Claimed Maintainer",
          action,
          rationale: "A workspace writer cannot authenticate this authority-bearing action.",
          decided_at: "2026-07-12T00:07:00Z",
        },
      ],
      checked_at: "2026-07-12T00:07:00Z",
    });
    const result = generate(fixture, {
      decisionsPath,
      reportPath: ".pm/dev-sessions/example/review/runs/review-test/round-1/draft-report.json",
      htmlPath: ".pm/dev-sessions/example/review/runs/review-test/round-1/draft-report.html",
      reportStage: "draft",
    });
    assert.equal(result.ok, true, `${action}: ${JSON.stringify(result.issues)}`);
    assert.equal(result.report.outcome, "blocked", action);
    assert.equal(result.report.findings[0].owner, "review", action);
    assert.equal(result.report.findings[0].disposition, "open", action);
    assert.deepEqual(result.report.unresolved_disagreements, [bug.id], action);
  }
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

  const high = { ...validFinding("bug"), id: "rv-high", issue: "High blocker" };
  const critical = {
    ...validFinding("bug"),
    id: "rv-critical",
    severity: "critical",
    confidence: 81,
    issue: "Critical blocker",
  };
  const ranked = buildCanonicalReport(
    { run_id: "review-test", review_round: 1, iteration_cap: 3, lenses: [] },
    { relative: "target.json", sha256: "c".repeat(64) },
    [],
    null,
    { findings: [high, critical], unresolved_disagreements: [] },
    "report.html"
  );
  assert.equal(ranked.top_issue, "Critical blocker");

  const residual = {
    ...validFinding("quality"),
    id: "rv-residual",
    severity: "medium",
    confidence: 70,
    issue: "Residual medium finding",
  };
  const passingWithResidual = buildCanonicalReport(
    { run_id: "review-test", review_round: 1, iteration_cap: 3, lenses: [] },
    { relative: "target.json", sha256: "d".repeat(64) },
    [],
    null,
    { findings: [residual], unresolved_disagreements: [] },
    "report.html"
  );
  assert.equal(passingWithResidual.outcome, "passed");
  assert.equal(passingWithResidual.top_issue, residual.issue);

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

test("later rounds authenticate prior frozen Git evidence on a diverged deleted-file diff", () => {
  const fixture = makeFixture({ maxWorkers: 6, deleteFile: true });
  const finding = {
    ...validFinding("bug"),
    file: "src/deleted.js",
    line_start: 1,
    line_end: 1,
    evidence: [
      { kind: "source", ref: "src/deleted.js:1" },
      { kind: "contract", ref: "skills/dev/references/model-profiles.json:1" },
    ],
    change_anchors: [
      {
        path: "src/deleted.js",
        side: "base",
        line_start: 1,
        line_end: 1,
        affected_ref: "src/deleted.js:1",
        relation: "Removing the source creates the reported missing behavior.",
      },
    ],
  };
  finding.id = findingId(finding);
  setFindingForLens(fixture, "bug", finding);
  assert.equal(
    generate(fixture, {
      reportPath: fixture.roundReportPath,
      htmlPath: fixture.roundHtmlPath,
    }).ok,
    true
  );

  // Rebind a structurally canonical round after forging only its frozen diff identity.
  fixture.target.source.diff_sha256 = "0".repeat(64);
  write(fixture.root, fixture.targetPath, fixture.target);
  const targetBinding = binding(fixture.root, fixture.targetPath);
  for (const resultPath of fixture.resultPaths) {
    const result = JSON.parse(fs.readFileSync(path.join(fixture.root, resultPath), "utf8"));
    result.target = targetBinding;
    result.source = fixture.target.source;
    write(fixture.root, resultPath, result);
  }
  const prior = JSON.parse(
    fs.readFileSync(path.join(fixture.root, fixture.roundReportPath), "utf8")
  );
  prior.source = fixture.target.source;
  prior.target = targetBinding;
  prior.results = fixture.resultPaths
    .map((resultPath) => binding(fixture.root, resultPath))
    .sort((left, right) => left.path.localeCompare(right.path));
  write(fixture.root, fixture.roundReportPath, prior);

  const control = `${fixture.root}-prior-control`;
  execFileSync("git", ["clone", "-q", `${fixture.root}-origin.git`, control]);
  try {
    git(control, ["config", "user.email", "test@example.com"]);
    git(control, ["config", "user.name", "Test"]);
    fs.writeFileSync(path.join(control, "default.txt"), "remote default advanced\n");
    git(control, ["add", "default.txt"]);
    git(control, ["commit", "-qm", "advance default independently"]);
    git(control, ["push", "-q", "origin", "main"]);

    fs.appendFileSync(path.join(fixture.root, "src/example.js"), "module.exports.round = 2;\n");
    git(fixture.root, ["add", "src/example.js"]);
    git(fixture.root, ["commit", "-qm", "round two source"]);
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
    assert.match(JSON.stringify(checked.issues), /frozen Git diff bytes/);
  } finally {
    fs.rmSync(control, { recursive: true, force: true });
  }
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
  assert.match(html, /<details open><summary>Reviewer signals<\/summary>/);
  assert.match(html, new RegExp(generated.report.findings[0].signals[0].reviewer_id));
  assert.match(html, /node --test tests\/example\.test\.js/);
  assert.match(html, /src\/example\.js:1/);
  assert.match(html, /The changed export directly causes the reported contract violation\./);
});

test("rendered finding markers require advisory verification and independent signal detail", () => {
  const fixture = makeFixture({ maxWorkers: 6 });
  setFindingForLens(fixture, "bug", validFinding("bug"));
  const generated = generate(fixture, {
    reportPath: fixture.roundReportPath,
    htmlPath: fixture.roundHtmlPath,
  });
  assert.equal(generated.ok, true, JSON.stringify(generated.issues));
  const finding = generated.report.findings[0];
  const signal = finding.signals[0];
  const findingMarkerIssue = (issues) =>
    issues.filter((issue) => issue.message.includes(`"data-review-finding-id":"${finding.id}"`));
  const sharedText = [
    finding.issue,
    finding.impact,
    finding.fix,
    finding.owner,
    "Decision required: no",
    "Disputed: no",
    "No recorded decision.",
    ...finding.evidence.map((item) => item.ref),
    ...finding.change_anchors.map(changeAnchorText),
  ];
  const signalText = [
    signal.reviewer_id,
    signal.category,
    signal.severity,
    `${signal.confidence}%`,
    `owner ${signal.owner}`,
    `disposition ${signal.disposition}`,
    `fix ${signal.fix_kind}`,
    `decision required ${signal.decision_required ? "yes" : "no"}`,
    ...signal.change_anchors.map(changeAnchorText),
  ];
  const marker = (textParts) => ({
    attributes: { "data-review-finding-id": finding.id },
    text: textParts.join(" "),
    firstScreenText: "",
    visible: true,
    inViewport: false,
  });

  let issues = [];
  validateRenderedReportMarkers([marker([...sharedText, ...signalText])], generated.report, issues);
  assert.equal(findingMarkerIssue(issues).length, 1, "missing verification must fail visibility");

  issues = [];
  validateRenderedReportMarkers(
    [marker([...sharedText, finding.verify])],
    generated.report,
    issues
  );
  assert.equal(findingMarkerIssue(issues).length, 1, "missing signal detail must fail visibility");

  issues = [];
  validateRenderedReportMarkers(
    [marker([...sharedText, finding.verify, ...signalText])],
    generated.report,
    issues
  );
  assert.equal(findingMarkerIssue(issues).length, 0);
});

test("Review HTML expansion fails before publishing beyond the shared byte budget", () => {
  const fixture = makeFixture({ maxWorkers: 3 });
  const generated = generate(fixture);
  assert.equal(generated.ok, true, JSON.stringify(generated.issues));
  const reportFile = path.join(fixture.root, fixture.reportPath);
  const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
  const expansion = "<".repeat(1_100_000);
  report.findings = [
    {
      ...validFinding("quality"),
      id: "rv-html-expansion",
      issue: expansion,
      signals: [],
      disputed: false,
      decision: null,
    },
  ];
  report.top_issue = expansion;
  fs.writeFileSync(reportFile, `${JSON.stringify(report)}\n`);
  fs.rmSync(path.join(fixture.root, fixture.htmlPath), { force: true });
  assert.ok(fs.statSync(reportFile).size < 4 * 1024 * 1024);
  assert.throws(
    () =>
      renderReviewReport({
        root: fixture.root,
        reportPath: fixture.reportPath,
        outputPath: fixture.htmlPath,
      }),
    /output exceeds 4194304-byte budget/
  );
  assert.equal(fs.existsSync(path.join(fixture.root, fixture.htmlPath)), false);
});

test("Review publication surfaces unsupported sync warnings and committed EIO failures", (t) => {
  const fixture = makeFixture({ maxWorkers: 3 });
  t.after(() => {
    fs.rmSync(fixture.root, { recursive: true, force: true });
    fs.rmSync(`${fixture.root}-origin.git`, { recursive: true, force: true });
  });
  const originalJson = projectWriter.writeProjectJsonAtomic;
  const originalText = projectWriter.writeProjectTextAtomic;
  t.after(() => {
    projectWriter.writeProjectJsonAtomic = originalJson;
    projectWriter.writeProjectTextAtomic = originalText;
  });
  const unsupported =
    (writer) =>
    (...args) => ({
      ...writer(...args),
      directory_synced: false,
      directory_sync_error: "EPERM",
    });
  const genuineFailure =
    (writer) =>
    (...args) => {
      writer(...args);
      const error = new Error(
        "project output committed but directory sync failed (EIO); do not retry this write"
      );
      error.committed = true;
      error.directorySyncError = "EIO";
      throw error;
    };

  let publicationOptions;
  projectWriter.writeProjectJsonAtomic = (...args) => {
    publicationOptions = args[3];
    return unsupported(originalJson)(...args);
  };
  const warnedReport = generate(fixture);
  assert.equal(warnedReport.ok, true, JSON.stringify(warnedReport.issues));
  assert.equal(publicationOptions.maxBytes, 4 * 1024 * 1024);
  assert.deepEqual(warnedReport.warnings, [
    {
      path: "report.path",
      message: "committed with unsupported directory sync EPERM",
    },
  ]);

  projectWriter.writeProjectJsonAtomic = genuineFailure(originalJson);
  const blockedReport = generate(fixture);
  assert.equal(blockedReport.ok, false);
  assert.match(
    JSON.stringify(blockedReport.issues),
    /committed but directory sync failed \(EIO\); do not retry/
  );
  assert.ok(fs.existsSync(path.join(fixture.root, fixture.reportPath)));

  projectWriter.writeProjectJsonAtomic = originalJson;
  let htmlPublicationOptions;
  projectWriter.writeProjectTextAtomic = (...args) => {
    htmlPublicationOptions = args[3];
    return unsupported(originalText)(...args);
  };
  const warnedHtml = renderReviewReport({
    root: fixture.root,
    reportPath: fixture.reportPath,
    outputPath: fixture.htmlPath,
  });
  assert.equal(warnedHtml.directory_synced, false);
  assert.equal(warnedHtml.directory_sync_error, "EPERM");
  assert.equal(htmlPublicationOptions.maxBytes, 4 * 1024 * 1024);

  projectWriter.writeProjectTextAtomic = genuineFailure(originalText);
  assert.throws(
    () =>
      renderReviewReport({
        root: fixture.root,
        reportPath: fixture.reportPath,
        outputPath: fixture.htmlPath,
      }),
    /committed but directory sync failed \(EIO\); do not retry/
  );
  assert.ok(fs.existsSync(path.join(fixture.root, fixture.htmlPath)));

  projectWriter.writeProjectJsonAtomic = originalJson;
  const preload = path.join(fixture.root, ".pm", "durability-preload.cjs");
  const writerModule = path.join(__dirname, "..", "scripts", "lib", "project-atomic-write.js");
  fs.writeFileSync(
    preload,
    `
      const writer = require(process.env.PM_TEST_WRITER_MODULE);
      const original = writer.writeProjectJsonAtomic;
      writer.writeProjectJsonAtomic = (...args) => {
        const state = original(...args);
        if (process.env.PM_TEST_DURABILITY === "unsupported") {
          return { ...state, directory_synced: false, directory_sync_error: "EPERM" };
        }
        const error = new Error("project output committed but directory sync failed (EIO); do not retry this write");
        error.committed = true;
        error.directorySyncError = "EIO";
        throw error;
      };
      delete process.env.NODE_OPTIONS;
    `
  );
  const targetScript = path.join(__dirname, "..", "scripts", "review-target.js");
  const targetArgs = (targetPath, runId) => [
    targetScript,
    "--root",
    fixture.root,
    "--out",
    targetPath,
    "--run-id",
    runId,
    "--round",
    "1",
    "--mode",
    "full",
    "--profile",
    "codex-workhorse",
    "--max-workers",
    "3",
    "--base",
    "origin/main",
  ];
  const baseEnv = {
    ...process.env,
    NODE_OPTIONS: `--require=${preload}`,
    PM_TEST_WRITER_MODULE: writerModule,
  };
  const warningTarget =
    ".pm/dev-sessions/example/review/runs/durability-warning/round-1/target.json";
  const warning = spawnSync(process.execPath, targetArgs(warningTarget, "durability-warning"), {
    encoding: "utf8",
    env: { ...baseEnv, PM_TEST_DURABILITY: "unsupported" },
  });
  assert.equal(warning.status, 0, warning.stderr);
  assert.match(warning.stderr, /unsupported directory sync EPERM/);
  assert.doesNotThrow(() => JSON.parse(warning.stdout));
  assert.ok(fs.existsSync(path.join(fixture.root, warningTarget)));

  const eioTarget = ".pm/dev-sessions/example/review/runs/durability-eio/round-1/target.json";
  const eio = spawnSync(process.execPath, targetArgs(eioTarget, "durability-eio"), {
    encoding: "utf8",
    env: { ...baseEnv, PM_TEST_DURABILITY: "eio" },
  });
  assert.equal(eio.status, 1);
  assert.match(eio.stderr, /committed but directory sync failed \(EIO\); do not retry/);
  assert.ok(fs.existsSync(path.join(fixture.root, eioTarget)));
});

test(
  "real Chromium renders the maximum accepted finding set within the artifact budget",
  {
    skip:
      (process.env.PM_SKIP_BROWSER_TESTS && "browser tests explicitly disabled") ||
      (!installedBrowser && "Chromium is not installed"),
  },
  () => {
    const fixture = makeFixture({ maxWorkers: 3 });
    const absolute = path.join(fixture.root, fixture.resultPaths[0]);
    const result = JSON.parse(fs.readFileSync(absolute, "utf8"));
    const lens = result.lenses[0];
    result.findings = maximumRenderBudgetFindings(lens, "render-boundary");
    assert.equal(
      result.findings.reduce((sum, finding) => sum + findingRenderChars(finding), 0),
      MAX_FINDING_RENDER_CHARS_PER_ROUND
    );
    result.verdicts.find((verdict) => verdict.lens === lens).outcome = "findings";
    fs.writeFileSync(absolute, `${JSON.stringify(result)}\n`);
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

    const rendered = renderArtifact({
      htmlPath: path.join(fixture.root, fixture.roundHtmlPath),
      outputDir: path.join(fixture.root, ".pm/finding-boundary-render"),
      browserPath: installedBrowser,
      projectRoot: fixture.root,
    });
    assert.equal(
      rendered.captures.every(({ metrics }) => metrics.documentHeight <= 16_000),
      true
    );
  }
);

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
        projectRoot: fixture.root,
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
          projectRoot: fixture.root,
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

function makeFixture({
  maxWorkers,
  deleteFile = false,
  renameFile = false,
  removeLine = false,
  runScoped = true,
  multiline = false,
  remote = "origin",
}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-review-check-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, "skills/dev/references"), { recursive: true });
  fs.writeFileSync(path.join(root, ".gitignore"), ".pm/\n");
  fs.writeFileSync(
    path.join(root, "src/example.js"),
    removeLine
      ? "module.exports = { value: 1 };\nmodule.exports.extra = true;\n"
      : multiline
        ? "const stable = true;\nmodule.exports = { value: 1, stable };\n"
        : "module.exports = { value: 1 };\n"
  );
  if (deleteFile)
    fs.writeFileSync(path.join(root, "src/deleted.js"), "module.exports = 'delete me';\n");
  if (renameFile)
    fs.writeFileSync(
      path.join(root, "src/old-name.js"),
      "stable 1\nold contract\nstable 3\nstable 4\nstable 5\nstable 6\nstable 7\nstable 8\n"
    );
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
  if (remote !== "origin") git(root, ["remote", "add", remote, origin]);
  fs.writeFileSync(
    path.join(root, "src/example.js"),
    removeLine
      ? "module.exports = { value: 1 };\n"
      : multiline
        ? "const stable = true;\nmodule.exports = { value: 2, stable };\n"
        : "module.exports = { value: 2 };\n"
  );
  if (deleteFile) fs.rmSync(path.join(root, "src/deleted.js"));
  if (renameFile) {
    fs.renameSync(path.join(root, "src/old-name.js"), path.join(root, "src/renamed.js"));
    fs.writeFileSync(
      path.join(root, "src/renamed.js"),
      "stable 1\nnew contract\nstable 3\nstable 4\nstable 5\nstable 6\nstable 7\nstable 8\n"
    );
  }
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "change"]);

  const target = buildReviewTarget({
    root,
    maxWorkers,
    profile: "codex-workhorse",
    runId: "review-test",
    remote,
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
    change_anchors: [
      {
        path: "src/example.js",
        side: "head",
        line_start: 1,
        line_end: 1,
        affected_ref: "src/example.js:1",
        relation: "The changed export directly causes the reported contract violation.",
      },
    ],
    owner: "review",
    disposition: "open",
    decision_required: false,
  };
  if (category === "bug")
    finding.evidence.push({ kind: "contract", ref: "skills/dev/references/model-profiles.json:1" });
  finding.id = findingId(finding);
  return finding;
}

function uniqueFindings(category, count, prefix = "finding") {
  return Array.from({ length: count }, (_, index) => {
    const finding = validFinding(category);
    finding.rule = `${prefix}-${index}`;
    finding.id = findingId(finding);
    return finding;
  });
}

function maximumRenderBudgetFindings(category, prefix) {
  const findings = uniqueFindings(category, MAX_FINDINGS_PER_ROUND, prefix);
  for (const [index, finding] of findings.entries()) {
    finding.rule = `r-${index}`;
    finding.issue = `Issue ${index}`;
    finding.impact = "Impact.";
    finding.fix = "Fix.";
    finding.verify = "Verify.";
    finding.change_anchors[0].relation = "Changed line causes affected behavior.";
    finding.id = findingId(finding);
  }
  let remaining =
    MAX_FINDING_RENDER_CHARS_PER_ROUND -
    findings.reduce((sum, finding) => sum + findingRenderChars(finding), 0);
  assert.ok(remaining > 0, "baseline boundary fixture must leave prose budget to fill");
  for (const finding of findings) {
    const addition = Math.min(remaining, MAX_FINDING_PROSE_CHARS - finding.impact.length);
    finding.impact += "x".repeat(addition);
    finding.id = findingId(finding);
    remaining -= addition;
    if (remaining === 0) break;
  }
  assert.equal(remaining, 0, "fixture fields must have enough capacity to reach the exact budget");
  assert.equal(
    findings.reduce((sum, finding) => sum + findingRenderChars(finding), 0),
    MAX_FINDING_RENDER_CHARS_PER_ROUND
  );
  return findings;
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
