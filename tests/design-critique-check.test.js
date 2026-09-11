"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { buildManifest, inspectHtmlArtifact } = require("../scripts/artifact-check");
const { normalizeAuditBytes } = require("../scripts/design-critique-audit-normalize");
const {
  ACQUISITION_METHOD,
  BROWSER_ARGS_PROFILE,
  CAPTURE_ASSURANCE,
  browserIdentity: inspectBrowserIdentity,
  captureVisualMetrics,
  redactedUrlIdentity,
} = require("../scripts/design-critique-capture");
const {
  checkDesignCritique,
  findingId,
  reconciliationId,
  reviewFindingId,
} = require("../scripts/design-critique-check");
const { inspectPngVisualBytes } = require("../scripts/lib/media-inspect");
const {
  createReviewReceipt,
  normalizePrimaryReviewResult,
} = require("../scripts/lib/design-critique-review-result");
const { writeProjectDirectoryAtomic } = require("../scripts/lib/project-atomic-write");
const { version: PLUGIN_VERSION } = require("../plugin.config.json");

const COMMIT = "a".repeat(40);
const PNG_CACHE = new Map();

function digest(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function write(root, rel, bytes) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  return { path: rel, sha256: digest(fs.readFileSync(file)) };
}

function makeFixture(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-design-critique-"));
  const routePath = "evidence/route.json";
  const capturesPath = "evidence/captures.json";
  const reviewsPath = "evidence/reviews.json";
  const reportPath = "evidence/report.json";
  const mode = options.mode || "product-ui";
  const routeSchemaVersion = options.routeSchemaVersion ?? 2;
  const platform = mode === "pm-artifact" ? "document" : "web";
  const artifact =
    mode === "pm-artifact"
      ? { ...write(root, "evidence/files/subject.html", artifactSubjectHtml()), kind: "report" }
      : null;
  const coverage =
    mode === "pm-artifact"
      ? [
          coverageRow("artifact-desktop", "primary", "desktop", true),
          coverageRow("artifact-tablet", "responsive", "tablet", true),
          coverageRow("artifact-narrow", "responsive", "narrow", true),
          coverageRow("artifact-print", "print", "print", true),
        ]
      : routeSchemaVersion === 1
        ? [
            coverageRow("ui-primary", "primary", "desktop", true),
            coverageRow(
              "ui-empty",
              "empty",
              "desktop",
              false,
              "The changed detail route has no empty collection state."
            ),
            coverageRow(
              "ui-error",
              "error",
              "desktop",
              false,
              "Error rendering is unchanged and outside this surface."
            ),
            coverageRow(
              "ui-boundary",
              "boundary",
              "desktop",
              false,
              "The fixed label has a validated maximum length."
            ),
          ]
        : [
            coverageRow("ui-primary", "primary", "desktop", true),
            coverageRow("ui-primary-narrow", "primary", "narrow", true),
            coverageRow(
              "ui-empty",
              "empty",
              "desktop",
              false,
              "The changed detail route has no empty collection state."
            ),
            coverageRow(
              "ui-error",
              "error",
              "desktop",
              false,
              "Error rendering is unchanged and outside this surface."
            ),
            coverageRow(
              "ui-boundary",
              "boundary",
              "desktop",
              false,
              "The fixed label has a validated maximum length."
            ),
            ...["loading", "success", "focus", "disabled", "keyboard", "modal"].map((state) =>
              coverageRow(
                `ui-${state}`,
                state,
                "desktop",
                false,
                `The ${state} state is not present on this static detail surface.`
              )
            ),
          ];
  const route = {
    schema_version: routeSchemaVersion,
    run_id: "dc-test-run",
    created_at: "2026-07-12T00:00:00Z",
    mode,
    source: {
      commit: COMMIT,
      base_ref: "origin/main",
      base_commit: "c".repeat(40),
      diff_sha256: "b".repeat(64),
    },
    subjects: [
      {
        id: "account-detail",
        title: "Account detail",
        surface: "/accounts/1",
        platform,
        ...(artifact ? { artifact } : {}),
      },
    ],
    coverage,
  };
  write(root, routePath, `${JSON.stringify(route, null, 2)}\n`);
  const routeBinding = binding(root, routePath);

  const captures = [];
  const artifactDimensions = {
    desktop: { width: 1440, height: 1000 },
    tablet: { width: 768, height: 1024 },
    narrow: { width: 500, height: 812 },
  };
  for (const row of coverage.filter((item) => item.required)) {
    const isPrint = row.state === "print";
    const viewport = artifactDimensions[row.viewport] || { width: 1440, height: 1000 };
    const captureHeight =
      mode === "pm-artifact" && !isPrint ? viewport.height + 200 : viewport.height;
    const captureBytes = isPrint ? validPdf() : validPng(viewport.width, captureHeight);
    const file = write(root, `evidence/files/${row.id}.${isPrint ? "pdf" : "png"}`, captureBytes);
    const pixels = isPrint ? null : inspectPngVisualBytes(captureBytes);
    captures.push({
      id: `capture-${row.id}`,
      coverage_id: row.id,
      kind: isPrint ? "pdf" : "screenshot",
      ...file,
      active: true,
      round: 1,
      ...(isPrint
        ? { pages: 1 }
        : {
            width: viewport.width,
            height: captureHeight,
            full_page: mode === "pm-artifact",
            ...(mode === "product-ui" ? { pixel_sha256: pixels.pixelSha256 } : {}),
          }),
      captured_at: "2026-07-12T00:01:00Z",
    });
  }
  const evidence = [];
  if (mode === "product-ui" && routeSchemaVersion === 2) {
    for (const capture of captures) {
      evidence.push(
        auditEvidenceFile(
          root,
          `a11y-${capture.id}`,
          "accessibility-tree",
          [capture],
          routeSchemaVersion
        ),
        auditEvidenceFile(root, `dom-${capture.id}`, "dom-audit", [capture], routeSchemaVersion)
      );
    }
  } else {
    evidence.push(
      auditEvidenceFile(root, "a11y", "accessibility-tree", captures, routeSchemaVersion)
    );
  }
  if (mode === "product-ui" && routeSchemaVersion === 1)
    evidence.push(auditEvidenceFile(root, "dom", "dom-audit", captures, routeSchemaVersion));
  if (mode === "pm-artifact") {
    const artifactPath = path.join(root, artifact.path);
    const structural = buildManifest(
      artifactPath,
      inspectHtmlArtifact(fs.readFileSync(artifactPath), { expectedKind: "report" })
    );
    const renderCaptures = captures
      .filter((item) => item.kind === "screenshot")
      .map((item) => {
        const name = coverage.find((row) => row.id === item.coverage_id).viewport;
        const viewport = artifactDimensions[name];
        const screen = write(
          root,
          `evidence/files/artifact-${name}-screen.png`,
          validPng(viewport.width, viewport.height, 2)
        );
        return {
          name,
          ...viewport,
          path: screen.path,
          sha256: `sha256:${screen.sha256}`,
          bytes: fs.statSync(path.join(root, screen.path)).size,
          metrics: {
            innerWidth: viewport.width,
            clientWidth: viewport.width - 15,
            scrollWidth: viewport.width - 15,
            documentHeight: item.height,
            horizontalOverflow: false,
            mainVisible: true,
            h1Visible: true,
            bodyText: 500,
            anchorCount: 4,
          },
          full_page: {
            path: item.path,
            sha256: `sha256:${item.sha256}`,
            bytes: fs.statSync(path.join(root, item.path)).size,
            width: item.width,
            height: item.height,
          },
        };
      });
    const print = captures.find((item) => item.kind === "pdf");
    const render = {
      source: { path: artifact.path, sha256: `sha256:${artifact.sha256}` },
      captures: renderCaptures,
      print: {
        path: print.path,
        sha256: `sha256:${print.sha256}`,
        bytes: fs.statSync(path.join(root, print.path)).size,
        pages: 1,
      },
      checked_at: "2026-07-12T00:02:00Z",
    };
    evidence.push({
      id: "evidence-structural",
      subject_id: "account-detail",
      kind: "artifact-structural",
      ...write(root, "evidence/files/structural.json", `${JSON.stringify(structural)}\n`),
    });
    evidence.push({
      id: "evidence-render",
      subject_id: "account-detail",
      kind: "artifact-render",
      ...write(root, "evidence/files/render.json", `${JSON.stringify(render)}\n`),
    });
  }
  if (mode === "product-ui" && routeSchemaVersion === 2)
    for (const capture of captures)
      attachTrustedCaptureObservation(root, route, routeBinding, capture, evidence);
  const captureDoc = {
    schema_version: 1,
    run_id: route.run_id,
    mode,
    commit: COMMIT,
    route: routeBinding,
    captures,
    evidence,
    checked_at: "2026-07-12T00:02:00Z",
  };
  write(root, capturesPath, `${JSON.stringify(captureDoc, null, 2)}\n`);

  const scores = Object.fromEntries(
    (mode === "product-ui"
      ? ["hierarchy", "density", "consistency", "accessibility", "responsive", "state-clarity"]
      : ["hierarchy", "density", "consistency", "accessibility", "responsive", "print-navigation"]
    ).map((key) => [
      key,
      {
        value: 4,
        rationale: `${key} is supported by the cited current capture.`,
        evidence_ids: scoreEvidenceIds(root, key, mode, coverage, captures, evidence),
      },
    ])
  );
  const reviews = makeReviews(root, route, captureDoc, scores, 1);
  reviews.route = routeBinding;
  reviews.captures = binding(root, capturesPath);
  write(root, reviewsPath, `${JSON.stringify(reviews, null, 2)}\n`);
  const report = {
    schema_version: 2,
    run_id: route.run_id,
    mode,
    commit: COMMIT,
    route: routeBinding,
    captures: binding(root, capturesPath),
    reviews: binding(root, reviewsPath),
    review_assurance: "workflow-attested-non-cryptographic",
    outcome: "passed",
    rounds: 1,
    coverage: { required: captures.length, captured: captures.length, percent: 100 },
    scores,
    findings: [],
    reconciliation: [],
    top_issue: "No unresolved design issue.",
    next_action: "Proceed to QA.",
    human_report: { path: "evidence/report.html" },
    checked_at: "2026-07-12T02:00:00Z",
  };
  write(root, reportPath, `${JSON.stringify(report, null, 2)}\n`);
  write(
    root,
    "evidence/report.html",
    htmlReport(
      binding(root, reportPath),
      binding(root, capturesPath),
      binding(root, reviewsPath),
      reviews,
      report
    )
  );
  return {
    root,
    routePath,
    capturesPath,
    reviewsPath,
    reportPath,
    route,
    captures: captureDoc,
    reviews,
    report,
  };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function promptHash(perspective) {
  const name =
    perspective === "primary" ? "design-critique-reviewer.md" : "design-critique-fresh-eyes.md";
  return digest(fs.readFileSync(path.join(__dirname, `../skills/dev/references/${name}`)));
}

function withPayloadHash(input) {
  return { ...input, payload_sha256: digest(Buffer.from(canonicalJson(input))) };
}

function makeReviews(root, route, captures, scores, rounds) {
  const routeBinding = binding(root, "evidence/route.json");
  const contextSource = {
    schema_version: 1,
    run_id: route.run_id,
    commit: route.source.commit,
    route: routeBinding,
    brief: {
      page_description: route.subjects[0].title,
      persona: "Account administrator",
      job_to_be_done: "Understand status and take the next action.",
    },
    design_principles: ["Use the established product hierarchy."],
    created_at: "2026-07-12T01:00:00Z",
  };
  const contextBinding = write(
    root,
    "evidence/review-context.json",
    `${JSON.stringify(contextSource, null, 2)}\n`
  );
  const requiredCoverage = route.coverage.filter((item) => item.required);
  const reviewRounds = [];
  for (let round = 1; round <= rounds; round += 1) {
    const selected =
      round === rounds
        ? captures.captures.filter((item) => item.active)
        : requiredCoverage
            .map(
              (coverage) =>
                captures.captures
                  .filter((item) => item.coverage_id === coverage.id)
                  .sort((left, right) => left.round - right.round)[0]
            )
            .filter(Boolean);
    const activeCaptureIds = selected.map((item) => item.id);
    const evidenceIds = reviewEvidenceIdsForCaptures(root, route, captures, activeCaptureIds);
    const minute = 10 + round * 10;
    const captureManifest = {
      schema_version: 1,
      run_id: route.run_id,
      round,
      commit: route.source.commit,
      route: routeBinding,
      capture_ids: activeCaptureIds,
      created_at: `2026-07-12T01:${String(minute).padStart(2, "0")}:00Z`,
    };
    const captureManifestBinding = write(
      root,
      `evidence/review-round-${round}-captures.json`,
      `${JSON.stringify(captureManifest, null, 2)}\n`
    );
    const primaryInput = withPayloadHash({
      prompt_profile: "primary-v1",
      prompt_sha256: promptHash("primary"),
      context_source: contextBinding,
      capture_manifest: captureManifestBinding,
      acceptance_criteria: ["The primary action remains visible at every required viewport."],
      capture_ids: activeCaptureIds,
      evidence_ids: evidenceIds,
      prior_finding_refs: [],
    });
    const freshInput = withPayloadHash({
      prompt_profile: "fresh-eyes-v1",
      prompt_sha256: promptHash("fresh-eyes"),
      context_source: contextBinding,
      capture_manifest: captureManifestBinding,
      capture_ids: activeCaptureIds,
    });
    const pair = [
      {
        review_id: `dc-test-r${round}-primary`,
        perspective: "primary",
        input: primaryInput,
        execution: reviewExecution(`primary-r${round}`, round),
        result: {
          summary: "The rendered interface is clear and supported by current evidence.",
          scores: JSON.parse(JSON.stringify(scores)),
          findings: [],
        },
      },
      {
        review_id: `dc-test-r${round}-fresh-eyes`,
        perspective: "fresh-eyes",
        input: freshInput,
        execution: reviewExecution(`fresh-r${round}`, round),
        result: {
          first_impression:
            "A dark account header sits above two summary cards, while the blue Save account button anchors the action hierarchy.",
          answers: {
            purpose: {
              text: "The Account detail heading above the summary cards identifies the account review purpose.",
              evidence_ids: [activeCaptureIds[0]],
            },
            visual_focus: {
              text: "The dark header draws attention first, followed by the blue Save account button below the cards.",
              evidence_ids: [activeCaptureIds[0]],
            },
            inconsistencies: {
              text: "The two summary cards keep aligned left edges and equal padding; no spacing mismatch is visible.",
              evidence_ids: [activeCaptureIds[0]],
            },
          },
          observations: selected.map((capture) => {
            const coverage = route.coverage.find((item) => item.id === capture.coverage_id);
            const subject = route.subjects.find((item) => item.id === coverage.subject_id);
            const layout =
              {
                desktop: "a wide two-column card grid",
                tablet: "a medium-width two-column card grid",
                narrow: "a single stacked card column",
                print: "a print-ready single-page card stack",
                device: "a compact device-width card column",
              }[coverage.viewport] || "a bounded card layout";
            return {
              capture_id: capture.id,
              coverage_id: coverage.id,
              state: coverage.state,
              viewport: coverage.viewport,
              observation: `The ${coverage.state} state at the ${coverage.viewport} viewport places the ${subject.title} heading above ${layout}, with the blue Save account button below the cards.`,
            };
          }),
          findings: [],
        },
      },
    ];
    for (const review of pair) attachReviewReceipt(root, review, round);
    reviewRounds.push({ round, reviews: pair });
  }
  return {
    schema_version: 1,
    run_id: route.run_id,
    mode: route.mode,
    commit: route.source.commit,
    route: null,
    captures: null,
    assurance: "workflow-attested-non-cryptographic",
    rounds: reviewRounds,
    checked_at: "2026-07-12T01:50:00Z",
  };
}

function reviewEvidenceIdsForCaptures(root, route, captures, captureIds) {
  const selected = new Set(captureIds);
  return captures.evidence
    .filter((item) => {
      const evidence = JSON.parse(fs.readFileSync(path.join(root, item.path), "utf8"));
      if (["accessibility-tree", "dom-audit"].includes(item.kind))
        return (
          Array.isArray(evidence.capture_ids) &&
          evidence.capture_ids.length > 0 &&
          evidence.capture_ids.every((id) => selected.has(id))
        );
      if (route.mode !== "pm-artifact") return false;
      if (item.kind === "artifact-structural") return true;
      if (item.kind !== "artifact-render") return false;
      const rendered = [
        ...(evidence.captures || []).map((capture) => capture.full_page),
        evidence.print,
      ].filter(Boolean);
      const selectedCaptures = captures.captures.filter((capture) => selected.has(capture.id));
      return sameFileBindingSet(rendered, selectedCaptures);
    })
    .map((item) => item.id);
}

function sameFileBindingSet(left, right) {
  const identity = (binding) =>
    `${String(binding.path).replaceAll("\\", "/").replace(/^\.\//, "")}|${String(
      binding.sha256
    ).replace(/^sha256:/, "")}`;
  return (
    [...new Set(left.map(identity))].sort().join("\n") ===
    [...new Set(right.map(identity))].sort().join("\n")
  );
}

function reviewExecution(suffix, round) {
  const minute = 10 + round * 10;
  return {
    mode: "same-runtime-isolated",
    runtime: { provider: "openai", model: "gpt-5.6-sol", reasoning: "high" },
    context_id: `ctx-${suffix}`,
    invocation_id: `invoke-${suffix}`,
    assurance: "workflow-attested-non-cryptographic",
    receipt: null,
    started_at: `2026-07-12T01:${String(minute).padStart(2, "0")}:10Z`,
    completed_at: `2026-07-12T01:${String(minute).padStart(2, "0")}:40Z`,
  };
}

function attachReviewReceipt(
  root,
  review,
  round,
  recordedAt = `2026-07-12T01:${String(10 + round * 10).padStart(2, "0")}:50Z`
) {
  const receipt = createReviewReceipt({
    reviewId: review.review_id,
    perspective: review.perspective,
    contextId: review.execution.context_id,
    invocationId: review.execution.invocation_id,
    inputPayloadSha256: review.input.payload_sha256,
    promptSha256: review.input.prompt_sha256,
    result: review.result,
    startedAt: review.execution.started_at,
    completedAt: review.execution.completed_at,
    recordedAt,
  });
  review.execution.receipt = write(
    root,
    `evidence/review-receipts/${review.review_id}.json`,
    `${JSON.stringify(receipt, null, 2)}\n`
  );
}

function scoreEvidenceIds(root, key, mode, coverage, captures, evidence) {
  const active = captures.filter((item) => item.active === true);
  const activeIds = new Set(active.map((item) => item.id));
  const coverageById = new Map(coverage.map((item) => [item.id, item]));
  const idsOfKind = (...kinds) =>
    evidence
      .filter((item) => kinds.includes(item.kind))
      .filter((item) => {
        if (mode !== "product-ui" || !["accessibility-tree", "dom-audit"].includes(item.kind))
          return true;
        const audit = JSON.parse(fs.readFileSync(path.join(root, item.path), "utf8"));
        return (audit.capture_ids || []).some((id) => activeIds.has(id));
      })
      .map((item) => item.id);
  if (key === "accessibility") return idsOfKind("accessibility-tree");
  if (key === "consistency")
    return mode === "product-ui"
      ? idsOfKind("dom-audit")
      : idsOfKind("artifact-structural", "artifact-render");
  if (key === "responsive")
    return [
      ...active
        .filter((item) =>
          ["desktop", "tablet", "narrow", "device"].includes(
            coverageById.get(item.coverage_id)?.viewport
          )
        )
        .map((item) => item.id),
      ...(mode === "product-ui" ? idsOfKind("dom-audit") : idsOfKind("artifact-render")),
    ];
  if (key === "state-clarity") return active.map((item) => item.id);
  if (key === "print-navigation")
    return [
      ...active
        .filter((item) => coverageById.get(item.coverage_id)?.viewport === "print")
        .map((item) => item.id),
      ...idsOfKind("artifact-structural", "artifact-render"),
    ];
  return active.map((item) => item.id);
}

function addRequiredStateCapture(fixture, state, bytes) {
  const coverage = fixture.route.coverage.find((item) => item.id === `ui-${state}`);
  coverage.required = true;
  coverage.reason = "";
  rewrite(fixture.root, fixture.routePath, fixture.route);
  fixture.captures.route = binding(fixture.root, fixture.routePath);
  const decoded = inspectPngVisualBytes(bytes);
  const file = write(fixture.root, `evidence/files/ui-${state}.png`, bytes);
  const capture = {
    id: `capture-ui-${state}`,
    coverage_id: coverage.id,
    kind: "screenshot",
    ...file,
    active: true,
    round: 1,
    width: decoded.width,
    height: decoded.height,
    full_page: false,
    pixel_sha256: decoded.pixelSha256,
    captured_at: "2026-07-12T00:04:00Z",
  };
  fixture.captures.captures.push(capture);
  fixture.captures.evidence.push(
    auditEvidenceFile(fixture.root, `a11y-capture-ui-${state}`, "accessibility-tree", [capture], 2),
    auditEvidenceFile(fixture.root, `dom-capture-ui-${state}`, "dom-audit", [capture], 2)
  );
  refreshTrustedCaptureObservations(fixture);
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  fixture.report.route = fixture.captures.route;
  fixture.report.captures = binding(fixture.root, fixture.capturesPath);
  const required = fixture.route.coverage.filter((item) => item.required).length;
  fixture.report.coverage = { required, captured: required, percent: 100 };
  for (const [key, score] of Object.entries(fixture.report.scores))
    score.evidence_ids = scoreEvidenceIds(
      fixture.root,
      key,
      fixture.route.mode,
      fixture.route.coverage,
      fixture.captures.captures,
      fixture.captures.evidence
    );
  rewriteReportAndHtml(fixture);
}

function addProductUiSubject(fixture, subjectId) {
  fixture.route.subjects.push({
    id: subjectId,
    title: "Billing detail",
    surface: "/billing/1",
    platform: "web",
  });
  const addedCoverage = fixture.route.coverage.map((item) => ({
    ...item,
    id: item.id.replace(/^ui-/, `${subjectId}-`),
    subject_id: subjectId,
  }));
  fixture.route.coverage.push(...addedCoverage);
  rewrite(fixture.root, fixture.routePath, fixture.route);
  fixture.captures.route = binding(fixture.root, fixture.routePath);

  let marker = 10;
  for (const row of addedCoverage.filter((item) => item.required)) {
    const viewport =
      row.viewport === "narrow" ? { width: 500, height: 812 } : { width: 1440, height: 1000 };
    const bytes = validPng(viewport.width, viewport.height, marker++);
    const file = write(fixture.root, `evidence/files/${row.id}.png`, bytes);
    const capture = {
      id: `capture-${row.id}`,
      coverage_id: row.id,
      kind: "screenshot",
      ...file,
      active: true,
      round: 1,
      ...viewport,
      full_page: false,
      pixel_sha256: inspectPngVisualBytes(bytes).pixelSha256,
      captured_at: "2026-07-12T00:01:00Z",
    };
    fixture.captures.captures.push(capture);
    fixture.captures.evidence.push(
      auditEvidenceFile(
        fixture.root,
        `a11y-${capture.id}`,
        "accessibility-tree",
        [capture],
        2,
        subjectId
      ),
      auditEvidenceFile(fixture.root, `dom-${capture.id}`, "dom-audit", [capture], 2, subjectId)
    );
  }
  refreshTrustedCaptureObservations(fixture);
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  fixture.report.route = fixture.captures.route;
  fixture.report.captures = binding(fixture.root, fixture.capturesPath);
  const required = fixture.route.coverage.filter((item) => item.required).length;
  fixture.report.coverage = { required, captured: required, percent: 100 };
  for (const [key, score] of Object.entries(fixture.report.scores))
    score.evidence_ids = scoreEvidenceIds(
      fixture.root,
      key,
      fixture.route.mode,
      fixture.route.coverage,
      fixture.captures.captures,
      fixture.captures.evidence
    );
  rewriteReportAndHtml(fixture);
}

function configureResolvedPrimaryFinding(fixture, replacementBytes = null) {
  const before = fixture.captures.captures.find((item) => item.coverage_id === "ui-primary");
  before.active = false;
  const afterBytes = replacementBytes || validPng(1440, 1000, 21);
  const afterFile = write(fixture.root, "evidence/files/ui-primary-after.png", afterBytes);
  const after = {
    ...before,
    id: "capture-ui-primary-after",
    ...afterFile,
    pixel_sha256: inspectPngVisualBytes(afterBytes).pixelSha256,
    active: true,
    round: 2,
    captured_at: "2026-07-12T01:25:00Z",
  };
  fixture.captures.captures.push(after);
  fixture.captures.evidence.push(
    auditEvidenceFile(
      fixture.root,
      "a11y-capture-ui-primary-after",
      "accessibility-tree",
      [after],
      2
    ),
    auditEvidenceFile(fixture.root, "dom-capture-ui-primary-after", "dom-audit", [after], 2)
  );
  refreshTrustedCaptureObservations(fixture);
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  const finding = {
    subject_id: "account-detail",
    region: "header",
    rule: "hierarchy",
    evidence_ids: [before.id, after.id],
    priority: "P1",
    status: "resolved",
    owner: "design-critique",
    summary: "Primary action hierarchy was repaired.",
    remediation: "Keep the corrected hierarchy.",
    before_capture_id: before.id,
    after_capture_id: after.id,
  };
  finding.id = findingId(finding);
  fixture.report.rounds = 2;
  fixture.report.captures = binding(fixture.root, fixture.capturesPath);
  fixture.report.findings = [finding];
  for (const [key, score] of Object.entries(fixture.report.scores))
    score.evidence_ids = scoreEvidenceIds(
      fixture.root,
      key,
      fixture.route.mode,
      fixture.route.coverage,
      fixture.captures.captures,
      fixture.captures.evidence
    );
  rewriteReportAndHtml(fixture);
  return { before, after, finding };
}

function coverageRow(id, state, viewport, required, reason = "") {
  return { id, subject_id: "account-detail", state, viewport, required, reason };
}

function auditEvidenceFile(
  root,
  id,
  kind,
  captures,
  routeSchemaVersion,
  subjectId = "account-detail"
) {
  const checks =
    kind === "accessibility-tree"
      ? { landmarks: true, names: true, focus_order: true }
      : routeSchemaVersion === 1
        ? { overflow: true, edge_alignment: true, hierarchy: true }
        : {
            overflow: true,
            edge_alignment: true,
            hierarchy: true,
            consistency: true,
            asymmetry: true,
          };
  const captureIds = captures.map((item) => item.id);
  let audit;
  if (routeSchemaVersion === 1) {
    audit = {
      schema_version: 1,
      subject_id: subjectId,
      commit: COMMIT,
      capture_ids: captureIds,
      checks,
      findings: [],
    };
  } else {
    const raw =
      kind === "accessibility-tree"
        ? {
            schema_version: 1,
            kind,
            subject_id: subjectId,
            commit: COMMIT,
            capture_ids: captureIds,
            observations: {
              landmarks: [{ role: "main", name: "", locator: "main#content" }],
              controls: [
                {
                  role: "button",
                  name: "Save account",
                  locator: "button#save",
                  disabled: false,
                  tab_index: 0,
                  document_index: 0,
                },
              ],
            },
          }
        : {
            schema_version: 1,
            kind,
            subject_id: subjectId,
            commit: COMMIT,
            capture_ids: captureIds,
            observations: {
              viewport: {
                inner_width: captures[0].width,
                client_width: captures[0].width,
                scroll_width: captures[0].width,
              },
              hierarchy: [],
              edge_alignment: [],
              consistency: [],
              asymmetry: [],
            },
          };
    const rawFile = write(root, `evidence/files/${id}-raw.json`, `${JSON.stringify(raw)}\n`);
    audit = normalizeAuditBytes(fs.readFileSync(path.join(root, rawFile.path)), rawFile);
  }
  return {
    id: `evidence-${id}`,
    subject_id: subjectId,
    kind,
    ...write(root, `evidence/files/${id}.json`, `${JSON.stringify(audit)}\n`),
  };
}

function refreshTrustedCaptureObservations(fixture) {
  const routeBinding = binding(fixture.root, fixture.routePath);
  for (const capture of fixture.captures.captures)
    attachTrustedCaptureObservation(
      fixture.root,
      fixture.route,
      routeBinding,
      capture,
      fixture.captures.evidence
    );
}

function attachTrustedCaptureObservation(
  root,
  route,
  routeBinding,
  capture,
  evidence,
  scrollY = 0,
  viewportOverrides = {}
) {
  const coverage = route.coverage.find((item) => item.id === capture.coverage_id);
  const subject = route.subjects.find((item) => item.id === coverage.subject_id);
  const audits = Object.fromEntries(
    ["accessibility-tree", "dom-audit"].map((kind) => {
      const entry = evidence.find((item) => {
        if (item.kind !== kind || item.subject_id !== subject.id) return false;
        const audit = JSON.parse(fs.readFileSync(path.join(root, item.path), "utf8"));
        return audit.capture_ids.includes(capture.id);
      });
      if (!entry) throw new Error(`test fixture lacks ${kind} evidence for ${capture.id}`);
      const audit = JSON.parse(fs.readFileSync(path.join(root, entry.path), "utf8"));
      const raw = JSON.parse(fs.readFileSync(path.join(root, audit.raw.path), "utf8"));
      return [kind, { binding: audit.raw, raw }];
    })
  );
  const assertion = {
    schema_version: 2,
    subject_id: subject.id,
    coverage_id: coverage.id,
    state: coverage.state,
    state_marker: {
      locator: { by: "test-id", value: "account-state" },
      attribute: "data-pm-state",
      value: coverage.state,
    },
    all: [
      {
        locator: { by: "role-name", value: "button:Save account" },
        expect: { kind: "visible" },
      },
    ],
  };
  const assertionBinding = write(
    root,
    `${path.posix.dirname(routeBinding.path)}/state-assertions/${coverage.id}.json`,
    `${JSON.stringify(assertion, null, 2)}\n`
  );
  const requestedUrl = new URL(subject.surface, "http://127.0.0.1:4173").href;
  const requestedUrlIdentity = redactedUrlIdentity(requestedUrl, "fixture URL").public;
  const allowedOrigins = [new URL(requestedUrl).origin];
  const requests = [
    {
      sequence: 1,
      method: "GET",
      resource_type: "Document",
      origin: allowedOrigins[0],
      url_sha256: digest(Buffer.from(requestedUrl)),
    },
  ];
  const networkLedger = {
    schema_version: 1,
    policy: "explicit-origin-allowlist",
    allowed_origins: allowedOrigins,
    observed_origins: allowedOrigins,
    requests,
    violations: [],
  };
  const networkBinding = write(
    root,
    `evidence/files/${capture.id}-network.json`,
    `${JSON.stringify(networkLedger, null, 2)}\n`
  );
  const cssViewport = {
    inner_width: capture.width,
    inner_height: capture.height,
    client_width: capture.width,
    client_height: capture.height,
    scroll_width: capture.width,
    scroll_height: capture.height + 2000,
    device_scale_factor: 1,
    scroll_x: 0,
    scroll_y: scrollY,
    visual_scale: 1,
    page_zoom: 1,
    ...viewportOverrides,
  };
  const pageIdentity = {
    target_id: `target-${capture.id}`,
    main_frame_id: `frame-${capture.id}`,
    loader_id: `loader-${capture.id}`,
    final_url: requestedUrlIdentity,
    css_viewport: cssViewport,
  };
  const assertionVisibility = {
    method: "cdp-dom-get-node-for-location-v1",
    effective_opacity_floor: 0.01,
    verified_nodes: 2,
    checks: [
      {
        label: "state marker",
        asserted_backend_node_id: 1,
        hit_backend_node_id: 1,
        x: 10,
        y: 10,
      },
      {
        label: "state assertion clause 1",
        asserted_backend_node_id: 2,
        hit_backend_node_id: 2,
        x: 20,
        y: 20,
      },
    ],
  };
  let sourceTree = "d".repeat(40);
  try {
    sourceTree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // Most fixtures are intentionally not Git repositories.
  }
  const sourceIdentity = {
    head: route.source.commit,
    tree: sourceTree,
    tracked_status_sha256: digest(Buffer.alloc(0)),
    clean: true,
  };
  const browserIdentity = {
    path: "/opt/pm-test/chromium",
    bytes: 1,
    sha256: "e".repeat(64),
    version: "Chromium 140.0.0.0",
  };
  const configuration = {
    readiness_timeout_ms: 15_000,
    settle_ms: 250,
    browser_args_profile: BROWSER_ARGS_PROFILE,
    acquisition: ACQUISITION_METHOD,
  };
  const captureBytes = fs.readFileSync(path.join(root, capture.path));
  const visualMetrics = captureVisualMetrics(inspectPngVisualBytes(captureBytes));
  const captureManifest = {
    id: capture.id,
    path: capture.path,
    sha256: capture.sha256,
    pixel_sha256: capture.pixel_sha256,
    visual_metrics: visualMetrics,
    width: capture.width,
    height: capture.height,
    full_page: capture.full_page,
    round: capture.round,
    captured_at: capture.captured_at,
  };
  const invocation = {
    producer: { name: "pm:design-critique-capture", version: PLUGIN_VERSION },
    route_sha256: routeBinding.sha256,
    run_id: route.run_id,
    commit: route.source.commit,
    subject_id: subject.id,
    coverage: { id: coverage.id, state: coverage.state, viewport: coverage.viewport },
    capture_id: capture.id,
    route_surface: subject.surface,
    requested_url: requestedUrlIdentity,
    expected_url: requestedUrlIdentity,
    viewport: { width: capture.width, height: capture.height },
    assertion: assertionBinding,
    allowed_origins: allowedOrigins,
    readiness_timeout_ms: configuration.readiness_timeout_ms,
    settle_ms: configuration.settle_ms,
    browser_args_profile: configuration.browser_args_profile,
    acquisition: configuration.acquisition,
  };
  const timestamps = {
    started_at: capture.captured_at,
    page_ready_at: capture.captured_at,
    captured_at: capture.captured_at,
    completed_at: capture.captured_at,
  };
  const manifest = {
    schema_version: 2,
    kind: "product-ui-capture",
    run_id: route.run_id,
    mode: "product-ui",
    commit: route.source.commit,
    route: routeBinding,
    subject_id: subject.id,
    coverage: invocation.coverage,
    capture: captureManifest,
    raw_evidence: {
      accessibility_tree: audits["accessibility-tree"].binding,
      dom_audit: audits["dom-audit"].binding,
      network_ledger: networkBinding,
    },
    page: {
      route_surface: subject.surface,
      requested_url: requestedUrlIdentity,
      expected_url: requestedUrlIdentity,
      final_url: requestedUrlIdentity,
      target_id: pageIdentity.target_id,
      main_frame_id: pageIdentity.main_frame_id,
      loader_id: pageIdentity.loader_id,
      css_viewport: cssViewport,
      state_assertion: {
        ...assertionBinding,
        passed: true,
        visibility: assertionVisibility,
      },
    },
    observation: {
      assurance_level: CAPTURE_ASSURANCE,
      producer: invocation.producer,
      browser: { engine: "chromium", before: browserIdentity, after: browserIdentity },
      source: {
        before: sourceIdentity,
        after: sourceIdentity,
        guard: "clean-tracked-tree-before-and-after",
      },
      network: {
        policy: networkLedger.policy,
        allowed_origins: networkLedger.allowed_origins,
        observed_origins: networkLedger.observed_origins,
        request_count: requests.length,
        ledger_sha256: networkBinding.sha256,
        violations: 0,
      },
      configuration,
      invocation_configuration_sha256: digest(Buffer.from(JSON.stringify(invocation))),
      stability: {
        samples: 2,
        native_observations_sha256: digest(
          Buffer.from(
            JSON.stringify({
              page: pageIdentity,
              assertion_visibility: assertionVisibility,
              accessibility: audits["accessibility-tree"].raw.observations,
              dom: audits["dom-audit"].raw.observations,
            })
          )
        ),
        decoded_pixels_sha256: capture.pixel_sha256,
      },
    },
    timestamps,
  };
  capture.observation = write(
    root,
    `evidence/files/${capture.id}-capture.json`,
    `${JSON.stringify(manifest, null, 2)}\n`
  );
}

function publishManagedCaptureBundle(fixture, capture) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(fixture.root, capture.observation.path), "utf8")
  );
  const base = `.pm/dev-sessions/dc-test/design-critique/round-1/${capture.id}`;
  const payloads = new Map([
    ["capture.png", fs.readFileSync(path.join(fixture.root, capture.path))],
    [
      "accessibility-tree-raw.json",
      fs.readFileSync(path.join(fixture.root, manifest.raw_evidence.accessibility_tree.path)),
    ],
    [
      "dom-audit-raw.json",
      fs.readFileSync(path.join(fixture.root, manifest.raw_evidence.dom_audit.path)),
    ],
    [
      "network-ledger.json",
      fs.readFileSync(path.join(fixture.root, manifest.raw_evidence.network_ledger.path)),
    ],
  ]);
  capture.path = `${base}/capture.png`;
  manifest.capture.path = capture.path;
  manifest.raw_evidence.accessibility_tree.path = `${base}/accessibility-tree-raw.json`;
  manifest.raw_evidence.dom_audit.path = `${base}/dom-audit-raw.json`;
  manifest.raw_evidence.network_ledger.path = `${base}/network-ledger.json`;
  for (const [kind, binding] of [
    ["accessibility-tree", manifest.raw_evidence.accessibility_tree],
    ["dom-audit", manifest.raw_evidence.dom_audit],
  ]) {
    const evidence = fixture.captures.evidence.find((item) => {
      if (item.kind !== kind) return false;
      const audit = JSON.parse(fs.readFileSync(path.join(fixture.root, item.path), "utf8"));
      return audit.capture_ids.includes(capture.id);
    });
    const audit = JSON.parse(fs.readFileSync(path.join(fixture.root, evidence.path), "utf8"));
    audit.raw = binding;
    evidence.sha256 = write(
      fixture.root,
      evidence.path,
      `${JSON.stringify(audit, null, 2)}\n`
    ).sha256;
  }
  payloads.set("capture.json", Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
  writeProjectDirectoryAtomic(fixture.root, base, [...payloads], { commitFile: "capture.json" });
  capture.observation = {
    path: `${base}/capture.json`,
    sha256: digest(payloads.get("capture.json")),
  };
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  fixture.report.captures = binding(fixture.root, fixture.capturesPath);
  rewriteReportAndHtml(fixture);
  return { bundle: fs.realpathSync(path.join(fixture.root, base)), payloads };
}

