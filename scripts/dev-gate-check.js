#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const {
  OBSERVATION_ASSURANCE_LEVEL,
  OBSERVATION_PRODUCER,
  VIEWPORTS: REVIEW_RENDER_VIEWPORTS,
  invocationConfigurationDigest,
  validateMetrics,
} = require("./artifact-render-check");
const { inspectPdfBytes, inspectPngBytes } = require("./lib/media-inspect");
const { readProjectInput } = require("./lib/safe-project-output");
const { MAX_HTML_BYTES, MAX_JSON_BYTES } = require("./lib/review-limits");
const { isUiImpactPath } = require("./lib/ui-impact");
const { deriveSessionSlug } = require("./lib/session-slug");
const { version: PLUGIN_VERSION } = require("../plugin.config.json");

const DEFAULT_MANIFEST_PATH = ".pm/dev-sessions/current.gates.json";
const DEFAULT_REQUIRED_GATES = ["tdd", "design-critique", "qa", "review", "verification"];
// "simplify" was absorbed into review in v1.9. The name stays valid only so
// legacy sidecars carrying old rows don't hard-fail; passed/skipped/stale rows
// are tolerated, failed/blocked rows are not. Single-gate --require calls are
// incremental checks, never a substitute for the default full-gate run.
const VALID_GATE_NAMES = new Set([...DEFAULT_REQUIRED_GATES, "simplify"]);
const VALID_STATUSES = new Set(["passed", "skipped", "failed", "blocked"]);
const DEFAULT_ALLOW_SKIPPED_GATES = ["tdd", "simplify", "design-critique", "qa"];
const NEVER_SKIPPABLE_GATES = new Set(["review", "verification"]);
const REQUIRED_GATE_FIELDS = ["name", "status", "commit", "artifact", "reason", "checked_at"];
const UI_SKIP_GATES = new Set(["design-critique", "qa"]);
const NO_UI_SKIP_REASON =
  /(no (ui|visual|user-visible|interaction) (impact|change|surface)|no visual impact|no user-visible (impact|change|surface)|backend-only|docs-only|config-only|generated-only|pure refactor)/i;
