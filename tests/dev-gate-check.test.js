"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");

const repoRoot = path.resolve(__dirname, "..");
const checkScript = path.join(repoRoot, "scripts", "dev-gate-check.js");

const {
  checkGateManifest,
  deriveSessionSlug,
  loadChangedFilesFromGit,
  parseArgs,
} = require("../scripts/dev-gate-check.js");
const { devReviewContext } = require("../scripts/lib/review-contract");
const { invocationConfigurationDigest } = require("../scripts/artifact-render-check");
const { version: PLUGIN_VERSION } = require("../plugin.config.json");

function gate(name, commit = "abc123", overrides = {}) {
  return {
    name,
    status: "passed",
    commit,
    artifact: `tests/dev-gate-check.test.js#${name}`,
    reason: "",
    checked_at: "2026-07-01T05:01:00Z",
    ...overrides,
  };
}

function manifest(gates, overrides = {}) {
  return {
    schema_version: 1,
    ...overrides,
    gates,
  };
}

function makeTmpManifest(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-dev-gates-"));
  const file = path.join(dir, "current.gates.json");
  fs.writeFileSync(file, JSON.stringify(content, null, 2));
  return {
    file,
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("pm/ KB artifacts (generated RFC HTML) are not UI-impact paths", () => {
  const rows = [
    gate("tdd"),
    gate("simplify"),
    gate("design-critique", "abc123", {
      status: "skipped",
      artifact: "",
      reason: "backend-only: no UI impact",
    }),
    gate("qa"),
    gate("review"),
    gate("verification"),
  ];
  const result = checkGateManifest(manifest(rows), {
    currentCommit: "abc123",
    changedFiles: ["pm/backlog/rfcs/some-feature.html", ".pm/dev-sessions/x.md", "scripts/a.js"],
  });
  assert.equal(
    result.issues.some((issue) => /UI-impact/.test(issue.message)),
    false,
    JSON.stringify(result.issues)
  );
});

test("dev gate checker accepts required gates tied to the current commit", () => {
  const result = checkGateManifest(
    manifest([
      gate("tdd"),
      gate("simplify"),
      gate("design-critique"),
      gate("qa"),
      gate("review"),
      gate("verification"),
    ]),
    {
      currentCommit: "abc123",
      manifestPath: ".pm/dev-sessions/current.gates.json",
      requiredGates: ["tdd", "simplify", "design-critique", "qa", "verification"],
    }
  );
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test("review-report-v1 gate requires the canonical sibling machine report", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-review-gate-"));
  try {
    const artifact = path.join(root, ".pm/dev-sessions/example/review/report.html");
    fs.mkdirSync(path.dirname(artifact), { recursive: true });
    fs.writeFileSync(artifact, "<!doctype html><title>Review</title>");
    const result = checkGateManifest(
      manifest([
        gate("review", "abc123", {
          artifact: path.relative(root, artifact),
          evidence_kind: "review-report-v1",
        }),
      ]),
      {
        currentCommit: "abc123",
        requiredGates: ["review"],
        artifactRoot: root,
      }
    );
    assert.equal(result.ok, false);
    assert.match(JSON.stringify(result.issues), /requires sibling review\/report\.json/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("review-report-v1 gate requires a hash-bound canonical render manifest", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-review-render-gate-"));
  try {
    const artifact = path.join(root, ".pm/dev-sessions/example/review/report.html");
    fs.mkdirSync(path.dirname(artifact), { recursive: true });
    fs.writeFileSync(artifact, "<!doctype html><title>Review</title>");
    fs.writeFileSync(path.join(path.dirname(artifact), "report.json"), "{}\n");
    const result = checkGateManifest(
      manifest([
        gate("review", "abc123", {
          artifact: path.relative(root, artifact),
          evidence_kind: "review-report-v1",
        }),
      ]),
      { currentCommit: "abc123", requiredGates: ["review"], artifactRoot: root }
    );
    assert.equal(result.ok, false);
    assert.match(JSON.stringify(result.issues), /requires render_manifest/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("review gate rejects unknown evidence contract versions", () => {
  const result = checkGateManifest(
    manifest([gate("review", "abc123", { evidence_kind: "review-report-v9" })]),
    { currentCommit: "abc123", requiredGates: ["review"] }
  );
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /evidence_kind must equal review-report-v1/);
});

test("canonical review artifact cannot omit its evidence contract", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-gates-review-kind-"));
  const artifact = path.join(root, ".pm/dev-sessions/example/review/report.html");
  fs.mkdirSync(path.dirname(artifact), { recursive: true });
  fs.writeFileSync(artifact, "<!doctype html><title>Unbound</title>");
  const result = checkGateManifest(
    manifest([gate("review", "abc123", { artifact: "review/report.html" })], {
      run_id: "canonical-run",
    }),
    {
      manifestPath: path.join(root, ".pm/dev-sessions/example.gates.json"),
      artifactRoot: path.join(root, ".pm/dev-sessions/example"),
      currentCommit: "abc123",
      requiredGates: ["review"],
    }
  );
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /requires evidence_kind review-report-v1/);
});

test("canonical sessions cannot use legacy-shaped passed Review rows", () => {
  for (const artifact of ["", "tests/dev-gate-check.test.js#review"]) {
    const result = checkGateManifest(
      manifest([gate("review", "abc123", { artifact })], { run_id: "canonical-run" }),
      { currentCommit: "abc123", requiredGates: ["review"] }
    );
    assert.equal(result.ok, false);
    assert.match(JSON.stringify(result.issues), /requires evidence_kind review-report-v1/);
  }
});

test("review enforcement rejects legacy rows and inspection is explicitly non-authoritative", () => {
  const legacy = manifest([gate("review")]);
  const defaulted = checkGateManifest(legacy, {
    currentCommit: "abc123",
    requiredGates: ["review"],
  });
  assert.equal(defaulted.ok, false);
  assert.match(
    defaulted.issues.map((item) => item.message).join("\n"),
    /requires evidence_kind review-report-v1 in enforcement mode/
  );
  const enforced = checkGateManifest(legacy, {
    currentCommit: "abc123",
    requiredGates: ["review"],
    reviewEvidenceMode: "enforce",
  });
  assert.equal(enforced.ok, false);
  assert.match(
    enforced.issues.map((item) => item.message).join("\n"),
    /requires evidence_kind review-report-v1 in enforcement mode/
  );

  const inspected = checkGateManifest(legacy, {
    currentCommit: "abc123",
    requiredGates: ["review"],
    reviewEvidenceMode: "inspect",
  });
  assert.deepEqual(inspected, {
    ok: false,
    authoritative: false,
    inspection_ok: true,
    issues: [],
  });
});

test("nested canonical review rows resolve project-relative evidence from the project root", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-review-gate-options-"));
  const sessionDir = path.join(root, ".pm", "dev-sessions", "example");
  const reviewDir = path.join(sessionDir, "review");
  fs.mkdirSync(reviewDir, { recursive: true });
  fs.writeFileSync(path.join(reviewDir, "report.html"), "<!doctype html><title>Review</title>");
  fs.writeFileSync(path.join(reviewDir, "report.json"), "{}\n");
  const render = seedReviewRenderManifest(root, path.join(reviewDir, "report.html"));

  const reviewModule = require("../scripts/review-check");
  const originalCheck = reviewModule.checkReview;
  const originalExpand = reviewModule.expandFromReport;
  let received;
  reviewModule.expandFromReport = (options) => {
    received = options;
    return options;
  };
  reviewModule.checkReview = () => ({
    ok: true,
    issues: [],
    report: reviewReportForMarkers(),
  });
  try {
    const result = checkGateManifest(
      manifest([
        gate("review", "abc123", {
          artifact: ".pm/dev-sessions/example/review/report.html",
          evidence_kind: "review-report-v1",
          render_manifest: render.path,
          render_manifest_sha256: render.sha256,
        }),
      ]),
      {
        artifactRoot: root,
        currentCommit: "abc123",
        requiredGates: ["review"],
        reviewEvidenceMode: "enforce",
      }
    );
    assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
    assert.equal(received.verifyGit, false);
    assert.equal(received.verifyFrozenGit, true);
    assert.equal(received.verifyBrowser, false);
    assert.equal(received.root, root);
    assert.equal(received.reportPath, ".pm/dev-sessions/example/review/report.json");
  } finally {
    reviewModule.checkReview = originalCheck;
    reviewModule.expandFromReport = originalExpand;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("canonical Dev routing binds the Review target mode and exact completed lenses", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-review-routing-gate-"));
  const reviewDir = path.join(root, ".pm/dev-sessions/example/review");
  fs.mkdirSync(reviewDir, { recursive: true });
  const htmlPath = path.join(reviewDir, "report.html");
  fs.writeFileSync(htmlPath, "<!doctype html><title>Review</title>");
  fs.writeFileSync(path.join(reviewDir, "report.json"), "{}\n");
  fs.writeFileSync(path.join(reviewDir, "target.json"), JSON.stringify({ mode: "code-scan" }));
  const render = seedReviewRenderManifest(root, htmlPath, { coverage: "5/5" });
  const lenses = ["bug", "edge", "reuse", "quality", "efficiency"];
  const routedSession = {
    run_id: "dev_run-1",
    slug: "example",
    routing: { review_mode: "code-scan", decision_version: 1 },
    task: { acceptance_criteria: ["Review the exact routed behavior"] },
  };
  const reviewModule = require("../scripts/review-check");
  const originalCheck = reviewModule.checkReview;
  const originalExpand = reviewModule.expandFromReport;
  reviewModule.expandFromReport = (options) => options;
  let checkedReport = {
    ...reviewReportForMarkers({ coverage: lenses }),
    target: { path: ".pm/dev-sessions/example/review/target.json" },
  };
  let validatedHumanReport = {
    path: ".pm/dev-sessions/example/review/report.html",
    sha256: fileDigest(htmlPath),
  };
  reviewModule.checkReview = () => ({
    ok: true,
    issues: [],
    target: {
      mode: "code-scan",
      source: { base_ref: "origin/main", base_commit: "base123" },
      dev_context: devReviewContext(routedSession),
    },
    report: checkedReport,
    validated_human_report: validatedHumanReport,
  });
  const row = gate("review", "abc123", {
    artifact: ".pm/dev-sessions/example/review/report.html",
    evidence_kind: "review-report-v1",
    render_manifest: render.path,
    render_manifest_sha256: render.sha256,
    lenses,
  });
  try {
    const matching = checkGateManifest(manifest([row], { run_id: routedSession.run_id }), {
      artifactRoot: root,
      currentCommit: "abc123",
      requiredGates: ["review"],
      canonicalSession: routedSession,
      requireSessionBinding: true,
      manifestPath: ".pm/dev-sessions/example/gates.json",
      authoritativeBaseRef: "origin/main",
      authoritativeBaseCommit: "base123",
    });
    assert.equal(matching.ok, true, JSON.stringify(matching.issues));

    validatedHumanReport = { ...validatedHumanReport, sha256: "0".repeat(64) };
    const swappedHtmlSnapshot = checkGateManifest(
      manifest([row], { run_id: routedSession.run_id }),
      {
        artifactRoot: root,
        currentCommit: "abc123",
        requiredGates: ["review"],
        canonicalSession: routedSession,
        requireSessionBinding: true,
        manifestPath: ".pm/dev-sessions/example/gates.json",
        authoritativeBaseRef: "origin/main",
        authoritativeBaseCommit: "base123",
      }
    );
    assert.equal(swappedHtmlSnapshot.ok, false);
    assert.match(JSON.stringify(swappedHtmlSnapshot.issues), /bind the exact report\.html bytes/);
    validatedHumanReport = {
      path: ".pm/dev-sessions/example/review/report.html",
      sha256: fileDigest(htmlPath),
    };

    fs.writeFileSync(path.join(reviewDir, "target.json"), JSON.stringify({ mode: "full" }));
    const swappedPath = checkGateManifest(manifest([row], { run_id: routedSession.run_id }), {
      artifactRoot: root,
      currentCommit: "abc123",
      requiredGates: ["review"],
      canonicalSession: routedSession,
      requireSessionBinding: true,
      manifestPath: ".pm/dev-sessions/example/gates.json",
      authoritativeBaseRef: "origin/main",
      authoritativeBaseCommit: "base123",
    });
    assert.equal(swappedPath.ok, true, JSON.stringify(swappedPath.issues));

    const wrongMode = checkGateManifest(manifest([row], { run_id: routedSession.run_id }), {
      artifactRoot: root,
      currentCommit: "abc123",
      requiredGates: ["review"],
      canonicalSession: {
        ...routedSession,
        routing: { ...routedSession.routing, review_mode: "full" },
      },
      requireSessionBinding: true,
      manifestPath: ".pm/dev-sessions/example/gates.json",
      authoritativeBaseRef: "origin/main",
      authoritativeBaseCommit: "base123",
    });
    assert.equal(wrongMode.ok, false);
    assert.match(JSON.stringify(wrongMode.issues), /must equal routed full/);

    const wrongSlug = checkGateManifest(manifest([row], { run_id: routedSession.run_id }), {
      artifactRoot: root,
      currentCommit: "abc123",
      requiredGates: ["review"],
      canonicalSession: { ...routedSession, slug: "other" },
      requireSessionBinding: true,
      manifestPath: ".pm/dev-sessions/example/gates.json",
      authoritativeBaseRef: "origin/main",
      authoritativeBaseCommit: "base123",
    });
    assert.equal(wrongSlug.ok, false);
    assert.match(JSON.stringify(wrongSlug.issues), /sibling session slug must equal example/);

    const wrongLenses = checkGateManifest(
      manifest([{ ...row, lenses: lenses.slice(0, -1) }], { run_id: routedSession.run_id }),
      {
        artifactRoot: root,
        currentCommit: "abc123",
        requiredGates: ["review"],
        canonicalSession: routedSession,
        requireSessionBinding: true,
        manifestPath: ".pm/dev-sessions/example/gates.json",
        authoritativeBaseRef: "origin/main",
        authoritativeBaseCommit: "base123",
      }
    );
    assert.equal(wrongLenses.ok, false);
    assert.match(JSON.stringify(wrongLenses.issues), /must exactly match report coverage/);

    const wrongBase = checkGateManifest(manifest([row], { run_id: routedSession.run_id }), {
      artifactRoot: root,
      currentCommit: "abc123",
      requiredGates: ["review"],
      canonicalSession: routedSession,
      requireSessionBinding: true,
      manifestPath: ".pm/dev-sessions/example/gates.json",
      authoritativeBaseRef: "origin/main",
      authoritativeBaseCommit: "different-base",
    });
    assert.equal(wrongBase.ok, false);
    assert.match(JSON.stringify(wrongBase.issues), /must equal the authoritative delivery base/);

    const changedAcceptance = checkGateManifest(manifest([row], { run_id: routedSession.run_id }), {
      artifactRoot: root,
      currentCommit: "abc123",
      requiredGates: ["review"],
      canonicalSession: {
        ...routedSession,
        task: { acceptance_criteria: ["Different routed acceptance criteria"] },
      },
      requireSessionBinding: true,
      manifestPath: ".pm/dev-sessions/example/gates.json",
      authoritativeBaseRef: "origin/main",
      authoritativeBaseCommit: "base123",
    });
    assert.equal(changedAcceptance.ok, false);
    assert.match(JSON.stringify(changedAcceptance.issues), /must bind the canonical Dev run/);

    const foreign = checkGateManifest(
      manifest([{ ...row, artifact: ".pm/dev-sessions/other/review/report.html" }], {
        run_id: routedSession.run_id,
      }),
      {
        artifactRoot: root,
        currentCommit: "abc123",
        requiredGates: ["review"],
        canonicalSession: routedSession,
        requireSessionBinding: true,
        manifestPath: ".pm/dev-sessions/example/gates.json",
        authoritativeBaseRef: "origin/main",
        authoritativeBaseCommit: "base123",
      }
    );
    assert.equal(foreign.ok, false);
    assert.match(JSON.stringify(foreign.issues), /must belong to the canonical Dev session/);

    checkedReport = { ...checkedReport, findings: [{ evidence: {} }] };
    const malformedProjection = checkGateManifest(
      manifest([row], { run_id: routedSession.run_id }),
      {
        artifactRoot: root,
        currentCommit: "abc123",
        requiredGates: ["review"],
        canonicalSession: routedSession,
        requireSessionBinding: true,
        manifestPath: ".pm/dev-sessions/example/gates.json",
        authoritativeBaseRef: "origin/main",
        authoritativeBaseCommit: "base123",
      }
    );
    assert.equal(malformedProjection.ok, false);
    assert.match(
      JSON.stringify(malformedProjection.issues),
      /retained browser marker evidence failed/
    );
    checkedReport = {
      ...reviewReportForMarkers({ coverage: lenses }),
      target: { path: ".pm/dev-sessions/example/review/target.json" },
    };

    const manifestFile = path.join(root, render.path);
    const hiddenMarkers = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    hiddenMarkers.markers.find((marker) => marker.attributes["data-review-source-sha256"]).visible =
      false;
    fs.writeFileSync(manifestFile, `${JSON.stringify(hiddenMarkers)}\n`);
    const hiddenSource = checkGateManifest(
      manifest([{ ...row, render_manifest_sha256: fileDigest(manifestFile) }], {
        run_id: routedSession.run_id,
      }),
      {
        artifactRoot: root,
        currentCommit: "abc123",
        requiredGates: ["review"],
        canonicalSession: routedSession,
        requireSessionBinding: true,
        manifestPath: ".pm/dev-sessions/example/gates.json",
        authoritativeBaseRef: "origin/main",
        authoritativeBaseCommit: "base123",
      }
    );
    assert.equal(hiddenSource.ok, false);
    assert.match(JSON.stringify(hiddenSource.issues), /retained browser marker evidence failed/);
  } finally {
    reviewModule.checkReview = originalCheck;
    reviewModule.expandFromReport = originalExpand;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("canonical enforcement requires a sibling session binding", () => {
  const result = checkGateManifest(manifest([gate("review")], { run_id: "run-1" }), {
    currentCommit: "abc123",
    requiredGates: ["review"],
    requireSessionBinding: true,
  });
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /canonical gates require sibling session\.json/);
});

test("review render evidence rejects forged retained-render boundaries", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-review-render-forgery-"));
  const outside = `${root}-outside.png`;
  try {
    const reviewDir = path.join(root, "review");
    const htmlPath = path.join(reviewDir, "report.html");
    fs.mkdirSync(reviewDir, { recursive: true });
    fs.writeFileSync(htmlPath, "<!doctype html><title>Review</title>");
    fs.writeFileSync(path.join(reviewDir, "report.json"), "{}\n");
    const render = seedReviewRenderManifest(root, htmlPath);
    const manifestPath = path.join(root, render.path);
    const baseline = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const retainedFiles = [
      ...baseline.captures.flatMap((capture) => [capture.path, capture.full_page.path]),
      baseline.print.path,
    ];
    const retainedBytes = new Map(
      retainedFiles.map((file) => [file, fs.readFileSync(path.join(root, file))])
    );
    const forgedHash = `sha256:${"0".repeat(64)}`;
    const scenarios = [
      {
        name: "gate-row manifest hash",
        mutate() {},
        gateHash: () => "0".repeat(64),
        expected: /render manifest SHA-256 does not match its bytes/,
      },
      {
        name: "non-object render manifest",
        value: null,
        mutate() {},
        expected: /render manifest must be a non-array object/,
      },
      {
        name: "source hash",
        mutate(value) {
          value.source.sha256 = forgedHash;
        },
        expected: /bind the exact report\.html bytes/,
      },
      {
        name: "missing local observation",
        mutate(value) {
          delete value.observation;
        },
        expected: /requires the current local-observation producer identity/,
      },
      {
        name: "browser executable drift",
        mutate(value) {
          value.observation.browser.executable_sha256_after = forgedHash;
        },
        expected: /requires a stable canonical Chromium executable observation/,
      },
      {
        name: "invocation configuration drift",
        mutate(value) {
          value.observation.invocation_configuration_sha256 = forgedHash;
        },
        expected: /uses a noncanonical invocation configuration/,
      },
      {
        name: "capture hash",
        mutate(value) {
          value.captures[0].sha256 = forgedHash;
        },
        expected: /review render desktop: hash or byte count does not match rendered bytes/,
      },
      {
        name: "capture byte count",
        mutate(value) {
          value.captures[0].bytes += 1;
        },
        expected: /review render desktop: hash or byte count does not match rendered bytes/,
      },
      {
        name: "capture PNG dimensions",
        mutate(value) {
          const capture = value.captures[0];
          const absolute = path.join(root, capture.path);
          fs.writeFileSync(absolute, validGatePng(capture.width - 1, capture.height));
          capture.sha256 = `sha256:${fileDigest(absolute)}`;
          capture.bytes = fs.statSync(absolute).size;
        },
        expected: /PNG dimensions must equal 1440x1000/,
      },
      {
        name: "capture overflow metrics",
        mutate(value) {
          value.captures[0].metrics.horizontalOverflow = true;
        },
        expected: /desktop render has horizontal document overflow/,
      },
      {
        name: "missing canonical viewport",
        mutate(value) {
          value.captures.pop();
        },
        expected: /requires one canonical capture per viewport/,
      },
      {
        name: "missing full-page capture",
        mutate(value) {
          delete value.captures[0].full_page;
        },
        expected: /requires canonical full-page metadata/,
      },
      {
        name: "print hash",
        mutate(value) {
          value.print.sha256 = forgedHash;
        },
        expected: /review render print: hash or byte count does not match rendered bytes/,
      },
      {
        name: "print byte count",
        mutate(value) {
          value.print.bytes += 1;
        },
        expected: /review render print: hash or byte count does not match rendered bytes/,
      },
      {
        name: "empty print evidence",
        mutate(value) {
          value.print.pages = 0;
        },
        expected: /requires a non-empty print PDF/,
      },
      {
        name: "missing marker evidence",
        mutate(value) {
          delete value.markers;
        },
        expected: /requires browser marker evidence/,
      },
      {
        name: "out-of-root capture",
        mutate(value) {
          fs.writeFileSync(outside, retainedBytes.get(value.captures[0].path));
          value.captures[0].path = outside;
          value.captures[0].sha256 = `sha256:${fileDigest(outside)}`;
          value.captures[0].bytes = fs.statSync(outside).size;
        },
        expected: /requires a project-relative path/,
      },
      {
        name: "symlinked capture",
        mutate(value) {
          const capture = value.captures[0];
          const link = path.join(root, path.dirname(capture.path), "desktop-link.png");
          fs.rmSync(link, { force: true });
          fs.symlinkSync(path.join(root, capture.path), link);
          capture.path = path.relative(root, link);
        },
        expected: /project path contains symlink|must be a regular non-symlink file/,
      },
    ];

    for (const scenario of scenarios) {
      for (const [file, bytes] of retainedBytes) fs.writeFileSync(path.join(root, file), bytes);
      const value = scenario.value === undefined ? structuredClone(baseline) : scenario.value;
      scenario.mutate(value);
      fs.writeFileSync(manifestPath, `${JSON.stringify(value)}\n`);
      const result = checkGateManifest(
        manifest([
          gate("review", "abc123", {
            artifact: "review/report.html",
            evidence_kind: "review-report-v1",
            render_manifest: render.path,
            render_manifest_sha256: scenario.gateHash
              ? scenario.gateHash()
              : fileDigest(manifestPath),
          }),
        ]),
        {
          artifactRoot: root,
          currentCommit: "abc123",
          requiredGates: ["review"],
          reviewEvidenceMode: "enforce",
        }
      );
      assert.equal(result.ok, false, scenario.name);
      assert.match(
        result.issues.map((item) => item.message).join("\n"),
        scenario.expected,
        scenario.name
      );
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { force: true });
  }
});

function seedReviewRenderManifest(root, htmlPath, values = {}) {
  const renderDir = path.join(path.dirname(htmlPath), "renders");
  fs.mkdirSync(renderDir, { recursive: true });
  const viewports = [
    ["desktop", 1440, 1000],
    ["tablet", 768, 1024],
    ["narrow", 500, 812],
  ];
  const captures = viewports.map(([name, width, height]) => {
    const screen = path.join(renderDir, `${name}.png`);
    const full = path.join(renderDir, `${name}-full.png`);
    fs.writeFileSync(screen, validGatePng(width, height));
    fs.writeFileSync(full, validGatePng(width, height));
    return {
      name,
      width,
      height,
      ...renderFile(root, screen),
      metrics: {
        innerWidth: width,
        clientWidth: width,
        scrollWidth: width,
        documentHeight: height,
        bodyText: 500,
        mainVisible: true,
        h1Visible: true,
        anchorCount: 4,
        horizontalOverflow: false,
      },
      full_page: { ...renderFile(root, full), width, height },
    };
  });
  const pdf = path.join(renderDir, "print.pdf");
  fs.writeFileSync(pdf, validGatePdf());
  const manifest = path.join(renderDir, "manifest.json");
  fs.writeFileSync(
    manifest,
    `${JSON.stringify({
      schema_version: 1,
      source: { path: path.relative(root, htmlPath), sha256: `sha256:${fileDigest(htmlPath)}` },
      observation: {
        assurance_level: "local-observation",
        producer: { name: "pm:artifact-render-check", version: PLUGIN_VERSION },
        browser: {
          path: path.resolve(root, "test-chromium"),
          executable_sha256_before: `sha256:${"a".repeat(64)}`,
          executable_sha256_after: `sha256:${"a".repeat(64)}`,
          engine: "chromium",
          version: "Chromium 123.0.0 test",
        },
        invocation_configuration_sha256: invocationConfigurationDigest("data-review-"),
      },
      captures,
      print: { ...renderFile(root, pdf), pages: 1 },
      markers: reviewRenderedMarkers(values),
      checked_at: "2026-07-12T00:00:00Z",
    })}\n`
  );
  return { path: path.relative(root, manifest), sha256: fileDigest(manifest) };
}

function reviewReportForMarkers({ coverage = [] } = {}) {
  return {
    source: { commit: "abc123", base_ref: "origin/main", base_commit: "base123" },
    outcome: "passed",
    review_round: 1,
    blockers: [],
    coverage: { required: coverage, completed: coverage },
    top_issue: "No unresolved Review finding.",
    next_action: "Proceed to full verification.",
  };
}

function reviewRenderedMarkers({ coverage = "0/0" } = {}) {
  const report = reviewReportForMarkers();
  const rows = [
    [{ "data-review-outcome": "passed" }, "passed"],
    [{ "data-review-round": "1" }, "1"],
    [{ "data-review-blockers": "0" }, "0"],
    [{ "data-review-coverage": coverage }, coverage],
    [
      { "data-review-source-sha256": fileDigestBytes(Buffer.from(report.source.commit)) },
      `Target: ${report.source.commit}`,
    ],
    [
      {
        "data-review-base-sha256": fileDigestBytes(
          Buffer.from(`${report.source.base_ref}:${report.source.base_commit}`)
        ),
      },
      `Base: ${report.source.base_ref} at ${report.source.base_commit}`,
    ],
    [
      { "data-review-top-issue-sha256": fileDigestBytes(Buffer.from(report.top_issue)) },
      `Top issue: ${report.top_issue}`,
    ],
    [
      { "data-review-next-action-sha256": fileDigestBytes(Buffer.from(report.next_action)) },
      `Next: ${report.next_action}`,
    ],
  ];
  return rows.map(([attributes, text]) => ({
    attributes,
    text,
    firstScreenText: text,
    visible: true,
    inViewport: true,
  }));
}

function fileDigestBytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function renderFile(root, file) {
  return {
    path: path.relative(root, file),
    sha256: `sha256:${fileDigest(file)}`,
    bytes: fs.statSync(file).size,
  };
}

function fileDigest(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function validGatePng(width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  const chunks = [Buffer.from("89504e470d0a1a0a", "hex"), gatePngChunk("IHDR", header)];
  chunks.push(gatePngChunk("IDAT", zlib.deflateSync(rows)), gatePngChunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(chunks);
}

function gatePngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(gateCrc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return chunk;
}

function gateCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function validGatePdf() {
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n",
  ];
  let body = "%PDF-1.7\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += object;
  }
  body += `%${"padding".repeat(150)}\n`;
  const xref = Buffer.byteLength(body, "latin1");
  body += "xref\n0 4\n0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

test("canonical gate manifests are bound to the active session run ID", () => {
  const rows = [gate("verification")];
  const ok = checkGateManifest(manifest(rows, { run_id: "dev_current" }), {
    currentCommit: "abc123",
    requiredGates: ["verification"],
    runId: "dev_current",
  });
  assert.equal(ok.ok, true, JSON.stringify(ok.issues));
  const stale = checkGateManifest(manifest(rows, { run_id: "dev_old" }), {
    currentCommit: "abc123",
    requiredGates: ["verification"],
    runId: "dev_current",
  });
  assert.equal(stale.ok, false);
  assert.match(stale.issues.map((entry) => entry.message).join("\n"), /active session dev_current/);
  assert.equal(parseArgs(["--run-id", "dev_current"]).runId, "dev_current");
});

test("dev gate checker default rejects a partial final gate manifest", () => {
  const result = checkGateManifest(manifest([gate("review"), gate("verification")]), {
    currentCommit: "abc123",
    manifestPath: ".pm/dev-sessions/current.gates.json",
  });
  assert.equal(result.ok, false);
  const text = result.issues.map((i) => i.message).join("\n");
  assert.match(text, /missing required gate tdd/);
  assert.match(text, /missing required gate design-critique/);
  assert.match(text, /missing required gate qa/);
});

test("dev gate checker does not let an empty required list bypass default gates", () => {
  const result = checkGateManifest(manifest([gate("review"), gate("verification")]), {
    currentCommit: "abc123",
    requiredGates: [],
    manifestPath: ".pm/dev-sessions/current.gates.json",
  });
  assert.equal(result.ok, false);
  assert.match(result.issues.map((i) => i.message).join("\n"), /missing required gate tdd/);
});

test("dev gate checker accepts recertified older evidence rows at final HEAD", () => {
  const result = checkGateManifest(
    manifest([
      gate("tdd", "implementation-sha", {
        verified_commit: "final-sha",
        verified_at: "2026-07-01T05:30:00Z",
      }),
      gate("simplify", "simplify-sha", {
        verified_commit: "final-sha",
        verified_at: "2026-07-01T05:30:00Z",
      }),
      gate("design-critique", "design-sha", {
        verified_commit: "final-sha",
        verified_at: "2026-07-01T05:30:00Z",
      }),
      gate("qa", "qa-sha", {
        verified_commit: "final-sha",
        verified_at: "2026-07-01T05:30:00Z",
      }),
      gate("review", "review-sha", {
        verified_commit: "final-sha",
        verified_at: "2026-07-01T05:30:00Z",
      }),
      gate("verification", "final-sha"),
    ]),
    {
      currentCommit: "final-sha",
      manifestPath: ".pm/dev-sessions/current.gates.json",
      reviewEvidenceMode: "inspect",
    }
  );
  assert.equal(result.inspection_ok, true, JSON.stringify(result.issues, null, 2));
});

test("dev gate checker accepts current evidence even when old recertification remains", () => {
  const result = checkGateManifest(
    manifest([
      gate("review", "final-sha", {
        verified_commit: "older-final-sha",
        verified_at: "2026-07-01T05:30:00Z",
      }),
    ]),
    {
      currentCommit: "final-sha",
      requiredGates: ["review"],
      manifestPath: ".pm/dev-sessions/current.gates.json",
      reviewEvidenceMode: "inspect",
    }
  );
  assert.equal(result.inspection_ok, true, JSON.stringify(result.issues, null, 2));
});

test("dev gate checker accepts explicit skip reasons for required gates", () => {
  const result = checkGateManifest(
    manifest([
      gate("tdd", "abc123", {
        status: "skipped",
        artifact: "",
        reason: "docs-only change",
      }),
    ]),
    {
      currentCommit: "abc123",
      requiredGates: ["tdd"],
      manifestPath: ".pm/dev-sessions/current.gates.json",
    }
  );
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test("dev gate checker allows UI gates to skip only for no-UI-impact reasons", () => {
  const result = checkGateManifest(
    manifest([
      gate("design-critique", "abc123", {
        status: "skipped",
        artifact: "",
        reason: "backend-only change with no UI impact",
      }),
      gate("qa", "abc123", {
        status: "skipped",
        artifact: "",
        reason: "backend-only change with no visual impact",
      }),
    ]),
    {
      currentCommit: "abc123",
      requiredGates: ["design-critique", "qa"],
      manifestPath: ".pm/dev-sessions/current.gates.json",
    }
  );
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test("dev gate checker rejects UI skips when UI-impact files changed", () => {
  const result = checkGateManifest(
    manifest([
      gate("design-critique", "abc123", {
        status: "skipped",
        artifact: "",
        reason: "backend-only change with no UI impact",
      }),
      gate("qa", "abc123", {
        status: "skipped",
        artifact: "",
        reason: "backend-only change with no visual impact",
      }),
    ]),
    {
      currentCommit: "abc123",
      requiredGates: ["design-critique", "qa"],
      changedFiles: ["apps/web/src/screens/Orders.tsx", "apps/web/src/styles/orders.css"],
      manifestPath: ".pm/dev-sessions/current.gates.json",
    }
  );
  assert.equal(result.ok, false);
  const text = result.issues.map((i) => i.message).join("\n");
  assert.match(text, /design-critique cannot be skipped when UI-impact files changed/);
  assert.match(text, /qa cannot be skipped when UI-impact files changed/);
});

test("dev gate checker rejects UI skips for plain frontend JavaScript and TypeScript", () => {
  const result = checkGateManifest(
    manifest([
      gate("design-critique", "abc123", {
        status: "skipped",
        artifact: "",
        reason: "backend-only change with no UI impact",
      }),
      gate("qa", "abc123", {
        status: "skipped",
        artifact: "",
        reason: "backend-only change with no visual impact",
      }),
    ]),
    {
      currentCommit: "abc123",
      requiredGates: ["design-critique", "qa"],
      changedFiles: [
        "src/App.js",
        "app/page.js",
        "app/layout.ts",
        "src/app/app.component.ts",
        "src/app/app.routes.ts",
        "src/app/app-routing.module.ts",
        "src/routes.ts",
        "src/router.ts",
        "src/routing.ts",
        "src/routes.ts",
        "src/router/index.ts",
        "src/features/orders/useOrderFilters.ts",
        "src/hooks/useCheckout.ts",
        "src/store/cart.ts",
        "src/context/AuthContext.ts",
        "src/redux/cart.ts",
        "src/reducers/cart.ts",
        "src/slices/cartSlice.ts",
        "src/zustand/cart.ts",
        "tailwind.config.ts",
        "apps/admin/src/store/cart.ts",
        "packages/admin/src/hooks/useCheckout.ts",
        "apps/backoffice/src/redux/cart.ts",
        "apps/admin/src/router.ts",
        "apps/admin/tailwind.config.ts",
        "packages/ui/tokens/colors.json",
        "src/design-tokens.json",
        "tokens.config.json",
        "theme.config.json",
        "style-dictionary.config.json",
        "app/page.mdx",
        "src/app/docs/page.md",
        "apps/admin/app/page.ts",
        "app/javascript/controllers/menu_controller.js",
        "assets/javascripts/checkout.js",
        "apps/web/src/main.ts",
      ],
      manifestPath: ".pm/dev-sessions/current.gates.json",
    }
  );
  assert.equal(result.ok, false);
  const text = result.issues.map((i) => i.message).join("\n");
  assert.match(text, /design-critique cannot be skipped when UI-impact files changed/);
  assert.match(text, /qa cannot be skipped when UI-impact files changed/);
});

test("dev gate checker rejects UI skips for static and server-rendered templates", () => {
  const result = checkGateManifest(
    manifest([
      gate("design-critique", "abc123", {
        status: "skipped",
        artifact: "",
        reason: "backend-only change with no UI impact",
      }),
      gate("qa", "abc123", {
        status: "skipped",
        artifact: "",
        reason: "backend-only change with no visual impact",
      }),
    ]),
    {
      currentCommit: "abc123",
      requiredGates: ["design-critique", "qa"],
      changedFiles: [
        "templates/base.html",
        "public/index.html",
        "views/orders/show.erb",
        "views/cart/show.ejs",
        "templates/emails/receipt.hbs",
        "templates/page.handlebars",
        "templates/product.liquid",
        "templates/profile.twig",
        "templates/dashboard.njk",
        "templates/report.j2",
        "templates/app.astro",
        "templates/article.pug",
        "templates/news.jade",
        "templates/card.slim",
        "templates/item.haml",
        "templates/post.mustache",
        "Pages/Account/Login.cshtml",
        "Pages/Index.razor",
        "resources/views/orders/show.blade.php",
      ],
      manifestPath: ".pm/dev-sessions/current.gates.json",
    }
  );
  assert.equal(result.ok, false);
  const text = result.issues.map((i) => i.message).join("\n");
  assert.match(text, /design-critique cannot be skipped when UI-impact files changed/);
  assert.match(text, /qa cannot be skipped when UI-impact files changed/);
});

test("dev gate checker does not treat every JavaScript file as UI impact", () => {
  const result = checkGateManifest(
    manifest([
      gate("design-critique", "abc123", {
        status: "skipped",
        artifact: "",
        reason: "backend-only change with no UI impact",
      }),
      gate("qa", "abc123", {
        status: "skipped",
        artifact: "",
        reason: "backend-only change with no visual impact",
      }),
    ]),
    {
      currentCommit: "abc123",
      requiredGates: ["design-critique", "qa"],
      changedFiles: ["services/orders/recalculate.js", "app/api/orders/route.ts"],
      manifestPath: ".pm/dev-sessions/current.gates.json",
    }
  );
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test("dev gate checker rejects UI gate environment failures recorded as skipped", () => {
  const result = checkGateManifest(
    manifest([
      gate("design-critique", "abc123", {
        status: "skipped",
        artifact: "",
        reason: "no UI screenshots because dev server cannot start",
      }),
      gate("qa", "abc123", {
        status: "skipped",
        artifact: "",
        reason: "no UI artifacts because dev server cannot start",
      }),
    ]),
    {
      currentCommit: "abc123",
      requiredGates: ["design-critique", "qa"],
      manifestPath: ".pm/dev-sessions/current.gates.json",
    }
  );
  assert.equal(result.ok, false);
  const text = result.issues.map((i) => i.message).join("\n");
  assert.match(text, /design-critique cannot be skipped for environment failure/);
  assert.match(text, /qa cannot be skipped for environment failure/);
});

test("dev gate checker rejects arbitrary tdd and simplify skip reasons", () => {
  const result = checkGateManifest(
    manifest([
      gate("tdd", "abc123", {
        status: "skipped",
        artifact: "",
        reason: "no time; tests not written",
      }),
      gate("simplify", "abc123", {
        status: "skipped",
        artifact: "",
        reason: "no time",
      }),
    ]),
    {
      currentCommit: "abc123",
      requiredGates: ["tdd", "simplify"],
      manifestPath: ".pm/dev-sessions/current.gates.json",
    }
  );
  assert.equal(result.ok, false);
  const text = result.issues.map((i) => i.message).join("\n");
  assert.match(text, /tdd skip reason is not allowed/);
  assert.match(text, /simplify skip reason is not allowed/);
});

test("dev gate checker rejects tdd skips when behavior files changed", () => {
  const result = checkGateManifest(
    manifest([
      gate("tdd", "abc123", {
        status: "skipped",
        artifact: "",
        reason: "docs-only change",
      }),
    ]),
    {
      currentCommit: "abc123",
      requiredGates: ["tdd"],
      changedFiles: [
        "src/orders/calculate-total.ts",
        "app/page.mdx",
        "src/app/docs/page.md",
        "templates/base.html",
      ],
      manifestPath: ".pm/dev-sessions/current.gates.json",
    }
  );
  assert.equal(result.ok, false);
  assert.match(
    result.issues.map((i) => i.message).join("\n"),
    /tdd cannot be skipped when behavior files changed/
  );
});

test("dev gate checker rejects no-code simplify skips when runtime source changed", () => {
  const result = checkGateManifest(
    manifest([
      gate("simplify", "abc123", {
        status: "skipped",
        artifact: "",
        reason: "no code changes",
      }),
    ]),
    {
      currentCommit: "abc123",
      requiredGates: ["simplify"],
      changedFiles: [
        "skills/dev/SKILL.md",
        ".githooks/pre-push",
        "plugin.config.json",
        "app/page.mdx",
        "src/app/docs/page.md",
        "public/index.html",
      ],
      manifestPath: ".pm/dev-sessions/current.gates.json",
    }
  );
  assert.equal(result.ok, false);
  assert.match(
    result.issues.map((i) => i.message).join("\n"),
    /simplify cannot use no-code skip when runtime source files changed/
  );
});

test("dev gate checker validates contextual simplify skip reasons", () => {
  const xsWithoutSize = checkGateManifest(
    manifest([
      gate("simplify", "abc123", {
        status: "skipped",
        artifact: "",
        reason: "XS size",
      }),
    ]),
    {
      currentCommit: "abc123",
      requiredGates: ["simplify"],
      changedFiles: ["scripts/dev-gate-check.js"],
      manifestPath: ".pm/dev-sessions/current.gates.json",
    }
  );
  assert.equal(xsWithoutSize.ok, false);
  assert.match(
    xsWithoutSize.issues.map((i) => i.message).join("\n"),
    /simplify XS skip requires manifest size XS/
  );

  const xsWithSize = checkGateManifest(
    manifest(
      [
        gate("simplify", "abc123", {
          status: "skipped",
          artifact: "",
          reason: "XS size",
        }),
      ],
      { size: "XS" }
    ),
    {
      currentCommit: "abc123",
      requiredGates: ["simplify"],
      changedFiles: ["scripts/dev-gate-check.js"],
      manifestPath: ".pm/dev-sessions/current.gates.json",
    }
  );
  assert.equal(xsWithSize.ok, true, JSON.stringify(xsWithSize.issues, null, 2));

  const kindWithoutMatch = checkGateManifest(
    manifest(
      [
        gate("simplify", "abc123", {
          status: "skipped",
          artifact: "",
          reason: "kind bug uses review gate instead",
        }),
      ],
      { kind: "task" }
    ),
    {
      currentCommit: "abc123",
      requiredGates: ["simplify"],
      changedFiles: ["skills/dev/SKILL.md"],
      manifestPath: ".pm/dev-sessions/current.gates.json",
    }
  );
  assert.equal(kindWithoutMatch.ok, false);
  assert.match(
    kindWithoutMatch.issues.map((i) => i.message).join("\n"),
    /simplify kind skip requires manifest kind bug/
  );

  const kindWithMatch = checkGateManifest(
    manifest(
      [
        gate("simplify", "abc123", {
          status: "skipped",
          artifact: "",
          reason: "kind bug uses review gate instead",
        }),
      ],
      { kind: "bug" }
    ),
    {
      currentCommit: "abc123",
      requiredGates: ["simplify"],
      changedFiles: ["skills/dev/SKILL.md"],
      manifestPath: ".pm/dev-sessions/current.gates.json",
    }
  );
  assert.equal(kindWithMatch.ok, true, JSON.stringify(kindWithMatch.issues, null, 2));
});

test("dev gate checker rejects skipped review and verification gates by default", () => {
  const result = checkGateManifest(
    manifest([
      gate("review", "abc123", {
        status: "skipped",
        artifact: "",
        reason: "claimed no review needed",
      }),
      gate("verification", "abc123", {
        status: "skipped",
        artifact: "",
        reason: "tests remembered from earlier",
      }),
    ]),
    {
      currentCommit: "abc123",
      requiredGates: ["review", "verification"],
      manifestPath: ".pm/dev-sessions/current.gates.json",
    }
  );
  assert.equal(result.ok, false);
  const text = result.issues.map((i) => i.message).join("\n");
  assert.match(text, /required gate review cannot be skipped/);
  assert.match(text, /required gate verification cannot be skipped/);
});

test("dev gate checker rejects passed gates with missing artifacts", () => {
  const result = checkGateManifest(manifest([gate("design-critique")]), {
    currentCommit: "abc123",
    requiredGates: ["design-critique"],
    changedFiles: ["app/page.js"],
    manifestPath: ".pm/dev-sessions/current.gates.json",
  });
  assert.equal(result.ok, true, "control row uses an existing artifact");

  const missing = checkGateManifest(
    manifest([
      gate("design-critique", "abc123", {
        artifact: "/tmp/pm-dev-gate-missing-artifact.json",
      }),
    ]),
    {
      currentCommit: "abc123",
      requiredGates: ["design-critique"],
      changedFiles: ["app/page.js"],
      manifestPath: ".pm/dev-sessions/current.gates.json",
    }
  );
  assert.equal(missing.ok, false);
  assert.match(missing.issues.map((i) => i.message).join("\n"), /artifact path does not exist/);
});

test("legacy review state anchors are readable only through non-authoritative inspection", () => {
  const result = checkGateManifest(
    manifest([
      gate("review", "abc123", {
        artifact: "tests/dev-gate-check.test.js#review",
      }),
    ]),
    {
      currentCommit: "abc123",
      requiredGates: ["review"],
      manifestPath: ".pm/dev-sessions/current.gates.json",
      reviewEvidenceMode: "inspect",
    }
  );
  assert.equal(result.ok, false);
  assert.equal(result.authoritative, false);
  assert.equal(result.inspection_ok, true, JSON.stringify(result.issues, null, 2));
});

test("dev gate checker rejects stale gate commits", () => {
  const result = checkGateManifest(manifest([gate("review", "oldsha")]), {
    currentCommit: "newsha",
    requiredGates: ["review"],
    manifestPath: ".pm/dev-sessions/current.gates.json",
  });
  assert.equal(result.ok, false);
  assert.match(result.issues.map((i) => i.message).join("\n"), /stale for current commit/);
});

test("dev gate checker ignores stale rows for gates that are not required", () => {
  const result = checkGateManifest(manifest([gate("tdd", "oldsha"), gate("simplify", "abc123")]), {
    currentCommit: "abc123",
    requiredGates: ["simplify"],
    manifestPath: ".pm/dev-sessions/current.gates.json",
  });
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test("dev gate checker rejects missing required gates", () => {
  const result = checkGateManifest(manifest([gate("verification")]), {
    currentCommit: "abc123",
    requiredGates: ["review"],
    manifestPath: ".pm/dev-sessions/current.gates.json",
  });
  assert.equal(result.ok, false);
  assert.match(result.issues.map((i) => i.message).join("\n"), /missing required gate review/);
});

test("dev gate checker rejects failed or blocked required gates", () => {
  const result = checkGateManifest(
    manifest([
      gate("review", "abc123", {
        status: "failed",
        reason: "P1 finding remains unresolved",
      }),
    ]),
    {
      currentCommit: "abc123",
      requiredGates: ["review"],
      manifestPath: ".pm/dev-sessions/current.gates.json",
    }
  );
  assert.equal(result.ok, false);
  assert.match(result.issues.map((i) => i.message).join("\n"), /required gate review is failed/);
});

test("dev gate checker rejects skip rows without a reason", () => {
  const result = checkGateManifest(
    manifest([
      gate("design-critique", "abc123", {
        status: "skipped",
        artifact: "",
      }),
    ]),
    {
      currentCommit: "abc123",
      requiredGates: ["design-critique"],
      manifestPath: ".pm/dev-sessions/current.gates.json",
    }
  );
  assert.equal(result.ok, false);
  assert.match(result.issues.map((i) => i.message).join("\n"), /reason is required/);
});

test("dev gate checker validates recertification fields as a pair", () => {
  const result = checkGateManifest(
    manifest([
      gate("review", "oldsha", {
        verified_commit: "newsha",
      }),
    ]),
    {
      currentCommit: "newsha",
      requiredGates: ["review"],
      manifestPath: ".pm/dev-sessions/current.gates.json",
    }
  );
  assert.equal(result.ok, false);
  assert.match(
    result.issues.map((i) => i.message).join("\n"),
    /verified_commit and verified_at must be written together/
  );
});

test("dev gate checker parses comma-separated required gates", () => {
  assert.deepEqual(parseArgs(["--require", "review,verification"]).requiredGates, [
    "review",
    "verification",
  ]);
});

test("dev gate checker parses base refs and changed files", () => {
  const parsed = parseArgs([
    "--branch",
    "chore/Review++Gate",
    "--base",
    "origin/main",
    "--remote",
    "origin",
    "--changed-file",
    "src/App.tsx",
    "--changed-files",
    "README.md,skills/dev/SKILL.md",
  ]);
  assert.equal(parsed.currentBranch, "chore/Review++Gate");
  assert.equal(parsed.baseRef, "origin/main");
  assert.equal(parsed.remote, "origin");
  assert.deepEqual(parsed.changedFiles, ["src/App.tsx", "README.md", "skills/dev/SKILL.md"]);
});

test("canonical sessions require the exact delivery branch, not only a colliding slug", () => {
  const canonicalSession = {
    run_id: "dev_branch",
    slug: "review-gate",
    source: { branch: "chore/Review++Gate" },
    routing: { review_mode: "code-scan" },
  };
  const result = checkGateManifest(manifest([], { run_id: canonicalSession.run_id }), {
    currentCommit: "abc123",
    currentBranch: "chore/review-gate",
    requiredGates: [],
    canonicalSession,
    manifestPath: ".pm/dev-sessions/review-gate/gates.json",
  });
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result.issues),
    /sibling session branch must equal chore\/review-gate/
  );
});

test("dev gate checker defaults to enforcement and accepts explicit migration inspection", () => {
  assert.equal(parseArgs([]).reviewEvidenceMode, "enforce");
  assert.equal(parseArgs(["--review-evidence-mode", "inspect"]).reviewEvidenceMode, "inspect");
  assert.throws(
    () => parseArgs(["--review-evidence-mode", "unsafe"]),
    /must be enforce or inspect/
  );
});

test("dev gate checker can load changed files for a target commit that is not HEAD", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-dev-git-target-"));
  try {
    const git = (...args) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    assert.equal(git("init", "-q").status, 0);
    assert.equal(git("config", "user.email", "test@example.com").status, 0);
    assert.equal(git("config", "user.name", "Test User").status, 0);
    fs.writeFileSync(path.join(dir, "base.txt"), "base\n");
    assert.equal(git("add", ".").status, 0);
    assert.equal(git("commit", "-q", "-m", "base").status, 0);
    assert.equal(git("branch", "base").status, 0);
    fs.mkdirSync(path.join(dir, "commands"), { recursive: true });
    fs.writeFileSync(path.join(dir, "commands", "design-critique.md"), "runtime\n");
    assert.equal(git("add", ".").status, 0);
    assert.equal(git("commit", "-q", "-m", "runtime").status, 0);
    const target = git("rev-parse", "HEAD").stdout.trim();
    fs.writeFileSync(path.join(dir, "unrelated.txt"), "head\n");
    assert.equal(git("add", ".").status, 0);
    assert.equal(git("commit", "-q", "-m", "head").status, 0);

    assert.deepEqual(loadChangedFilesFromGit("base", dir, target), ["commands/design-critique.md"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("deriveSessionSlug normalizes branch families the same way hooks and skills expect", () => {
  assert.equal(deriveSessionSlug("feat/add-auth"), "add-auth");
  assert.equal(deriveSessionSlug("codex/pm-dev-workflow-proposal"), "pm-dev-workflow-proposal");
  assert.equal(deriveSessionSlug("release/v1.2.3"), "v1.2.3");
  assert.equal(deriveSessionSlug("team/feature/foo"), "team-feature-foo");
  assert.equal(deriveSessionSlug("feat/Checkout Card++"), "checkout-card");
  assert.equal(deriveSessionSlug("CODEX/UPPER/Case"), "upper-case");
  assert.equal(deriveSessionSlug(""), "current");
});

test("dev gate checker can explicitly allow only skippable gates", () => {
  const parsed = parseArgs(["--no-skip", "--allow-skip", "qa"]);
  const allowed = checkGateManifest(
    manifest([
      gate("qa", "abc123", {
        status: "skipped",
        artifact: "",
        reason: "backend-only change with no UI impact",
      }),
    ]),
    {
      currentCommit: "abc123",
      requiredGates: ["qa"],
      allowSkippedGates: parsed.allowSkippedGates,
      manifestPath: ".pm/dev-sessions/current.gates.json",
    }
  );
  assert.equal(allowed.ok, true, JSON.stringify(allowed.issues, null, 2));

  assert.throws(
    () => parseArgs(["--allow-skip", "review"]),
    /cannot include non-skippable gate review/
  );
  assert.throws(
    () => parseArgs(["--allow-skip", "verification"]),
    /cannot include non-skippable gate verification/
  );

  const rejected = checkGateManifest(
    manifest([
      gate("review", "abc123", {
        status: "skipped",
        artifact: "",
        reason: "explicitly allowed by caller",
      }),
      gate("verification", "abc123", {
        status: "skipped",
        artifact: "",
        reason: "explicitly allowed by caller",
      }),
    ]),
    {
      currentCommit: "abc123",
      requiredGates: ["review", "verification"],
      allowSkippedGates: ["review", "verification"],
      manifestPath: ".pm/dev-sessions/current.gates.json",
    }
  );
  assert.equal(rejected.ok, false);
  const text = rejected.issues.map((i) => i.message).join("\n");
  assert.match(text, /required gate review cannot be skipped/);
  assert.match(text, /required gate verification cannot be skipped/);
});

test("dev gate checker rejects unknown required gate names", () => {
  const result = checkGateManifest(manifest([gate("review")]), {
    currentCommit: "abc123",
    requiredGates: ["review", "not-a-gate"],
    manifestPath: ".pm/dev-sessions/current.gates.json",
  });
  assert.equal(result.ok, false);
  assert.match(result.issues.map((i) => i.message).join("\n"), /unknown required gate/);
});

test("dev gate checker CLI args require values", () => {
  assert.throws(() => parseArgs(["--manifest"]), /--manifest requires a value/);
});

test("dev gate checker CLI exits non-zero on stale gate state", () => {
  const tmp = makeTmpManifest(manifest([gate("review", "oldsha")]));
  try {
    const result = spawnSync(
      process.execPath,
      [checkScript, "--manifest", tmp.file, "--commit", "newsha", "--require", "review", "--json"],
      {
        cwd: repoRoot,
        encoding: "utf8",
      }
    );
    assert.notEqual(result.status, 0);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, false);
    assert.match(output.issues.map((i) => i.message).join("\n"), /stale for current commit/);
  } finally {
    tmp.cleanup();
  }
});

test("dev gate checker CLI cannot authorize a legacy-shaped required Review row", () => {
  const tmp = makeTmpManifest(manifest([gate("review")]));
  try {
    const enforced = spawnSync(
      process.execPath,
      [checkScript, "--manifest", tmp.file, "--commit", "abc123", "--require", "review", "--json"],
      { cwd: repoRoot, encoding: "utf8" }
    );
    assert.notEqual(enforced.status, 0);
    assert.match(
      JSON.parse(enforced.stdout)
        .issues.map((item) => item.message)
        .join("\n"),
      /requires evidence_kind review-report-v1 in enforcement mode/
    );

    const inspected = spawnSync(
      process.execPath,
      [
        checkScript,
        "--manifest",
        tmp.file,
        "--commit",
        "abc123",
        "--require",
        "review",
        "--review-evidence-mode",
        "inspect",
        "--json",
      ],
      { cwd: repoRoot, encoding: "utf8" }
    );
    assert.notEqual(inspected.status, 0, inspected.stderr || inspected.stdout);
    assert.deepEqual(JSON.parse(inspected.stdout), {
      ok: false,
      authoritative: false,
      inspection_ok: true,
      issues: [],
    });
  } finally {
    tmp.cleanup();
  }
});

test("dev gate checker does not require simplify by default (absorbed into review, v1.9)", () => {
  const result = checkGateManifest(
    manifest([
      gate("tdd"),
      gate("design-critique"),
      gate("qa"),
      gate("review"),
      gate("verification"),
    ]),
    {
      currentCommit: "abc123",
      manifestPath: ".pm/dev-sessions/current.gates.json",
      reviewEvidenceMode: "inspect",
    }
  );
  assert.equal(result.inspection_ok, true, JSON.stringify(result.issues, null, 2));
});

test("dev gate checker tolerates legacy simplify rows without requiring freshness", () => {
  const result = checkGateManifest(
    manifest([
      gate("tdd"),
      gate("simplify", "old-stale-sha"),
      gate("design-critique"),
      gate("qa"),
      gate("review"),
      gate("verification"),
    ]),
    {
      currentCommit: "abc123",
      manifestPath: ".pm/dev-sessions/current.gates.json",
      reviewEvidenceMode: "inspect",
    }
  );
  assert.equal(result.inspection_ok, true, JSON.stringify(result.issues, null, 2));
});

test("legacy simplify rows with failed or blocked status still fail the checker", () => {
  const result = checkGateManifest(
    manifest([
      gate("tdd"),
      gate("simplify", "abc123", { status: "failed", reason: "findings not fixed" }),
      gate("design-critique"),
      gate("qa"),
      gate("review"),
      gate("verification"),
    ]),
    { currentCommit: "abc123" }
  );
  assert.equal(result.ok, false);
  assert.match(result.issues.map((i) => i.message).join("\n"), /legacy gate simplify is failed/);
});

test("legacy passed simplify rows are not policed for artifact existence", () => {
  const result = checkGateManifest(
    manifest([
      gate("tdd"),
      gate("simplify", "old-sha", { artifact: ".pm/dev-sessions/gone.md#simplify" }),
      gate("design-critique"),
      gate("qa"),
      gate("review"),
      gate("verification"),
    ]),
    { currentCommit: "abc123", reviewEvidenceMode: "inspect" }
  );
  assert.equal(result.inspection_ok, true, JSON.stringify(result.issues, null, 2));
});

test("M/L/XL manifests require the review row to record the absorbed lenses", () => {
  const noLenses = checkGateManifest(
    manifest(
      [gate("tdd"), gate("design-critique"), gate("qa"), gate("review"), gate("verification")],
      { size: "M" }
    ),
    { currentCommit: "abc123", reviewEvidenceMode: "inspect" }
  );
  assert.equal(noLenses.ok, false);
  assert.match(noLenses.issues.map((i) => i.message).join("\n"), /review row must record lenses/);

  const withLenses = checkGateManifest(
    manifest(
      [
        gate("tdd"),
        gate("design-critique"),
        gate("qa"),
        gate("review", "abc123", {
          lenses: ["bug", "design", "edge", "reuse", "quality", "efficiency"],
        }),
        gate("verification"),
      ],
      { size: "L" }
    ),
    { currentCommit: "abc123", reviewEvidenceMode: "inspect" }
  );
  assert.equal(withLenses.inspection_ok, true, JSON.stringify(withLenses.issues, null, 2));

  const partialLenses = checkGateManifest(
    manifest(
      [
        gate("tdd"),
        gate("design-critique"),
        gate("qa"),
        gate("review", "abc123", { lenses: ["bug", "design", "edge"] }),
        gate("verification"),
      ],
      { size: "XL" }
    ),
    { currentCommit: "abc123", reviewEvidenceMode: "inspect" }
  );
  assert.equal(partialLenses.ok, false);
  assert.match(
    partialLenses.issues.map((i) => i.message).join("\n"),
    /review lenses must include reuse, quality, efficiency/
  );
});

test("XS/S and unsized manifests do not require review lenses", () => {
  for (const size of ["XS", "S", undefined]) {
    const overrides = size ? { size } : {};
    const result = checkGateManifest(
      manifest(
        [gate("tdd"), gate("design-critique"), gate("qa"), gate("review"), gate("verification")],
        overrides
      ),
      { currentCommit: "abc123", reviewEvidenceMode: "inspect" }
    );
    assert.equal(result.inspection_ok, true, `size=${size}: ${JSON.stringify(result.issues)}`);
  }
});

test("single-gate --require checks do not enforce review lenses on an unrelated preserved review row", () => {
  // Mirrors skills/design-critique/steps/03-critique.md, which runs
  // `--require design-critique` while preserving any existing `review` row untouched.
  const result = checkGateManifest(
    manifest([gate("design-critique"), gate("review")], { size: "M" }),
    { currentCommit: "abc123", requiredGates: ["design-critique"] }
  );
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});