function rewriteNormalizedAudit(fixture, evidence, mutate) {
  const audit = JSON.parse(fs.readFileSync(path.join(fixture.root, evidence.path), "utf8"));
  if (audit.schema_version === 1) {
    mutate(audit);
  } else {
    const raw = JSON.parse(fs.readFileSync(path.join(fixture.root, audit.raw.path), "utf8"));
    mutate(raw);
    const rawFile = write(fixture.root, audit.raw.path, `${JSON.stringify(raw)}\n`);
    Object.assign(
      audit,
      normalizeAuditBytes(fs.readFileSync(path.join(fixture.root, rawFile.path)), rawFile)
    );
  }
  const rebound = write(fixture.root, evidence.path, `${JSON.stringify(audit)}\n`);
  evidence.sha256 = rebound.sha256;
}

function validPng(
  width,
  height,
  marker = 0,
  ancillaryBytes = 0,
  onePixelMarker = null,
  markerPixelCount = 1
) {
  const cacheKey = `${width}:${height}:${marker}:${ancillaryBytes}:${onePixelMarker}:${markerPixelCount}`;
  if (PNG_CACHE.has(cacheKey)) return PNG_CACHE.get(cacheKey);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const offset = row * (width * 4 + 1);
    rows[offset] = 0;
    for (let column = 0; column < width; column += 1) {
      const pixel = offset + 1 + column * 4;
      const header = row < Math.max(1, Math.floor(height * 0.16));
      const sidebar = !header && column < Math.max(1, Math.floor(width * 0.18));
      const card =
        !header &&
        !sidebar &&
        row > height * 0.3 &&
        row < height * 0.72 &&
        column > width * 0.28 &&
        column < width * 0.88;
      const accent = marker % 64;
      const color = header
        ? [25 + accent, 45 + Math.floor(accent / 2), 105 + accent]
        : sidebar
          ? [224, 231, 244]
          : card
            ? [255, 255, 255]
            : [242, 245, 250];
      rows[pixel] = color[0];
      rows[pixel + 1] = color[1];
      rows[pixel + 2] = color[2];
      rows[pixel + 3] = 255;
    }
  }
  if (onePixelMarker !== null) {
    for (let index = 0; index < markerPixelCount; index += 1) {
      const pixelIndex = width * height - 1 - index;
      const row = Math.floor(pixelIndex / width);
      const column = pixelIndex % width;
      const pixel = row * (width * 4 + 1) + 1 + column * 4;
      rows[pixel] = onePixelMarker;
      rows[pixel + 1] = 10;
      rows[pixel + 2] = 20;
    }
  }
  const chunks = [
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", header),
    pngChunk("tEXt", Buffer.alloc(1024 + ancillaryBytes, 65)),
  ];
  chunks.push(pngChunk("IDAT", zlib.deflateSync(rows)), pngChunk("IEND", Buffer.alloc(0)));
  const png = Buffer.concat(chunks);
  PNG_CACHE.set(cacheKey, png);
  return png;
}