const ENVIRONMENT_SKIP_REASON =
  /(server|environment|db|database|auth|login|seed|screenshot|artifact|can't start|cannot start|failed to start|not running)/i;
const TDD_SKIP_REASON =
  /(docs-only|documentation-only|config-only|generated-only|lockfile-only|non-behavior|no behavior change|no runtime behavior)/i;
const SIMPLIFY_SKIP_REASON =
  /(xs size|kind (task|bug) uses review gate|no code changes|no runtime-source changes|no reviewable source)/i;
const PM_RUNTIME_PATH_RE =
  /^(commands|skills|templates|hooks|scripts|tests|references|agents|\.githooks)\//;
const PM_RUNTIME_FILE_RE = /^(plugin\.config\.json|\.claude-plugin\/|\.codex-plugin\/)/;
const CODE_PATH_RE =
  /\.(js|mjs|cjs|ts|tsx|jsx|py|rb|go|rs|java|kt|kts|swift|php|cs|cpp|cxx|cc|c|h|hpp|m|mm|sh|bash|zsh|fish|ps1|sql)$/i;
const DOC_OR_CONFIG_PATH_RE =
  /(^|\/)(README|CHANGELOG|LICENSE)(\.[^/]*)?$|(^|\/)docs\/|\.md$|\.mdx$|\.txt$|\.ya?ml$|\.json$|\.toml$|\.ini$|\.env(\.|$)|(^|\/)(package-lock|pnpm-lock|yarn\.lock|Cargo\.lock|Gemfile\.lock|poetry\.lock|uv\.lock|composer\.lock)$/i;
const GENERATED_PATH_RE =
  /(^|\/)(dist|build|coverage|generated|__generated__|vendor|node_modules)\//i;

function checkGateManifest(manifest, opts = {}) {
  const issues = [];
  const reviewEvidenceMode = opts.reviewEvidenceMode ?? "enforce";
  if (!new Set(["enforce", "inspect"]).has(reviewEvidenceMode))
    return {
      ok: false,
      issues: [issue(opts.manifestPath || DEFAULT_MANIFEST_PATH, "reviewEvidenceMode is invalid")],
    };
  const requiredGatesInput = normalizeGateNames(opts.requiredGates);
  const requiredGates = requiredGatesInput.length > 0 ? requiredGatesInput : DEFAULT_REQUIRED_GATES;
  const allowSkippedGates = new Set(
    normalizeGateNames(opts.allowSkippedGates || DEFAULT_ALLOW_SKIPPED_GATES)
  );
  const currentCommit = opts.currentCommit || "";
  const manifestPath = opts.manifestPath || DEFAULT_MANIFEST_PATH;
  const artifactRoot = opts.artifactRoot || process.cwd();
  const changedFiles = normalizeChangedFiles(opts.changedFiles || []);

  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return { ok: false, issues: [issue(manifestPath, "gate manifest must be an object")] };
  }
  if (manifest.schema_version !== 1) {
    issues.push(issue(manifestPath, "schema_version must equal 1"));
  }
  if (opts.runId && manifest.run_id !== opts.runId) {
    issues.push(issue(manifestPath, `run_id must equal active session ${opts.runId}`));
  }
  if (!Array.isArray(manifest.gates)) {
    issues.push(issue(manifestPath, "gates must be an array"));
    return { ok: false, issues };
  }
  const sessionContext = readSessionContext(manifest, opts);
  const canonicalSession = opts.canonicalSession || null;
  if (opts.requireSessionBinding && !canonicalSession)
    issues.push(
      issue(manifestPath, opts.sessionError || "canonical gates require sibling session.json")
    );
  if (canonicalSession) {
    if (canonicalSession.run_id !== manifest.run_id)
      issues.push(issue(manifestPath, "gate run_id must equal sibling session.json"));
    if (!new Set(["full", "code-scan"]).has(canonicalSession.routing?.review_mode))
      issues.push(issue(manifestPath, "sibling session.json requires routing.review_mode"));
    const expectedSlug = path.basename(
      path.dirname(resolveArtifactPath(manifestPath, artifactRoot))
    );
    if (canonicalSession.slug !== expectedSlug)
      issues.push(issue(manifestPath, `sibling session slug must equal ${expectedSlug}`));
    if (opts.currentBranch && canonicalSession.source?.branch !== opts.currentBranch)
      issues.push(issue(manifestPath, `sibling session branch must equal ${opts.currentBranch}`));
  }

  const legacySimplifyTolerated = !requiredGates.includes("simplify");
  const byName = new Map();
  manifest.gates.forEach((gate, index) => {
    const where = `${manifestPath}#gates[${index}]`;
    const legacyRow = legacySimplifyTolerated && gate?.name === "simplify";
    validateGateRow(gate, where, issues, { artifactRoot, skipArtifactExistence: legacyRow });
    if (!gate || typeof gate !== "object" || Array.isArray(gate)) return;
    if (byName.has(gate.name)) {
      issues.push(issue(where, `duplicate gate ${gate.name}`));
      return;
    }
    // Legacy tolerance covers passed/skipped/stale rows, never recorded failures.
    if (legacyRow && (gate.status === "failed" || gate.status === "blocked")) {
      issues.push(issue(where, `legacy gate simplify is ${gate.status} — resolve or remove it`));
    }
    byName.set(gate.name, gate);
  });

  for (const name of requiredGates) {
    if (!VALID_GATE_NAMES.has(name)) {
      issues.push(issue(manifestPath, `unknown required gate ${name}`));
      continue;
    }
    const gate = byName.get(name);
    if (!gate) {
      issues.push(issue(manifestPath, `missing required gate ${name}`));
      continue;
    }
    if (gate.status !== "passed" && gate.status !== "skipped") {
      issues.push(issue(manifestPath, `required gate ${name} is ${gate.status}`));
    }
    if (
      gate.status === "skipped" &&
      (NEVER_SKIPPABLE_GATES.has(name) || !allowSkippedGates.has(name))
    ) {
      issues.push(issue(manifestPath, `required gate ${name} cannot be skipped`));
    }
    if (gate.status === "skipped") {
      validateRequiredSkipReason(gate, manifestPath, { changedFiles, ...sessionContext }, issues);
    }
    if (gate.commit !== currentCommit && gate.verified_commit !== currentCommit) {
      issues.push(issue(manifestPath, `required gate ${name} is stale for current commit`));
    }
  }

  if (requiredGates.includes("review")) {
    const reviewGate = byName.get("review");
    validateReviewLenses(reviewGate, manifestPath, sessionContext, issues);
    validateReviewReportArtifact(
      reviewGate,
      manifestPath,
      artifactRoot,
      currentCommit,
      canonicalSession,
      Boolean(manifest.run_id),
      reviewEvidenceMode === "enforce",
      canonicalSession?.routing?.review_mode || null,
      opts.authoritativeBaseRef || null,
      opts.authoritativeBaseCommit || null,
      issues
    );
  }

  if (reviewEvidenceMode === "inspect")
    return {
      ok: false,
      authoritative: false,
      inspection_ok: issues.length === 0,
      issues,
    };
  return { ok: issues.length === 0, issues };
}