function pngHeaderOnly(width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const prefix = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), pngChunk("IHDR", header)]);
  return Buffer.concat([prefix, Buffer.alloc(1024 - prefix.length)]);
}

function onePixelBeaconPng(width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const offset = row * (width * 4 + 1);
    for (let column = 0; column < width; column += 1) {
      const pixel = offset + 1 + column * 4;
      rows[pixel] = 250;
      rows[pixel + 1] = 250;
      rows[pixel + 2] = 250;
      rows[pixel + 3] = 255;
    }
  }
  const lastPixel = rows.length - 4;
  rows[lastPixel] = 0;
  rows[lastPixel + 1] = 0;
  rows[lastPixel + 2] = 0;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", header),
    pngChunk("tEXt", Buffer.alloc(1024, 65)),
    pngChunk("IDAT", zlib.deflateSync(rows)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function nearUniformTwoTilePng(width, height) {
  const changedPixels = Math.ceil(width * height * 0.0025);
  const changedPerTile = Math.ceil(changedPixels / 2);
  const tileWidth = Math.ceil(width / 8);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const rowOffset = row * (width * 4 + 1);
    for (let column = 0; column < width; column += 1) {
      const firstTileIndex = row * tileWidth + column;
      const secondTileIndex = row * tileWidth + column - tileWidth;
      const changed =
        (column < tileWidth && firstTileIndex < changedPerTile) ||
        (column >= tileWidth &&
          column < tileWidth * 2 &&
          secondTileIndex < changedPixels - changedPerTile);
      const pixel = rowOffset + 1 + column * 4;
      rows[pixel] = changed ? 0 : 250;
      rows[pixel + 1] = changed ? 0 : 250;
      rows[pixel + 2] = changed ? 0 : 250;
      rows[pixel + 3] = 255;
    }
  }
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", header),
    pngChunk("tEXt", Buffer.alloc(1024, 65)),
    pngChunk("IDAT", zlib.deflateSync(rows)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function transparentPng(width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(rows)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function nearTransparentVariedPng(width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const rowOffset = row * (width * 4 + 1);
    for (let column = 0; column < width; column += 1) {
      const pixel = rowOffset + 1 + column * 4;
      rows[pixel] = (column * 17 + row * 31) % 256;
      rows[pixel + 1] = (column * 47 + row * 13) % 256;
      rows[pixel + 2] = (column * 7 + row * 61) % 256;
      rows[pixel + 3] = 1;
    }
  }
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(rows)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function validPdf() {
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

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(testCrc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return chunk;
}

function testCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function binding(root, rel) {
  return { path: rel, sha256: digest(fs.readFileSync(path.join(root, rel))) };
}

function htmlReport(source, captures, reviewsBinding, reviews, report) {
  source = { path: source.path, sha256: `sha256:${source.sha256}` };
  captures = { path: captures.path, sha256: `sha256:${captures.sha256}` };
  reviewsBinding = {
    path: reviewsBinding.path,
    sha256: `sha256:${reviewsBinding.sha256}`,
  };
  const meta = {
    schema_version: 1,
    id: "report:design-critique-test",
    kind: "report",
    slug: "design-critique-test",
    lifecycle: "reviewed",
    title: "Design critique test",
    generated_at: "2026-07-12T00:00:00Z",
    generator: { name: "pm:design-critique", version: PLUGIN_VERSION },
    source,
    evidence: [captures, reviewsBinding],
  };
  const findingMarkers = (report.findings || [])
    .map((finding) => {
      const projection = {
        id: finding.id,
        priority: finding.priority,
        status: finding.status,
        owner: finding.owner,
        summary: finding.summary,
        remediation: finding.remediation,
        evidence_ids: finding.evidence_ids,
        before_capture_id: finding.before_capture_id || null,
        after_capture_id: finding.after_capture_id || null,
      };
      const projectionHash = digest(Buffer.from(JSON.stringify(projection)));
      return `<article data-dc-finding-id="${finding.id}" data-dc-finding-priority="${finding.priority}" data-dc-finding-status="${finding.status}" data-dc-finding-sha256="${projectionHash}">${finding.priority} ${finding.status} ${finding.owner} ${finding.summary} ${finding.remediation} ${finding.evidence_ids.join(" ")}</article>`;
    })
    .join("");
  const scoreMarkers = Object.entries(report.scores)
    .map(
      ([key, score]) =>
        `<span data-dc-score-key="${key}" data-dc-score-value="${score.value}">${key} ${score.value} ${score.rationale}</span>`
    )
    .join("");
  const reviewMarkers = (reviews.rounds || [])
    .flatMap((round) =>
      round.reviews.map((review) => {
        const summary =
          review.perspective === "primary" ? review.result.summary : review.result.first_impression;
        const projection = {
          review_id: review.review_id,
          perspective: review.perspective,
          round: round.round,
          execution_mode: review.execution.mode,
          assurance: review.execution.assurance,
          model: review.execution.runtime.model,
          summary,
          finding_count: review.result.findings.length,
        };
        return `<article data-dc-review-id="${review.review_id}" data-dc-perspective="${review.perspective}" data-dc-review-sha256="${digest(Buffer.from(canonicalJson(projection)))}">${review.perspective} ${review.execution.assurance} ${review.execution.runtime.model} ${summary} ${review.result.findings.length}</article>`;
      })
    )
    .join("");
  const reconciliationMarkers = (report.reconciliation || [])
    .map((row) => {
      const projection = {
        id: row.id,
        agreement: row.agreement,
        disposition: row.disposition,
        rationale: row.rationale,
        source_finding_refs: row.source_finding_refs,
        final_finding_id: row.final_finding_id,
      };
      const refs = row.source_finding_refs
        .map((ref) => `${ref.review_id}:${ref.finding_id}`)
        .join(" ");
      return `<article data-dc-reconciliation-id="${row.id}" data-dc-reconciliation-sha256="${digest(Buffer.from(canonicalJson(projection)))}">${row.agreement} ${row.disposition} ${row.rationale} ${row.final_finding_id} ${refs}</article>`;
    })
    .join("");
  const nextHash = digest(Buffer.from(report.next_action));
  const topIssueHash = digest(Buffer.from(report.top_issue));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Design critique test</title><script id="pm-artifact" type="application/json">${JSON.stringify(meta)}</script><style>.skip-link{position:absolute}.skip-link:focus{position:static}:focus-visible{outline:3px solid #05f}@media(max-width:600px){main{padding:1rem}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}@media print{nav{display:none}}</style></head><body><a class="skip-link" href="#main">Skip</a><nav aria-label="Report"><a href="#findings">Findings</a></nav><main id="main"><h1>Design critique test</h1><p>Reviewed</p><p data-dc-outcome="${report.outcome}">${report.outcome}</p><p data-dc-coverage="${report.coverage.percent}">${report.coverage.percent}%</p><p data-dc-top-issue-sha256="${topIssueHash}">${report.top_issue}</p><p data-dc-next-action-sha256="${nextHash}">${report.next_action}</p>${scoreMarkers}<section id="reviews"><h2>Review perspectives</h2><p data-dc-review-assurance="${report.review_assurance}">${report.review_assurance}</p>${reviewMarkers}${reconciliationMarkers}</section><section id="findings"><h2>Findings</h2><p>No blocking findings.</p>${findingMarkers}</section></main></body></html>`;
}

function artifactSubjectHtml() {
  const meta = {
    schema_version: 1,
    id: "report:artifact-subject",
    kind: "report",
    slug: "artifact-subject",
    lifecycle: "reviewed",
    title: "Artifact subject",
    generated_at: "2026-07-12T00:00:00Z",
    generator: { name: "pm:test", version: "1" },
    source: { path: "source.md", sha256: null },
    evidence: [],
  };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Artifact subject</title><script id="pm-artifact" type="application/json">${JSON.stringify(meta)}</script><style>.skip-link{position:absolute}.skip-link:focus{position:static}:focus-visible{outline:3px solid #05f}@media(max-width:600px){main{padding:1rem}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}@media print{nav{display:none}}</style></head><body><a class="skip-link" href="#main">Skip</a><nav aria-label="Report"><a href="#content">Content</a></nav><main id="main"><h1>Artifact subject</h1><p data-pm-lifecycle>reviewed</p><section id="content"><h2>Content</h2><p>Evidence subject.</p></section></main></body></html>`;
}

function check(fixture, commit = COMMIT, options = {}) {
  return checkDesignCritique({
    root: fixture.root,
    routePath: fixture.routePath,
    capturesPath: fixture.capturesPath,
    reportPath: fixture.reportPath,
    commit,
    verifyGit: false,
    verifyBrowser: false,
    ...options,
  });
}

function renderedMarkers(report, hidden = () => false) {
  const rows = [
    [{ "data-dc-outcome": report.outcome }, report.outcome],
    [{ "data-dc-coverage": String(report.coverage.percent) }, `${report.coverage.percent}%`],
    [{ "data-dc-top-issue-sha256": digest(Buffer.from(report.top_issue)) }, report.top_issue],
    [{ "data-dc-next-action-sha256": digest(Buffer.from(report.next_action)) }, report.next_action],
    ...Object.entries(report.scores).map(([key, score]) => [
      { "data-dc-score-key": key, "data-dc-score-value": String(score.value) },
      score.rationale,
    ]),
  ];
  return rows.map(([attributes, text]) => ({
    attributes,
    text,
    firstScreenText: text,
    visible: !hidden(attributes),
    inViewport: true,
  }));
}

function rewrite(root, rel, value) {
  write(root, rel, `${JSON.stringify(value, null, 2)}\n`);
}

function rewriteReportAndHtml(fixture) {
  refreshReviews(fixture);
  rewriteBoundReportAndHtml(fixture);
}

function rewriteBoundReportAndHtml(fixture) {
  rewrite(fixture.root, fixture.reportPath, fixture.report);
  write(
    fixture.root,
    "evidence/report.html",
    htmlReport(
      binding(fixture.root, fixture.reportPath),
      binding(fixture.root, fixture.capturesPath),
      binding(fixture.root, fixture.reviewsPath),
      fixture.reviews,
      fixture.report
    )
  );
}

function rewriteReviewsAndReport(fixture) {
  rewrite(fixture.root, fixture.reviewsPath, fixture.reviews);
  fixture.report.reviews = binding(fixture.root, fixture.reviewsPath);
  rewriteBoundReportAndHtml(fixture);
}

function refreshReviews(fixture) {
  const rebuilt = makeReviews(
    fixture.root,
    fixture.route,
    fixture.captures,
    fixture.report.scores,
    fixture.report.rounds
  );
  rebuilt.route = binding(fixture.root, fixture.routePath);
  rebuilt.captures = binding(fixture.root, fixture.capturesPath);
  for (const round of rebuilt.rounds) {
    const primary = round.reviews.find((item) => item.perspective === "primary");
    if (round.round !== fixture.report.rounds)
      for (const score of Object.values(primary.result.scores))
        score.evidence_ids = [primary.input.capture_ids[0]];
  }
  fixture.report.reconciliation = [];
  for (const finalFinding of fixture.report.findings || []) {
    const sourceRound =
      fixture.report.rounds === 2 &&
      finalFinding.status === "resolved" &&
      ["P0", "P1"].includes(finalFinding.priority)
        ? 1
        : fixture.report.rounds;
    const primary = rebuilt.rounds[sourceRound - 1].reviews.find(
      (item) => item.perspective === "primary"
    );
    const sourceEvidence =
      sourceRound === 1 && finalFinding.before_capture_id
        ? [finalFinding.before_capture_id]
        : finalFinding.evidence_ids.filter((id) =>
            [...primary.input.capture_ids, ...primary.input.evidence_ids].includes(id)
          );
    const coverageIds = uniqueCoverageIds(fixture, finalFinding, sourceEvidence);
    const reviewFinding = {
      subject_id: finalFinding.subject_id,
      region: finalFinding.region,
      rule: finalFinding.rule,
      coverage_ids: coverageIds,
      evidence_ids: sourceEvidence,
      priority: finalFinding.priority,
      owner: finalFinding.owner,
      basis: "objective",
      confidence: "high",
      summary: finalFinding.summary,
      impact: "The rendered evidence demonstrates the reported user impact.",
      remediation: finalFinding.remediation,
    };
    reviewFinding.id = reviewFindingId(primary.review_id, reviewFinding);
    primary.result.findings.push(reviewFinding);
    const ref = { review_id: primary.review_id, finding_id: reviewFinding.id };
    if (sourceRound < fixture.report.rounds) {
      const finalPrimary = rebuilt.rounds
        .at(-1)
        .reviews.find((item) => item.perspective === "primary");
      finalPrimary.input.prior_finding_refs.push(ref);
      const priorSourcePath = `evidence/review-round-${fixture.report.rounds}-prior-findings.json`;
      const priorSource = finalPrimary.input.prior_findings_source
        ? JSON.parse(fs.readFileSync(path.join(fixture.root, priorSourcePath), "utf8"))
        : {
            schema_version: 1,
            run_id: fixture.route.run_id,
            commit: fixture.route.source.commit,
            for_round: fixture.report.rounds,
            findings: [],
            created_at: "2026-07-12T01:29:55Z",
          };
      priorSource.findings.push({ review_id: primary.review_id, finding: reviewFinding });
      finalPrimary.input.prior_findings_source = write(
        fixture.root,
        priorSourcePath,
        `${JSON.stringify(priorSource, null, 2)}\n`
      );
      const payload = { ...finalPrimary.input };
      delete payload.payload_sha256;
      finalPrimary.input.payload_sha256 = digest(Buffer.from(canonicalJson(payload)));
    }
    const row = {
      subject_id: finalFinding.subject_id,
      region: finalFinding.region,
      rule: finalFinding.rule,
      coverage_ids: coverageIds,
      source_finding_refs: [ref],
      agreement: "single-source",
      disposition: finalFinding.status === "dismissed" ? "dismissed" : "accepted",
      final_finding_id: finalFinding.id,
      decision_evidence_ids: finalFinding.evidence_ids.filter((id) => !sourceEvidence.includes(id)),
      rationale: "The final report preserves the evidence-bound reviewer finding.",
    };
    row.id = reconciliationId(row);
    fixture.report.reconciliation.push(row);
  }
  for (const round of rebuilt.rounds)
    for (const review of round.reviews) attachReviewReceipt(fixture.root, review, round.round);
  fixture.reviews = rebuilt;
  rewrite(fixture.root, fixture.reviewsPath, fixture.reviews);
  fixture.report.reviews = binding(fixture.root, fixture.reviewsPath);
}

function uniqueCoverageIds(fixture, finalFinding, evidenceIds) {
  const coverage = new Set();
  for (const id of evidenceIds) {
    const capture = fixture.captures.captures.find((item) => item.id === id);
    if (capture) coverage.add(capture.coverage_id);
  }
  if (coverage.size === 0) {
    for (const item of fixture.route.coverage)
      if (item.subject_id === finalFinding.subject_id && item.required) coverage.add(item.id);
  }
  return [...coverage].sort();
}

test("accepts a complete product UI evidence chain", () => {
  const fixture = makeFixture();
  assert.deepEqual(check(fixture), { ok: true, issues: [] });
});

test("hashes each managed capture bundle once per design-critique validation", (t) => {
  const fixture = makeFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const capture = fixture.captures.captures.find((item) => item.coverage_id === "ui-primary");
  const { bundle, payloads } = publishManagedCaptureBundle(fixture, capture);
  const payloadPaths = new Set([...payloads.keys()].map((name) => path.join(bundle, name)));
  const bytesRead = new Map([...payloadPaths].map((file) => [file, 0]));
  const descriptorPaths = new Map();
  const originalOpen = fs.openSync;
  const originalRead = fs.readSync;
  const originalClose = fs.closeSync;
  fs.openSync = function trackManagedPayloadOpen(file, ...args) {
    const descriptor = Reflect.apply(originalOpen, fs, [file, ...args]);
    const resolved = path.resolve(String(file));
    if (payloadPaths.has(resolved)) descriptorPaths.set(descriptor, resolved);
    return descriptor;
  };
  fs.readSync = function trackManagedPayloadRead(descriptor, ...args) {
    const count = Reflect.apply(originalRead, fs, [descriptor, ...args]);
    const file = descriptorPaths.get(descriptor);
    if (file && count > 0) bytesRead.set(file, bytesRead.get(file) + count);
    return count;
  };
  fs.closeSync = function trackManagedPayloadClose(descriptor, ...args) {
    descriptorPaths.delete(descriptor);
    return Reflect.apply(originalClose, fs, [descriptor, ...args]);
  };

  try {
    assert.deepEqual(check(fixture), { ok: true, issues: [] });
    const bundleBytes = [...payloads.values()].reduce((total, bytes) => total + bytes.length, 0);
    assert.equal(
      [...bytesRead.values()].reduce((total, bytes) => total + bytes, 0),
      bundleBytes * 2
    );
    for (const [name, bytes] of payloads)
      assert.equal(bytesRead.get(path.join(bundle, name)), bytes.length * 2, name);

    assert.deepEqual(check(fixture), { ok: true, issues: [] });
    assert.equal(
      [...bytesRead.values()].reduce((total, bytes) => total + bytes, 0),
      bundleBytes * 4
    );
  } finally {
    fs.openSync = originalOpen;
    fs.readSync = originalRead;
    fs.closeSync = originalClose;
  }
});

test("mirrors the trusted producer's route cardinality limits", async (t) => {
  await t.test("allows 100 subjects but rejects 101", () => {
    const fixture = makeFixture();
    for (let index = 1; index < 100; index += 1)
      fixture.route.subjects.push({
        ...fixture.route.subjects[0],
        id: `account-detail-${index}`,
        surface: `/accounts/${index + 1}`,
      });
    rewrite(fixture.root, fixture.routePath, fixture.route);

    const atLimit = check(fixture);
    assert.equal(
      atLimit.issues.some(
        (issue) => issue.path === "route.subjects" && /1 through 100/.test(issue.message)
      ),
      false
    );

    fixture.route.subjects.push({
      ...fixture.route.subjects[0],
      id: "account-detail-over-limit",
      surface: "/accounts/over-limit",
    });
    rewrite(fixture.root, fixture.routePath, fixture.route);

    const aboveLimit = check(fixture);
    assert.equal(aboveLimit.ok, false);
    assert.equal(
      aboveLimit.issues.filter(
        (issue) => issue.path === "route.subjects" && /1 through 100/.test(issue.message)
      ).length,
      1
    );
    assert.doesNotMatch(JSON.stringify(aboveLimit.issues), /account-detail-over-limit/);
  });

  await t.test("allows 1,000 coverage rows but rejects 1,001", () => {
    const fixture = makeFixture();
    const repeated = fixture.route.coverage.find((item) => item.id === "ui-empty");
    while (fixture.route.coverage.length < 1_000) {
      const index = fixture.route.coverage.length;
      fixture.route.coverage.push({ ...repeated, id: `repeated-empty-${index}` });
    }
    rewrite(fixture.root, fixture.routePath, fixture.route);

    const atLimit = check(fixture);
    assert.equal(
      atLimit.issues.some(
        (issue) => issue.path === "route.coverage" && /1 through 1000 rows/.test(issue.message)
      ),
      false
    );
    assert.ok(
      atLimit.issues.filter((issue) => /duplicate subject\/state\/viewport/.test(issue.message))
        .length <= 25
    );

    fixture.route.coverage.push({ ...repeated, id: "repeated-empty-over-limit" });
    rewrite(fixture.root, fixture.routePath, fixture.route);

    const aboveLimit = check(fixture);
    assert.equal(aboveLimit.ok, false);
    assert.equal(
      aboveLimit.issues.filter(
        (issue) => issue.path === "route.coverage" && /1 through 1000 rows/.test(issue.message)
      ).length,
      1
    );
    assert.equal(
      aboveLimit.issues.filter((issue) => /duplicate subject\/state\/viewport/.test(issue.message))
        .length,
      0
    );
    assert.doesNotMatch(JSON.stringify(aboveLimit.issues), /repeated-empty-over-limit/);
  });

  await t.test("rejects more than two capture rows per maximum coverage set", () => {
    const fixture = makeFixture();
    const template = fixture.captures.captures[0];
    while (fixture.captures.captures.length <= 2_000)
      fixture.captures.captures.push({
        ...template,
        id: `capture-history-${fixture.captures.captures.length}`,
        active: false,
      });
    rewrite(fixture.root, fixture.capturesPath, fixture.captures);

    const target = fs.realpathSync(path.join(fixture.root, template.path));
    const original = fs.openSync;
    let captureReads = 0;
    fs.openSync = function counted(file, ...args) {
      try {
        if (fs.realpathSync(String(file)) === target) captureReads += 1;
      } catch {
        // Unrelated missing paths cannot be the retained capture under observation.
      }
      return original.call(this, file, ...args);
    };
    let result;
    try {
      result = check(fixture);
    } finally {
      fs.openSync = original;
    }
    assert.equal(result.ok, false);
    assert.equal(
      result.issues.filter(
        (issue) => issue.path === "captures.captures" && /at most 2000 rows/.test(issue.message)
      ).length,
      1
    );
    assert.equal(captureReads, 0);
    assert.doesNotMatch(JSON.stringify(result.issues), /capture-history-/);
  });

  await t.test(
    "rejects duplicate coverage and round rows at the limit without decode amplification",
    () => {
      const fixture = makeFixture();
      const template = fixture.captures.captures[0];
      fixture.captures.captures = [template];
      while (fixture.captures.captures.length < 2_000)
        fixture.captures.captures.push({
          ...template,
          id: `capture-amplification-${fixture.captures.captures.length}`,
          active: false,
        });
      rewrite(fixture.root, fixture.capturesPath, fixture.captures);

      const original = zlib.inflateSync;
      let inflations = 0;
      zlib.inflateSync = function counted(...args) {
        inflations += 1;
        return original.apply(this, args);
      };
      let result;
      try {
        result = check(fixture);
      } finally {
        zlib.inflateSync = original;
      }

      const details = result.issues.filter((issue) =>
        /duplicates the coverage\/round capture/.test(issue.message)
      );
      const summaries = result.issues.filter((issue) =>
        /additional duplicate coverage\/round captures omitted/.test(issue.message)
      );
      assert.equal(result.ok, false);
      assert.equal(details.length, 24);
      assert.equal(summaries.length, 1);
      assert.match(summaries[0].message, /^1975 additional/);
      assert.equal(inflations, 1);
    }
  );
});

test("malformed route and capture collections return issues instead of throwing", async (t) => {
  for (const field of ["subjects", "coverage"])
    await t.test(`route.${field} object`, () => {
      const fixture = makeFixture();
      fixture.route[field] = {};
      rewrite(fixture.root, fixture.routePath, fixture.route);

      let result;
      assert.doesNotThrow(() => {
        result = check(fixture);
      });
      assert.equal(result.ok, false);
      assert.equal(
        result.issues.some((issue) => issue.path === `route.${field}`),
        true
      );
    });

  for (const field of ["subjects", "coverage"])
    await t.test(`route.${field} non-object row`, () => {
      const fixture = makeFixture();
      fixture.route[field] = [null];
      rewrite(fixture.root, fixture.routePath, fixture.route);

      let result;
      assert.doesNotThrow(() => {
        result = check(fixture);
      });
      assert.equal(result.ok, false);
      assert.equal(
        result.issues.some(
          (issue) => issue.path === `route.${field}[0]` && issue.message === "must be an object"
        ),
        true
      );
    });

  await t.test("captures.captures object", () => {
    const fixture = makeFixture();
    fixture.captures.captures = {};
    rewrite(fixture.root, fixture.capturesPath, fixture.captures);

    let result;
    assert.doesNotThrow(() => {
      result = check(fixture);
    });
    assert.equal(result.ok, false);
    assert.equal(
      result.issues.some((issue) => issue.path === "captures.captures"),
      true
    );
  });

  await t.test("captures.captures non-object row", () => {
    const fixture = makeFixture();
    fixture.captures.captures = [null];
    rewrite(fixture.root, fixture.capturesPath, fixture.captures);

    let result;
    assert.doesNotThrow(() => {
      result = check(fixture);
    });
    assert.equal(result.ok, false);
    assert.equal(
      result.issues.some(
        (issue) => issue.path === "captures.captures[0]" && issue.message === "must be an object"
      ),
      true
    );
  });

  await t.test("caps indexed non-object row diagnostics", () => {
    const fixture = makeFixture();
    fixture.route.coverage = Array.from({ length: 1_000 }, () => null);
    rewrite(fixture.root, fixture.routePath, fixture.route);

    let result;
    assert.doesNotThrow(() => {
      result = check(fixture);
    });
    const details = result.issues.filter(
      (issue) =>
        /^route\.coverage\[\d+\]$/.test(issue.path) && issue.message === "must be an object"
    );
    const summaries = result.issues.filter(
      (issue) =>
        issue.path === "route.coverage" &&
        /additional non-object rows omitted after 24 indexed diagnostics/.test(issue.message)
    );
    assert.equal(result.ok, false);
    assert.equal(details.length, 24);
    assert.equal(summaries.length, 1);
    assert.match(summaries[0].message, /^976 additional/);
  });

  for (const value of [null, "invalid", 7])
    await t.test(`scalar route ${JSON.stringify(value)}`, () => {
      const fixture = makeFixture();
      rewrite(fixture.root, fixture.routePath, value);

      let result;
      assert.doesNotThrow(() => {
        result = check(fixture);
      });
      assert.equal(result.ok, false);
      assert.equal(
        result.issues.some(
          (issue) => issue.path === "route" && issue.message === "must be an object"
        ),
        true
      );
    });

  for (const value of [null, "invalid", 7])
    await t.test(`scalar captures ${JSON.stringify(value)}`, () => {
      const fixture = makeFixture();
      rewrite(fixture.root, fixture.capturesPath, value);

      let result;
      assert.doesNotThrow(() => {
        result = check(fixture);
      });
      assert.equal(result.ok, false);
      assert.equal(
        result.issues.some(
          (issue) => issue.path === "captures" && issue.message === "must be an object"
        ),
        true
      );
    });
});

test("rejects duplicate subject, state, and viewport coverage decisions", () => {
  const fixture = makeFixture();
  fixture.route.coverage.push({
    ...fixture.route.coverage.find((item) => item.id === "ui-empty"),
    id: "ui-empty-duplicate",
  });
  rewrite(fixture.root, fixture.routePath, fixture.route);

  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /duplicates the subject\/state\/viewport decision/);
});

test("requires a trusted same-session observation for schema-v2 web captures", () => {
  const fixture = makeFixture();
  delete fixture.captures.captures[0].observation;
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  fixture.report.captures = binding(fixture.root, fixture.capturesPath);
  rewriteReportAndHtml(fixture);
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /require a trusted capture manifest/);
});

test("reports object-valued network requests as structured validation issues", () => {
  const fixture = makeFixture();
  const capture = fixture.captures.captures[0];
  const manifest = JSON.parse(
    fs.readFileSync(path.join(fixture.root, capture.observation.path), "utf8")
  );
  const ledgerPath = manifest.raw_evidence.network_ledger.path;
  const ledger = JSON.parse(fs.readFileSync(path.join(fixture.root, ledgerPath), "utf8"));
  ledger.requests = { sequence: 1 };
  ledger.observed_origins = [];
  const networkBinding = write(fixture.root, ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
  manifest.raw_evidence.network_ledger = networkBinding;
  manifest.observation.network.observed_origins = [];
  manifest.observation.network.request_count = 0;
  manifest.observation.network.ledger_sha256 = networkBinding.sha256;
  capture.observation = write(
    fixture.root,
    capture.observation.path,
    `${JSON.stringify(manifest, null, 2)}\n`
  );
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  fixture.report.captures = binding(fixture.root, fixture.capturesPath);
  rewriteReportAndHtml(fixture);

  let result;
  assert.doesNotThrow(() => {
    result = check(fixture);
  });
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result.issues),
    /network_ledger\.requests.*must contain at most 2000 requests/
  );
});

test("reports truthy non-array network origin fields without throwing", () => {
  const fixture = makeFixture();
  const capture = fixture.captures.captures[0];
  const manifest = JSON.parse(
    fs.readFileSync(path.join(fixture.root, capture.observation.path), "utf8")
  );
  const ledgerPath = manifest.raw_evidence.network_ledger.path;
  const ledger = JSON.parse(fs.readFileSync(path.join(fixture.root, ledgerPath), "utf8"));
  ledger.allowed_origins = { local: "http://127.0.0.1:4173" };
  ledger.observed_origins = { local: "http://127.0.0.1:4173" };
  const networkBinding = write(fixture.root, ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
  manifest.raw_evidence.network_ledger = networkBinding;
  manifest.observation.network.ledger_sha256 = networkBinding.sha256;
  capture.observation = write(
    fixture.root,
    capture.observation.path,
    `${JSON.stringify(manifest, null, 2)}\n`
  );
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  fixture.report.captures = binding(fixture.root, fixture.capturesPath);
  rewriteReportAndHtml(fixture);

  let result;
  assert.doesNotThrow(() => {
    result = check(fixture);
  });
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result.issues),
    /allowed_origins.*bounded unique origin array.*observed_origins.*bounded unique origin array/
  );
});

test("rejects navigation drift inside a rebound trusted capture manifest", () => {
  const fixture = makeFixture();
  const capture = fixture.captures.captures[0];
  const manifest = JSON.parse(
    fs.readFileSync(path.join(fixture.root, capture.observation.path), "utf8")
  );
  manifest.page.final_url = {
    ...manifest.page.expected_url,
    has_query: true,
    full_url_sha256: "0".repeat(64),
  };
  capture.observation = write(
    fixture.root,
    capture.observation.path,
    `${JSON.stringify(manifest, null, 2)}\n`
  );
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  fixture.report.captures = binding(fixture.root, fixture.capturesPath);
  rewriteReportAndHtml(fixture);
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /must equal the asserted expected URL/);
});

test("trusted checker accepts scrollbar gutters and rejects invalid viewport dimensions", () => {
  const fixture = makeFixture();
  const capture = fixture.captures.captures[0];
  const gutter = {
    client_width: capture.width - 11,
    client_height: capture.height - 11,
    scroll_width: capture.width - 11,
    scroll_height: capture.height - 11,
  };
  for (const [overrides, accepted] of [
    [gutter, true],
    [{ ...gutter, scroll_height: capture.height + 2000 }, true],
    [{ ...gutter, client_width: 0 }, false],
    [{ ...gutter, client_height: 0 }, false],
    [{ ...gutter, client_width: capture.width + 1 }, false],
    [{ ...gutter, client_height: capture.height + 1 }, false],
    [{ ...gutter, inner_width: capture.width - 1 }, false],
    [{ ...gutter, inner_height: capture.height - 1 }, false],
    [{ ...gutter, scroll_width: capture.width - 12 }, false],
    [{ ...gutter, scroll_height: capture.height - 12 }, false],
  ]) {
    attachTrustedCaptureObservation(
      fixture.root,
      fixture.route,
      binding(fixture.root, fixture.routePath),
      capture,
      fixture.captures.evidence,
      0,
      overrides
    );
    rewrite(fixture.root, fixture.capturesPath, fixture.captures);
    fixture.report.captures = binding(fixture.root, fixture.capturesPath);
    rewriteReportAndHtml(fixture);
    const result = check(fixture);
    assert.equal(result.ok, accepted, JSON.stringify(result.issues));
    if (!accepted) assert.match(JSON.stringify(result.issues), /css_viewport|CSS viewport/);
  }
});

test("trusted checker accepts bound scroll offsets but rejects offsets outside document bounds", () => {
  const fixture = makeFixture();
  const capture = fixture.captures.captures[0];
  for (const scrollY of [1200, -1, 2001, 0.5]) {
    attachTrustedCaptureObservation(
      fixture.root,
      fixture.route,
      binding(fixture.root, fixture.routePath),
      capture,
      fixture.captures.evidence,
      scrollY
    );
    rewrite(fixture.root, fixture.capturesPath, fixture.captures);
    fixture.report.captures = binding(fixture.root, fixture.capturesPath);
    rewriteReportAndHtml(fixture);
    const result = check(fixture);
    assert.equal(result.ok, scrollY === 1200, JSON.stringify(result.issues));
    if (scrollY !== 1200) assert.match(JSON.stringify(result.issues), /CSS viewport/);
  }
});

test("rejects a cross-origin lookalike route even when that origin is allowlisted", () => {
  const fixture = makeFixture();
  const capture = fixture.captures.captures[0];
  const manifest = JSON.parse(
    fs.readFileSync(path.join(fixture.root, capture.observation.path), "utf8")
  );
  const lookalike = redactedUrlIdentity("https://lookalike.test/accounts/1", "fixture URL").public;
  manifest.page.expected_url = lookalike;
  manifest.page.final_url = lookalike;
  manifest.observation.network.allowed_origins.push(lookalike.origin);
  capture.observation = write(
    fixture.root,
    capture.observation.path,
    `${JSON.stringify(manifest, null, 2)}\n`
  );
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  fixture.report.captures = binding(fixture.root, fixture.capturesPath);
  rewriteReportAndHtml(fixture);

  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result.issues),
    /requested, expected, and final URL origins must match/
  );
});

test("rejects arbitrary-code state assertions even when their hashes are rebound", () => {
  const fixture = makeFixture();
  const capture = fixture.captures.captures[0];
  const manifest = JSON.parse(
    fs.readFileSync(path.join(fixture.root, capture.observation.path), "utf8")
  );
  const assertionBinding = write(
    fixture.root,
    manifest.page.state_assertion.path,
    `${JSON.stringify({ schema_version: 1, expression: "window.ready === true" })}\n`
  );
  manifest.page.state_assertion.sha256 = assertionBinding.sha256;
  const configuration = manifest.observation.configuration;
  const invocation = {
    producer: manifest.observation.producer,
    route_sha256: manifest.route.sha256,
    run_id: manifest.run_id,
    commit: manifest.commit,
    subject_id: manifest.subject_id,
    coverage: manifest.coverage,
    capture_id: manifest.capture.id,
    requested_url: manifest.page.requested_url,
    expected_url: manifest.page.expected_url,
    viewport: { width: manifest.capture.width, height: manifest.capture.height },
    assertion: { path: assertionBinding.path, sha256: assertionBinding.sha256 },
    allowed_origins: manifest.observation.network.allowed_origins,
    readiness_timeout_ms: configuration.readiness_timeout_ms,
    settle_ms: configuration.settle_ms,
    browser_args_profile: configuration.browser_args_profile,
    acquisition: configuration.acquisition,
  };
  manifest.observation.invocation_configuration_sha256 = digest(
    Buffer.from(JSON.stringify(invocation))
  );
  capture.observation = write(
    fixture.root,
    capture.observation.path,
    `${JSON.stringify(manifest, null, 2)}\n`
  );
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  fixture.report.captures = binding(fixture.root, fixture.capturesPath);
  rewriteReportAndHtml(fixture);
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /invalid declarative assertion:.*unknown field/);
});

test("accepts a complete PM artifact evidence chain", () => {
  const fixture = makeFixture({ mode: "pm-artifact" });
  assert.deepEqual(check(fixture), { ok: true, issues: [] });
});

test("rejects a PM artifact whose reviewed HTML bytes changed", () => {
  const fixture = makeFixture({ mode: "pm-artifact" });
  fs.appendFileSync(
    path.join(fixture.root, fixture.route.subjects[0].artifact.path),
    "<!-- drift -->"
  );
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /does not match file bytes/);
});

test("rejects artifact captures not bound by the render manifest", () => {
  const fixture = makeFixture({ mode: "pm-artifact" });
  const renderEvidence = fixture.captures.evidence.find((item) => item.kind === "artifact-render");
  const render = JSON.parse(fs.readFileSync(path.join(fixture.root, renderEvidence.path), "utf8"));
  render.captures[0].sha256 = `sha256:${"f".repeat(64)}`;
  const rebound = write(fixture.root, renderEvidence.path, `${JSON.stringify(render, null, 2)}\n`);
  renderEvidence.sha256 = rebound.sha256;
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /render hash and byte count must match the file/);
});

test("rejects non-portable absolute paths in retained artifact renders", () => {
  const fixture = makeFixture({ mode: "pm-artifact" });
  const renderEvidence = fixture.captures.evidence.find((item) => item.kind === "artifact-render");
  const render = JSON.parse(fs.readFileSync(path.join(fixture.root, renderEvidence.path), "utf8"));
  render.captures[0].path = path.join(fixture.root, render.captures[0].path);
  const rebound = write(fixture.root, renderEvidence.path, `${JSON.stringify(render, null, 2)}\n`);
  renderEvidence.sha256 = rebound.sha256;
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /must be a relative path/);
});

test("rejects artifact captures swapped between viewport labels", () => {
  const fixture = makeFixture({ mode: "pm-artifact" });
  const renderEvidence = fixture.captures.evidence.find((item) => item.kind === "artifact-render");
  const render = JSON.parse(fs.readFileSync(path.join(fixture.root, renderEvidence.path), "utf8"));
  const desktop = { path: render.captures[0].path, sha256: render.captures[0].sha256 };
  render.captures[0].path = render.captures[2].path;
  render.captures[0].sha256 = render.captures[2].sha256;
  render.captures[2].path = desktop.path;
  render.captures[2].sha256 = desktop.sha256;
  const rebound = write(fixture.root, renderEvidence.path, `${JSON.stringify(render, null, 2)}\n`);
  renderEvidence.sha256 = rebound.sha256;
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /render dimensions must equal/);
});

test("rejects stale source identity", () => {
  const fixture = makeFixture();
  const result = check(fixture, "c".repeat(40));
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /must equal current commit/);
});

test("revalidates the current browser executable identity before certifying captures", () => {
  const fixture = makeFixture();
  const browserPath = path.join(fixture.root, "fake-chromium");
  fs.writeFileSync(browserPath, "#!/bin/sh\necho 'Chromium 140.0.0.0'\n", { mode: 0o755 });
  const identity = inspectBrowserIdentity(browserPath).public;
  for (const capture of fixture.captures.captures) {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(fixture.root, capture.observation.path), "utf8")
    );
    manifest.observation.browser = { engine: "chromium", before: identity, after: identity };
    capture.observation = write(
      fixture.root,
      capture.observation.path,
      `${JSON.stringify(manifest, null, 2)}\n`
    );
  }
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  fixture.report.captures = binding(fixture.root, fixture.capturesPath);
  rewriteReportAndHtml(fixture);
  const verifyOptions = {
    verifyBrowser: false,
    verifyCaptureBrowser: true,
    browserPath,
  };
  assert.deepEqual(check(fixture, COMMIT, verifyOptions), { ok: true, issues: [] });

  fs.appendFileSync(browserPath, "# executable drift\n");
  const result = check(fixture, COMMIT, verifyOptions);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /current browser executable identity/);
});