function validateReviewReportArtifact(
  reviewGate,
  manifestPath,
  artifactRoot,
  currentCommit,
  canonicalSession,
  canonicalDeclared,
  enforceReviewEvidence,
  expectedReviewMode,
  authoritativeBaseRef,
  authoritativeBaseCommit,
  issues
) {
  if (!reviewGate || reviewGate.status !== "passed") return;
  if (reviewGate.evidence_kind === undefined) {
    const artifact = String(reviewGate.artifact || "")
      .split(path.sep)
      .join("/");
    if (enforceReviewEvidence)
      issues.push(
        issue(
          manifestPath,
          "required passed review gate requires evidence_kind review-report-v1 in enforcement mode"
        )
      );
    else if (canonicalDeclared || /(^|\/)review\/report\.html$/.test(artifact))
      issues.push(
        issue(manifestPath, "canonical review/report.html requires evidence_kind review-report-v1")
      );
    return;
  }
  if (reviewGate.evidence_kind !== "review-report-v1") {
    issues.push(issue(manifestPath, "review evidence_kind must equal review-report-v1"));
    return;
  }
  const htmlPath = resolveArtifactPath(reviewGate.artifact, artifactRoot);
  if (canonicalSession) {
    const canonicalReview = path.join(
      path.dirname(resolveArtifactPath(manifestPath, artifactRoot)),
      "review",
      "report.html"
    );
    if (path.resolve(htmlPath) !== path.resolve(canonicalReview)) {
      issues.push(
        issue(manifestPath, "review-report-v1 artifact must belong to the canonical Dev session")
      );
      return;
    }
  }
  if (
    path.basename(htmlPath) !== "report.html" ||
    path.basename(path.dirname(htmlPath)) !== "review"
  ) {
    issues.push(issue(manifestPath, "review-report-v1 artifact must point to review/report.html"));
    return;
  }
  const reportPath = path.join(path.dirname(htmlPath), "report.json");
  if (!fs.existsSync(reportPath)) {
    issues.push(issue(manifestPath, "review-report-v1 requires sibling review/report.json"));
    return;
  }
  const expectedRenderManifest = path.join(path.dirname(htmlPath), "renders", "manifest.json");
  const resolvedRenderManifest = resolveArtifactPath(reviewGate.render_manifest, artifactRoot);
  const renderBindingValid =
    resolvedRenderManifest &&
    path.resolve(resolvedRenderManifest) === path.resolve(expectedRenderManifest) &&
    /^[a-f0-9]{64}$/.test(reviewGate.render_manifest_sha256 || "");
  if (
    !resolvedRenderManifest ||
    path.resolve(resolvedRenderManifest) !== path.resolve(expectedRenderManifest)
  )
    issues.push(
      issue(manifestPath, "review-report-v1 requires render_manifest review/renders/manifest.json")
    );
  else if (!/^[a-f0-9]{64}$/.test(reviewGate.render_manifest_sha256 || ""))
    issues.push(issue(manifestPath, "review-report-v1 requires render_manifest_sha256"));
  let renderValidated = false;
  try {
    const root = path.resolve(artifactRoot || process.cwd());
    const relative = path.relative(root, reportPath).split(path.sep).join("/");
    const { checkReview, expandFromReport } = require("./review-check");
    const result = checkReview(
      expandFromReport({
        root,
        reportPath: relative,
        fromReport: true,
        verifyGit: false,
        verifyFrozenGit: true,
        verifyBrowser: false,
      })
    );
    if (renderBindingValid) {
      validateReviewRenderManifest(
        reviewGate,
        htmlPath,
        artifactRoot,
        manifestPath,
        result.report,
        result.validated_human_report,
        issues
      );
      renderValidated = true;
    }
    if (!result.ok)
      issues.push(
        issue(
          manifestPath,
          `review-report-v1 failed current validation: ${result.issues
            .slice(0, 3)
            .map((item) => `${item.path}: ${item.message}`)
            .join("; ")}`
        )
      );
    if (result.report?.source?.commit !== currentCommit || result.report?.outcome !== "passed")
      issues.push(
        issue(manifestPath, "review-report-v1 must be passed and bound to current commit")
      );
    const completed = [...(result.report?.coverage?.completed || [])].sort();
    const recorded = [...(reviewGate.lenses || [])].sort();
    if (JSON.stringify(recorded) !== JSON.stringify(completed))
      issues.push(issue(manifestPath, "review row lenses must exactly match report coverage"));
    if (expectedReviewMode) {
      if (result.target?.mode !== expectedReviewMode)
        issues.push(
          issue(
            manifestPath,
            `review target mode ${result.target?.mode || "missing"} must equal routed ${expectedReviewMode}`
          )
        );
    }
    if (canonicalSession) {
      const expectedContext = require("./lib/review-contract").devReviewContext(canonicalSession);
      if (JSON.stringify(result.target?.dev_context) !== JSON.stringify(expectedContext))
        issues.push(
          issue(
            manifestPath,
            "review target must bind the canonical Dev run, route, and acceptance criteria"
          )
        );
    }
    if (canonicalSession && (!authoritativeBaseRef || !authoritativeBaseCommit))
      issues.push(issue(manifestPath, "canonical Review enforcement requires authoritative base"));
    else if (
      authoritativeBaseRef &&
      (result.target?.source?.base_ref !== authoritativeBaseRef ||
        result.target?.source?.base_commit !== authoritativeBaseCommit)
    )
      issues.push(
        issue(manifestPath, "review target base must equal the authoritative delivery base")
      );
  } catch (error) {
    if (renderBindingValid && !renderValidated)
      validateReviewRenderManifest(
        reviewGate,
        htmlPath,
        artifactRoot,
        manifestPath,
        null,
        null,
        issues
      );
    issues.push(issue(manifestPath, `cannot validate review-report-v1: ${error.message}`));
  }
}