test("does not execute a browser path supplied only by retained capture evidence", () => {
  const fixture = makeFixture();
  const markerPath = path.join(fixture.root, "untrusted-browser-ran");
  const untrustedBrowser = path.join(fixture.root, "untrusted-chromium");
  const trustedBrowser = path.join(fixture.root, "configured-chromium");
  fs.writeFileSync(
    untrustedBrowser,
    `#!/bin/sh\nprintf ran > '${markerPath}'\necho 'Chromium 140.0.0.0'\n`,
    { mode: 0o755 }
  );
  fs.writeFileSync(trustedBrowser, "#!/bin/sh\necho 'Chromium 140.0.0.0'\n", { mode: 0o755 });
  const untrustedBytes = fs.readFileSync(untrustedBrowser);
  const identity = {
    path: fs.realpathSync(untrustedBrowser),
    bytes: untrustedBytes.length,
    sha256: digest(untrustedBytes),
    version: "Chromium 140.0.0.0",
  };
  for (const capture of fixture.captures.captures) {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(fixture.root, capture.observation.path), "utf8")
    );
    manifest.observation.browser = { engine: "chromium", before: identity, after: identity };
    capture.observation = write(
      fixture.root,
      capture.observation.path,
      `${JSON.stringify(manifest, null, 2)}\n`
    );
  }
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  fixture.report.captures = binding(fixture.root, fixture.capturesPath);
  rewriteReportAndHtml(fixture);

  const result = check(fixture, COMMIT, {
    verifyBrowser: false,
    verifyCaptureBrowser: true,
    browserPath: trustedBrowser,
  });
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /configured current browser executable/);
  assert.equal(fs.existsSync(markerPath), false);
});

test("rejects changed capture bytes", () => {
  const fixture = makeFixture();
  fs.appendFileSync(path.join(fixture.root, fixture.captures.captures[0].path), "changed");
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /does not match file bytes/);
});

test("rejects one canonical capture path reused for distinct required states", () => {
  const fixture = makeFixture();
  const [desktop, narrow] = fixture.captures.captures;
  narrow.path = desktop.path;
  narrow.sha256 = desktop.sha256;
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  fixture.report.captures = binding(fixture.root, fixture.capturesPath);
  rewriteReportAndHtml(fixture);

  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /distinct required coverage.*canonical capture path/);
});

test("rejects identical capture bytes stored under distinct required-state paths", () => {
  const fixture = makeFixture();
  const [desktop, narrow] = fixture.captures.captures;
  const desktopBytes = fs.readFileSync(path.join(fixture.root, desktop.path));
  const rebound = write(fixture.root, narrow.path, desktopBytes);
  narrow.sha256 = rebound.sha256;
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  fixture.report.captures = binding(fixture.root, fixture.capturesPath);
  rewriteReportAndHtml(fixture);

  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /distinct required coverage.*capture content hash/);
});

test("rejects re-encoded identical pixels for distinct required states", () => {
  const fixture = makeFixture();
  const desktop = fixture.captures.captures.find((item) => item.coverage_id === "ui-primary");
  const reencoded = validPng(desktop.width, desktop.height, 0, 64);
  addRequiredStateCapture(fixture, "success", reencoded);

  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /distinct required coverage.*decoded-pixel hash/);
});

test("rejects different state captures whose only visual change is a one-pixel beacon", () => {
  const fixture = makeFixture();
  const desktop = fixture.captures.captures.find((item) => item.coverage_id === "ui-primary");
  addRequiredStateCapture(fixture, "success", validPng(desktop.width, desktop.height, 0, 0, 1));

  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /states primary and success.*materially different/);
});

test("bounds cross-state visual-distance diagnostics after grouping by subject and viewport", () => {
  const fixture = makeFixture();
  const desktop = fixture.captures.captures.find((item) => item.coverage_id === "ui-primary");
  const states = [
    "empty",
    "error",
    "boundary",
    "loading",
    "success",
    "focus",
    "disabled",
    "keyboard",
    "modal",
  ];
  for (const [index, state] of states.entries())
    addRequiredStateCapture(
      fixture,
      state,
      validPng(desktop.width, desktop.height, 0, 0, index + 1)
    );

  const result = check(fixture);
  const detail = result.issues.filter((issue) =>
    issue.message.includes("materially different decoded pixels")
  );
  const summaries = result.issues.filter((issue) =>
    issue.message.includes("additional cross-state visual-distance failures omitted")
  );
  assert.equal(result.ok, false);
  assert.equal(detail.length, 24);
  assert.equal(summaries.length, 1);
  assert.match(summaries[0].message, /^21 additional/);
});

test("rejects an opaque near-blank screenshot with a one-pixel beacon", () => {
  const fixture = makeFixture();
  const capture = fixture.captures.captures[0];
  const bytes = onePixelBeaconPng(capture.width, capture.height);
  const rebound = write(fixture.root, capture.path, bytes);
  capture.sha256 = rebound.sha256;
  capture.pixel_sha256 = inspectPngVisualBytes(bytes).pixelSha256;
  refreshTrustedCaptureObservations(fixture);
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  fixture.report.captures = binding(fixture.root, fixture.capturesPath);
  rewriteReportAndHtml(fixture);

  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /meaningful pixels|spatial tiles/);
});

test("rejects a 99.75 percent uniform screenshot spread across enough tiles to mimic content", () => {
  const fixture = makeFixture();
  const capture = fixture.captures.captures[0];
  const bytes = nearUniformTwoTilePng(capture.width, capture.height);
  const inspected = inspectPngVisualBytes(bytes);
  assert.ok(inspected.meaningfulPixelRatio >= 0.002);
  assert.ok(inspected.meaningfulPixelRatio < 0.003);
  assert.equal(inspected.meaningfulTileRatio, 2 / 64);
  const rebound = write(fixture.root, capture.path, bytes);
  capture.sha256 = rebound.sha256;
  capture.pixel_sha256 = inspected.pixelSha256;
  refreshTrustedCaptureObservations(fixture);
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  fixture.report.captures = binding(fixture.root, fixture.capturesPath);
  rewriteReportAndHtml(fixture);

  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /meaningful pixels must cover at least 1%/);
});

test("rejects a transparent product UI screenshot", () => {
  const fixture = makeFixture();
  const capture = fixture.captures.captures[0];
  const bytes = transparentPng(capture.width, capture.height);
  const rebound = write(fixture.root, capture.path, bytes);
  capture.sha256 = rebound.sha256;
  capture.pixel_sha256 = inspectPngVisualBytes(bytes).pixelSha256;
  refreshTrustedCaptureObservations(fixture);
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  fixture.report.captures = binding(fixture.root, fixture.capturesPath);
  rewriteReportAndHtml(fixture);

  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /effective visible coverage must be at least/);
});

test("rejects a near-transparent varied product UI screenshot", () => {
  const fixture = makeFixture();
  const capture = fixture.captures.captures[0];
  const bytes = nearTransparentVariedPng(capture.width, capture.height);
  const rebound = write(fixture.root, capture.path, bytes);
  capture.sha256 = rebound.sha256;
  capture.pixel_sha256 = inspectPngVisualBytes(bytes).pixelSha256;
  refreshTrustedCaptureObservations(fixture);
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  fixture.report.captures = binding(fixture.root, fixture.capturesPath);
  rewriteReportAndHtml(fixture);

  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /effective visible coverage must be at least/);
});

for (const [coverageId, width] of [
  ["ui-primary", 1440],
  ["ui-primary-narrow", 500],
]) {
  test(`rejects a one-pixel-tall ${coverageId} capture`, () => {
    const fixture = makeFixture();
    const capture = fixture.captures.captures.find((item) => item.coverage_id === coverageId);
    const bytes = validPng(width, 1, 0, 1024);
    const rebound = write(fixture.root, capture.path, bytes);
    capture.sha256 = rebound.sha256;
    capture.pixel_sha256 = inspectPngVisualBytes(bytes).pixelSha256;
    capture.width = width;
    capture.height = 1;
    rewrite(fixture.root, fixture.capturesPath, fixture.captures);
    fixture.report.captures = binding(fixture.root, fixture.capturesPath);
    rewriteReportAndHtml(fixture);

    const result = check(fixture);
    assert.equal(result.ok, false);
    assert.match(JSON.stringify(result.issues), /viewport height 1 must be at least/);
  });
}

for (const [name, width, height, expected] of [
  ["over-width", 8193, 600, /desktop viewport width 8193 is outside its accepted range/],
  ["over-height", 1024, 8193, /desktop viewport height 8193 must be at most 8192/],
  ["over-pixel-budget", 8192, 3000, /exceeds the 16777216-pixel budget/],
]) {
  test(`rejects ${name} web PNG metadata before pixel inflation`, () => {
    const fixture = makeFixture();
    const capture = fixture.captures.captures.find((item) => item.coverage_id === "ui-primary");
    const rebound = write(fixture.root, capture.path, pngHeaderOnly(width, height));
    capture.sha256 = rebound.sha256;
    capture.width = width;
    capture.height = height;
    rewrite(fixture.root, fixture.capturesPath, fixture.captures);
    fixture.report.captures = binding(fixture.root, fixture.capturesPath);
    rewriteReportAndHtml(fixture);

    const result = check(fixture);
    assert.equal(result.ok, false);
    assert.match(JSON.stringify(result.issues), expected);
    assert.doesNotMatch(
      JSON.stringify(result.issues),
      /PNG must contain|pixel stream|decoded pixel budget/
    );
  });
}

test("rejects a PDF substituted for a mobile product UI capture", () => {
  const fixture = makeFixture();
  fixture.route.subjects[0].platform = "mobile";
  fixture.route.coverage.find((item) => item.id === "ui-primary").viewport = "device";
  rewrite(fixture.root, fixture.routePath, fixture.route);
  fixture.captures.route = binding(fixture.root, fixture.routePath);
  const capture = fixture.captures.captures.find((item) => item.coverage_id === "ui-primary");
  const rebound = write(fixture.root, "evidence/files/ui-primary.pdf", validPdf());
  capture.kind = "pdf";
  capture.path = rebound.path;
  capture.sha256 = rebound.sha256;
  capture.pages = 1;
  delete capture.width;
  delete capture.height;
  delete capture.full_page;
  delete capture.pixel_sha256;
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  fixture.report.route = fixture.captures.route;
  fixture.report.captures = binding(fixture.root, fixture.capturesPath);
  rewriteReportAndHtml(fixture);

  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /product UI coverage requires a screenshot/);
});

test("rejects screenshot bindings whose bytes are not an image", () => {
  const fixture = makeFixture();
  const capture = fixture.captures.captures[0];
  const rebound = write(fixture.root, capture.path, "not an image");
  capture.sha256 = rebound.sha256;
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /invalid PNG capture/);
});

test("rejects decoded dimensions that differ from the capture manifest", () => {
  const fixture = makeFixture();
  fixture.captures.captures[0].width = 1;
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /declared dimensions must equal 1440x1000/);
});

test("rejects PNG headers without a decodable pixel stream", () => {
  const fixture = makeFixture();
  const capture = fixture.captures.captures[0];
  const fake = Buffer.alloc(1024);
  Buffer.from("89504e470d0a1a0a", "hex").copy(fake);
  fake.write("IHDR", 12, "ascii");
  fake.writeUInt32BE(1440, 16);
  fake.writeUInt32BE(1000, 20);
  const rebound = write(fixture.root, capture.path, fake);
  capture.sha256 = rebound.sha256;
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /PNG/);
});

test("rejects oversized evidence before reading it", () => {
  const fixture = makeFixture();
  const file = path.join(fixture.root, fixture.captures.captures[0].path);
  fs.truncateSync(file, 64 * 1024 * 1024 + 1);
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /evidence budget/);
});

test("reads a large bound capture only once per validation run", () => {
  const fixture = makeFixture();
  const capture = fixture.captures.captures[0];
  const large = write(fixture.root, capture.path, validPng(1440, 1000, 0, 4 * 1024 * 1024 + 1));
  capture.sha256 = large.sha256;
  refreshTrustedCaptureObservations(fixture);
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  fixture.report.captures = binding(fixture.root, fixture.capturesPath);
  rewriteReportAndHtml(fixture);
  const target = fs.realpathSync(path.join(fixture.root, capture.path));
  const original = fs.openSync;
  let reads = 0;
  fs.openSync = function counted(file, ...args) {
    try {
      if (fs.realpathSync(String(file)) === target) reads += 1;
    } catch {
      // A missing/non-path open cannot be the retained capture under observation.
    }
    return original.call(this, file, ...args);
  };
  try {
    assert.deepEqual(check(fixture), { ok: true, issues: [] });
  } finally {
    fs.openSync = original;
  }
  assert.equal(reads, 1);
});

test("decodes repeated capture bytes once across distinct coverage rows", () => {
  const fixture = makeFixture();
  const desktop = fixture.captures.captures.find((item) => item.coverage_id === "ui-primary");
  const narrow = fixture.captures.captures.find((item) => item.coverage_id === "ui-primary-narrow");
  Object.assign(narrow, {
    path: desktop.path,
    sha256: desktop.sha256,
    pixel_sha256: desktop.pixel_sha256,
    width: desktop.width,
    height: desktop.height,
  });
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);

  const original = zlib.inflateSync;
  let inflations = 0;
  zlib.inflateSync = function counted(...args) {
    inflations += 1;
    return original.apply(this, args);
  };
  let result;
  try {
    result = check(fixture);
  } finally {
    zlib.inflateSync = original;
  }

  assert.equal(result.ok, false);
  assert.equal(inflations, 1);
});

test("rejects missing required coverage", () => {
  const fixture = makeFixture();
  fixture.captures.captures = [];
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /must have exactly one active capture/);
});

test("requires a primary device capture for mobile UI", () => {
  const fixture = makeFixture();
  fixture.route.subjects[0].platform = "mobile";
  rewrite(fixture.root, fixture.routePath, fixture.route);
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /mobile primary device capture is required/);
});

test("rejects device and print viewport decisions for web product UI", () => {
  const fixture = makeFixture();
  fixture.route.coverage.find((item) => item.id === "ui-empty").viewport = "device";
  fixture.route.coverage.find((item) => item.id === "ui-error").viewport = "print";
  rewrite(fixture.root, fixture.routePath, fixture.route);

  const result = check(fixture);
  assert.equal(result.ok, false);
  const compatibilityIssues = result.issues.filter(
    (issue) =>
      issue.path.endsWith(".viewport") &&
      issue.message === "web product-ui coverage must use desktop, tablet, or narrow"
  );
  assert.equal(compatibilityIssues.length, 2);
});

test("rejects non-device viewport decisions for mobile product UI", () => {
  const fixture = makeFixture();
  fixture.route.subjects[0].platform = "mobile";
  fixture.route.coverage = fixture.route.coverage.filter((item) => item.id !== "ui-primary-narrow");
  for (const item of fixture.route.coverage) item.viewport = "device";
  for (const [id, viewport] of [
    ["ui-empty", "desktop"],
    ["ui-error", "tablet"],
    ["ui-boundary", "narrow"],
    ["ui-loading", "print"],
  ])
    fixture.route.coverage.find((item) => item.id === id).viewport = viewport;
  rewrite(fixture.root, fixture.routePath, fixture.route);

  const result = check(fixture);
  assert.equal(result.ok, false);
  const compatibilityIssues = result.issues.filter(
    (issue) =>
      issue.path.endsWith(".viewport") &&
      issue.message === "mobile product-ui coverage must use device"
  );
  assert.equal(compatibilityIssues.length, 4);
});

test("requires primary narrow viewport evidence for web UI", () => {
  const fixture = makeFixture();
  fixture.route.coverage = fixture.route.coverage.filter((item) => item.viewport !== "narrow");
  rewrite(fixture.root, fixture.routePath, fixture.route);
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /web primary narrow capture is required/);
});

test("does not let a responsive narrow state replace the primary narrow capture", () => {
  const fixture = makeFixture();
  const narrow = fixture.route.coverage.find((item) => item.viewport === "narrow");
  narrow.state = "responsive";
  rewrite(fixture.root, fixture.routePath, fixture.route);
  fixture.captures.route = binding(fixture.root, fixture.routePath);
  fixture.report.route = fixture.captures.route;
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  fixture.report.captures = binding(fixture.root, fixture.capturesPath);
  rewriteReportAndHtml(fixture);

  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /web primary narrow capture is required/);
});

test("rejects a wide product UI screenshot labeled narrow", () => {
  const fixture = makeFixture();
  const narrowCoverage = fixture.route.coverage.find((item) => item.viewport === "narrow");
  const capture = fixture.captures.captures.find((item) => item.coverage_id === narrowCoverage.id);
  const rebound = write(fixture.root, capture.path, validPng(1440, 1000));
  capture.sha256 = rebound.sha256;
  capture.width = 1440;
  capture.height = 1000;
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  fixture.report.captures = binding(fixture.root, fixture.capturesPath);
  rewriteReportAndHtml(fixture);

  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result.issues),
    /narrow viewport width 1440 is outside its accepted range/
  );
});

test("legacy route v1 is readable for migration but cannot certify a current pass", () => {
  const fixture = makeFixture({ routeSchemaVersion: 1 });
  const enforced = check(fixture);
  assert.equal(enforced.ok, false);
  assert.match(JSON.stringify(enforced.issues), /schema version 1 is migration-only/);

  assert.deepEqual(check(fixture, COMMIT, { legacyRouteMode: "inspect" }), {
    ok: false,
    authoritative: false,
    inspection_ok: true,
    issues: [],
  });
});

test("documents route v2 as the only schema for newly authored critique routes", () => {
  const contract = fs.readFileSync(
    path.join(__dirname, "../skills/design-critique/references/evidence-contract.md"),
    "utf8"
  );
  const scope = fs.readFileSync(
    path.join(__dirname, "../skills/design-critique/steps/01-scope.md"),
    "utf8"
  );
  assert.match(contract, /"schema_version": 2/);
  assert.match(`${contract}\n${scope}`, /never create a new route with schema version 1/i);
});

test("documents the complete schema-v2 reviewer evidence contract", () => {
  const contract = fs.readFileSync(
    path.join(__dirname, "../skills/design-critique/references/evidence-contract.md"),
    "utf8"
  );
  const skill = fs.readFileSync(path.join(__dirname, "../skills/design-critique/SKILL.md"), "utf8");
  for (const required of [
    /report\.json.*schema-v2 machine outcome/i,
    /"schema_version": 2/,
    /"reviews".*reviews\.json/,
    /workflow-attested-non-cryptographic/,
    /shared context source/i,
    /round capture manifest/i,
    /one observation.*every supplied capture/i,
    /Every reviewer finding appears in exactly one reconciliation row/i,
    /Design Critique-owned source.*remains or becomes P0\/P1.*cannot be reassigned/i,
    /data-dc-review-assurance/,
    /Schema v1.*inspection mode.*never certify/i,
  ])
    assert.match(contract, required);
  assert.match(skill, /changed capture bytes invalidate reviews and report/i);
  assert.match(skill, /Route, captures, reviews\.json, structured report/i);
});

test("rejects empty accessibility audit evidence", () => {
  const fixture = makeFixture();
  const evidence = fixture.captures.evidence.find((item) => item.kind === "accessibility-tree");
  const rebound = write(fixture.root, evidence.path, "{}\n");
  evidence.sha256 = rebound.sha256;
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /requires passing landmarks, names, focus_order/);
});

test("rejects a normalized audit when its raw probe bytes are tampered", () => {
  const fixture = makeFixture();
  const evidence = fixture.captures.evidence.find((item) => item.kind === "accessibility-tree");
  const audit = JSON.parse(fs.readFileSync(path.join(fixture.root, evidence.path), "utf8"));
  fs.appendFileSync(path.join(fixture.root, audit.raw.path), "\n");

  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /does not match raw probe bytes/);
});

test("rejects a claimed passing boolean contradicted by the raw probe", () => {
  const fixture = makeFixture();
  const evidence = fixture.captures.evidence.find((item) => item.kind === "dom-audit");
  const audit = JSON.parse(fs.readFileSync(path.join(fixture.root, evidence.path), "utf8"));
  const raw = JSON.parse(fs.readFileSync(path.join(fixture.root, audit.raw.path), "utf8"));
  raw.observations.viewport.scroll_width = raw.observations.viewport.client_width + 20;
  const rawFile = write(fixture.root, audit.raw.path, `${JSON.stringify(raw)}\n`);
  const contradicted = normalizeAuditBytes(
    fs.readFileSync(path.join(fixture.root, rawFile.path)),
    rawFile
  );
  contradicted.checks.overflow = true;
  const rebound = write(fixture.root, evidence.path, `${JSON.stringify(contradicted)}\n`);
  evidence.sha256 = rebound.sha256;
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  fixture.report.captures = binding(fixture.root, fixture.capturesPath);
  rewriteReportAndHtml(fixture);

  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /deterministic normalization of the bound raw probe/);
});

for (const issueKind of ["consistency", "asymmetry"]) {
  test(`rejects a normalized DOM audit with a measured ${issueKind} defect`, () => {
    const fixture = makeFixture();
    const evidence = fixture.captures.evidence.find((item) => item.kind === "dom-audit");
    rewriteNormalizedAudit(fixture, evidence, (raw) => {
      raw.observations[issueKind].push({
        code: `${issueKind}-defect`,
        locator: "main > section",
        detail: `Measured ${issueKind} defect in the rendered interface.`,
      });
    });
    rewrite(fixture.root, fixture.capturesPath, fixture.captures);
    fixture.report.captures = binding(fixture.root, fixture.capturesPath);
    rewriteReportAndHtml(fixture);

    const result = check(fixture);
    assert.equal(result.ok, false);
    assert.match(JSON.stringify(result.issues), new RegExp(`requires passing.*${issueKind}`));
  });
}

test("rejects one desktop DOM probe claiming both desktop and narrow captures", () => {
  const fixture = makeFixture();
  const desktop = fixture.captures.captures.find((item) => item.width === 1440);
  const narrow = fixture.captures.captures.find((item) => item.width === 500);
  const desktopEvidence = fixture.captures.evidence.find((item) => {
    if (item.kind !== "dom-audit") return false;
    const audit = JSON.parse(fs.readFileSync(path.join(fixture.root, item.path), "utf8"));
    return audit.capture_ids.includes(desktop.id);
  });
  fixture.captures.evidence = fixture.captures.evidence.filter((item) => {
    if (item.kind !== "dom-audit" || item === desktopEvidence) return true;
    const audit = JSON.parse(fs.readFileSync(path.join(fixture.root, item.path), "utf8"));
    return !audit.capture_ids.includes(narrow.id);
  });
  rewriteNormalizedAudit(fixture, desktopEvidence, (raw) => {
    raw.capture_ids = [desktop.id, narrow.id];
  });
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  fixture.report.captures = binding(fixture.root, fixture.capturesPath);
  rewriteReportAndHtml(fixture);

  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /must cite exactly one capture/);
});

test("rejects a narrow DOM probe measured at the desktop viewport", () => {
  const fixture = makeFixture();
  const narrow = fixture.captures.captures.find((item) => item.width === 500);
  const evidence = fixture.captures.evidence.find((item) => {
    if (item.kind !== "dom-audit") return false;
    const audit = JSON.parse(fs.readFileSync(path.join(fixture.root, item.path), "utf8"));
    return audit.capture_ids.includes(narrow.id);
  });
  rewriteNormalizedAudit(fixture, evidence, (raw) => {
    raw.observations.viewport = { inner_width: 1440, client_width: 1440, scroll_width: 1440 };
  });
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  fixture.report.captures = binding(fixture.root, fixture.capturesPath);
  rewriteReportAndHtml(fixture);

  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /must equal cited capture width 500/);
});

test("rejects normalized audit evidence when the retained raw probe is missing", () => {
  const fixture = makeFixture();
  const evidence = fixture.captures.evidence.find((item) => item.kind === "dom-audit");
  const audit = JSON.parse(fs.readFileSync(path.join(fixture.root, evidence.path), "utf8"));
  fs.unlinkSync(path.join(fixture.root, audit.raw.path));

  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /ENOENT|input must be an existing regular file/);
});

test("rejects a self-attested schema-v1 audit on a route-v2 run", () => {
  const fixture = makeFixture();
  const evidence = fixture.captures.evidence.find((item) => item.kind === "accessibility-tree");
  const audit = JSON.parse(fs.readFileSync(path.join(fixture.root, evidence.path), "utf8"));
  audit.schema_version = 1;
  delete audit.raw;
  const rebound = write(fixture.root, evidence.path, `${JSON.stringify(audit)}\n`);
  evidence.sha256 = rebound.sha256;
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  fixture.report.captures = binding(fixture.root, fixture.capturesPath);
  rewriteReportAndHtml(fixture);

  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /requires a raw probe path and SHA-256/);
});

test("rejects a passed report with an open P1", () => {
  const fixture = makeFixture();
  const finding = {
    subject_id: "account-detail",
    region: "header",
    rule: "hierarchy",
    evidence_ids: [fixture.captures.captures[0].id],
    priority: "P1",
    status: "open",
    owner: "design-critique",
    summary: "Primary action is visually subordinate.",
    remediation: "Increase action prominence.",
  };
  finding.id = findingId(finding);
  fixture.report.findings = [finding];
  rewrite(fixture.root, fixture.reportPath, fixture.report);
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /passed cannot contain open or deferred P0\/P1/);
});

test("rejects a passed report with an unevidenced dismissed Design Critique P1", () => {
  const fixture = makeFixture();
  const finding = {
    subject_id: "account-detail",
    region: "header",
    rule: "hierarchy",
    evidence_ids: [fixture.captures.captures[0].id],
    priority: "P1",
    status: "dismissed",
    owner: "design-critique",
    summary: "Primary action is visually subordinate.",
    remediation: "Increase action prominence.",
  };
  finding.id = findingId(finding);
  fixture.report.findings = [finding];
  rewriteReportAndHtml(fixture);

  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /dismissed Design Critique P0\/P1/);
});

test("allows a genuine QA P1 handoff but rejects Design blocker ownership laundering", () => {
  const fixture = makeFixture();
  const finding = {
    subject_id: "account-detail",
    region: "save-flow",
    rule: "functional-navigation",
    evidence_ids: [fixture.captures.captures[0].id],
    priority: "P1",
    status: "open",
    owner: "qa",
    summary: "The post-save destination needs functional verification.",
    remediation: "Exercise the save flow in QA.",
  };
  finding.id = findingId(finding);
  fixture.report.findings = [finding];
  rewriteReportAndHtml(fixture);
  assert.deepEqual(check(fixture), { ok: true, issues: [] });

  const round = fixture.reviews.rounds[0];
  const primary = round.reviews.find((item) => item.perspective === "primary");
  primary.result.findings[0].owner = "design-critique";
  attachReviewReceipt(fixture.root, primary, round.round);
  rewriteReviewsAndReport(fixture);
  const laundered = check(fixture);
  assert.equal(laundered.ok, false);
  assert.match(
    JSON.stringify(laundered.issues),
    /ownership cannot be reassigned|source Design Critique blocker/
  );
});

test("a Design P2 cannot be escalated to P1 and transferred to QA", () => {
  const fixture = makeFixture();
  const captureId = fixture.captures.captures[0].id;
  const decisionEvidenceId = fixture.captures.evidence[0].id;
  const finalFinding = {
    subject_id: "account-detail",
    region: "header-actions",
    rule: "primary-action-hierarchy",
    evidence_ids: [captureId, decisionEvidenceId],
    priority: "P1",
    status: "open",
    owner: "qa",
    summary: "The visually subordinate primary action was escalated and transferred.",
    remediation: "Keep the Design-owned blocker in Design Critique until resolved.",
  };
  finalFinding.id = findingId(finalFinding);
  fixture.report.findings = [finalFinding];
  rewriteReportAndHtml(fixture);

  const round = fixture.reviews.rounds[0];
  const primary = round.reviews.find((item) => item.perspective === "primary");
  const sourceFinding = primary.result.findings[0];
  sourceFinding.priority = "P2";
  sourceFinding.owner = "design-critique";
  attachReviewReceipt(fixture.root, primary, round.round);
  const row = fixture.report.reconciliation[0];
  row.decision_evidence_ids = [decisionEvidenceId];
  row.rationale = "Additional accessibility evidence raises the issue to blocking severity.";
  row.final_finding_id = finalFinding.id;
  rewriteReviewsAndReport(fixture);

  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /becomes P0\/P1 cannot be reassigned/);
});

test("rejects a human report whose visible outcome diverges from JSON", () => {
  const fixture = makeFixture();
  const htmlPath = path.join(fixture.root, fixture.report.human_report.path);
  fs.writeFileSync(
    htmlPath,
    fs
      .readFileSync(htmlPath, "utf8")
      .replace('data-dc-outcome="passed"', 'data-dc-outcome="failed"')
  );
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /visible outcome marker must match report JSON/);
});

test("rejects an unresolved or stale report generator version", () => {
  const fixture = makeFixture();
  const htmlPath = path.join(fixture.root, fixture.report.human_report.path);
  fs.writeFileSync(
    htmlPath,
    fs
      .readFileSync(htmlPath, "utf8")
      .replace(`"version":"${PLUGIN_VERSION}"`, '"version":"{{PLUGIN_VERSION}}"')
  );
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /metadata generator must be pm:design-critique/);
});

test("rejects correct outcome attributes with contradictory visible text", () => {
  const fixture = makeFixture();
  const htmlPath = path.join(fixture.root, fixture.report.human_report.path);
  fs.writeFileSync(
    htmlPath,
    fs
      .readFileSync(htmlPath, "utf8")
      .replace('data-dc-outcome="passed">passed', 'data-dc-outcome="passed">failed')
  );
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /visible outcome marker must match report JSON/);
});

test("ignores semantic markers hidden in HTML comments", () => {
  const fixture = makeFixture();
  const htmlPath = path.join(fixture.root, fixture.report.human_report.path);
  const html = fs.readFileSync(htmlPath, "utf8");
  const marker = '<p data-dc-outcome="passed">passed</p>';
  fs.writeFileSync(htmlPath, html.replace(marker, `<!-- ${marker} -->`));
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /visible outcome marker must match report JSON/);
});

test("ignores semantic markers inside hidden ancestors", () => {
  const fixture = makeFixture();
  const htmlPath = path.join(fixture.root, fixture.report.human_report.path);
  const html = fs.readFileSync(htmlPath, "utf8");
  const marker = '<p data-dc-outcome="passed">passed</p>';
  fs.writeFileSync(htmlPath, html.replace(marker, `<div hidden>${marker}</div>`));
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /visible outcome marker must match report JSON/);
});

test("ignores semantic markers hidden by a stylesheet class", () => {
  const fixture = makeFixture();
  const htmlPath = path.join(fixture.root, fixture.report.human_report.path);
  const html = fs.readFileSync(htmlPath, "utf8");
  const marker = '<p data-dc-outcome="passed">passed</p>';
  fs.writeFileSync(
    htmlPath,
    html
      .replace("</style>", ".concealed{display:none}</style>")
      .replace(marker, `<div class="concealed">${marker}</div>`)
  );
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /visible outcome marker must match report JSON/);
});

for (const [name, wrapper] of [
  ["an attribute selector", (marker) => `<style>[data-dc-outcome]{display:none}</style>${marker}`],
  ["a closed details element", (marker) => `<details>${marker}</details>`],
  ["a closed dialog element", (marker) => `<dialog>${marker}</dialog>`],
]) {
  test(`rejects an outcome marker hidden by ${name} in the rendered DOM`, () => {
    const fixture = makeFixture();
    const htmlPath = path.join(fixture.root, fixture.report.human_report.path);
    const html = fs.readFileSync(htmlPath, "utf8");
    const marker = '<p data-dc-outcome="passed">passed</p>';
    fs.writeFileSync(htmlPath, html.replace(marker, wrapper(marker)));
    const result = check(fixture, COMMIT, {
      verifyBrowser: true,
      markerProbe: () =>
        renderedMarkers(fixture.report, (attributes) => attributes["data-dc-outcome"] === "passed"),
    });
    assert.equal(result.ok, false);
    assert.match(
      JSON.stringify(result.issues),
      /must exist exactly once with matching visible text/
    );
  });
}

test("rejects a marker whose JSON-bound text is hidden behind visible filler", () => {
  const fixture = makeFixture();
  const htmlPath = path.join(fixture.root, fixture.report.human_report.path);
  const html = fs.readFileSync(htmlPath, "utf8");
  const marker = `<p data-dc-next-action-sha256="${digest(Buffer.from(fixture.report.next_action))}">${fixture.report.next_action}</p>`;
  fs.writeFileSync(
    htmlPath,
    html
      .replace("</style>", "[data-hide]{display:none}</style>")
      .replace(
        marker,
        marker.replace(
          fixture.report.next_action,
          `<span data-hide>${fixture.report.next_action}</span><span>Proceed</span>`
        )
      )
  );
  const markers = renderedMarkers(fixture.report);
  const nextAction = markers.find((item) => item.attributes["data-dc-next-action-sha256"]);
  nextAction.text = "Proceed";
  nextAction.firstScreenText = "Proceed";
  const result = check(fixture, COMMIT, {
    verifyBrowser: true,
    markerProbe: () => markers,
  });
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /matching visible text in the first screenful/);
});

test("rejects a summary marker outside the first screenful", () => {
  const fixture = makeFixture();
  const markers = renderedMarkers(fixture.report);
  markers.find((item) => item.attributes["data-dc-top-issue-sha256"]).inViewport = false;
  const result = check(fixture, COMMIT, {
    verifyBrowser: true,
    markerProbe: () => markers,
  });
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /matching visible text in the first screenful/);
});

test("rejects a marker clipped by an overflow ancestor", () => {
  const fixture = makeFixture();
  const markers = renderedMarkers(fixture.report);
  markers.find((item) => item.attributes["data-dc-score-key"] === "hierarchy").visible = false;
  const result = check(fixture, COMMIT, {
    verifyBrowser: true,
    markerProbe: () => markers,
  });
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /matching visible text/);
});

test("rejects failed outcome without a blocking design finding or reason", () => {
  const fixture = makeFixture();
  fixture.report.outcome = "failed";
  fixture.report.top_issue = "No unresolved design issue.";
  rewriteReportAndHtml(fixture);
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result.issues),
    /failed requires an unresolved Design Critique P0\/P1/
  );
});

test("rejects unknown durable schema fields", () => {
  const fixture = makeFixture();
  fixture.route.source.base_sha = "typo";
  rewrite(fixture.root, fixture.routePath, fixture.route);
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /route\.source\.base_sha.*unknown field/);
});

test("rejects a human report whose visible score diverges from JSON", () => {
  const fixture = makeFixture();
  const htmlPath = path.join(fixture.root, fixture.report.human_report.path);
  fs.writeFileSync(
    htmlPath,
    fs
      .readFileSync(htmlPath, "utf8")
      .replace(
        'data-dc-score-key="hierarchy" data-dc-score-value="4"',
        'data-dc-score-key="hierarchy" data-dc-score-value="1"'
      )
  );
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /visible score hierarchy must match report JSON/);
});

test("rejects a passed report whose noncompensatory scores fall below three", () => {
  const fixture = makeFixture();
  for (const score of Object.values(fixture.report.scores)) score.value = 1;
  rewriteReportAndHtml(fixture);

  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /passed requires every score to be at least 3/);
});

test("rejects score evidence from the wrong modality", () => {
  const fixture = makeFixture();
  fixture.report.scores.accessibility.evidence_ids = [fixture.captures.captures[0].id];
  rewriteReportAndHtml(fixture);

  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /required accessibility evidence/);
});

test("score evidence must cover every active subject", () => {
  const fixture = makeFixture();
  addProductUiSubject(fixture, "billing-detail");
  fixture.report.scores.accessibility.evidence_ids =
    fixture.report.scores.accessibility.evidence_ids.filter((id) => !id.includes("billing-detail"));
  rewriteReportAndHtml(fixture);

  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /required accessibility evidence:.*billing-detail/);
});

test("state-clarity scores must cite every active required state capture", () => {
  const fixture = makeFixture();
  fixture.report.scores["state-clarity"].evidence_ids = [fixture.captures.captures[0].id];
  rewriteReportAndHtml(fixture);

  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /required state-clarity evidence/);
});

test("verifies the frozen git diff hash when enabled", () => {
  const fixture = makeFixture();
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: fixture.root });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: fixture.root });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: fixture.root });
  write(fixture.root, ".gitignore", "/evidence/\n");
  write(fixture.root, "source.txt", "base\n");
  execFileSync("git", ["add", "."], { cwd: fixture.root });
  execFileSync("git", ["commit", "-qm", "base"], { cwd: fixture.root });
  const base = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: fixture.root,
    encoding: "utf8",
  }).trim();
  write(fixture.root, "source.txt", "changed\n");
  execFileSync("git", ["add", "source.txt"], { cwd: fixture.root });
  execFileSync("git", ["commit", "-qm", "change"], { cwd: fixture.root });
  const commit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: fixture.root,
    encoding: "utf8",
  }).trim();
  const origin = path.join(path.dirname(fixture.root), `${path.basename(fixture.root)}-origin.git`);
  execFileSync("git", ["init", "-q", "--bare", origin]);
  execFileSync("git", ["--git-dir", origin, "symbolic-ref", "HEAD", "refs/heads/main"]);
  execFileSync("git", ["remote", "add", "origin", origin], { cwd: fixture.root });
  execFileSync("git", ["push", "-q", "origin", `${base}:refs/heads/main`], {
    cwd: fixture.root,
  });
  const diff = execFileSync("git", ["diff", "--binary", `${base}...${commit}`], {
    cwd: fixture.root,
  });
  fixture.route.source = {
    commit,
    base_ref: "origin/main",
    base_commit: base,
    diff_sha256: digest(diff),
  };
  rewrite(fixture.root, fixture.routePath, fixture.route);
  fixture.captures.commit = commit;
  fixture.captures.route = binding(fixture.root, fixture.routePath);
  for (const evidence of fixture.captures.evidence.filter((item) =>
    ["accessibility-tree", "dom-audit"].includes(item.kind)
  ))
    rewriteNormalizedAudit(fixture, evidence, (audit) => {
      audit.commit = commit;
    });
  refreshTrustedCaptureObservations(fixture);
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  fixture.report.commit = commit;
  fixture.report.route = binding(fixture.root, fixture.routePath);
  fixture.report.captures = binding(fixture.root, fixture.capturesPath);
  rewriteReportAndHtml(fixture);
  const result = checkDesignCritique({
    root: fixture.root,
    routePath: fixture.routePath,
    capturesPath: fixture.capturesPath,
    reportPath: fixture.reportPath,
    commit,
    baseRef: "origin/main",
    baseCommit: base,
    verifyBrowser: false,
  });
  assert.deepEqual(result, { ok: true, issues: [] });

  write(fixture.root, "source.txt", "dirty tracked UI mutation\n");
  const dirtySource = checkDesignCritique({
    root: fixture.root,
    routePath: fixture.routePath,
    capturesPath: fixture.capturesPath,
    reportPath: fixture.reportPath,
    commit,
    baseRef: "origin/main",
    baseCommit: base,
    verifyBrowser: false,
  });
  assert.equal(dirtySource.ok, false);
  assert.match(
    JSON.stringify(dirtySource.issues),
    /tracked source must be clean before certification/
  );
  write(fixture.root, "source.txt", "changed\n");

  const capture = fixture.captures.captures[0];
  const manifest = JSON.parse(
    fs.readFileSync(path.join(fixture.root, capture.observation.path), "utf8")
  );
  manifest.observation.source.before.tree = "0".repeat(40);
  manifest.observation.source.after.tree = "0".repeat(40);
  capture.observation = write(
    fixture.root,
    capture.observation.path,
    `${JSON.stringify(manifest, null, 2)}\n`
  );
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  fixture.report.captures = binding(fixture.root, fixture.capturesPath);
  rewriteReportAndHtml(fixture);
  const staleTree = checkDesignCritique({
    root: fixture.root,
    routePath: fixture.routePath,
    capturesPath: fixture.capturesPath,
    reportPath: fixture.reportPath,
    commit,
    baseRef: "origin/main",
    baseCommit: base,
    verifyBrowser: false,
  });
  assert.match(JSON.stringify(staleTree.issues), /current local Git HEAD and tree/);
  refreshTrustedCaptureObservations(fixture);
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  fixture.report.captures = binding(fixture.root, fixture.capturesPath);
  rewriteReportAndHtml(fixture);

  assert.match(
    JSON.stringify(
      checkDesignCritique({
        root: fixture.root,
        routePath: fixture.routePath,
        capturesPath: fixture.capturesPath,
        reportPath: fixture.reportPath,
        commit: base,
        baseRef: "origin/main",
        baseCommit: base,
        verifyBrowser: false,
      }).issues
    ),
    /supplied commit must equal current HEAD/
  );
  assert.match(
    JSON.stringify(
      checkDesignCritique({
        root: fixture.root,
        routePath: fixture.routePath,
        capturesPath: fixture.capturesPath,
        reportPath: fixture.reportPath,
        commit,
        baseRef: commit,
        baseCommit: commit,
        verifyBrowser: false,
      }).issues
    ),
    /supplied base must equal remote default origin\/main/
  );
  fixture.route.source.diff_sha256 = "0".repeat(64);
  rewrite(fixture.root, fixture.routePath, fixture.route);
  assert.match(
    JSON.stringify(
      checkDesignCritique({
        root: fixture.root,
        routePath: fixture.routePath,
        capturesPath: fixture.capturesPath,
        reportPath: fixture.reportPath,
        commit,
        baseRef: "origin/main",
        baseCommit: base,
        verifyBrowser: false,
      }).issues
    ),
    /does not match the frozen git diff bytes/
  );
});