function validateReviewRenderManifest(
  reviewGate,
  htmlPath,
  artifactRoot,
  manifestPath,
  report,
  validatedHumanReport,
  issues
) {
  const expected = path.join(path.dirname(htmlPath), "renders", "manifest.json");
  const manifest = resolveArtifactPath(reviewGate.render_manifest, artifactRoot);
  if (!manifest || path.resolve(manifest) !== path.resolve(expected)) {
    issues.push(
      issue(manifestPath, "review-report-v1 requires render_manifest review/renders/manifest.json")
    );
    return;
  }
  if (!/^[a-f0-9]{64}$/.test(reviewGate.render_manifest_sha256 || "")) {
    issues.push(issue(manifestPath, "review-report-v1 requires render_manifest_sha256"));
    return;
  }
  let value;
  try {
    const file = readRegularProjectFile(manifest, artifactRoot, MAX_JSON_BYTES);
    if (digest(file.bytes) !== reviewGate.render_manifest_sha256)
      throw new Error("render manifest SHA-256 does not match its bytes");
    value = JSON.parse(file.bytes.toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("render manifest must be a non-array object");
  } catch (error) {
    issues.push(issue(manifestPath, `cannot validate review render manifest: ${error.message}`));
    return;
  }
  let html;
  try {
    html = readRegularProjectFile(htmlPath, artifactRoot, MAX_HTML_BYTES);
  } catch (error) {
    issues.push(issue(manifestPath, `cannot bind review render source: ${error.message}`));
    return;
  }
  if (
    value.schema_version !== 1 ||
    !isProjectRelative(value.source?.path) ||
    resolveArtifactPath(value.source?.path, artifactRoot) !== path.resolve(htmlPath) ||
    value.source?.sha256 !== `sha256:${digest(html.bytes)}` ||
    (validatedHumanReport && validatedHumanReport.sha256 !== digest(html.bytes))
  )
    issues.push(
      issue(manifestPath, "review render manifest must bind the exact report.html bytes")
    );
  validateRenderObservation(value.observation, manifestPath, issues);

  const captures = Array.isArray(value.captures) ? value.captures : [];
  const names = captures.map((item) => item?.name);
  if (captures.length !== REVIEW_RENDER_VIEWPORTS.length || new Set(names).size !== names.length)
    issues.push(
      issue(manifestPath, "review render manifest requires one canonical capture per viewport")
    );
  for (const viewport of REVIEW_RENDER_VIEWPORTS) {
    const capture = captures.find((item) => item?.name === viewport.name);
    const label = `review render ${viewport.name}`;
    if (!capture || capture.width !== viewport.width || capture.height !== viewport.height) {
      issues.push(issue(manifestPath, `${label} uses noncanonical viewport dimensions`));
      continue;
    }
    try {
      validateMetrics(capture.metrics, viewport);
    } catch (error) {
      issues.push(issue(manifestPath, `${label} metrics failed: ${error.message}`));
    }
    validateRenderedFile(
      capture,
      "png",
      viewport.width,
      viewport.height,
      artifactRoot,
      manifestPath,
      label,
      issues
    );
    if (
      !capture.full_page ||
      capture.full_page.width !== viewport.width ||
      capture.full_page.height < viewport.height
    )
      issues.push(issue(manifestPath, `${label} requires canonical full-page metadata`));
    else
      validateRenderedFile(
        capture.full_page,
        "png",
        viewport.width,
        capture.full_page.height,
        artifactRoot,
        manifestPath,
        `${label} full-page`,
        issues
      );
  }
  if (!value.print || !Number.isInteger(value.print.pages) || value.print.pages < 1)
    issues.push(issue(manifestPath, "review render manifest requires a non-empty print PDF"));
  else
    validateRenderedFile(
      value.print,
      "pdf",
      null,
      value.print.pages,
      artifactRoot,
      manifestPath,
      "review render print",
      issues
    );
  if (!Array.isArray(value.markers)) {
    issues.push(issue(manifestPath, "review render manifest requires browser marker evidence"));
  } else if (report) {
    try {
      const markerIssues = [];
      require("./review-check").validateRenderedReportMarkers(value.markers, report, markerIssues);
      for (const markerIssue of markerIssues)
        issues.push(
          issue(manifestPath, `retained browser marker evidence failed: ${markerIssue.message}`)
        );
    } catch (error) {
      issues.push(issue(manifestPath, `retained browser marker evidence failed: ${error.message}`));
    }
  }
}

function validateRenderObservation(observation, manifestPath, issues) {
  const browser = observation?.browser;
  const expectedInvocation = invocationConfigurationDigest("data-review-");
  if (
    observation?.assurance_level !== OBSERVATION_ASSURANCE_LEVEL ||
    observation?.producer?.name !== OBSERVATION_PRODUCER ||
    observation?.producer?.version !== PLUGIN_VERSION
  )
    issues.push(
      issue(
        manifestPath,
        "review render manifest requires the current local-observation producer identity"
      )
    );
  if (
    !browser ||
    typeof browser.path !== "string" ||
    !path.isAbsolute(browser.path) ||
    path.normalize(browser.path) !== browser.path ||
    browser.engine !== "chromium" ||
    typeof browser.version !== "string" ||
    !browser.version.trim() ||
    browser.version.length > 500 ||
    !/^sha256:[a-f0-9]{64}$/.test(browser.executable_sha256_before || "") ||
    browser.executable_sha256_after !== browser.executable_sha256_before
  )
    issues.push(
      issue(
        manifestPath,
        "review render manifest requires a stable canonical Chromium executable observation"
      )
    );
  if (observation?.invocation_configuration_sha256 !== expectedInvocation)
    issues.push(
      issue(manifestPath, "review render manifest uses a noncanonical invocation configuration")
    );
}

function validateRenderedFile(
  entry,
  kind,
  width,
  heightOrPages,
  artifactRoot,
  manifestPath,
  label,
  issues
) {
  try {
    if (
      !entry ||
      !isProjectRelative(entry.path) ||
      !/^sha256:[a-f0-9]{64}$/.test(entry.sha256 || "")
    )
      throw new Error("requires a project-relative path and SHA-256 binding");
    const file = readRegularProjectFile(
      resolveArtifactPath(entry.path, artifactRoot),
      artifactRoot,
      64 * 1024 * 1024
    );
    if (entry.sha256 !== `sha256:${digest(file.bytes)}` || entry.bytes !== file.bytes.length)
      throw new Error("hash or byte count does not match rendered bytes");
    if (kind === "png") {
      const image = inspectPngBytes(file.bytes);
      if (image.width !== width || image.height !== heightOrPages)
        throw new Error(`PNG dimensions must equal ${width}x${heightOrPages}`);
    } else if (inspectPdfBytes(file.bytes).pages !== heightOrPages) {
      throw new Error(`PDF pages must equal ${heightOrPages}`);
    }
  } catch (error) {
    issues.push(issue(manifestPath, `${label}: ${error.message}`));
  }
}

function isProjectRelative(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !path.isAbsolute(value) &&
    !value.split(/[\\/]+/).some((part) => !part || part === "." || part === "..")
  );
}