test("rejects resolved P1 without distinct before and after evidence", () => {
  const fixture = makeFixture();
  const captureId = fixture.captures.captures[0].id;
  const finding = {
    subject_id: "account-detail",
    region: "header",
    rule: "hierarchy",
    evidence_ids: [captureId],
    priority: "P1",
    status: "resolved",
    owner: "design-critique",
    summary: "Primary action was visually subordinate.",
    remediation: "Increased action prominence.",
    before_capture_id: captureId,
    after_capture_id: captureId,
  };
  finding.id = findingId(finding);
  fixture.report.findings = [finding];
  rewrite(fixture.root, fixture.reportPath, fixture.report);
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /distinct before and after capture hashes/);
});

test("rejects re-encoded identical pixels as resolved product UI evidence", () => {
  const fixture = makeFixture();
  const before = fixture.captures.captures.find((item) => item.coverage_id === "ui-primary");
  before.active = false;
  const afterBytes = validPng(before.width, before.height, 0, 64);
  const afterFile = write(fixture.root, "evidence/files/ui-primary-reencoded.png", afterBytes);
  const after = {
    ...before,
    id: "capture-ui-primary-reencoded",
    ...afterFile,
    pixel_sha256: inspectPngVisualBytes(afterBytes).pixelSha256,
    active: true,
    round: 2,
    captured_at: "2026-07-12T01:25:00Z",
  };
  fixture.captures.captures.push(after);
  fixture.captures.evidence.push(
    auditEvidenceFile(
      fixture.root,
      "a11y-capture-ui-primary-reencoded",
      "accessibility-tree",
      [after],
      2
    ),
    auditEvidenceFile(fixture.root, "dom-capture-ui-primary-reencoded", "dom-audit", [after], 2)
  );
  refreshTrustedCaptureObservations(fixture);
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  const finding = {
    subject_id: "account-detail",
    region: "header",
    rule: "hierarchy",
    evidence_ids: [before.id, after.id],
    priority: "P1",
    status: "resolved",
    owner: "design-critique",
    summary: "Primary action hierarchy was repaired.",
    remediation: "Keep the corrected hierarchy.",
    before_capture_id: before.id,
    after_capture_id: after.id,
  };
  finding.id = findingId(finding);
  fixture.report.rounds = 2;
  fixture.report.captures = binding(fixture.root, fixture.capturesPath);
  fixture.report.findings = [finding];
  for (const [key, score] of Object.entries(fixture.report.scores))
    score.evidence_ids = scoreEvidenceIds(
      fixture.root,
      key,
      fixture.route.mode,
      fixture.route.coverage,
      fixture.captures.captures,
      fixture.captures.evidence
    );
  rewriteReportAndHtml(fixture);

  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /including decoded pixels for product UI/);
});

test("resolved PM artifact evidence does not require product UI pixel fields", () => {
  const fixture = makeFixture({ mode: "pm-artifact" });
  const after = fixture.captures.captures.find((item) => item.coverage_id === "artifact-desktop");
  after.round = 2;
  after.captured_at = "2026-07-12T01:25:00Z";
  const beforeFile = write(
    fixture.root,
    "evidence/files/artifact-desktop-before.png",
    validPng(after.width, after.height, 4)
  );
  const before = {
    ...after,
    id: "capture-artifact-desktop-before",
    ...beforeFile,
    active: false,
    round: 1,
    captured_at: "2026-07-12T00:01:00Z",
  };
  fixture.captures.captures.push(before);
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  const finding = {
    subject_id: "account-detail",
    region: "summary",
    rule: "hierarchy",
    evidence_ids: [before.id, after.id],
    priority: "P1",
    status: "resolved",
    owner: "design-critique",
    summary: "The artifact summary hierarchy was repaired.",
    remediation: "Keep the corrected summary hierarchy.",
    before_capture_id: before.id,
    after_capture_id: after.id,
  };
  finding.id = findingId(finding);
  fixture.report.rounds = 2;
  fixture.report.captures = binding(fixture.root, fixture.capturesPath);
  fixture.report.findings = [finding];
  rewriteReportAndHtml(fixture);

  assert.deepEqual(check(fixture), { ok: true, issues: [] });
});

test("accepts a resolved P1 with inactive before and active after captures", () => {
  const fixture = makeFixture();
  const { before, after } = configureResolvedPrimaryFinding(fixture);
  assert.deepEqual(check(fixture), { ok: true, issues: [] });

  after.captured_at = before.captured_at;
  refreshTrustedCaptureObservations(fixture);
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  fixture.report.captures = binding(fixture.root, fixture.capturesPath);
  rewriteReportAndHtml(fixture);
  const unordered = check(fixture);
  assert.equal(unordered.ok, false);
  assert.match(JSON.stringify(unordered.issues), /chronologically ordered/);
});

test("rejects resolved P1 evidence whose only visual change is 200 pixels", () => {
  const fixture = makeFixture();
  const before = fixture.captures.captures.find((item) => item.coverage_id === "ui-primary");
  configureResolvedPrimaryFinding(fixture, validPng(before.width, before.height, 0, 0, 1, 200));

  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /decoded pixels must differ materially/);
});

test("rejects an active capture older than an inactive later round", () => {
  const fixture = makeFixture();
  const before = fixture.captures.captures[0];
  const laterBytes = validPng(1440, 1000, 3);
  const laterFile = write(fixture.root, "evidence/files/ui-primary-later.png", laterBytes);
  const later = {
    ...before,
    id: "capture-ui-primary-later",
    ...laterFile,
    pixel_sha256: inspectPngVisualBytes(laterBytes).pixelSha256,
    active: false,
    round: 2,
    captured_at: "2026-07-12T01:25:00Z",
  };
  fixture.captures.captures.push(later);
  for (const evidence of fixture.captures.evidence.filter((item) =>
    ["accessibility-tree", "dom-audit"].includes(item.kind)
  ))
    rewriteNormalizedAudit(fixture, evidence, (audit) => {
      audit.capture_ids.push(later.id);
    });
  refreshTrustedCaptureObservations(fixture);
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  fixture.report.rounds = 2;
  fixture.report.captures = binding(fixture.root, fixture.capturesPath);
  rewriteReportAndHtml(fixture);
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /must use the latest round/);
});

test("rejects evidence paths that escape the project root", () => {
  const fixture = makeFixture();
  fixture.captures.captures[0].path = "../outside.png";
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /escapes the project root/);
});

test("report schema v1 is inspection-only and cannot certify route v2", () => {
  const fixture = makeFixture();
  fixture.report.schema_version = 1;
  delete fixture.report.reviews;
  delete fixture.report.review_assurance;
  delete fixture.report.reconciliation;
  rewriteBoundReportAndHtml(fixture);

  const enforced = check(fixture);
  assert.equal(enforced.ok, false);
  assert.match(JSON.stringify(enforced.issues), /schema version 1 is inspection-only/);
  assert.deepEqual(check(fixture, COMMIT, { legacyReportMode: "inspect" }), {
    ok: false,
    authoritative: false,
    inspection_ok: true,
    issues: [],
  });
});

test("requires exactly one Primary and one Fresh Eyes review per round", () => {
  const fixture = makeFixture();
  fixture.reviews.rounds[0].reviews[1].perspective = "primary";
  rewriteReviewsAndReport(fixture);
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /exactly one Primary and one Fresh Eyes/);
});

for (const [field, message] of [
  ["context_id", /globally unique bounded identity/],
  ["invocation_id", /globally unique bounded identity/],
]) {
  test(`same-runtime perspectives cannot reuse ${field}`, () => {
    const fixture = makeFixture();
    const [primary, fresh] = fixture.reviews.rounds[0].reviews;
    fresh.execution[field] = primary.execution[field];
    rewriteReviewsAndReport(fixture);
    const result = check(fixture);
    assert.equal(result.ok, false);
    assert.match(JSON.stringify(result.issues), message);
  });
}

test("Primary and Fresh Eyes cannot reuse the same input payload", () => {
  const fixture = makeFixture();
  const [primary, fresh] = fixture.reviews.rounds[0].reviews;
  fresh.input = JSON.parse(JSON.stringify(primary.input));
  rewriteReviewsAndReport(fixture);
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /distinct input payloads/);
});

test("Primary and Fresh Eyes cannot reuse the same result object", () => {
  const fixture = makeFixture();
  const [primary, fresh] = fixture.reviews.rounds[0].reviews;
  fresh.result = JSON.parse(JSON.stringify(primary.result));
  rewriteReviewsAndReport(fixture);
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /cannot reuse the same result object/);
});

for (const [field, value] of [
  ["prior_finding_refs", []],
  ["evidence_ids", []],
  ["acceptance_criteria", ["Leaked implementation acceptance context."]],
  ["implementation_rationale", "The implementation used a grid."],
  ["brief", { page_description: "Unbound context" }],
  ["design_principles", ["Unbound principle"]],
]) {
  test(`Fresh Eyes rejects leaked ${field}`, () => {
    const fixture = makeFixture();
    const fresh = fixture.reviews.rounds[0].reviews.find(
      (item) => item.perspective === "fresh-eyes"
    );
    fresh.input[field] = value;
    const payload = { ...fresh.input };
    delete payload.payload_sha256;
    fresh.input.payload_sha256 = digest(Buffer.from(canonicalJson(payload)));
    rewriteReviewsAndReport(fixture);
    const result = check(fixture);
    assert.equal(result.ok, false);
    assert.match(JSON.stringify(result.issues), new RegExp(`${field}.*unknown field`));
  });
}

test("Fresh Eyes findings cannot cite normalized audit evidence", () => {
  const fixture = makeFixture();
  const fresh = fixture.reviews.rounds[0].reviews.find((item) => item.perspective === "fresh-eyes");
  const auditId = fixture.captures.evidence[0].id;
  const finding = {
    subject_id: "account-detail",
    region: "header-actions",
    rule: "primary-action-hierarchy",
    coverage_ids: ["ui-primary"],
    evidence_ids: [auditId],
    priority: "P2",
    owner: "design-critique",
    basis: "craft",
    confidence: "medium",
    summary: "The action competes with metadata.",
    impact: "A first-time user may scan the wrong region first.",
    remediation: "Increase the primary action prominence.",
  };
  finding.id = reviewFindingId(fresh.review_id, finding);
  fresh.result.findings = [finding];
  rewriteReviewsAndReport(fixture);
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result.issues),
    /Fresh Eyes findings must cite supplied rendered captures only/
  );
});

test("review prompt profiles bind the exact reviewer instruction bytes", () => {
  const fixture = makeFixture();
  fixture.reviews.rounds[0].reviews[0].input.prompt_sha256 = "0".repeat(64);
  rewriteReviewsAndReport(fixture);
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /exact reviewer instruction bytes/);
});

test("shared brief and principles are hash-bound before review", () => {
  const fixture = makeFixture();
  const context = fixture.reviews.rounds[0].reviews[0].input.context_source;
  const file = path.join(fixture.root, context.path);
  fs.writeFileSync(file, `${fs.readFileSync(file, "utf8")} `);
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /must bind .*review-context\.json/);
});

test("Primary and Fresh Eyes cannot bind different shared context sources", () => {
  const fixture = makeFixture();
  const round = fixture.reviews.rounds[0];
  const fresh = round.reviews.find((item) => item.perspective === "fresh-eyes");
  const source = JSON.parse(
    fs.readFileSync(path.join(fixture.root, fresh.input.context_source.path), "utf8")
  );
  source.brief.job_to_be_done = "A different unshared job was smuggled into Fresh Eyes.";
  fresh.input.context_source = write(
    fixture.root,
    "evidence/review-context-fresh.json",
    `${JSON.stringify(source, null, 2)}\n`
  );
  fresh.input = withPayloadHash(
    Object.fromEntries(Object.entries(fresh.input).filter(([key]) => key !== "payload_sha256"))
  );
  attachReviewReceipt(fixture.root, fresh, round.round);
  rewriteReviewsAndReport(fixture);
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /must bind the same brief and design principles/);
});

test("a round capture manifest must exist before reviewer execution", () => {
  const fixture = makeFixture();
  const round = fixture.reviews.rounds[0];
  const original = round.reviews[0].input.capture_manifest;
  const manifest = JSON.parse(fs.readFileSync(path.join(fixture.root, original.path), "utf8"));
  manifest.created_at = "2026-07-12T01:40:00Z";
  const rebound = write(fixture.root, original.path, `${JSON.stringify(manifest, null, 2)}\n`);
  for (const review of round.reviews) {
    review.input.capture_manifest = rebound;
    const payload = { ...review.input };
    delete payload.payload_sha256;
    review.input = withPayloadHash(payload);
    attachReviewReceipt(fixture.root, review, round.round);
  }
  rewriteReviewsAndReport(fixture);
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result.issues),
    /started_at.*must not precede the bound capture manifest/
  );
});

test("review cannot cite a capture created after its round manifest", () => {
  const fixture = makeFixture();
  fixture.captures.captures[0].captured_at = "2026-07-12T01:25:00Z";
  refreshTrustedCaptureObservations(fixture);
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  fixture.report.captures = binding(fixture.root, fixture.capturesPath);
  rewriteReportAndHtml(fixture);
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result.issues),
    /capture_manifest\.created_at.*must not precede capture/
  );
});

test("round 2 cannot execute before round 1 completes", () => {
  const fixture = makeFixture();
  configureResolvedPrimaryFinding(fixture);
  const firstRound = fixture.reviews.rounds[0];
  for (const review of firstRound.reviews) {
    review.execution.started_at = "2026-07-12T01:40:00Z";
    review.execution.completed_at = "2026-07-12T01:40:20Z";
    attachReviewReceipt(fixture.root, review, firstRound.round, "2026-07-12T01:40:30Z");
  }
  rewriteReviewsAndReport(fixture);

  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result.issues),
    /round 2 (?:capture manifest|execution).*after every round 1 review receipt/
  );
});

test("trusted capture chronology preserves sub-millisecond precision", () => {
  const fixture = makeFixture();
  const capture = fixture.captures.captures[0];
  const manifest = JSON.parse(
    fs.readFileSync(path.join(fixture.root, capture.observation.path), "utf8")
  );
  manifest.timestamps = {
    started_at: "2026-07-12T00:01:00.0002Z",
    page_ready_at: "2026-07-12T00:01:00.0001Z",
    captured_at: "2026-07-12T00:01:00.0003Z",
    completed_at: "2026-07-12T00:01:00.0004Z",
  };
  manifest.capture.captured_at = manifest.timestamps.captured_at;
  capture.captured_at = manifest.timestamps.captured_at;
  capture.observation = write(
    fixture.root,
    capture.observation.path,
    `${JSON.stringify(manifest, null, 2)}\n`
  );
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  fixture.report.captures = binding(fixture.root, fixture.capturesPath);
  rewriteReportAndHtml(fixture);

  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /ordered RFC 3339 timestamps/);
});

test("review evidence chronology preserves sub-millisecond precision", async (t) => {
  await t.test("execution completion cannot precede its start", () => {
    const fixture = makeFixture();
    const review = fixture.reviews.rounds[0].reviews[0];
    review.execution.started_at = "2026-07-12T01:20:10.0002Z";
    review.execution.completed_at = "2026-07-12T01:20:10.0001Z";
    attachReviewReceipt(fixture.root, review, 1);
    rewriteReviewsAndReport(fixture);

    const result = check(fixture);
    assert.equal(result.ok, false);
    assert.match(JSON.stringify(result.issues), /completed_at must not precede started_at/);
  });

  await t.test("receipt recording cannot precede completion", () => {
    const fixture = makeFixture();
    const review = fixture.reviews.rounds[0].reviews[0];
    review.execution.completed_at = "2026-07-12T01:20:40.0002Z";
    attachReviewReceipt(fixture.root, review, 1, "2026-07-12T01:20:40.0001Z");
    rewriteReviewsAndReport(fixture);

    const result = check(fixture);
    assert.equal(result.ok, false);
    assert.match(JSON.stringify(result.issues), /recorded_at.*must not precede completed_at/);
  });

  await t.test("report cannot predate completed reviews", () => {
    const fixture = makeFixture();
    fixture.reviews.checked_at = "2026-07-12T01:50:00.0002Z";
    fixture.report.checked_at = "2026-07-12T01:50:00.0001Z";
    rewriteReviewsAndReport(fixture);

    const result = check(fixture);
    assert.equal(result.ok, false);
    assert.match(JSON.stringify(result.issues), /reviews\.checked_at.*report\.checked_at/);
  });

  await t.test("review execution cannot predate its bound context", () => {
    const fixture = makeFixture();
    const round = fixture.reviews.rounds[0];
    const contextPath = round.reviews[0].input.context_source.path;
    const context = JSON.parse(fs.readFileSync(path.join(fixture.root, contextPath), "utf8"));
    context.created_at = "2026-07-12T01:20:10.0002Z";
    const rebound = write(fixture.root, contextPath, `${JSON.stringify(context, null, 2)}\n`);
    for (const review of round.reviews) {
      review.input.context_source = rebound;
      const payload = { ...review.input };
      delete payload.payload_sha256;
      review.input = withPayloadHash(payload);
      review.execution.started_at = "2026-07-12T01:20:10.0001Z";
      attachReviewReceipt(fixture.root, review, 1);
    }
    rewriteReviewsAndReport(fixture);

    const result = check(fixture);
    assert.equal(result.ok, false);
    assert.match(JSON.stringify(result.issues), /must not precede the bound context source/);
  });

  await t.test("review execution cannot predate its round manifest", () => {
    const fixture = makeFixture();
    const round = fixture.reviews.rounds[0];
    const manifestPath = round.reviews[0].input.capture_manifest.path;
    const manifest = JSON.parse(fs.readFileSync(path.join(fixture.root, manifestPath), "utf8"));
    manifest.created_at = "2026-07-12T01:20:10.0002Z";
    const rebound = write(fixture.root, manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    for (const review of round.reviews) {
      review.input.capture_manifest = rebound;
      const payload = { ...review.input };
      delete payload.payload_sha256;
      review.input = withPayloadHash(payload);
      review.execution.started_at = "2026-07-12T01:20:10.0001Z";
      attachReviewReceipt(fixture.root, review, 1);
    }
    rewriteReviewsAndReport(fixture);

    const result = check(fixture);
    assert.equal(result.ok, false);
    assert.match(JSON.stringify(result.issues), /must not precede the bound capture manifest/);
  });

  await t.test("round manifest cannot predate a supplied capture", () => {
    const fixture = makeFixture({ mode: "pm-artifact" });
    fixture.captures.captures[0].captured_at = "2026-07-12T01:20:00.0002Z";
    fixture.captures.checked_at = "2026-07-12T01:20:01Z";
    rewrite(fixture.root, fixture.capturesPath, fixture.captures);
    fixture.report.captures = binding(fixture.root, fixture.capturesPath);
    rewriteReportAndHtml(fixture);

    const result = check(fixture);
    assert.equal(result.ok, false);
    assert.match(
      JSON.stringify(result.issues),
      /capture_manifest\.created_at.*must not precede capture/
    );
  });

  await t.test("round boundary accepts a later instant inside the same millisecond", () => {
    const fixture = makeFixture();
    const { after } = configureResolvedPrimaryFinding(fixture);
    after.captured_at = "2026-07-12T01:30:00.0002Z";
    refreshTrustedCaptureObservations(fixture);
    rewrite(fixture.root, fixture.capturesPath, fixture.captures);
    fixture.reviews.captures = binding(fixture.root, fixture.capturesPath);
    fixture.report.captures = binding(fixture.root, fixture.capturesPath);
    const firstRound = fixture.reviews.rounds[0];
    for (const review of firstRound.reviews) {
      review.execution.started_at = "2026-07-12T01:29:59.9999Z";
      review.execution.completed_at = "2026-07-12T01:30:00.0001Z";
      attachReviewReceipt(fixture.root, review, 1, "2026-07-12T01:30:00.0001Z");
    }
    const secondRound = fixture.reviews.rounds[1];
    const manifestPath = secondRound.reviews[0].input.capture_manifest.path;
    const manifest = JSON.parse(fs.readFileSync(path.join(fixture.root, manifestPath), "utf8"));
    manifest.created_at = "2026-07-12T01:30:00.0003Z";
    const rebound = write(fixture.root, manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    for (const review of secondRound.reviews) {
      review.input.capture_manifest = rebound;
      if (review.input.prior_findings_source) {
        const priorPath = review.input.prior_findings_source.path;
        const prior = JSON.parse(fs.readFileSync(path.join(fixture.root, priorPath), "utf8"));
        prior.created_at = "2026-07-12T01:30:00.0002Z";
        review.input.prior_findings_source = write(
          fixture.root,
          priorPath,
          `${JSON.stringify(prior, null, 2)}\n`
        );
      }
      const payload = { ...review.input };
      delete payload.payload_sha256;
      review.input = withPayloadHash(payload);
      review.execution.started_at = "2026-07-12T01:30:00.0004Z";
      review.execution.completed_at = "2026-07-12T01:30:00.0005Z";
      attachReviewReceipt(fixture.root, review, 2, "2026-07-12T01:30:00.0006Z");
    }
    rewriteReviewsAndReport(fixture);

    assert.deepEqual(check(fixture), { ok: true, issues: [] });
  });
});

test("round 1 Primary cannot consume audit evidence from round 2", () => {
  const fixture = makeFixture();
  const { after } = configureResolvedPrimaryFinding(fixture);
  const firstRound = fixture.reviews.rounds[0];
  const primary = firstRound.reviews.find((item) => item.perspective === "primary");
  const laterAudit = fixture.captures.evidence.find((item) => {
    if (!["accessibility-tree", "dom-audit"].includes(item.kind)) return false;
    const audit = JSON.parse(fs.readFileSync(path.join(fixture.root, item.path), "utf8"));
    return audit.capture_ids.includes(after.id);
  });
  const payload = {
    ...primary.input,
    evidence_ids: [...primary.input.evidence_ids, laterAudit.id],
  };
  delete payload.payload_sha256;
  primary.input = withPayloadHash(payload);
  attachReviewReceipt(fixture.root, primary, firstRound.round);
  rewriteReviewsAndReport(fixture);

  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /evidence bound to this round's captures/);
});

test("verification Primary refs require an exact hash-bound prior findings source", () => {
  const fixture = makeFixture();
  configureResolvedPrimaryFinding(fixture);
  assert.deepEqual(check(fixture), { ok: true, issues: [] });

  const primary = fixture.reviews.rounds[1].reviews.find(
    (review) => review.perspective === "primary"
  );
  delete primary.input.prior_findings_source;
  const payload = { ...primary.input };
  delete payload.payload_sha256;
  primary.input.payload_sha256 = digest(Buffer.from(canonicalJson(payload)));
  attachReviewReceipt(fixture.root, primary, 2);
  rewriteReviewsAndReport(fixture);

  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /prior_findings_source.*requires a path and SHA-256/);
});

test("prior findings materialization must follow the preceding receipt with full precision", () => {
  for (const createdAt of [
    "2026-07-12T01:20:00Z",
    "2026-07-12T01:24:00.0002Z",
    "2026-07-12T01:24:00.0001Z",
  ]) {
    const fixture = makeFixture();
    configureResolvedPrimaryFinding(fixture);
    for (const review of fixture.reviews.rounds[0].reviews) {
      attachReviewReceipt(fixture.root, review, 1, "2026-07-12T01:24:00.0002Z");
    }
    const primary = fixture.reviews.rounds[1].reviews.find(
      (review) => review.perspective === "primary"
    );
    const sourcePath = primary.input.prior_findings_source.path;
    const source = JSON.parse(fs.readFileSync(path.join(fixture.root, sourcePath), "utf8"));
    source.created_at = createdAt;
    primary.input.prior_findings_source = write(
      fixture.root,
      sourcePath,
      `${JSON.stringify(source, null, 2)}\n`
    );
    const payload = { ...primary.input };
    delete payload.payload_sha256;
    primary.input.payload_sha256 = digest(Buffer.from(canonicalJson(payload)));
    attachReviewReceipt(fixture.root, primary, 2);
    rewriteReviewsAndReport(fixture);
    const result = check(fixture);
    assert.equal(result.ok, false);
    assert.match(
      JSON.stringify(result.issues),
      /prior_findings_source.created_at.*after every round 1 review receipt/
    );
  }
});

test("verification Primary rejects rebound prior finding content that differs from its ref", () => {
  const fixture = makeFixture();
  configureResolvedPrimaryFinding(fixture);
  const primary = fixture.reviews.rounds[1].reviews.find(
    (review) => review.perspective === "primary"
  );
  const sourcePath = primary.input.prior_findings_source.path;
  const source = JSON.parse(fs.readFileSync(path.join(fixture.root, sourcePath), "utf8"));
  source.findings[0].finding.summary = "A caller-rewritten prior finding.";
  primary.input.prior_findings_source = write(
    fixture.root,
    sourcePath,
    `${JSON.stringify(source, null, 2)}\n`
  );
  const payload = { ...primary.input };
  delete payload.payload_sha256;
  primary.input.payload_sha256 = digest(Buffer.from(canonicalJson(payload)));
  attachReviewReceipt(fixture.root, primary, 2);
  rewriteReviewsAndReport(fixture);

  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /materialize the exact earlier reviewer finding/);
});

test("round 1 PM artifact Primary cannot consume evidence bound to round 2", () => {
  const fixture = makeFixture({ mode: "pm-artifact" });
  const after = fixture.captures.captures.find((item) => item.coverage_id === "artifact-desktop");
  after.round = 2;
  after.captured_at = "2026-07-12T01:25:00Z";
  const beforeFile = write(
    fixture.root,
    "evidence/files/artifact-desktop-before.png",
    validPng(after.width, after.height, 4)
  );
  fixture.captures.captures.push({
    ...after,
    id: "capture-artifact-desktop-before",
    ...beforeFile,
    active: false,
    round: 1,
    captured_at: "2026-07-12T00:01:00Z",
  });
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  fixture.report.rounds = 2;
  fixture.report.captures = binding(fixture.root, fixture.capturesPath);
  rewriteReportAndHtml(fixture);
  assert.deepEqual(check(fixture), { ok: true, issues: [] });

  const firstRound = fixture.reviews.rounds[0];
  const primary = firstRound.reviews.find((item) => item.perspective === "primary");
  const laterEvidence = fixture.captures.evidence.find((item) => item.kind === "artifact-render");
  const payload = {
    ...primary.input,
    evidence_ids: [...primary.input.evidence_ids, laterEvidence.id],
  };
  delete payload.payload_sha256;
  primary.input = withPayloadHash(payload);
  attachReviewReceipt(fixture.root, primary, firstRound.round);
  rewriteReviewsAndReport(fixture);

  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /evidence bound to this round's captures/);
});

test("Fresh Eyes must observe every supplied capture", () => {
  const fixture = makeFixture();
  const round = fixture.reviews.rounds[0];
  const fresh = round.reviews.find((item) => item.perspective === "fresh-eyes");
  fresh.result.observations.pop();
  attachReviewReceipt(fixture.root, fresh, round.round);
  rewriteReviewsAndReport(fixture);
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /one observation for every supplied capture/);
});

test("Fresh Eyes observations bind the routed state and viewport", () => {
  const fixture = makeFixture();
  const round = fixture.reviews.rounds[0];
  const fresh = round.reviews.find((item) => item.perspective === "fresh-eyes");
  fresh.result.observations[0].state = "success";
  attachReviewReceipt(fixture.root, fresh, round.round);
  rewriteReviewsAndReport(fixture);
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /must match the supplied capture's route coverage/);
});

test("Fresh Eyes rejects metadata-templated prose without concrete visual substance", () => {
  const fixture = makeFixture();
  const round = fixture.reviews.rounds[0];
  const fresh = round.reviews.find((item) => item.perspective === "fresh-eyes");
  fresh.result.first_impression = "The purpose and primary action are immediately clear.";
  for (const answer of Object.values(fresh.result.answers))
    answer.text = "The current rendered evidence is clear and consistent for this answer.";
  for (const observation of fresh.result.observations)
    observation.observation = `The ${observation.state} state at the ${observation.viewport} viewport shows ${observation.coverage_id} with clear purpose, focus, and consistency.`;
  attachReviewReceipt(fixture.root, fresh, round.round);
  rewriteReviewsAndReport(fixture);

  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result.issues),
    /concrete interface element|directly observed visual property|substantive visual reasoning/
  );
});

test("Fresh Eyes cannot repeat boilerplate across captures", () => {
  const fixture = makeFixture();
  addProductUiSubject(fixture, "billing-detail");
  const round = fixture.reviews.rounds[0];
  const fresh = round.reviews.find((item) => item.perspective === "fresh-eyes");
  const desktopPrimary = fresh.result.observations.filter(
    (item) => item.state === "primary" && item.viewport === "desktop"
  );
  assert.equal(desktopPrimary.length, 2);
  for (const observation of desktopPrimary)
    observation.observation =
      "The primary state at the desktop viewport has a visible heading and primary action.";
  attachReviewReceipt(fixture.root, fresh, round.round);
  rewriteReviewsAndReport(fixture);

  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result.issues),
    /must contain visual substance distinct from the observation for capture/
  );
});

test("review receipts bind the exact result and expose non-cryptographic assurance", () => {
  const fixture = makeFixture();
  const review = fixture.reviews.rounds[0].reviews[0];
  review.result.summary = "Caller-edited result after receipt creation.";
  rewriteReviewsAndReport(fixture);
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /result_sha256.*must match the exact review record/);
  assert.equal(fixture.report.review_assurance, "workflow-attested-non-cryptographic");
});

test("ID-free Primary output normalizes with a checker-valid receipt", () => {
  const fixture = makeFixture();
  const finalFinding = {
    subject_id: "account-detail",
    region: "save-flow",
    rule: "functional-navigation",
    evidence_ids: [fixture.captures.captures[0].id],
    priority: "P1",
    status: "open",
    owner: "qa",
    summary: "The post-save destination needs functional verification.",
    remediation: "Exercise the save flow in QA.",
  };
  finalFinding.id = findingId(finalFinding);
  fixture.report.findings = [finalFinding];
  rewriteReportAndHtml(fixture);

  const primary = fixture.reviews.rounds[0].reviews.find(
    (review) => review.perspective === "primary"
  );
  const rawResult = {
    ...primary.result,
    findings: primary.result.findings.map((finding) => {
      const rawFinding = { ...finding };
      delete rawFinding.id;
      return rawFinding;
    }),
  };
  const normalized = normalizePrimaryReviewResult(rawResult, {
    reviewId: primary.review_id,
    mode: fixture.route.mode,
    route: fixture.route,
    captures: fixture.captures,
    input: primary.input,
  });
  assert.equal(
    normalized.findings[0].id,
    reviewFindingId(primary.review_id, normalized.findings[0])
  );
  primary.result = normalized;
  attachReviewReceipt(fixture.root, primary, 1);
  rewriteReviewsAndReport(fixture);

  const receipt = JSON.parse(
    fs.readFileSync(path.join(fixture.root, primary.execution.receipt.path), "utf8")
  );
  assert.equal(Object.hasOwn(receipt, "prompt_profile"), false);
  assert.equal(receipt.result_sha256, digest(Buffer.from(canonicalJson(normalized))));
  assert.deepEqual(check(fixture), { ok: true, issues: [] });
});

test("report scores must exactly equal the final Primary scores", () => {
  const fixture = makeFixture();
  fixture.report.scores.hierarchy.rationale = "A different report-only rationale.";
  rewriteBoundReportAndHtml(fixture);
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /final-round Primary scores/);
});

test("reconciliation cannot drop a reviewer finding", () => {
  const fixture = makeFixture();
  const finalFinding = {
    subject_id: "account-detail",
    region: "save-flow",
    rule: "functional-navigation",
    evidence_ids: [fixture.captures.captures[0].id],
    priority: "P1",
    status: "open",
    owner: "qa",
    summary: "The post-save destination needs functional verification.",
    remediation: "Exercise the save flow in QA.",
  };
  finalFinding.id = findingId(finalFinding);
  fixture.report.findings = [finalFinding];
  rewriteReportAndHtml(fixture);
  fixture.report.reconciliation = [];
  rewriteBoundReportAndHtml(fixture);
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /dropped reviewer finding|orphan final finding/);
});

test("reconciliation cannot hide a reviewer disagreement", () => {
  const fixture = makeFixture();
  const finalFinding = {
    subject_id: "account-detail",
    region: "header-actions",
    rule: "primary-action-hierarchy",
    evidence_ids: [fixture.captures.captures[0].id],
    priority: "P1",
    status: "open",
    owner: "qa",
    summary: "The action destination needs verification.",
    remediation: "Verify the destination in QA.",
  };
  finalFinding.id = findingId(finalFinding);
  fixture.report.findings = [finalFinding];
  rewriteReportAndHtml(fixture);
  const row = fixture.report.reconciliation[0];
  const fresh = fixture.reviews.rounds[0].reviews.find((item) => item.perspective === "fresh-eyes");
  const freshFinding = {
    subject_id: "account-detail",
    region: "header-actions",
    rule: "primary-action-hierarchy",
    coverage_ids: ["ui-primary"],
    evidence_ids: [fixture.captures.captures[0].id],
    priority: "P0",
    owner: "design-critique",
    basis: "craft",
    confidence: "medium",
    summary: "The action appears visually lost.",
    impact: "A first-time user may miss the main action.",
    remediation: "Restore clear action hierarchy.",
  };
  freshFinding.id = reviewFindingId(fresh.review_id, freshFinding);
  fresh.result.findings.push(freshFinding);
  row.source_finding_refs.push({ review_id: fresh.review_id, finding_id: freshFinding.id });
  row.id = reconciliationId(row);
  rewriteReviewsAndReport(fixture);
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /must preserve reviewer agreement as disputed/);
});

test("reconciliation forbids lowering a source reviewer severity", () => {
  const fixture = makeFixture();
  const finalFinding = {
    subject_id: "account-detail",
    region: "header-actions",
    rule: "primary-action-hierarchy",
    evidence_ids: [fixture.captures.captures[0].id],
    priority: "P2",
    status: "open",
    owner: "design-critique",
    summary: "The primary action is visually subordinate.",
    remediation: "Restore clear action hierarchy.",
  };
  finalFinding.id = findingId(finalFinding);
  fixture.report.outcome = "failed";
  fixture.report.reason = "A reviewer blocker remains unresolved.";
  fixture.report.top_issue = finalFinding.summary;
  fixture.report.findings = [finalFinding];
  rewriteReportAndHtml(fixture);
  const round = fixture.reviews.rounds[0];
  const primary = round.reviews.find((item) => item.perspective === "primary");
  primary.result.findings[0].priority = "P1";
  attachReviewReceipt(fixture.root, primary, round.round);
  rewriteReviewsAndReport(fixture);
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /cannot lower reviewer priority below P1/);
});

test("severity escalation requires new decision evidence and rationale", () => {
  const fixture = makeFixture();
  const finalFinding = {
    subject_id: "account-detail",
    region: "header-actions",
    rule: "primary-action-hierarchy",
    evidence_ids: [fixture.captures.captures[0].id],
    priority: "P1",
    status: "open",
    owner: "design-critique",
    summary: "The primary action is visually subordinate.",
    remediation: "Restore clear action hierarchy.",
  };
  finalFinding.id = findingId(finalFinding);
  fixture.report.outcome = "failed";
  fixture.report.top_issue = finalFinding.summary;
  fixture.report.findings = [finalFinding];
  rewriteReportAndHtml(fixture);
  const round = fixture.reviews.rounds[0];
  const primary = round.reviews.find((item) => item.perspective === "primary");
  primary.result.findings[0].priority = "P2";
  attachReviewReceipt(fixture.root, primary, round.round);
  rewriteReviewsAndReport(fixture);
  const missingDecision = check(fixture);
  assert.equal(missingDecision.ok, false);
  assert.match(
    JSON.stringify(missingDecision.issues),
    /severity escalation requires new decision evidence/
  );

  const row = fixture.report.reconciliation[0];
  row.decision_evidence_ids = [fixture.captures.captures[0].id];
  row.rationale = "The same screenshot is not new evidence for a blocking escalation.";
  rewriteReviewsAndReport(fixture);
  const reusedDecision = check(fixture);
  assert.equal(reusedDecision.ok, false);
  assert.match(JSON.stringify(reusedDecision.issues), /requires new decision evidence/);

  const sourceCapture = fixture.captures.captures[0];
  const duplicateCapture = {
    ...sourceCapture,
    id: `${sourceCapture.id}-decision-copy`,
    active: false,
  };
  fixture.captures.captures.push(duplicateCapture);
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  fixture.reviews.captures = binding(fixture.root, fixture.capturesPath);
  fixture.report.captures = binding(fixture.root, fixture.capturesPath);
  row.decision_evidence_ids = [duplicateCapture.id];
  row.rationale = "A copied screenshot ID is not genuinely new escalation evidence.";
  finalFinding.evidence_ids = [sourceCapture.id, duplicateCapture.id];
  finalFinding.id = findingId(finalFinding);
  row.final_finding_id = finalFinding.id;
  rewriteReviewsAndReport(fixture);
  const copiedDecision = check(fixture);
  assert.equal(copiedDecision.ok, false);
  assert.match(JSON.stringify(copiedDecision.issues), /requires new decision evidence/);

  fixture.captures.captures.pop();
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  fixture.reviews.captures = binding(fixture.root, fixture.capturesPath);
  fixture.report.captures = binding(fixture.root, fixture.capturesPath);
  const decisionEvidence = fixture.captures.evidence[0].id;
  row.decision_evidence_ids = [decisionEvidence];
  row.rationale = "The normalized accessibility evidence raises the user impact to blocking.";
  finalFinding.evidence_ids = [sourceCapture.id, decisionEvidence];
  finalFinding.id = findingId(finalFinding);
  row.final_finding_id = finalFinding.id;
  rewriteReviewsAndReport(fixture);
  assert.deepEqual(check(fixture), { ok: true, issues: [] });
});

test("human report must disclose workflow-attested non-cryptographic assurance", () => {
  const fixture = makeFixture();
  const htmlPath = path.join(fixture.root, fixture.report.human_report.path);
  fs.writeFileSync(
    htmlPath,
    fs
      .readFileSync(htmlPath, "utf8")
      .replace("data-dc-review-assurance", "data-hidden-review-assurance")
  );
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /visible reviewer assurance/);
});

test("human report metadata binds the exact reviews manifest", () => {
  const fixture = makeFixture();
  const htmlPath = path.join(fixture.root, fixture.report.human_report.path);
  const boundHash = `sha256:${fixture.report.reviews.sha256}`;
  fs.writeFileSync(
    htmlPath,
    fs.readFileSync(htmlPath, "utf8").replace(boundHash, `sha256:${"0".repeat(64)}`)
  );
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result.issues),
    /metadata evidence must bind the exact reviews manifest/
  );
});

test("accepts localized cross-state pixel changes in trusted native captures", () => {
  const fixture = makeFixture();
  const desktop = fixture.captures.captures.find((item) => item.coverage_id === "ui-primary");
  // A thin full-width highlight changes several tiles but less than 0.5% on average.
  addRequiredStateCapture(
    fixture,
    "success",
    validPng(desktop.width, desktop.height, 0, 0, 50, desktop.width * 2)
  );
  const result = check(fixture);
  assert.equal(
    result.issues.some((issue) => /materially different decoded pixels/.test(issue.message)),
    false,
    JSON.stringify(result.issues)
  );
});