function readRegularProjectFile(filePath, artifactRoot, maxBytes) {
  const requestedRoot = path.resolve(artifactRoot || process.cwd());
  const root = fs.realpathSync(requestedRoot);
  const absolute = path.resolve(filePath);
  let relative = path.relative(requestedRoot, absolute);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    relative = path.relative(root, absolute);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    throw new Error("path resolves outside the project root");
  try {
    return readProjectInput(root, relative, maxBytes);
  } catch (error) {
    if (error.message === `input exceeds ${maxBytes}-byte budget`)
      throw new Error("evidence exceeds its byte budget");
    throw error;
  }
}

function digest(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

// The v1.9 absorption of simplify into review is enforceable, not prose-only:
// M/L/XL sessions must show the review row actually ran the absorbed lenses.
const ABSORBED_REVIEW_LENSES = ["reuse", "quality", "efficiency"];
const LENSED_SIZES = new Set(["m", "l", "xl"]);

function validateReviewLenses(reviewGate, manifestPath, sessionContext, issues) {
  if (!reviewGate || reviewGate.status !== "passed") return;
  if (!LENSED_SIZES.has(sessionContext.sessionSize)) return;
  if (!Array.isArray(reviewGate.lenses)) {
    issues.push(
      issue(
        manifestPath,
        "review row must record lenses for M/L/XL sessions (6-lens fan-out, v1.9)"
      )
    );
    return;
  }
  const have = new Set(reviewGate.lenses.map(normalizeContextValue));
  if (!ABSORBED_REVIEW_LENSES.every((l) => have.has(l))) {
    issues.push(issue(manifestPath, "review lenses must include reuse, quality, efficiency"));
  }
}

function validateGateRow(gate, where, issues, context = {}) {
  if (!gate || typeof gate !== "object" || Array.isArray(gate)) {
    issues.push(issue(where, "gate row must be an object"));
    return;
  }
  for (const field of REQUIRED_GATE_FIELDS) {
    if (!(field in gate)) issues.push(issue(where, `missing gate field ${field}`));
  }
  if (!VALID_GATE_NAMES.has(gate.name)) {
    issues.push(issue(where, `invalid gate name ${gate.name}`));
  }
  if (!VALID_STATUSES.has(gate.status)) {
    issues.push(issue(where, `invalid gate status ${gate.status}`));
  }
  if (!gate.commit || typeof gate.commit !== "string") {
    issues.push(issue(where, "commit must be a string"));
  }
  if (typeof gate.artifact !== "string") {
    issues.push(issue(where, "artifact must be a string"));
  } else if (gate.status === "passed" && gate.artifact.trim() === "") {
    issues.push(issue(where, "artifact is required when gate passed"));
  } else if (
    gate.status === "passed" &&
    !context.skipArtifactExistence &&
    !artifactExists(gate.artifact, context.artifactRoot || process.cwd())
  ) {
    issues.push(issue(where, `artifact path does not exist: ${gate.artifact}`));
  }
  if (["skipped", "failed", "blocked"].includes(gate.status) && !gate.reason) {
    issues.push(issue(where, "reason is required when gate is skipped, failed, or blocked"));
  }
  if (!gate.checked_at || Number.isNaN(Date.parse(gate.checked_at))) {
    issues.push(issue(where, "checked_at must be an ISO timestamp"));
  }
  if ("verified_commit" in gate && typeof gate.verified_commit !== "string") {
    issues.push(issue(where, "verified_commit must be a string when present"));
  }
  if ("verified_at" in gate && Number.isNaN(Date.parse(gate.verified_at))) {
    issues.push(issue(where, "verified_at must be an ISO timestamp when present"));
  }
  if ("verified_commit" in gate !== "verified_at" in gate) {
    issues.push(issue(where, "verified_commit and verified_at must be written together"));
  }
}

function validateRequiredSkipReason(gate, manifestPath, context, issues) {
  const reason = String(gate.reason || "");
  if (UI_SKIP_GATES.has(gate.name)) {
    validateUiSkipReason(gate, reason, manifestPath, context, issues);
    return;
  }
  if (gate.name === "tdd") {
    validateTddSkipReason(reason, manifestPath, context, issues);
    return;
  }
  if (gate.name === "simplify") {
    validateSimplifySkipReason(reason, manifestPath, context, issues);
  }
}

function validateUiSkipReason(gate, reason, manifestPath, context, issues) {
  const environmentFailure = ENVIRONMENT_SKIP_REASON.test(reason);
  if (environmentFailure) {
    issues.push(
      issue(manifestPath, `required gate ${gate.name} cannot be skipped for environment failure`)
    );
    return;
  }
  if (!NO_UI_SKIP_REASON.test(reason)) {
    issues.push(
      issue(manifestPath, `required gate ${gate.name} skip reason must describe no UI impact`)
    );
  }
  if (hasUiImpact(context.changedFiles)) {
    issues.push(
      issue(
        manifestPath,
        `required gate ${gate.name} cannot be skipped when UI-impact files changed`
      )
    );
  }
}

function validateTddSkipReason(reason, manifestPath, context, issues) {
  if (!TDD_SKIP_REASON.test(reason)) {
    issues.push(issue(manifestPath, "required gate tdd skip reason is not allowed"));
  }
  if (context.changedFiles.length > 0 && !context.changedFiles.every(isTddSkippablePath)) {
    issues.push(
      issue(manifestPath, "required gate tdd cannot be skipped when behavior files changed")
    );
  }
}

function validateSimplifySkipReason(reason, manifestPath, context, issues) {
  if (!SIMPLIFY_SKIP_REASON.test(reason)) {
    issues.push(issue(manifestPath, "required gate simplify skip reason is not allowed"));
  }
  if (/xs size/i.test(reason) && context.sessionSize !== "xs") {
    issues.push(issue(manifestPath, "required gate simplify XS skip requires manifest size XS"));
  }
  const kindMatch = reason.match(/kind (task|bug) uses review gate/i);
  if (kindMatch && context.sessionKind !== kindMatch[1].toLowerCase()) {
    issues.push(
      issue(manifestPath, `required gate simplify kind skip requires manifest kind ${kindMatch[1]}`)
    );
  }
  const noCodeReason = /no code changes|no runtime-source changes|no reviewable source/i.test(
    reason
  );
  if (noCodeReason && context.changedFiles.some(isReviewableSourcePath)) {
    issues.push(
      issue(
        manifestPath,
        "required gate simplify cannot use no-code skip when runtime source files changed"
      )
    );
  }
}

function hasUiImpact(changedFiles) {
  return changedFiles.some(isUiImpactPath);
}

function artifactExists(artifact, artifactRoot) {
  const filePath = resolveArtifactPath(artifact, artifactRoot);
  return filePath !== "" && fs.existsSync(filePath);
}

function resolveArtifactPath(artifact, artifactRoot) {
  const raw = String(artifact || "").trim();
  const withoutFragment = raw.split("#")[0].trim();
  if (withoutFragment === "") return "";
  return path.isAbsolute(withoutFragment)
    ? withoutFragment
    : path.resolve(artifactRoot || process.cwd(), withoutFragment);
}

function isTddSkippablePath(file) {
  if (isPmRuntimePath(file)) return false;
  if (isUiImpactPath(file)) return false;
  return DOC_OR_CONFIG_PATH_RE.test(file) || GENERATED_PATH_RE.test(file);
}

function isReviewableSourcePath(file) {
  if (isPmRuntimePath(file)) return true;
  if (GENERATED_PATH_RE.test(file)) return false;
  if (isUiImpactPath(file)) return true;
  return CODE_PATH_RE.test(file);
}

function isPmRuntimePath(file) {
  return PM_RUNTIME_PATH_RE.test(file) || PM_RUNTIME_FILE_RE.test(file);
}

function readSessionContext(manifest, opts) {
  const context = manifest.context && typeof manifest.context === "object" ? manifest.context : {};
  return {
    sessionSize: normalizeContextValue(
      opts.sessionSize || opts.size || manifest.size || manifest.session_size || context.size
    ),
    sessionKind: normalizeContextValue(
      opts.sessionKind || opts.kind || manifest.kind || manifest.session_kind || context.kind
    ),
  };
}

function normalizeContextValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeGateNames(value) {
  const names = Array.isArray(value) ? value : String(value || "").split(",");
  return names
    .flatMap((name) => String(name).split(","))
    .map((name) => name.trim())
    .filter(Boolean);
}

function normalizeChangedFiles(value) {
  const files = Array.isArray(value) ? value : String(value || "").split(",");
  return files
    .flatMap((file) => String(file).split(","))
    .map((file) => file.trim())
    .filter(Boolean)
    .map((file) => file.split(path.sep).join("/"));
}

function loadGateManifest(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadChangedFilesFromGit(baseRef, cwd = process.cwd(), targetRef = "HEAD") {
  const output = execFileSync("git", ["diff", "--name-only", `${baseRef}...${targetRef}`], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return normalizeChangedFiles(output.split(/\r?\n/));
}

function currentGitCommit(cwd = process.cwd()) {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function parseArgs(argv) {
  const opts = {
    manifestPath: DEFAULT_MANIFEST_PATH,
    requiredGates: [],
    allowSkippedGates: DEFAULT_ALLOW_SKIPPED_GATES,
    changedFiles: [],
    reviewEvidenceMode: "enforce",
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--manifest") {
      opts.manifestPath = requireValue(argv, ++index, arg);
    } else if (arg === "--commit") {
      opts.currentCommit = requireValue(argv, ++index, arg);
    } else if (arg === "--branch") {
      opts.currentBranch = requireValue(argv, ++index, arg);
    } else if (arg === "--run-id") {
      opts.runId = requireValue(argv, ++index, arg);
    } else if (arg === "--require") {
      opts.requiredGates.push(...normalizeGateNames(requireValue(argv, ++index, arg)));
    } else if (arg === "--allow-skip") {
      const gateNames = normalizeGateNames(requireValue(argv, ++index, arg));
      for (const gateName of gateNames) {
        if (NEVER_SKIPPABLE_GATES.has(gateName)) {
          throw new Error(`${arg} cannot include non-skippable gate ${gateName}`);
        }
      }
      opts.allowSkippedGates.push(...gateNames);
    } else if (arg === "--no-skip") {
      opts.allowSkippedGates = [];
    } else if (arg === "--base") {
      opts.baseRef = requireValue(argv, ++index, arg);
    } else if (arg === "--remote") {
      opts.remote = requireValue(argv, ++index, arg);
    } else if (arg === "--changed-file") {
      opts.changedFiles.push(requireValue(argv, ++index, arg));
    } else if (arg === "--changed-files") {
      opts.changedFiles.push(...normalizeChangedFiles(requireValue(argv, ++index, arg)));
    } else if (arg === "--review-evidence-mode") {
      opts.reviewEvidenceMode = requireValue(argv, ++index, arg);
      if (!new Set(["enforce", "inspect"]).has(opts.reviewEvidenceMode)) {
        throw new Error("--review-evidence-mode must be enforce or inspect");
      }
    } else if (arg === "--json") {
      opts.json = true;
    } else if (arg === "--help" || arg === "-h") {
      opts.help = true;
    } else {
      throw new Error(`unknown argument ${arg}`);
    }
  }

  if (opts.requiredGates.length === 0) {
    opts.requiredGates = DEFAULT_REQUIRED_GATES;
  }
  return opts;
}

function requireValue(argv, index, flag) {
  if (index >= argv.length || argv[index].startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return argv[index];
}

function usage() {
  return [
    "Usage: node scripts/dev-gate-check.js [--manifest PATH] [--run-id ID] [--commit SHA] [--branch NAME] [--base REF] [--remote NAME] [--changed-files file[,file]] [--changed-file file] [--require gate[,gate]] [--allow-skip gate[,gate]] [--no-skip] [--review-evidence-mode enforce|inspect] [--json]",
    "",
    "Default manifest: .pm/dev-sessions/current.gates.json",
    `Default required gates: ${DEFAULT_REQUIRED_GATES.join(", ")}`,
    `Default skip-allowed gates: ${DEFAULT_ALLOW_SKIPPED_GATES.join(", ")}`,
    "Default review evidence mode: enforce (inspect is migration-only and cannot authorize delivery)",
  ].join("\n");
}

// These four helpers are intentionally NOT pulled from scripts/lib/check-cli.js
// (where rfc-sidecar-check.js gets them). .githooks/pre-push runs the archived
// `scripts/` tree plus plugin.config.json from the pushed commit in /tmp. Review
// evidence validation may use that archived tree, but adding dependencies outside
// it would break the push gate. Keep these trivial CLI helpers local.
function issue(file, message) {
  return { file: toRel(file), message };
}

function toRel(file) {
  return path.relative(process.cwd(), file).split(path.sep).join("/") || file;
}

function printResult(result, json) {
  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }
  if (result.authoritative === false && result.inspection_ok) {
    process.stdout.write("Dev gate inspection complete (non-authoritative).\n");
    return;
  }
  if (result.ok) {
    process.stdout.write("Dev gate check passed.\n");
    return;
  }
  process.stdout.write("Dev gate check failed:\n");
  for (const found of result.issues) {
    process.stdout.write(`- ${found.file}: ${found.message}\n`);
  }
}

function main(argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = parseArgs(argv);
    if (opts.help) {
      process.stdout.write(usage() + "\n");
      return 0;
    }
  } catch (err) {
    process.stderr.write(`${err.message}\n\n${usage()}\n`);
    return 2;
  }

  const manifestPath = path.resolve(opts.manifestPath);
  let currentCommit;
  try {
    currentCommit = opts.currentCommit || currentGitCommit(process.cwd());
  } catch (err) {
    const result = {
      ok: false,
      issues: [issue(process.cwd(), `unable to determine current git commit: ${err.message}`)],
    };
    printResult(result, opts.json);
    return 1;
  }
  let manifest;
  try {
    manifest = loadGateManifest(manifestPath);
  } catch (err) {
    const result = {
      ok: false,
      issues: [issue(manifestPath, `unable to read gate manifest: ${err.message}`)],
    };
    printResult(result, opts.json);
    return 1;
  }
  const sibling = readSiblingSessionContext(manifestPath);
  let currentBranch = opts.currentBranch || null;
  if (sibling.session && opts.reviewEvidenceMode === "enforce" && !currentBranch) {
    try {
      currentBranch = execFileSync("git", ["branch", "--show-current"], {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
      if (!currentBranch) throw new Error("detached HEAD");
    } catch (error) {
      const result = {
        ok: false,
        issues: [issue(manifestPath, `unable to determine delivery branch: ${error.message}`)],
      };
      printResult(result, opts.json);
      return 1;
    }
  }
  let changedFiles = opts.changedFiles;
  let authoritativeBaseRef = opts.baseRef || null;
  let authoritativeBaseCommit = null;
  if (sibling.session && opts.reviewEvidenceMode === "enforce") {
    try {
      const trusted = require("./review-target").resolveTrustedBase(
        process.cwd(),
        opts.remote || "origin"
      );
      if (opts.baseRef && opts.baseRef !== trusted.ref)
        throw new Error(`supplied base ${opts.baseRef} must equal remote default ${trusted.ref}`);
      authoritativeBaseRef = trusted.ref;
      authoritativeBaseCommit = trusted.commit;
      changedFiles = loadChangedFilesFromGit(trusted.commit, process.cwd(), currentCommit);
    } catch (err) {
      const result = {
        ok: false,
        issues: [
          issue(process.cwd(), `unable to resolve authoritative remote base: ${err.message}`),
        ],
      };
      printResult(result, opts.json);
      return 1;
    }
  } else if (opts.baseRef) {
    try {
      changedFiles = loadChangedFilesFromGit(opts.baseRef, process.cwd(), currentCommit);
      authoritativeBaseCommit = execFileSync("git", ["rev-parse", opts.baseRef], {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    } catch (err) {
      const result = {
        ok: false,
        issues: [issue(process.cwd(), `unable to determine changed files: ${err.message}`)],
      };
      printResult(result, opts.json);
      return 1;
    }
  }

  const result = checkGateManifest(manifest, {
    currentCommit,
    currentBranch,
    manifestPath,
    requiredGates: opts.requiredGates,
    allowSkippedGates: opts.allowSkippedGates,
    changedFiles,
    runId: opts.runId || sibling.session?.run_id || null,
    canonicalSession: sibling.session,
    requireSessionBinding: opts.reviewEvidenceMode === "enforce",
    sessionError: sibling.error,
    authoritativeBaseRef,
    authoritativeBaseCommit,
    reviewEvidenceMode: opts.reviewEvidenceMode,
  });
  printResult(result, opts.json);
  return result.ok ? 0 : 1;
}

function readSiblingSessionContext(manifestPath) {
  if (path.basename(manifestPath) !== "gates.json") return { session: null, error: null };
  try {
    const sessionPath = path.join(path.dirname(manifestPath), "session.json");
    const file = readRegularProjectFile(sessionPath, process.cwd(), MAX_JSON_BYTES);
    const session = JSON.parse(file.bytes.toString("utf8"));
    const validation = require("./lib/dev-session-schema").validateSession(session);
    if (validation.length > 0)
      throw new Error(
        validation
          .slice(0, 3)
          .map((item) => `${item.path}: ${item.message}`)
          .join("; ")
      );
    return { session, error: null };
  } catch (error) {
    return { session: null, error: `cannot validate sibling session.json: ${error.message}` };
  }
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  DEFAULT_ALLOW_SKIPPED_GATES,
  DEFAULT_REQUIRED_GATES,
  checkGateManifest,
  deriveSessionSlug,
  loadChangedFilesFromGit,
  loadGateManifest,
  normalizeChangedFiles,
  parseArgs,
  currentGitCommit,
  main,
};
