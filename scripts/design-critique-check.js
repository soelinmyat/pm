#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { isDeepStrictEqual } = require("node:util");
const { inspectHtmlArtifact, structuralMarkup } = require("./artifact-check");
const {
  VIEWPORTS: ARTIFACT_VIEWPORTS,
  probeDataMarkerVisibility,
  resolveBrowser,
  validateMetrics,
} = require("./artifact-render-check");
const { isRfc3339DateTime } = require("./lib/iso-time");
const { inspectPdfBytes, inspectPngBytes, inspectPngVisualBytes } = require("./lib/media-inspect");
const { readProjectInput } = require("./lib/project-file");
const { MAX_RAW_AUDIT_BYTES, normalizeAuditBytes } = require("./design-critique-audit-normalize");
const { version: PLUGIN_VERSION } = require("../plugin.config.json");

const MODES = new Set(["product-ui", "pm-artifact"]);
const ROUTE_SCHEMA_VERSIONS = new Set([1, 2]);
const OUTCOMES = new Set(["passed", "failed", "blocked", "deferred"]);
const PRIORITIES = new Set(["P0", "P1", "P2", "P3"]);
const PRIORITY_RANK = Object.freeze({ P0: 0, P1: 1, P2: 2, P3: 3 });
const FINDING_STATUSES = new Set(["open", "resolved", "deferred", "dismissed"]);
const REVIEW_PERSPECTIVES = new Set(["primary", "fresh-eyes"]);
const REVIEW_EXECUTION_MODES = new Set(["delegated", "same-runtime-isolated"]);
const REVIEW_BASES = new Set(["objective", "craft", "uncertain"]);
const REVIEW_CONFIDENCE = new Set(["high", "medium", "low"]);
const RECONCILIATION_AGREEMENTS = new Set(["single-source", "aligned", "disputed"]);
const RECONCILIATION_DISPOSITIONS = new Set(["accepted", "dismissed"]);
const VIEWPORTS = new Set(["desktop", "tablet", "narrow", "device", "print"]);
const PRODUCT_UI_WEB_VIEWPORT_WIDTHS = Object.freeze({
  desktop: Object.freeze({ min: 1024, minHeight: 600 }),
  tablet: Object.freeze({ min: 601, max: 1023, minHeight: 600 }),
  narrow: Object.freeze({ min: 320, max: 600, minHeight: 480 }),
});
const PRODUCT_UI_DEVICE_BOUNDS = Object.freeze({ min: 240, minHeight: 400 });
const MIN_VISIBLE_PIXEL_RATIO = 0.01;
const PASSING_SCORE_FLOOR = 3;
const PRODUCT_UI_STATES = Object.freeze([
  "primary",
  "empty",
  "error",
  "boundary",
  "loading",
  "success",
  "focus",
  "disabled",
  "keyboard",
  "modal",
]);
const LEGACY_PRODUCT_UI_STATES = Object.freeze(["primary", "empty", "error", "boundary"]);
const STATES = new Set([...PRODUCT_UI_STATES, "responsive", "print"]);
const MAX_EVIDENCE_BYTES = 64 * 1024 * 1024;
const MAX_JSON_BYTES = 4 * 1024 * 1024;
const MAX_CACHE_BYTES = 256 * 1024 * 1024;
const ARTIFACT_VIEWPORT_NAMES = Object.freeze(ARTIFACT_VIEWPORTS.map((item) => item.name));
let activeReadCache = null;
const SCORE_KEYS = Object.freeze({
  "product-ui": [
    "hierarchy",
    "density",
    "consistency",
    "accessibility",
    "responsive",
    "state-clarity",
  ],
  "pm-artifact": [
    "hierarchy",
    "density",
    "consistency",
    "accessibility",
    "responsive",
    "print-navigation",
  ],
});
const REVIEW_PROMPTS = Object.freeze({
  primary: Object.freeze({
    profile: "primary-v1",
    path: path.join(__dirname, "../skills/dev/references/design-critique-reviewer.md"),
  }),
  "fresh-eyes": Object.freeze({
    profile: "fresh-eyes-v1",
    path: path.join(__dirname, "../skills/dev/references/design-critique-fresh-eyes.md"),
  }),
});

function checkDesignCritique(options) {
  const previousCache = activeReadCache;
  activeReadCache = { files: new Map(), bytes: 0 };
  try {
    return checkDesignCritiqueUncached(options);
  } finally {
    activeReadCache = previousCache;
  }
}

function checkDesignCritiqueUncached(options) {
  const root = fs.realpathSync(path.resolve(options.root || process.cwd()));
  const issues = [];
  const routeFile = readJsonFile(root, options.routePath, "route", issues);
  const capturesFile = readJsonFile(root, options.capturesPath, "captures", issues);
  const reportFile = readJsonFile(root, options.reportPath, "report", issues);
  if (!routeFile || !capturesFile || !reportFile) return { ok: false, issues };

  const route = routeFile.value;
  const captures = capturesFile.value;
  const report = reportFile.value;
  const reviewsFile =
    report?.schema_version === 2 && object(report.reviews) && text(report.reviews.path)
      ? readJsonFile(root, report.reviews.path, "reviews", issues)
      : null;
  const gitIdentity =
    options.verifyGit === false
      ? { commit: options.commit, baseRef: options.baseRef, baseCommit: options.baseCommit }
      : resolveGitIdentity(root, options, issues);
  validateRoute(route, gitIdentity.commit, gitIdentity.baseRef, gitIdentity.baseCommit, issues);
  if (options.verifyGit !== false)
    validateDiffIdentity(root, route, gitIdentity.baseCommit, issues);
  validateCaptures(root, captures, route, routeFile, issues);
  validateReport(
    root,
    report,
    route,
    captures,
    routeFile,
    capturesFile,
    reviewsFile,
    reportFile,
    options,
    issues
  );
  const legacyRouteMode = options.legacyRouteMode || "enforce";
  const legacyReportMode = options.legacyReportMode || legacyRouteMode;
  if (!new Set(["enforce", "inspect"]).has(legacyRouteMode))
    add(issues, "route.schema_version", "legacyRouteMode must be enforce or inspect");
  if (!new Set(["enforce", "inspect"]).has(legacyReportMode))
    add(issues, "report.schema_version", "legacyReportMode must be enforce or inspect");
  const legacyRoute = route.schema_version === 1;
  const legacyReport = report.schema_version === 1;
  if (legacyRoute || legacyReport) {
    const inspectionAllowed =
      (!legacyRoute || legacyRouteMode === "inspect") &&
      (!legacyReport || legacyReportMode === "inspect");
    if (inspectionAllowed)
      return {
        ok: false,
        authoritative: false,
        inspection_ok: issues.length === 0,
        issues,
      };
    if (legacyRoute)
      add(
        issues,
        "route.schema_version",
        "schema version 1 is migration-only and cannot certify a current Design Critique gate; create and run a schema-version-2 route"
      );
    if (legacyReport)
      add(
        issues,
        "report.schema_version",
        "schema version 1 is inspection-only and cannot certify Primary and Fresh Eyes review; create a schema-version-2 report with reviews.json"
      );
  }
  return { ok: issues.length === 0, issues };
}

function validateRoute(route, commit, baseRef, baseCommit, issues) {
  if (!object(route)) return add(issues, "route", "must be an object");
  closed(
    route,
    ["schema_version", "run_id", "created_at", "mode", "source", "subjects", "coverage"],
    "route",
    issues
  );
  if (!ROUTE_SCHEMA_VERSIONS.has(route.schema_version))
    add(issues, "route.schema_version", "must equal 1 or 2");
  if (!text(route.run_id)) add(issues, "route.run_id", "is required");
  if (!isRfc3339DateTime(route.created_at)) add(issues, "route.created_at", "must be RFC 3339");
  if (!MODES.has(route.mode)) add(issues, "route.mode", "must be product-ui or pm-artifact");
  if (!object(route.source)) add(issues, "route.source", "is required");
  else {
    closed(
      route.source,
      ["commit", "base_ref", "base_commit", "remote_push_url_sha256", "diff_sha256"],
      "route.source",
      issues
    );
    if (!sha(route.source.commit))
      add(issues, "route.source.commit", "must be a SHA-1 or SHA-256 commit");
    if (commit && route.source.commit !== commit)
      add(issues, "route.source.commit", `must equal current commit ${commit}`);
    if (!text(route.source.base_ref)) add(issues, "route.source.base_ref", "is required");
    if (baseRef && route.source.base_ref !== baseRef)
      add(issues, "route.source.base_ref", `must equal expected base ${baseRef}`);
    if (!sha(route.source.base_commit))
      add(issues, "route.source.base_commit", "must be an immutable Git object ID");
    if (baseCommit && route.source.base_commit !== baseCommit)
      add(issues, "route.source.base_commit", `must equal remote base commit ${baseCommit}`);
    if (!sha256(route.source.diff_sha256))
      add(issues, "route.source.diff_sha256", "must be SHA-256");
    if (
      route.source.remote_push_url_sha256 !== undefined &&
      !sha256(route.source.remote_push_url_sha256)
    )
      add(issues, "route.source.remote_push_url_sha256", "must be SHA-256 when present");
  }
  if (!Array.isArray(route.subjects) || route.subjects.length === 0)
    add(issues, "route.subjects", "must contain at least one subject");
  const subjectIds = new Set();
  for (const [index, subject] of (route.subjects || []).entries()) {
    const at = `route.subjects[${index}]`;
    if (!object(subject)) {
      add(issues, at, "must be an object");
      continue;
    }
    closed(subject, ["id", "title", "surface", "platform", "artifact"], at, issues);
    if (object(subject.artifact))
      closed(subject.artifact, ["path", "sha256", "kind"], `${at}.artifact`, issues);
    if (!slug(subject.id) || subjectIds.has(subject.id))
      add(issues, `${at}.id`, "must be unique kebab-case");
    subjectIds.add(subject.id);
    if (!text(subject.title) || !text(subject.surface))
      add(issues, at, "requires title and surface");
    if (!["web", "mobile", "document"].includes(subject.platform))
      add(issues, `${at}.platform`, "must be web, mobile, or document");
    if (route.mode === "pm-artifact" && subject.platform !== "document")
      add(issues, `${at}.platform`, "pm-artifact subjects must use document");
    if (route.mode === "product-ui" && subject.platform === "document")
      add(issues, `${at}.platform`, "product-ui subjects cannot use document");
  }
  validateCoverage(route, subjectIds, issues);
}

function resolveGitIdentity(root, options, issues) {
  let head = "";
  try {
    head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  } catch (error) {
    add(issues, "git", `cannot resolve current HEAD: ${error.message}`);
  }
  if (options.commit && head && options.commit !== head)
    add(issues, "commit", `supplied commit must equal current HEAD ${head}`);
  if (!text(options.baseRef)) add(issues, "base", "an expected base ref is required");
  const trusted =
    options.verifyRemote === false
      ? { ref: options.baseRef, commit: options.baseCommit }
      : resolveTrustedBase(root, issues);
  if (trusted.ref && options.baseRef && trusted.ref !== options.baseRef)
    add(issues, "base", `supplied base must equal remote default ${trusted.ref}`);
  if (trusted.commit && options.baseCommit && trusted.commit !== options.baseCommit)
    add(issues, "baseCommit", `supplied base commit must equal remote default ${trusted.commit}`);
  return {
    commit: head || options.commit,
    baseRef: trusted.ref || options.baseRef,
    baseCommit: trusted.commit || options.baseCommit,
  };
}

function resolveTrustedBase(root, issues) {
  try {
    const output = execFileSync("git", ["ls-remote", "--symref", "origin", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "Never" },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15_000,
    });
    const ref = output.match(/^ref:\s+refs\/heads\/([^\s]+)\s+HEAD$/m)?.[1];
    const commit = output.match(/^([a-f0-9]{40,64})\s+HEAD$/m)?.[1];
    if (!ref || !commit) throw new Error("origin HEAD lacks a symbolic ref or object ID");
    return { ref: `origin/${ref}`, commit };
  } catch (error) {
    const detail =
      error.code === "ETIMEDOUT" || error.signal
        ? "timed out after 15 seconds with interactive prompts disabled"
        : String(error.stderr || error.message)
            .trim()
            .slice(0, 300);
    add(issues, "base", `cannot resolve authoritative origin default: ${detail}`);
    return { ref: "", commit: "" };
  }
}

function validateDiffIdentity(root, route, baseCommit, issues) {
  if (
    !text(route?.source?.base_ref) ||
    !sha(route?.source?.commit) ||
    !sha256(route?.source?.diff_sha256)
  )
    return;
  try {
    const bytes = execFileSync(
      "git",
      ["diff", "--binary", `${baseCommit}...${route.source.commit}`],
      {
        cwd: root,
        encoding: null,
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 32 * 1024 * 1024,
      }
    );
    if (digest(bytes) !== route.source.diff_sha256)
      add(issues, "route.source.diff_sha256", "does not match the frozen git diff bytes");
  } catch (error) {
    add(
      issues,
      "route.source",
      `cannot verify git diff identity: ${String(error.stderr || error.message)
        .trim()
        .slice(0, 300)}`
    );
  }
}

function validateCoverage(route, subjectIds, issues) {
  if (!Array.isArray(route.coverage) || route.coverage.length === 0)
    return add(issues, "route.coverage", "must contain coverage decisions");
  const ids = new Set();
  for (const [index, item] of route.coverage.entries()) {
    const at = `route.coverage[${index}]`;
    if (!object(item)) {
      add(issues, at, "must be an object");
      continue;
    }
    closed(item, ["id", "subject_id", "state", "viewport", "required", "reason"], at, issues);
    if (!slug(item.id) || ids.has(item.id)) add(issues, `${at}.id`, "must be unique kebab-case");
    ids.add(item.id);
    if (!subjectIds.has(item.subject_id))
      add(issues, `${at}.subject_id`, "must reference a subject");
    if (!STATES.has(item.state)) add(issues, `${at}.state`, "is invalid");
    if (!VIEWPORTS.has(item.viewport)) add(issues, `${at}.viewport`, "is invalid");
    if (typeof item.required !== "boolean") add(issues, `${at}.required`, "must be boolean");
    if (item.required === false && !text(item.reason))
      add(issues, `${at}.reason`, "is required when not applicable");
  }
  for (const subject of route.subjects || []) {
    const rows = route.coverage.filter((item) => item.subject_id === subject.id);
    const required = (state, viewport) =>
      rows.some((item) => item.state === state && item.viewport === viewport && item.required);
    if (route.mode === "product-ui") {
      const requiredStateDecisions =
        route.schema_version === 1 ? LEGACY_PRODUCT_UI_STATES : PRODUCT_UI_STATES;
      for (const state of requiredStateDecisions)
        if (!rows.some((item) => item.state === state))
          add(issues, `route.coverage.${subject.id}`, `must decide applicability for ${state}`);
      if (!required("primary", "desktop") && subject.platform === "web")
        add(issues, `route.coverage.${subject.id}`, "web primary desktop capture is required");
      if (
        subject.platform === "web" &&
        route.schema_version === 2 &&
        !required("primary", "narrow")
      )
        add(issues, `route.coverage.${subject.id}`, "web primary narrow capture is required");
      if (!required("primary", "device") && subject.platform === "mobile")
        add(issues, `route.coverage.${subject.id}`, "mobile primary device capture is required");
    } else {
      for (const viewport of ARTIFACT_VIEWPORT_NAMES)
        if (!rows.some((item) => item.viewport === viewport && item.required))
          add(issues, `route.coverage.${subject.id}`, `${viewport} artifact render is required`);
      if (
        !rows.some((item) => item.state === "print" && item.viewport === "print" && item.required)
      )
        add(issues, `route.coverage.${subject.id}`, "print artifact capture is required");
    }
  }
}

function validateCaptures(root, captures, route, routeFile, issues) {
  if (!object(captures)) return add(issues, "captures", "must be an object");
  closed(
    captures,
    ["schema_version", "run_id", "mode", "commit", "route", "captures", "evidence", "checked_at"],
    "captures",
    issues
  );
  if (object(captures.route)) closed(captures.route, ["path", "sha256"], "captures.route", issues);
  if (captures.schema_version !== 1) add(issues, "captures.schema_version", "must equal 1");
  if (captures.run_id !== route.run_id || captures.mode !== route.mode)
    add(issues, "captures", "run_id and mode must match route");
  if (captures.commit !== route.source?.commit)
    add(issues, "captures.commit", "must match route commit");
  if (!isRfc3339DateTime(captures.checked_at))
    add(issues, "captures.checked_at", "must be RFC 3339");
  validateBinding(captures.route, routeFile, "captures.route", issues);
  const coverage = new Map((route.coverage || []).map((item) => [item.id, item]));
  const subjects = new Map((route.subjects || []).map((item) => [item.id, item]));
  const captureIds = new Set();
  const activeCoverage = new Map();
  const allCoverage = new Map();
  const decodedByCapture = new Map();
  if (!Array.isArray(captures.captures)) add(issues, "captures.captures", "must be an array");
  for (const [index, item] of (captures.captures || []).entries()) {
    const at = `captures.captures[${index}]`;
    if (!object(item) || !slug(item.id) || captureIds.has(item.id)) {
      add(issues, `${at}.id`, "must be unique kebab-case");
      continue;
    }
    closed(
      item,
      [
        "id",
        "coverage_id",
        "kind",
        "path",
        "sha256",
        "active",
        "round",
        "captured_at",
        "width",
        "height",
        "full_page",
        "pages",
        "pixel_sha256",
      ],
      at,
      issues
    );
    captureIds.add(item.id);
    if (!coverage.has(item.coverage_id))
      add(issues, `${at}.coverage_id`, "must reference route coverage");
    allCoverage.set(item.coverage_id, (allCoverage.get(item.coverage_id) || 0) + 1);
    if (item.active === true)
      activeCoverage.set(item.coverage_id, (activeCoverage.get(item.coverage_id) || 0) + 1);
    if (typeof item.active !== "boolean") add(issues, `${at}.active`, "must be boolean");
    if (!Number.isInteger(item.round) || item.round < 1 || item.round > 2)
      add(issues, `${at}.round`, "must be 1 or 2");
    if (!["screenshot", "pdf"].includes(item.kind))
      add(issues, `${at}.kind`, "must be screenshot or pdf");
    validateFileBinding(root, item, at, issues);
    const decoded = validateCaptureBytes(root, item, at, issues);
    if (decoded) decodedByCapture.set(item.id, decoded);
    validateProductUiViewport(
      item,
      coverage.get(item.coverage_id),
      subjects,
      route.mode,
      route.schema_version,
      decoded,
      at,
      issues
    );
    if (!isRfc3339DateTime(item.captured_at)) add(issues, `${at}.captured_at`, "must be RFC 3339");
    if (item.kind === "screenshot" && (!positiveInt(item.width) || !positiveInt(item.height)))
      add(issues, at, "screenshots require positive width and height");
    if (coverage.get(item.coverage_id)?.state === "print" && item.kind !== "pdf")
      add(issues, `${at}.kind`, "print coverage requires a PDF");
  }
  for (const item of route.coverage || []) {
    const activeCount = activeCoverage.get(item.id) || 0;
    const totalCount = allCoverage.get(item.id) || 0;
    if (item.required && activeCount !== 1)
      add(
        issues,
        `captures.captures`,
        `required coverage ${item.id} must have exactly one active capture`
      );
    if (item.required && activeCount === 1) {
      const rows = (captures.captures || []).filter((capture) => capture.coverage_id === item.id);
      const active = rows.find((capture) => capture.active === true);
      const latestRound = Math.max(...rows.map((capture) => capture.round));
      if (active.round !== latestRound)
        add(issues, `captures.captures`, `active coverage ${item.id} must use the latest round`);
    }
    if (!item.required && totalCount > 0)
      add(issues, `captures.captures`, `non-applicable coverage ${item.id} cannot have a capture`);
  }
  validateDistinctActiveCaptures(root, captures.captures || [], coverage, decodedByCapture, issues);
  validateEvidence(root, captures.evidence, route, captures.captures || [], issues);
}

function validateDistinctActiveCaptures(root, captureRows, coverage, decodedByCapture, issues) {
  const paths = new Map();
  const hashes = new Map();
  const pixelHashes = new Map();
  for (const capture of captureRows) {
    if (capture?.active !== true || !coverage.get(capture.coverage_id)?.required) continue;
    const file = readBoundFile(root, capture.path, `captures.captures.${capture.id}.path`, []);
    if (!file) continue;
    const priorPath = paths.get(file.path);
    if (priorPath && priorPath !== capture.coverage_id)
      add(
        issues,
        `captures.captures.${capture.id}`,
        `distinct required coverage ${priorPath} and ${capture.coverage_id} must use a distinct canonical capture path`
      );
    else paths.set(file.path, capture.coverage_id);
    const priorHash = hashes.get(file.sha256);
    if (priorHash && priorHash !== capture.coverage_id)
      add(
        issues,
        `captures.captures.${capture.id}`,
        `distinct required coverage ${priorHash} and ${capture.coverage_id} must use a distinct capture content hash`
      );
    else hashes.set(file.sha256, capture.coverage_id);
    const pixelHash = decodedByCapture.get(capture.id)?.pixelSha256;
    const priorPixels = pixelHashes.get(pixelHash);
    if (pixelHash && priorPixels && priorPixels !== capture.coverage_id)
      add(
        issues,
        `captures.captures.${capture.id}`,
        `distinct required coverage ${priorPixels} and ${capture.coverage_id} must use a distinct decoded-pixel hash`
      );
    else if (pixelHash) pixelHashes.set(pixelHash, capture.coverage_id);
  }
}

function validateAuditEvidence(root, entry, route, captureRows, label, issues) {
  const audit = readEvidenceJson(root, entry, label, issues);
  if (!audit) return null;
  const normalizedAuditRequired = route.schema_version === 2;
  closed(
    audit,
    [
      "schema_version",
      "subject_id",
      "commit",
      "capture_ids",
      ...(normalizedAuditRequired ? ["raw"] : []),
      "checks",
      "findings",
    ],
    label,
    issues
  );
  if (
    audit.schema_version !== (normalizedAuditRequired ? 2 : 1) ||
    audit.subject_id !== entry.subject_id ||
    audit.commit !== route.source?.commit
  )
    add(issues, label, "audit schema, subject, and commit must match the route");
  const raw = normalizedAuditRequired
    ? validateNormalizedAudit(root, audit, entry, label, issues)
    : null;
  const subjectCoverage = new Set(
    (route.coverage || [])
      .filter((item) => item.subject_id === entry.subject_id)
      .map((item) => item.id)
  );
  const validCaptureIds = new Set(
    captureRows.filter((item) => subjectCoverage.has(item.coverage_id)).map((item) => item.id)
  );
  const activeCaptureIds = captureRows
    .filter((item) => item.active === true && subjectCoverage.has(item.coverage_id))
    .map((item) => item.id);
  if (
    !Array.isArray(audit.capture_ids) ||
    audit.capture_ids.length === 0 ||
    audit.capture_ids.some((id) => !validCaptureIds.has(id))
  )
    add(issues, `${label}.capture_ids`, "must cite captures for the same subject");
  else if (normalizedAuditRequired && route.mode === "product-ui") {
    if (audit.capture_ids.length !== 1)
      add(issues, `${label}.capture_ids`, "must cite exactly one capture for the subject");
    if (entry.kind === "dom-audit" && raw) {
      const capture = captureRows.find((item) => item.id === audit.capture_ids[0]);
      if (capture?.kind !== "screenshot")
        add(issues, `${label}.capture_ids`, "DOM audit must cite an active screenshot");
      else if (raw.observations?.viewport?.inner_width !== capture.width)
        add(
          issues,
          `${label}.raw.observations.viewport.inner_width`,
          `must equal cited capture width ${capture.width}`
        );
    }
  } else if (activeCaptureIds.some((id) => !audit.capture_ids.includes(id)))
    add(issues, `${label}.capture_ids`, "must include every active capture for the subject");
  const requiredChecks =
    entry.kind === "accessibility-tree"
      ? ["landmarks", "names", "focus_order"]
      : [
          "overflow",
          "edge_alignment",
          "hierarchy",
          ...(normalizedAuditRequired ? ["consistency", "asymmetry"] : []),
        ];
  if (object(audit.checks)) closed(audit.checks, requiredChecks, `${label}.checks`, issues);
  if (!object(audit.checks) || requiredChecks.some((name) => audit.checks[name] !== true))
    add(issues, `${label}.checks`, `requires passing ${requiredChecks.join(", ")}`);
  if (!Array.isArray(audit.findings)) add(issues, `${label}.findings`, "must be an array");
  return audit;
}

function validateNormalizedAudit(root, audit, entry, label, issues) {
  if (!object(audit.raw)) {
    add(issues, `${label}.raw`, "requires a raw probe path and SHA-256");
    return null;
  }
  closed(audit.raw, ["path", "sha256"], `${label}.raw`, issues);
  if (!text(audit.raw.path) || !sha256(audit.raw.sha256)) {
    add(issues, `${label}.raw`, "requires a raw probe path and SHA-256");
    return null;
  }
  if (audit.raw.path === entry.path) {
    add(issues, `${label}.raw.path`, "must differ from the normalized audit path");
    return null;
  }
  const rawFile = readBoundFile(
    root,
    audit.raw.path,
    `${label}.raw.path`,
    issues,
    MAX_RAW_AUDIT_BYTES
  );
  if (!rawFile) return null;
  if (rawFile.sha256 !== audit.raw.sha256)
    add(issues, `${label}.raw.sha256`, "does not match raw probe bytes");
  let expected;
  try {
    expected = normalizeAuditBytes(rawFile.bytes, {
      path: rawFile.relative,
      sha256: rawFile.sha256,
    });
  } catch (error) {
    add(issues, `${label}.raw`, `cannot normalize raw probe: ${error.message}`);
    return null;
  }
  if (!isDeepStrictEqual(audit, expected))
    add(issues, label, "must exactly equal the deterministic normalization of the bound raw probe");
  try {
    return JSON.parse(rawFile.bytes.toString("utf8"));
  } catch {
    return null;
  }
}

function validateEvidence(root, evidence, route, captureRows, issues) {
  if (!Array.isArray(evidence)) return add(issues, "captures.evidence", "must be an array");
  const ids = new Set();
  const audits = [];
  for (const [index, item] of evidence.entries()) {
    const at = `captures.evidence[${index}]`;
    if (!object(item) || !slug(item.id) || ids.has(item.id))
      add(issues, `${at}.id`, "must be unique kebab-case");
    ids.add(item?.id);
    if (object(item)) closed(item, ["id", "subject_id", "kind", "path", "sha256"], at, issues);
    if (!(route.subjects || []).some((subject) => subject.id === item?.subject_id))
      add(issues, `${at}.subject_id`, "must reference a subject");
    if (
      !["accessibility-tree", "dom-audit", "artifact-structural", "artifact-render"].includes(
        item?.kind
      )
    )
      add(issues, `${at}.kind`, "is invalid");
    validateFileBinding(root, item, at, issues);
    if (["accessibility-tree", "dom-audit"].includes(item?.kind)) {
      const audit = validateAuditEvidence(root, item, route, captureRows, at, issues);
      if (audit) audits.push({ entry: item, audit });
    }
  }
  for (const subject of route.subjects || []) {
    const kinds = new Set(
      evidence.filter((item) => item.subject_id === subject.id).map((item) => item.kind)
    );
    if (!kinds.has("accessibility-tree"))
      add(issues, `captures.evidence.${subject.id}`, "requires accessibility-tree evidence");
    if (route.mode === "product-ui" && subject.platform === "web" && !kinds.has("dom-audit"))
      add(issues, `captures.evidence.${subject.id}`, "web UI requires dom-audit evidence");
    if (route.schema_version === 2 && route.mode === "product-ui") {
      const subjectCoverage = new Set(
        (route.coverage || [])
          .filter((item) => item.subject_id === subject.id)
          .map((item) => item.id)
      );
      const activeCaptures = captureRows.filter(
        (item) => item.active === true && subjectCoverage.has(item.coverage_id)
      );
      const requiredKinds =
        subject.platform === "web" ? ["accessibility-tree", "dom-audit"] : ["accessibility-tree"];
      for (const capture of activeCaptures)
        for (const kind of requiredKinds) {
          const count = audits.filter(
            ({ entry, audit }) =>
              entry.subject_id === subject.id &&
              entry.kind === kind &&
              audit.capture_ids?.includes(capture.id)
          ).length;
          if (count !== 1)
            add(
              issues,
              `captures.evidence.${subject.id}`,
              `${kind} must cover active capture ${capture.id} exactly once`
            );
        }
    }
    if (route.mode === "pm-artifact") {
      for (const kind of ["artifact-structural", "artifact-render"])
        if (!kinds.has(kind))
          add(issues, `captures.evidence.${subject.id}`, `requires ${kind} evidence`);
      validateArtifactSubject(root, subject, evidence, route, captureRows, issues);
    }
  }
}

function validateArtifactSubject(root, subject, evidence, route, captureRows, issues) {
  const at = `route.subjects.${subject.id}.artifact`;
  if (!object(subject.artifact) || !["proposal", "rfc", "report"].includes(subject.artifact.kind)) {
    add(issues, at, "requires path, SHA-256, and proposal/rfc/report kind");
    return;
  }
  validateFileBinding(root, subject.artifact, at, issues);
  const artifactFile = readBoundFile(root, subject.artifact.path, `${at}.path`, []);
  if (!artifactFile) return;
  const inspected = inspectHtmlArtifact(artifactFile.bytes, {
    expectedKind: subject.artifact.kind,
  });
  for (const item of inspected.issues || []) add(issues, `${at}${item.path || ""}`, item.message);

  const structuralEntry = evidence.find(
    (item) => item.subject_id === subject.id && item.kind === "artifact-structural"
  );
  const renderEntry = evidence.find(
    (item) => item.subject_id === subject.id && item.kind === "artifact-render"
  );
  const structural = readEvidenceJson(root, structuralEntry, `${at}.structural`, issues);
  const render = readEvidenceJson(root, renderEntry, `${at}.render`, issues);
  if (
    structural &&
    (structural.schema_version !== 1 ||
      structural.artifact?.sha256 !== `sha256:${artifactFile.sha256}` ||
      realPathMaybe(structural.artifact?.path) !== artifactFile.path ||
      !object(structural.checks) ||
      Object.values(structural.checks).some((value) => value !== true))
  ) {
    add(
      issues,
      `${at}.structural`,
      "must be a passing structural manifest for the exact HTML bytes"
    );
  }
  if (render) {
    if (!isRfc3339DateTime(render.checked_at))
      add(issues, `${at}.render.checked_at`, "must be RFC 3339");
    const renderSource = readBoundFile(
      root,
      render.source?.path,
      `${at}.render.source.path`,
      issues
    );
    if (
      !renderSource ||
      renderSource.path !== artifactFile.path ||
      render.source?.sha256 !== `sha256:${artifactFile.sha256}`
    )
      add(issues, `${at}.render.source`, "must bind the exact HTML bytes");
    const viewports = new Set((render.captures || []).map((item) => item.name));
    for (const viewport of ARTIFACT_VIEWPORT_NAMES)
      if (!viewports.has(viewport)) add(issues, `${at}.render.captures`, `missing ${viewport}`);
    if (viewports.size !== (render.captures || []).length)
      add(issues, `${at}.render.captures`, "viewport names must be unique");
    const renderedPaths = new Set();
    for (const expected of ARTIFACT_VIEWPORTS) {
      const item = (render.captures || []).find((candidate) => candidate.name === expected.name);
      if (!item) continue;
      if (item.width !== expected.width || item.height !== expected.height)
        add(issues, `${at}.render.${expected.name}`, "viewport dimensions are noncanonical");
      validateRenderedPng(
        root,
        item,
        expected.width,
        expected.height,
        `${at}.render.${expected.name}`,
        renderedPaths,
        issues
      );
      if (
        !object(item.full_page) ||
        item.full_page.width !== expected.width ||
        item.full_page.height < expected.height
      )
        add(
          issues,
          `${at}.render.${expected.name}.full_page`,
          "requires canonical-width full-page metadata"
        );
      else
        validateRenderedPng(
          root,
          item.full_page,
          expected.width,
          item.full_page.height,
          `${at}.render.${expected.name}.full_page`,
          renderedPaths,
          issues
        );
      try {
        validateMetrics(item.metrics, expected);
      } catch (error) {
        add(issues, `${at}.render.${expected.name}.metrics`, error.message);
      }
    }
    if (
      !text(render.print?.path) ||
      !/^sha256:[a-f0-9]{64}$/.test(render.print?.sha256 || "") ||
      !positiveInt(render.print?.bytes) ||
      !positiveInt(render.print?.pages)
    )
      add(issues, `${at}.render.print`, "requires a non-empty hash-bound PDF");
    else {
      const printFile = readBoundFile(root, render.print.path, `${at}.render.print.path`, issues);
      if (
        printFile &&
        (render.print.sha256 !== `sha256:${printFile.sha256}` ||
          render.print.bytes !== printFile.bytes.length)
      )
        add(issues, `${at}.render.print`, "print hash and byte count must match the PDF");
    }
    const renderedByViewport = new Map();
    for (const item of render.captures || []) {
      const files = new Set();
      if (item.path && item.sha256) {
        const file = readBoundFile(root, item.path, `${at}.render.${item.name}.path`, []);
        if (file) files.add(`${file.path}|${item.sha256}`);
      }
      if (item.full_page?.path && item.full_page?.sha256) {
        const file = readBoundFile(
          root,
          item.full_page.path,
          `${at}.render.${item.name}.full_page.path`,
          []
        );
        if (file) files.add(`${file.path}|${item.full_page.sha256}`);
      }
      renderedByViewport.set(item.name, files);
    }
    const subjectCoverage = new Map(
      (route.coverage || [])
        .filter((item) => item.subject_id === subject.id && item.required)
        .map((item) => [item.id, item])
    );
    for (const capture of captureRows.filter(
      (item) => item.active === true && subjectCoverage.has(item.coverage_id)
    )) {
      const file = readBoundFile(root, capture.path, `${at}.capture.${capture.id}`, []);
      const coverage = subjectCoverage.get(capture.coverage_id);
      const renderedFiles =
        coverage.viewport === "print"
          ? (() => {
              const printFile = readBoundFile(
                root,
                render.print?.path,
                `${at}.render.print.path`,
                []
              );
              return new Set(printFile ? [`${printFile.path}|${render.print?.sha256}`] : []);
            })()
          : renderedByViewport.get(coverage.viewport) || new Set();
      if (capture.kind === "screenshot" && capture.full_page !== true)
        add(
          issues,
          `${at}.capture.${capture.id}`,
          "artifact screenshots must be full-page captures"
        );
      if (file && !renderedFiles.has(`${file.path}|sha256:${file.sha256}`))
        add(issues, `${at}.capture.${capture.id}`, "is not bound by the artifact render manifest");
    }
  }
}

function validateRenderedPng(root, item, width, height, label, seen, issues) {
  if (!object(item) || !text(item.path) || !/^sha256:[a-f0-9]{64}$/.test(item.sha256 || "")) {
    add(issues, label, "requires a hash-bound PNG");
    return;
  }
  const file = readBoundFile(root, item.path, `${label}.path`, issues);
  if (!file) return;
  if (seen.has(file.path)) add(issues, label, "render files must be distinct");
  seen.add(file.path);
  if (item.sha256 !== `sha256:${file.sha256}` || item.bytes !== file.bytes.length)
    add(issues, label, "render hash and byte count must match the file");
  try {
    const dimensions = inspectPngBytes(file.bytes);
    if (dimensions.width !== width || dimensions.height !== height)
      add(issues, label, `render dimensions must equal ${width}x${height}`);
  } catch (error) {
    add(issues, label, error.message);
  }
}

function readEvidenceJson(root, entry, label, issues) {
  if (!entry) return null;
  const file = readBoundFile(root, entry.path, `${label}.path`, issues);
  if (!file) return null;
  if (file.bytes.length > MAX_JSON_BYTES) {
    add(issues, label, `JSON exceeds ${MAX_JSON_BYTES} bytes`);
    return null;
  }
  try {
    return JSON.parse(file.bytes.toString("utf8"));
  } catch (error) {
    add(issues, label, `invalid JSON: ${error.message}`);
    return null;
  }
}

function validateReport(
  root,
  report,
  route,
  captures,
  routeFile,
  capturesFile,
  reviewsFile,
  reportFile,
  options,
  issues
) {
  if (!object(report)) return add(issues, "report", "must be an object");
  closed(
    report,
    [
      "schema_version",
      "run_id",
      "mode",
      "commit",
      "route",
      "captures",
      ...(report.schema_version === 2 ? ["reviews"] : []),
      "outcome",
      "reason",
      "authority",
      "rounds",
      "coverage",
      "scores",
      "findings",
      ...(report.schema_version === 2 ? ["reconciliation"] : []),
      "top_issue",
      "next_action",
      "human_report",
      "checked_at",
    ],
    "report",
    issues
  );
  for (const [name, binding] of [
    ["route", report.route],
    ["captures", report.captures],
    ...(report.schema_version === 2 ? [["reviews", report.reviews]] : []),
  ])
    if (object(binding)) closed(binding, ["path", "sha256"], `report.${name}`, issues);
  if (object(report.coverage))
    closed(report.coverage, ["required", "captured", "percent"], "report.coverage", issues);
  if (object(report.human_report))
    closed(report.human_report, ["path"], "report.human_report", issues);
  if (object(report.authority))
    closed(report.authority, ["approver", "decision"], "report.authority", issues);
  if (![1, 2].includes(report.schema_version))
    add(issues, "report.schema_version", "must equal 1 or 2");
  if (!isRfc3339DateTime(report.checked_at)) add(issues, "report.checked_at", "must be RFC 3339");
  if (
    report.run_id !== route.run_id ||
    report.mode !== route.mode ||
    report.commit !== route.source?.commit
  )
    add(issues, "report", "run_id, mode, and commit must match route");
  validateBinding(report.route, routeFile, "report.route", issues);
  validateBinding(report.captures, capturesFile, "report.captures", issues);
  let reviewState = null;
  if (report.schema_version === 2) {
    if (!reviewsFile) add(issues, "report.reviews", "requires a readable reviews.json binding");
    else {
      validateBinding(report.reviews, reviewsFile, "report.reviews", issues);
      reviewState = validateReviews(
        root,
        reviewsFile.value,
        route,
        captures,
        routeFile,
        capturesFile,
        report,
        issues
      );
    }
  }
  if (!OUTCOMES.has(report.outcome)) add(issues, "report.outcome", "is invalid");
  if (!text(report.next_action)) add(issues, "report.next_action", "is required");
  const expectedTopIssue = deriveTopIssue(report);
  if (report.top_issue !== expectedTopIssue)
    add(issues, "report.top_issue", `must equal ${expectedTopIssue}`);
  if (!Number.isInteger(report.rounds) || report.rounds < 1 || report.rounds > 2)
    add(issues, "report.rounds", "must be 1 or 2");
  if ((captures.captures || []).some((item) => item.round > report.rounds))
    add(issues, "report.rounds", "must include every recorded capture round");
  validateScores(root, report.scores, route, captures, report.outcome, issues);
  validateFindings(report.findings, route, captures, report.outcome, issues);
  if (report.schema_version === 2 && reviewState)
    validateReconciliation(report, route, captures, reviewState, issues);
  const required = (route.coverage || []).filter((item) => item.required).length;
  const captured = new Set(
    (captures.captures || []).filter((item) => item.active === true).map((item) => item.coverage_id)
  );
  const completed = (route.coverage || []).filter(
    (item) => item.required && captured.has(item.id)
  ).length;
  if (
    !object(report.coverage) ||
    report.coverage.required !== required ||
    report.coverage.captured !== completed
  )
    add(issues, "report.coverage", "must exactly account for required and captured coverage");
  const expectedPercent = required === 0 ? 0 : Math.round((completed / required) * 100);
  if (report.coverage?.percent !== expectedPercent)
    add(issues, "report.coverage.percent", `must equal ${expectedPercent}`);
  if (report.outcome === "passed" && expectedPercent !== 100)
    add(issues, "report.outcome", "passed requires 100% applicable coverage");
  if (["blocked", "deferred"].includes(report.outcome) && !text(report.reason))
    add(issues, "report.reason", `${report.outcome} requires a concrete reason`);
  const unresolvedBlocking = (report.findings || []).some(
    (finding) =>
      finding.owner === "design-critique" &&
      ["P0", "P1"].includes(finding.priority) &&
      ["open", "deferred"].includes(finding.status)
  );
  if (report.outcome === "failed" && !unresolvedBlocking && !text(report.reason))
    add(
      issues,
      "report.reason",
      "failed requires an unresolved Design Critique P0/P1 or a concrete reason"
    );
  if (
    report.outcome === "deferred" &&
    (!object(report.authority) ||
      !text(report.authority.approver) ||
      !text(report.authority.decision))
  )
    add(issues, "report.authority", "deferred requires approver and decision");
  validateHumanReport(
    root,
    report.human_report,
    report,
    reportFile,
    capturesFile,
    reviewsFile,
    reviewState,
    options,
    issues
  );
}

function validateReviews(root, reviews, route, captures, routeFile, capturesFile, report, issues) {
  const state = {
    reviews: new Map(),
    findings: new Map(),
    finalPrimaryScores: null,
    rows: [],
  };
  if (!object(reviews)) {
    add(issues, "reviews", "must be an object");
    return state;
  }
  closed(
    reviews,
    ["schema_version", "run_id", "mode", "commit", "route", "captures", "rounds", "checked_at"],
    "reviews",
    issues
  );
  if (reviews.schema_version !== 1) add(issues, "reviews.schema_version", "must equal 1");
  if (
    reviews.run_id !== route.run_id ||
    reviews.mode !== route.mode ||
    reviews.commit !== route.source?.commit
  )
    add(issues, "reviews", "run_id, mode, and commit must match the route");
  for (const [name, binding] of [
    ["route", reviews.route],
    ["captures", reviews.captures],
  ])
    if (object(binding)) closed(binding, ["path", "sha256"], `reviews.${name}`, issues);
  validateBinding(reviews.route, routeFile, "reviews.route", issues);
  validateBinding(reviews.captures, capturesFile, "reviews.captures", issues);
  if (!isRfc3339DateTime(reviews.checked_at)) add(issues, "reviews.checked_at", "must be RFC 3339");
  if (
    isRfc3339DateTime(reviews.checked_at) &&
    isRfc3339DateTime(report.checked_at) &&
    Date.parse(reviews.checked_at) > Date.parse(report.checked_at)
  )
    add(issues, "reviews.checked_at", "must not be later than report.checked_at");
  if (!Array.isArray(reviews.rounds)) {
    add(issues, "reviews.rounds", "must be an array");
    return state;
  }
  if (reviews.rounds.length !== report.rounds)
    add(issues, "reviews.rounds", "must contain exactly one entry per report round");

  const captureById = new Map((captures.captures || []).map((item) => [item.id, item]));
  const evidenceById = new Map((captures.evidence || []).map((item) => [item.id, item]));
  const coverageById = new Map((route.coverage || []).map((item) => [item.id, item]));
  const expectedRounds = new Set(
    Array.from(
      { length: Number.isInteger(report.rounds) ? report.rounds : 0 },
      (_, index) => index + 1
    )
  );
  const seenRounds = new Set();
  const seenReviewIds = new Set();
  const seenContextIds = new Set();
  const seenInvocationIds = new Set();

  for (const [roundIndex, roundRow] of reviews.rounds.entries()) {
    const roundAt = `reviews.rounds[${roundIndex}]`;
    if (!object(roundRow)) {
      add(issues, roundAt, "must be an object");
      continue;
    }
    closed(roundRow, ["round", "reviews"], roundAt, issues);
    if (!expectedRounds.has(roundRow.round) || seenRounds.has(roundRow.round))
      add(issues, `${roundAt}.round`, "must be a unique consecutive report round");
    seenRounds.add(roundRow.round);
    if (!Array.isArray(roundRow.reviews) || roundRow.reviews.length !== 2) {
      add(issues, `${roundAt}.reviews`, "must contain exactly Primary and Fresh Eyes");
      continue;
    }
    const pair = [];
    for (const [reviewIndex, review] of roundRow.reviews.entries()) {
      const at = `${roundAt}.reviews[${reviewIndex}]`;
      if (!object(review)) {
        add(issues, at, "must be an object");
        continue;
      }
      closed(review, ["review_id", "perspective", "input", "execution", "result"], at, issues);
      if (!reviewId(review.review_id) || seenReviewIds.has(review.review_id))
        add(issues, `${at}.review_id`, "must be a unique bounded review identity");
      seenReviewIds.add(review.review_id);
      if (!REVIEW_PERSPECTIVES.has(review.perspective))
        add(issues, `${at}.perspective`, "must be primary or fresh-eyes");
      const inputState = validateReviewInput(
        root,
        review.input,
        review.perspective,
        roundRow.round,
        route,
        captures,
        captureById,
        evidenceById,
        at,
        issues
      );
      validateReviewExecution(
        review.execution,
        reviews.checked_at,
        seenContextIds,
        seenInvocationIds,
        at,
        issues
      );
      const resultState = validateReviewResult(
        review,
        inputState,
        route,
        captureById,
        evidenceById,
        at,
        issues
      );
      const row = {
        review,
        round: roundRow.round,
        inputState,
        resultState,
        resultSha256: digest(Buffer.from(canonicalJson(review.result ?? null))),
      };
      pair.push(row);
      state.rows.push(row);
      state.reviews.set(review.review_id, row);
      for (const finding of resultState.findings)
        state.findings.set(`${review.review_id}:${finding.id}`, {
          review_id: review.review_id,
          perspective: review.perspective,
          round: roundRow.round,
          finding,
        });
    }
    validateReviewPair(pair, roundRow.round, report.rounds, captures, coverageById, issues);
    const primary = pair.find((item) => item.review.perspective === "primary");
    if (roundRow.round === report.rounds && primary)
      state.finalPrimaryScores = primary.review.result?.scores || null;
  }
  for (const expected of expectedRounds)
    if (!seenRounds.has(expected)) add(issues, "reviews.rounds", `missing round ${expected}`);
  validatePriorFindingRefs(state, issues);
  if (!isDeepStrictEqual(report.scores, state.finalPrimaryScores))
    add(issues, "report.scores", "must exactly equal the final-round Primary scores");
  return state;
}

function validateReviewInput(
  root,
  input,
  perspective,
  round,
  route,
  captures,
  captureById,
  evidenceById,
  at,
  issues
) {
  const label = `${at}.input`;
  const state = { captureIds: [], evidenceIds: [], priorFindingRefs: [], payloadSha256: "" };
  if (!object(input)) {
    add(issues, label, "must be an object");
    return state;
  }
  const common = [
    "prompt_profile",
    "prompt_sha256",
    "brief",
    "design_principles",
    "capture_ids",
    "payload_sha256",
  ];
  closed(
    input,
    perspective === "primary"
      ? [...common, "acceptance_criteria", "evidence_ids", "prior_finding_refs"]
      : common,
    label,
    issues
  );
  const prompt = REVIEW_PROMPTS[perspective];
  if (!prompt || input.prompt_profile !== prompt.profile)
    add(issues, `${label}.prompt_profile`, `must equal ${prompt?.profile || "a known profile"}`);
  else {
    const expectedHash = digest(fs.readFileSync(prompt.path));
    if (input.prompt_sha256 !== expectedHash)
      add(issues, `${label}.prompt_sha256`, "must bind the exact reviewer instruction bytes");
  }
  if (!object(input.brief)) add(issues, `${label}.brief`, "must be an object");
  else {
    closed(
      input.brief,
      ["page_description", "persona", "job_to_be_done"],
      `${label}.brief`,
      issues
    );
    for (const key of ["page_description", "persona", "job_to_be_done"])
      if (!boundedText(input.brief[key], 2_000))
        add(issues, `${label}.brief.${key}`, "is required");
  }
  if (
    !Array.isArray(input.design_principles) ||
    input.design_principles.length > 20 ||
    input.design_principles.some((item) => !boundedText(item, 1_000))
  )
    add(issues, `${label}.design_principles`, "must contain at most 20 bounded text principles");
  if (!uniqueTextArray(input.capture_ids, 200))
    add(issues, `${label}.capture_ids`, "must be a non-empty unique bounded array");
  else {
    state.captureIds = input.capture_ids;
    for (const id of input.capture_ids)
      if (!captureById.has(id)) add(issues, `${label}.capture_ids`, `unknown capture ${id}`);
  }
  if (perspective === "primary") {
    if (
      !Array.isArray(input.acceptance_criteria) ||
      input.acceptance_criteria.length === 0 ||
      input.acceptance_criteria.length > 50 ||
      input.acceptance_criteria.some((item) => !boundedText(item, 2_000))
    )
      add(issues, `${label}.acceptance_criteria`, "must contain bounded acceptance criteria");
    if (!uniqueTextArray(input.evidence_ids, 400))
      add(issues, `${label}.evidence_ids`, "must be a non-empty unique bounded array");
    else {
      state.evidenceIds = input.evidence_ids;
      for (const id of input.evidence_ids)
        if (!evidenceById.has(id)) add(issues, `${label}.evidence_ids`, `unknown evidence ${id}`);
    }
    if (!Array.isArray(input.prior_finding_refs) || input.prior_finding_refs.length > 100)
      add(issues, `${label}.prior_finding_refs`, "must be a bounded array");
    else {
      state.priorFindingRefs = input.prior_finding_refs;
      for (const [index, ref] of input.prior_finding_refs.entries()) {
        const refAt = `${label}.prior_finding_refs[${index}]`;
        if (!object(ref)) add(issues, refAt, "must be an object");
        else {
          closed(ref, ["review_id", "finding_id"], refAt, issues);
          if (!text(ref.review_id) || !text(ref.finding_id))
            add(issues, refAt, "requires review_id and finding_id");
        }
      }
    }
    if (round === 1 && state.priorFindingRefs.length > 0)
      add(issues, `${label}.prior_finding_refs`, "round 1 cannot contain prior findings");
    const requiredEvidence = requiredReviewEvidenceIds(root, route, captures, state.captureIds);
    const supplied = new Set(state.evidenceIds);
    const missing = requiredEvidence.filter((id) => !supplied.has(id));
    if (missing.length > 0)
      add(
        issues,
        `${label}.evidence_ids`,
        `must include required review evidence: ${missing.join(", ")}`
      );
  }
  const payload = { ...input };
  delete payload.payload_sha256;
  const expectedPayload = digest(Buffer.from(canonicalJson(payload)));
  state.payloadSha256 = expectedPayload;
  if (input.payload_sha256 !== expectedPayload)
    add(issues, `${label}.payload_sha256`, "must match the canonical reviewer input payload");
  return state;
}

function requiredReviewEvidenceIds(root, route, captures, captureIds) {
  const selected = new Set(captureIds);
  if (route.mode === "pm-artifact") return (captures.evidence || []).map((item) => item.id);
  return (captures.evidence || [])
    .filter((item) => ["accessibility-tree", "dom-audit"].includes(item.kind))
    .filter((item) => {
      const audit = readEvidenceJson(root, item, `captures.evidence.${item.id}`, []);
      return (audit?.capture_ids || []).some((id) => selected.has(id));
    })
    .map((item) => item.id);
}

function validateReviewExecution(
  execution,
  reviewsCheckedAt,
  seenContextIds,
  seenInvocationIds,
  at,
  issues
) {
  const label = `${at}.execution`;
  if (!object(execution)) return add(issues, label, "must be an object");
  closed(
    execution,
    ["mode", "runtime", "context_id", "invocation_id", "started_at", "completed_at"],
    label,
    issues
  );
  if (!REVIEW_EXECUTION_MODES.has(execution.mode))
    add(issues, `${label}.mode`, "must be delegated or same-runtime-isolated");
  if (!object(execution.runtime)) add(issues, `${label}.runtime`, "must be an object");
  else {
    closed(execution.runtime, ["provider", "model", "reasoning"], `${label}.runtime`, issues);
    for (const key of ["provider", "model", "reasoning"])
      if (!boundedText(execution.runtime[key], 200))
        add(issues, `${label}.runtime.${key}`, "is required");
  }
  for (const [key, seen] of [
    ["context_id", seenContextIds],
    ["invocation_id", seenInvocationIds],
  ]) {
    if (!reviewId(execution[key]) || seen.has(execution[key]))
      add(issues, `${label}.${key}`, "must be a globally unique bounded identity");
    seen.add(execution[key]);
  }
  if (!isRfc3339DateTime(execution.started_at))
    add(issues, `${label}.started_at`, "must be RFC 3339");
  if (!isRfc3339DateTime(execution.completed_at))
    add(issues, `${label}.completed_at`, "must be RFC 3339");
  if (
    isRfc3339DateTime(execution.started_at) &&
    isRfc3339DateTime(execution.completed_at) &&
    Date.parse(execution.started_at) > Date.parse(execution.completed_at)
  )
    add(issues, label, "completed_at must not precede started_at");
  if (
    isRfc3339DateTime(execution.completed_at) &&
    isRfc3339DateTime(reviewsCheckedAt) &&
    Date.parse(execution.completed_at) > Date.parse(reviewsCheckedAt)
  )
    add(issues, `${label}.completed_at`, "must not be later than reviews.checked_at");
}

function validateReviewResult(review, inputState, route, captureById, evidenceById, at, issues) {
  const label = `${at}.result`;
  const result = review.result;
  const state = { findings: [] };
  if (!object(result)) {
    add(issues, label, "must be an object");
    return state;
  }
  if (review.perspective === "primary") {
    closed(result, ["summary", "scores", "findings"], label, issues);
    if (!boundedText(result.summary, 10_000)) add(issues, `${label}.summary`, "is required");
    validatePerspectiveScores(result.scores, route.mode, inputState, `${label}.scores`, issues);
  } else {
    closed(result, ["first_impression", "answers", "findings"], label, issues);
    if (!boundedText(result.first_impression, 10_000))
      add(issues, `${label}.first_impression`, "is required");
    validateFreshAnswers(result.answers, inputState, label, issues);
  }
  const limit = review.perspective === "fresh-eyes" ? 5 : 50;
  if (!Array.isArray(result.findings) || result.findings.length > limit)
    add(issues, `${label}.findings`, `must be an array with at most ${limit} findings`);
  else {
    const ids = new Set();
    for (const [index, finding] of result.findings.entries()) {
      validateReviewFinding(
        finding,
        review,
        inputState,
        route,
        captureById,
        evidenceById,
        `${label}.findings[${index}]`,
        ids,
        issues
      );
      if (object(finding)) state.findings.push(finding);
    }
  }
  return state;
}

function validatePerspectiveScores(scores, mode, inputState, label, issues) {
  if (!object(scores)) return add(issues, label, "must be an object");
  const expected = new Set(SCORE_KEYS[mode] || []);
  const allowedEvidence = new Set([...inputState.captureIds, ...inputState.evidenceIds]);
  for (const key of Object.keys(scores))
    if (!expected.has(key)) add(issues, `${label}.${key}`, "is not valid for this mode");
  for (const key of expected) {
    const score = scores[key];
    const at = `${label}.${key}`;
    if (!object(score)) {
      add(issues, at, "must be an evidence-backed score object");
      continue;
    }
    closed(score, ["value", "rationale", "evidence_ids"], at, issues);
    if (!Number.isInteger(score.value) || score.value < 1 || score.value > 5)
      add(issues, `${at}.value`, "must be an integer from 1 to 5");
    if (!boundedText(score.rationale, 10_000)) add(issues, `${at}.rationale`, "is required");
    if (
      !uniqueTextArray(score.evidence_ids, 400) ||
      score.evidence_ids.some((id) => !allowedEvidence.has(id))
    )
      add(issues, `${at}.evidence_ids`, "must cite supplied Primary evidence");
  }
}

function validateFreshAnswers(answers, inputState, label, issues) {
  const at = `${label}.answers`;
  if (!object(answers)) return add(issues, at, "must be an object");
  const keys = ["purpose", "visual_focus", "inconsistencies"];
  closed(answers, keys, at, issues);
  const allowed = new Set(inputState.captureIds);
  for (const key of keys) {
    const answer = answers[key];
    if (!object(answer)) {
      add(issues, `${at}.${key}`, "must be an evidence-backed answer");
      continue;
    }
    closed(answer, ["text", "evidence_ids"], `${at}.${key}`, issues);
    if (!boundedText(answer.text, 10_000)) add(issues, `${at}.${key}.text`, "is required");
    if (
      !uniqueTextArray(answer.evidence_ids, 200) ||
      answer.evidence_ids.some((id) => !allowed.has(id))
    )
      add(issues, `${at}.${key}.evidence_ids`, "must cite supplied rendered captures only");
  }
}

function validateReviewFinding(
  finding,
  review,
  inputState,
  route,
  captureById,
  evidenceById,
  at,
  ids,
  issues
) {
  if (!object(finding)) return add(issues, at, "must be an object");
  closed(
    finding,
    [
      "id",
      "subject_id",
      "region",
      "rule",
      "coverage_ids",
      "evidence_ids",
      "priority",
      "owner",
      "basis",
      "confidence",
      "summary",
      "impact",
      "remediation",
    ],
    at,
    issues
  );
  const expectedId = reviewFindingId(review.review_id, finding);
  if (finding.id !== expectedId || ids.has(finding.id))
    add(issues, `${at}.id`, `must equal deterministic identity ${expectedId}`);
  ids.add(finding.id);
  if (!(route.subjects || []).some((subject) => subject.id === finding.subject_id))
    add(issues, `${at}.subject_id`, "must reference a route subject");
  if (!slug(finding.region) || !slug(finding.rule))
    add(issues, at, "region and rule must be kebab-case");
  if (!uniqueTextArray(finding.coverage_ids, 100))
    add(issues, `${at}.coverage_ids`, "must be a non-empty unique array");
  else
    for (const id of finding.coverage_ids) {
      const coverage = (route.coverage || []).find((item) => item.id === id);
      if (!coverage || coverage.subject_id !== finding.subject_id)
        add(issues, `${at}.coverage_ids`, `invalid subject coverage ${id}`);
    }
  const allowedEvidence = new Set([
    ...inputState.captureIds,
    ...(review.perspective === "primary" ? inputState.evidenceIds : []),
  ]);
  if (
    !uniqueTextArray(finding.evidence_ids, 400) ||
    finding.evidence_ids.some((id) => !allowedEvidence.has(id))
  )
    add(
      issues,
      `${at}.evidence_ids`,
      review.perspective === "fresh-eyes"
        ? "Fresh Eyes findings must cite supplied rendered captures only"
        : "must cite supplied Primary evidence"
    );
  for (const id of finding.evidence_ids || []) {
    const capture = captureById.get(id);
    const evidence = evidenceById.get(id);
    if (capture) {
      const coverage = (route.coverage || []).find((item) => item.id === capture.coverage_id);
      if (coverage?.subject_id !== finding.subject_id)
        add(issues, `${at}.evidence_ids`, `capture ${id} belongs to another subject`);
    } else if (evidence?.subject_id !== finding.subject_id)
      add(issues, `${at}.evidence_ids`, `evidence ${id} belongs to another subject`);
  }
  if (!PRIORITIES.has(finding.priority)) add(issues, `${at}.priority`, "is invalid");
  if (review.perspective === "fresh-eyes" && finding.priority === "P3")
    add(issues, `${at}.priority`, "Fresh Eyes findings are limited to P0-P2");
  if (!["design-critique", "qa", "review"].includes(finding.owner))
    add(issues, `${at}.owner`, "is invalid");
  if (!REVIEW_BASES.has(finding.basis)) add(issues, `${at}.basis`, "is invalid");
  if (!REVIEW_CONFIDENCE.has(finding.confidence)) add(issues, `${at}.confidence`, "is invalid");
  for (const key of ["summary", "impact", "remediation"])
    if (!boundedText(finding[key], 10_000)) add(issues, `${at}.${key}`, "is required");
}

function validateReviewPair(pair, round, reportRounds, captures, coverageById, issues) {
  const label = `reviews.rounds[${Math.max(0, round - 1)}].reviews`;
  const primaryRows = pair.filter((item) => item.review.perspective === "primary");
  const freshRows = pair.filter((item) => item.review.perspective === "fresh-eyes");
  if (primaryRows.length !== 1 || freshRows.length !== 1) {
    add(issues, label, "must contain exactly one Primary and one Fresh Eyes review");
    return;
  }
  const primary = primaryRows[0];
  const fresh = freshRows[0];
  if (!isDeepStrictEqual(primary.review.input?.brief, fresh.review.input?.brief))
    add(issues, label, "Primary and Fresh Eyes must receive the same brief");
  if (
    !isDeepStrictEqual(
      primary.review.input?.design_principles,
      fresh.review.input?.design_principles
    )
  )
    add(issues, label, "Primary and Fresh Eyes must receive the same design principles");
  if (!sameStringSet(primary.inputState.captureIds, fresh.inputState.captureIds))
    add(issues, label, "Primary and Fresh Eyes must review the same rendered captures");
  if (primary.inputState.payloadSha256 === fresh.inputState.payloadSha256)
    add(issues, label, "Primary and Fresh Eyes must use distinct input payloads");
  if (primary.resultSha256 === fresh.resultSha256)
    add(issues, label, "Primary and Fresh Eyes cannot reuse the same result object");
  if (round === reportRounds) {
    const expected = (captures.captures || [])
      .filter((item) => item.active === true && coverageById.get(item.coverage_id)?.required)
      .map((item) => item.id);
    if (!sameStringSet(primary.inputState.captureIds, expected))
      add(issues, label, "final-round reviews must cover every active required capture");
  } else {
    const reviewedCoverage = new Set(
      primary.inputState.captureIds
        .map((id) => (captures.captures || []).find((item) => item.id === id)?.coverage_id)
        .filter(Boolean)
    );
    const missing = [...coverageById.values()]
      .filter((item) => item.required)
      .map((item) => item.id)
      .filter((id) => !reviewedCoverage.has(id));
    if (missing.length > 0)
      add(
        issues,
        label,
        `initial review must cover every required route row: ${missing.join(", ")}`
      );
  }
}

function validatePriorFindingRefs(state, issues) {
  for (const row of state.rows) {
    for (const [index, ref] of row.inputState.priorFindingRefs.entries()) {
      const source = state.findings.get(`${ref.review_id}:${ref.finding_id}`);
      if (!source || source.round >= row.round)
        add(
          issues,
          `reviews.${row.review.review_id}.input.prior_finding_refs[${index}]`,
          "must reference a finding from an earlier review round"
        );
    }
  }
}

function validateReconciliation(report, route, captures, reviewState, issues) {
  if (!Array.isArray(report.reconciliation)) {
    add(issues, "report.reconciliation", "must be an array");
    return;
  }
  const finalById = new Map((report.findings || []).map((finding) => [finding.id, finding]));
  const knownEvidence = new Set([
    ...(captures.captures || []).map((item) => item.id),
    ...(captures.evidence || []).map((item) => item.id),
  ]);
  const consumedSources = new Set();
  const consumedFinal = new Set();
  const ids = new Set();
  for (const [index, row] of report.reconciliation.entries()) {
    const at = `report.reconciliation[${index}]`;
    if (!object(row)) {
      add(issues, at, "must be an object");
      continue;
    }
    closed(
      row,
      [
        "id",
        "subject_id",
        "region",
        "rule",
        "coverage_ids",
        "source_finding_refs",
        "agreement",
        "disposition",
        "final_finding_id",
        "decision_evidence_ids",
        "rationale",
      ],
      at,
      issues
    );
    if (!slug(row.region) || !slug(row.rule)) add(issues, at, "region and rule must be kebab-case");
    if (!uniqueTextArray(row.coverage_ids, 100))
      add(issues, `${at}.coverage_ids`, "must be a non-empty unique array");
    const sourceRefs = Array.isArray(row.source_finding_refs) ? row.source_finding_refs : [];
    if (sourceRefs.length === 0)
      add(issues, `${at}.source_finding_refs`, "must contain source findings");
    const sources = [];
    for (const [refIndex, ref] of sourceRefs.entries()) {
      const refAt = `${at}.source_finding_refs[${refIndex}]`;
      if (!object(ref)) {
        add(issues, refAt, "must be an object");
        continue;
      }
      closed(ref, ["review_id", "finding_id"], refAt, issues);
      const key = `${ref.review_id}:${ref.finding_id}`;
      const source = reviewState.findings.get(key);
      if (!source) add(issues, refAt, "must reference a reviewer finding");
      else {
        if (consumedSources.has(key)) add(issues, refAt, "reviewer finding is reconciled twice");
        consumedSources.add(key);
        sources.push(source);
      }
    }
    const expectedId = reconciliationId(row);
    if (row.id !== expectedId || ids.has(row.id))
      add(issues, `${at}.id`, `must equal deterministic identity ${expectedId}`);
    ids.add(row.id);
    if (!RECONCILIATION_AGREEMENTS.has(row.agreement)) add(issues, `${at}.agreement`, "is invalid");
    if (!RECONCILIATION_DISPOSITIONS.has(row.disposition))
      add(issues, `${at}.disposition`, "is invalid");
    if (!boundedText(row.rationale, 10_000)) add(issues, `${at}.rationale`, "is required");
    const decisionEvidenceIds = Array.isArray(row.decision_evidence_ids)
      ? row.decision_evidence_ids
      : [];
    if (!boundedUniqueTextArray(row.decision_evidence_ids, 400, true))
      add(issues, `${at}.decision_evidence_ids`, "must be a bounded array");
    else
      for (const id of decisionEvidenceIds)
        if (!knownEvidence.has(id))
          add(issues, `${at}.decision_evidence_ids`, `unknown evidence ${id}`);
    const subjectIds = new Set(sources.map((item) => item.finding.subject_id));
    if (subjectIds.size > 1 || (subjectIds.size === 1 && !subjectIds.has(row.subject_id)))
      add(issues, `${at}.subject_id`, "must match every source finding");
    if (
      sources.some((item) => item.finding.region !== row.region || item.finding.rule !== row.rule)
    )
      add(issues, at, "canonical region and rule must match every source finding");
    const expectedCoverage = uniqueSorted(
      sources.flatMap((item) => item.finding.coverage_ids || [])
    );
    if (!sameStringSet(row.coverage_ids, expectedCoverage))
      add(issues, `${at}.coverage_ids`, "must equal the union of source finding coverage");
    const perspectives = new Set(sources.map((item) => item.perspective));
    const verdicts = new Set(
      sources.map((item) =>
        JSON.stringify([item.finding.priority, item.finding.owner, item.finding.basis])
      )
    );
    const expectedAgreement =
      perspectives.size === 1 ? "single-source" : verdicts.size === 1 ? "aligned" : "disputed";
    if (row.agreement !== expectedAgreement)
      add(issues, `${at}.agreement`, `must preserve reviewer agreement as ${expectedAgreement}`);
    const finalFinding = finalById.get(row.final_finding_id);
    if (!finalFinding) add(issues, `${at}.final_finding_id`, "must reference a final finding");
    else {
      if (consumedFinal.has(finalFinding.id))
        add(issues, `${at}.final_finding_id`, "final finding is reconciled twice");
      consumedFinal.add(finalFinding.id);
      if (
        finalFinding.subject_id !== row.subject_id ||
        finalFinding.region !== row.region ||
        finalFinding.rule !== row.rule
      )
        add(
          issues,
          `${at}.final_finding_id`,
          "final finding must match the canonical subject, region, and rule"
        );
      const sourceEvidence = uniqueSorted(
        sources.flatMap((item) => item.finding.evidence_ids || [])
      );
      const expectedEvidence = uniqueSorted([...sourceEvidence, ...decisionEvidenceIds]);
      if (!sameStringSet(finalFinding.evidence_ids, expectedEvidence))
        add(
          issues,
          `${at}.final_finding_id`,
          "final finding evidence must equal source plus decision evidence"
        );
      const worstPriority = sources
        .map((item) => item.finding.priority)
        .filter((priority) => PRIORITIES.has(priority))
        .sort((left, right) => PRIORITY_RANK[left] - PRIORITY_RANK[right])[0];
      if (worstPriority && finalFinding.priority !== worstPriority)
        add(
          issues,
          `${at}.final_finding_id`,
          `cannot lower reviewer priority below ${worstPriority}`
        );
      if (row.disposition === "dismissed") {
        if (finalFinding.status !== "dismissed")
          add(
            issues,
            `${at}.final_finding_id`,
            "dismissed reconciliation requires a dismissed final finding"
          );
        if (decisionEvidenceIds.length === 0)
          add(issues, `${at}.decision_evidence_ids`, "dismissal requires decision evidence");
        if (
          ["P0", "P1"].includes(worstPriority) &&
          !decisionEvidenceIds.some((id) => !sourceEvidence.includes(id))
        )
          add(
            issues,
            `${at}.decision_evidence_ids`,
            "dismissed P0/P1 requires new contrary evidence"
          );
      } else if (finalFinding.status === "dismissed")
        add(
          issues,
          `${at}.final_finding_id`,
          "accepted reconciliation cannot dismiss the final finding"
        );
    }
  }
  for (const key of reviewState.findings.keys())
    if (!consumedSources.has(key))
      add(issues, "report.reconciliation", `dropped reviewer finding ${key}`);
  for (const id of finalById.keys())
    if (!consumedFinal.has(id)) add(issues, "report.reconciliation", `orphan final finding ${id}`);
}

function validateScores(root, scores, route, captures, outcome, issues) {
  if (!object(scores)) return add(issues, "report.scores", "must be an object");
  const expected = new Set(SCORE_KEYS[route.mode] || []);
  const evidenceIds = new Set([
    ...(captures.captures || []).filter((item) => item.active === true).map((item) => item.id),
    ...(captures.evidence || []).map((item) => item.id),
  ]);
  for (const key of Object.keys(scores))
    if (!expected.has(key)) add(issues, `report.scores.${key}`, "is not valid for this mode");
  for (const key of expected) {
    const score = scores[key];
    if (!object(score)) {
      add(issues, `report.scores.${key}`, "must be an evidence-backed score object");
      continue;
    }
    closed(score, ["value", "rationale", "evidence_ids"], `report.scores.${key}`, issues);
    if (!Number.isInteger(score.value) || score.value < 1 || score.value > 5)
      add(issues, `report.scores.${key}.value`, "must be an integer from 1 to 5");
    else if (outcome === "passed" && score.value < PASSING_SCORE_FLOOR)
      add(
        issues,
        `report.scores.${key}.value`,
        `passed requires every score to be at least ${PASSING_SCORE_FLOOR}`
      );
    if (!text(score.rationale)) add(issues, `report.scores.${key}.rationale`, "is required");
    if (
      !Array.isArray(score.evidence_ids) ||
      score.evidence_ids.length === 0 ||
      score.evidence_ids.some((id) => !evidenceIds.has(id))
    )
      add(issues, `report.scores.${key}.evidence_ids`, "must cite known evidence");
    else {
      const requiredEvidence = requiredScoreEvidence(root, key, route, captures);
      const cited = new Set(score.evidence_ids);
      const missing = requiredEvidence.filter((id) => !cited.has(id));
      if (missing.length > 0)
        add(
          issues,
          `report.scores.${key}.evidence_ids`,
          `must cite the required ${key} evidence: ${missing.join(", ")}`
        );
    }
  }
}

function requiredScoreEvidence(root, key, route, captures) {
  const coverageById = new Map((route.coverage || []).map((item) => [item.id, item]));
  const activeCaptures = (captures.captures || []).filter((item) => item.active === true);
  const activeCaptureIds = new Set(activeCaptures.map((item) => item.id));
  const evidence = captures.evidence || [];
  const idsOfKind = (...kinds) =>
    evidence
      .filter((item) => kinds.includes(item.kind))
      .filter((item) => {
        if (
          route.schema_version !== 2 ||
          route.mode !== "product-ui" ||
          !["accessibility-tree", "dom-audit"].includes(item.kind)
        )
          return true;
        const audit = readEvidenceJson(root, item, `captures.evidence.${item.id}`, []);
        return audit?.capture_ids?.some((id) => activeCaptureIds.has(id));
      })
      .map((item) => item.id);
  if (key === "accessibility") return idsOfKind("accessibility-tree");
  if (key === "consistency")
    return route.mode === "product-ui"
      ? idsOfKind("dom-audit")
      : idsOfKind("artifact-structural", "artifact-render");
  if (key === "responsive") {
    const rendered = activeCaptures
      .filter((item) =>
        ["desktop", "tablet", "narrow", "device"].includes(
          coverageById.get(item.coverage_id)?.viewport
        )
      )
      .map((item) => item.id);
    return [
      ...rendered,
      ...(route.mode === "product-ui" ? idsOfKind("dom-audit") : idsOfKind("artifact-render")),
    ];
  }
  if (key === "state-clarity") return activeCaptures.map((item) => item.id);
  if (key === "print-navigation") {
    return [
      ...activeCaptures
        .filter((item) => coverageById.get(item.coverage_id)?.viewport === "print")
        .map((item) => item.id),
      ...idsOfKind("artifact-structural", "artifact-render"),
    ];
  }
  return activeCaptures.map((item) => item.id);
}

function validateFindings(findings, route, captures, outcome, issues) {
  if (!Array.isArray(findings)) return add(issues, "report.findings", "must be an array");
  const captureById = new Map((captures.captures || []).map((item) => [item.id, item]));
  const evidenceById = new Map((captures.evidence || []).map((item) => [item.id, item]));
  const coverageById = new Map((route.coverage || []).map((item) => [item.id, item]));
  const ids = new Set();
  for (const [index, finding] of findings.entries()) {
    const at = `report.findings[${index}]`;
    if (!object(finding)) {
      add(issues, at, "must be an object");
      continue;
    }
    closed(
      finding,
      [
        "id",
        "subject_id",
        "region",
        "rule",
        "evidence_ids",
        "priority",
        "status",
        "owner",
        "summary",
        "remediation",
        "before_capture_id",
        "after_capture_id",
        "defer_reason",
        "defer_owner",
      ],
      at,
      issues
    );
    const expectedId = findingId(finding);
    if (finding.id !== expectedId || ids.has(finding.id))
      add(issues, `${at}.id`, `must equal deterministic identity ${expectedId}`);
    ids.add(finding.id);
    if (!PRIORITIES.has(finding.priority)) add(issues, `${at}.priority`, "is invalid");
    if (!FINDING_STATUSES.has(finding.status)) add(issues, `${at}.status`, "is invalid");
    if (!["design-critique", "qa", "review"].includes(finding.owner))
      add(issues, `${at}.owner`, "is invalid");
    if (
      !text(finding.subject_id) ||
      !text(finding.region) ||
      !text(finding.rule) ||
      !text(finding.summary) ||
      !text(finding.remediation)
    )
      add(issues, at, "requires subject_id, region, rule, summary, and remediation");
    if (!(route.subjects || []).some((subject) => subject.id === finding.subject_id))
      add(issues, `${at}.subject_id`, "must reference a route subject");
    if (!Array.isArray(finding.evidence_ids) || finding.evidence_ids.length === 0)
      add(issues, `${at}.evidence_ids`, "must cite evidence");
    else
      for (const id of finding.evidence_ids) {
        if (!captureById.has(id) && !evidenceById.has(id))
          add(issues, `${at}.evidence_ids`, `unknown evidence ${id}`);
        else {
          const citedSubject = captureById.has(id)
            ? coverageById.get(captureById.get(id).coverage_id)?.subject_id
            : evidenceById.get(id)?.subject_id;
          if (citedSubject !== finding.subject_id)
            add(
              issues,
              `${at}.evidence_ids`,
              `evidence ${id} belongs to subject ${citedSubject || "unknown"}, not ${finding.subject_id}`
            );
        }
      }
    if (["P0", "P1"].includes(finding.priority) && finding.status === "resolved") {
      const before = captureById.get(finding.before_capture_id);
      const after = captureById.get(finding.after_capture_id);
      const requiresPixelIdentity =
        route.schema_version === 2 &&
        route.mode === "product-ui" &&
        before?.kind === "screenshot" &&
        after?.kind === "screenshot";
      const subjectCoverage = new Set(
        (route.coverage || [])
          .filter((item) => item.subject_id === finding.subject_id)
          .map((item) => item.id)
      );
      if (
        !before ||
        !after ||
        before.sha256 === after.sha256 ||
        (requiresPixelIdentity &&
          (!sha256(before.pixel_sha256) ||
            !sha256(after.pixel_sha256) ||
            before.pixel_sha256 === after.pixel_sha256)) ||
        before.coverage_id !== after.coverage_id ||
        !subjectCoverage.has(before.coverage_id) ||
        before.active !== false ||
        after.active !== true ||
        !Number.isInteger(before.round) ||
        !Number.isInteger(after.round) ||
        before.round >= after.round ||
        !finding.evidence_ids.includes(before.id) ||
        !finding.evidence_ids.includes(after.id)
      )
        add(
          issues,
          at,
          "resolved P0/P1 requires distinct before and after capture hashes, including decoded pixels for product UI"
        );
    }
    if (
      finding.status === "deferred" &&
      (!text(finding.defer_reason) || !text(finding.defer_owner))
    )
      add(issues, at, "deferred findings require reason and owner");
  }
  if (
    outcome === "passed" &&
    findings.some(
      (f) =>
        f.owner === "design-critique" &&
        ["P0", "P1"].includes(f.priority) &&
        ["open", "deferred", "dismissed"].includes(f.status)
    )
  )
    add(
      issues,
      "report.outcome",
      "passed cannot contain open or deferred P0/P1 findings, or dismissed Design Critique P0/P1 findings"
    );
}

function validateCaptureBytes(root, item, label, issues) {
  if (!object(item) || !text(item.path)) return;
  const file = readBoundFile(root, item.path, `${label}.path`, []);
  if (!file) return;
  try {
    if (item.kind === "screenshot") {
      const dimensions = inspectPngVisualBytes(file.bytes);
      if (dimensions.width !== item.width || dimensions.height !== item.height)
        add(
          issues,
          label,
          `declared dimensions must equal ${dimensions.width}x${dimensions.height}`
        );
      return dimensions;
    }
    if (item.kind === "pdf") {
      const inspected = inspectPdfBytes(file.bytes);
      if (!positiveInt(item.pages) || item.pages !== inspected.pages)
        add(issues, label, `declared pages must equal ${inspected.pages}`);
      return inspected;
    }
  } catch (error) {
    add(issues, label, error.message);
  }
}

function validateProductUiViewport(
  item,
  coverage,
  subjects,
  mode,
  routeSchemaVersion,
  decoded,
  label,
  issues
) {
  if (mode !== "product-ui" || routeSchemaVersion !== 2 || !coverage) return;
  if (item.kind !== "screenshot") {
    add(issues, `${label}.kind`, "product UI coverage requires a screenshot");
    return;
  }
  if (!decoded || !positiveInt(decoded.width)) return;
  if (!sha256(item.pixel_sha256) || item.pixel_sha256 !== decoded.pixelSha256)
    add(issues, `${label}.pixel_sha256`, "must equal the canonical decoded-pixel SHA-256");
  if (
    decoded.pixelSha256 === null ||
    decoded.visiblePixels === null ||
    decoded.hasVisualVariation === null
  )
    add(issues, label, "product UI screenshots must use 8-bit grayscale, RGB, or RGBA pixels");
  else {
    const visibleRatio = decoded.visiblePixels / decoded.totalPixels;
    if (visibleRatio < MIN_VISIBLE_PIXEL_RATIO)
      add(
        issues,
        label,
        `product UI screenshot visible pixels must cover at least ${Math.round(MIN_VISIBLE_PIXEL_RATIO * 100)}% of the image`
      );
    if (!decoded.hasVisualVariation)
      add(issues, label, "product UI screenshot must contain non-uniform visible content");
  }
  const platform = subjects.get(coverage.subject_id)?.platform;
  const bounds =
    platform === "web"
      ? PRODUCT_UI_WEB_VIEWPORT_WIDTHS[coverage.viewport]
      : platform === "mobile" && coverage.viewport === "device"
        ? PRODUCT_UI_DEVICE_BOUNDS
        : null;
  if (!bounds) return;
  const surface = platform === "web" ? "web" : "product UI";
  if (bounds.min && decoded.width < bounds.min)
    add(
      issues,
      label,
      `${coverage.viewport} ${surface} capture width must be at least ${bounds.min} pixels; decoded width is ${decoded.width}`
    );
  if (bounds.max && decoded.width > bounds.max)
    add(
      issues,
      label,
      `${coverage.viewport} ${surface} capture width must be at most ${bounds.max} pixels; decoded width is ${decoded.width}`
    );
  if (bounds.minHeight && decoded.height < bounds.minHeight)
    add(
      issues,
      label,
      `${coverage.viewport} product UI capture height must be at least ${bounds.minHeight} pixels; decoded height is ${decoded.height}`
    );
}

function validateHumanReport(
  root,
  human,
  report,
  reportFile,
  capturesFile,
  reviewsFile,
  reviewState,
  options,
  issues
) {
  if (!object(human) || !text(human.path))
    return add(issues, "report.human_report", "requires an HTML path");
  const htmlFile = readBoundFile(root, human.path, "report.human_report.path", issues);
  if (!htmlFile) return;
  const inspection = inspectHtmlArtifact(htmlFile.bytes, { expectedKind: "report" });
  for (const item of inspection.issues || [])
    add(issues, `report.human_report${item.path || ""}`, item.message);
  const metadata = inspection.metadata;
  if (!metadata) return;
  if (
    metadata.generator?.name !== "pm:design-critique" ||
    metadata.generator?.version !== PLUGIN_VERSION
  )
    add(
      issues,
      "report.human_report",
      `metadata generator must be pm:design-critique ${PLUGIN_VERSION}`
    );
  if (
    metadata.source?.path !== reportFile.relative ||
    metadata.source?.sha256 !== `sha256:${reportFile.sha256}`
  )
    add(issues, "report.human_report", "metadata source must bind the exact report JSON");
  if (
    !(metadata.evidence || []).some(
      (item) =>
        item.path === capturesFile.relative && item.sha256 === `sha256:${capturesFile.sha256}`
    )
  )
    add(issues, "report.human_report", "metadata evidence must bind the exact captures manifest");
  if (
    report.schema_version === 2 &&
    (!reviewsFile ||
      !(metadata.evidence || []).some(
        (item) =>
          item.path === reviewsFile.relative && item.sha256 === `sha256:${reviewsFile.sha256}`
      ))
  )
    add(issues, "report.human_report", "metadata evidence must bind the exact reviews manifest");
  const rawHtml = htmlFile.bytes.toString("utf8");
  const html = structuralMarkup(rawHtml);
  const css = [...rawHtml.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((match) => match[1])
    .join("\n");
  const outcome = visibleMarker(html, { "data-dc-outcome": report.outcome }, css);
  if (!outcome || normalizeVisible(outcome.text).toLowerCase() !== report.outcome)
    add(issues, "report.human_report", "visible outcome marker must match report JSON");
  const coverage = visibleMarker(
    html,
    {
      "data-dc-coverage": String(report.coverage?.percent),
    },
    css
  );
  if (!coverage || !normalizeVisible(coverage.text).includes(`${report.coverage?.percent}%`))
    add(issues, "report.human_report", "visible coverage marker must match report JSON");
  const nextAction = visibleMarker(
    html,
    {
      "data-dc-next-action-sha256": digest(Buffer.from(report.next_action || "")),
    },
    css
  );
  if (
    !nextAction ||
    !normalizeVisible(nextAction.text).includes(normalizeVisible(report.next_action))
  )
    add(issues, "report.human_report", "visible next action must match report JSON");
  const topIssue = visibleMarker(
    html,
    {
      "data-dc-top-issue-sha256": digest(Buffer.from(report.top_issue || "")),
    },
    css
  );
  if (!topIssue || !normalizeVisible(topIssue.text).includes(normalizeVisible(report.top_issue)))
    add(issues, "report.human_report", "visible top issue must match report JSON");
  for (const [key, score] of Object.entries(report.scores || {})) {
    const marker = visibleMarker(
      html,
      {
        "data-dc-score-key": key,
        "data-dc-score-value": score.value,
      },
      css
    );
    if (!marker || !normalizeVisible(marker.text).includes(normalizeVisible(score.rationale)))
      add(issues, "report.human_report", `visible score ${key} must match report JSON`);
  }
  for (const finding of report.findings || []) {
    const projection = findingProjection(finding);
    const marker = visibleMarker(
      html,
      {
        "data-dc-finding-id": finding.id,
        "data-dc-finding-priority": finding.priority,
        "data-dc-finding-status": finding.status,
        "data-dc-finding-sha256": digest(Buffer.from(JSON.stringify(projection))),
      },
      css
    );
    const visibleText = normalizeVisible(marker?.text || "");
    if (
      !marker ||
      ![finding.summary, finding.remediation, finding.owner, ...finding.evidence_ids].every(
        (value) => visibleText.includes(normalizeVisible(value))
      )
    )
      add(issues, "report.human_report", `missing visible finding ${finding.id}`);
  }
  for (const row of reviewState?.rows || []) {
    const projection = reviewProjection(row);
    const marker = visibleMarker(
      html,
      {
        "data-dc-review-id": row.review.review_id,
        "data-dc-perspective": row.review.perspective,
        "data-dc-review-sha256": digest(Buffer.from(canonicalJson(projection))),
      },
      css
    );
    const visibleText = normalizeVisible(marker?.text || "");
    if (
      !marker ||
      ![
        row.review.perspective,
        row.review.execution?.runtime?.model,
        reviewSummary(row.review),
        String(row.resultState.findings.length),
      ].every((value) => visibleText.includes(normalizeVisible(value)))
    )
      add(issues, "report.human_report", `missing visible review ${row.review.review_id}`);
  }
  for (const row of Array.isArray(report.reconciliation) ? report.reconciliation : []) {
    const projection = reconciliationProjection(row);
    const marker = visibleMarker(
      html,
      {
        "data-dc-reconciliation-id": row.id,
        "data-dc-reconciliation-sha256": digest(Buffer.from(canonicalJson(projection))),
      },
      css
    );
    const visibleText = normalizeVisible(marker?.text || "");
    if (
      !marker ||
      ![
        row.agreement,
        row.disposition,
        row.rationale,
        row.final_finding_id,
        ...(Array.isArray(row.source_finding_refs) ? row.source_finding_refs : []).map(
          (ref) => `${ref?.review_id}:${ref?.finding_id}`
        ),
      ].every((value) => visibleText.includes(normalizeVisible(value)))
    )
      add(issues, "report.human_report", `missing visible reconciliation ${row.id}`);
  }
  if (options.verifyBrowser !== false) {
    try {
      const markers = options.markerProbe
        ? options.markerProbe(htmlFile.path)
        : probeDataMarkerVisibility(
            resolveBrowser(options.browserPath),
            htmlFile.path,
            path.dirname(htmlFile.path)
          );
      validateRenderedMarkers(markers, report, reviewState, issues);
    } catch (error) {
      add(
        issues,
        "report.human_report",
        `cannot verify rendered marker visibility: ${error.message}`
      );
    }
  }
}

function validateRenderedMarkers(markers, report, reviewState, issues) {
  const expected = [
    {
      attributes: { "data-dc-outcome": report.outcome },
      exactText: report.outcome,
      firstScreen: true,
    },
    {
      attributes: { "data-dc-coverage": String(report.coverage?.percent) },
      requiredText: [`${report.coverage?.percent}%`],
      firstScreen: true,
    },
    {
      attributes: {
        "data-dc-top-issue-sha256": digest(Buffer.from(report.top_issue || "")),
      },
      requiredText: [report.top_issue],
      firstScreen: true,
    },
    {
      attributes: {
        "data-dc-next-action-sha256": digest(Buffer.from(report.next_action || "")),
      },
      requiredText: [report.next_action],
      firstScreen: true,
    },
    ...Object.entries(report.scores || {}).map(([key, score]) => ({
      attributes: {
        "data-dc-score-key": key,
        "data-dc-score-value": String(score.value),
      },
      requiredText: [score.rationale],
    })),
    ...(report.findings || []).map((finding) => ({
      attributes: {
        "data-dc-finding-id": finding.id,
        "data-dc-finding-priority": finding.priority,
        "data-dc-finding-status": finding.status,
        "data-dc-finding-sha256": digest(Buffer.from(JSON.stringify(findingProjection(finding)))),
      },
      requiredText: [finding.summary, finding.remediation, finding.owner, ...finding.evidence_ids],
    })),
    ...(reviewState?.rows || []).map((row) => ({
      attributes: {
        "data-dc-review-id": row.review.review_id,
        "data-dc-perspective": row.review.perspective,
        "data-dc-review-sha256": digest(Buffer.from(canonicalJson(reviewProjection(row)))),
      },
      requiredText: [
        row.review.perspective,
        row.review.execution?.runtime?.model,
        reviewSummary(row.review),
        String(row.resultState.findings.length),
      ],
    })),
    ...(Array.isArray(report.reconciliation) ? report.reconciliation : []).map((row) => ({
      attributes: {
        "data-dc-reconciliation-id": row.id,
        "data-dc-reconciliation-sha256": digest(
          Buffer.from(canonicalJson(reconciliationProjection(row)))
        ),
      },
      requiredText: [
        row.agreement,
        row.disposition,
        row.rationale,
        row.final_finding_id,
        ...(Array.isArray(row.source_finding_refs) ? row.source_finding_refs : []).map(
          (ref) => `${ref?.review_id}:${ref?.finding_id}`
        ),
      ],
    })),
  ];
  for (const item of expected) {
    const { attributes } = item;
    const matches = markers.filter((marker) =>
      Object.entries(attributes).every(([name, value]) => marker.attributes?.[name] === value)
    );
    const renderedText = normalizeVisible(
      (item.firstScreen ? matches[0]?.firstScreenText : matches[0]?.text) || ""
    );
    const textMatches = item.exactText
      ? renderedText.toLowerCase() === normalizeVisible(item.exactText).toLowerCase()
      : (item.requiredText || []).every((value) =>
          renderedText.includes(normalizeVisible(value || ""))
        );
    if (
      matches.length !== 1 ||
      matches[0].visible !== true ||
      (item.firstScreen && matches[0].inViewport !== true) ||
      !textMatches
    )
      add(
        issues,
        "report.human_report",
        `rendered marker ${JSON.stringify(attributes)} must exist exactly once with matching visible text${item.firstScreen ? " in the first screenful" : ""}`
      );
  }
}

function hasDataValue(html, attribute, value) {
  const escaped = String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${attribute}=["']${escaped}["']`, "i").test(html);
}

function visibleMarker(html, attributes, css) {
  const firstAttribute = Object.keys(attributes)[0];
  const pattern = new RegExp(
    `<([a-z][a-z0-9-]*)\\b(?=[^>]*\\b${firstAttribute}=["'])[^>]*>([\\s\\S]*?)<\\/\\1>`,
    "gi"
  );
  for (const match of String(html).matchAll(pattern)) {
    const opening = match[0].slice(0, match[0].indexOf(">") + 1);
    if (!Object.entries(attributes).every(([name, value]) => hasDataValue(opening, name, value)))
      continue;
    if (hiddenMarkup(opening, css) || hiddenAncestorAt(html, match.index, css)) continue;
    const visibleInner = removeHiddenSubtrees(match[2], css);
    const textValue = visibleInner.replace(/<[^>]+>/g, " ");
    if (normalizeVisible(textValue)) return { text: textValue };
  }
  return null;
}

function hiddenAncestorAt(html, targetIndex, css) {
  const stack = [];
  const voidTags = new Set([
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "source",
    "track",
    "wbr",
  ]);
  for (const match of html.slice(0, targetIndex).matchAll(/<\/?([a-z][a-z0-9-]*)\b[^>]*>/gi)) {
    const token = match[0];
    const name = match[1].toLowerCase();
    if (token.startsWith("</")) {
      const index = stack.map((item) => item.name).lastIndexOf(name);
      if (index >= 0) stack.splice(index);
    } else if (!token.endsWith("/>") && !voidTags.has(name)) {
      stack.push({ name, hidden: hiddenMarkup(token, css) });
    }
  }
  return stack.some((item) => item.hidden);
}

function hiddenMarkup(opening, css) {
  if (
    /\bhidden(?:\s|=|\/?>)|\baria-hidden=["']true["']|style=["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0)/i.test(
      opening
    )
  )
    return true;
  const classes =
    opening
      .match(/\bclass=["']([^"']*)["']/i)?.[1]
      ?.split(/\s+/)
      .filter(Boolean) || [];
  const id = opening.match(/\bid=["']([^"']+)["']/i)?.[1];
  return [
    ...classes.map((value) => `\\.${escapeRegex(value)}`),
    ...(id ? [`#${escapeRegex(id)}`] : []),
  ].some((selector) =>
    new RegExp(
      `${selector}(?:[^,{]*)\\{[^}]*(?:display\\s*:\\s*none|visibility\\s*:\\s*hidden|opacity\\s*:\\s*0)`,
      "i"
    ).test(css)
  );
}

function removeHiddenSubtrees(html, css) {
  let output = String(html);
  let previous;
  do {
    previous = output;
    output = output.replace(
      /<([a-z][a-z0-9-]*)\b([^>]*)>([\s\S]*?)<\/\1>/gi,
      (whole, name, attrs) => (hiddenMarkup(`<${name}${attrs}>`, css) ? "" : whole)
    );
  } while (output !== previous);
  return output;
}

function normalizeVisible(value) {
  return String(value)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findingProjection(finding) {
  return {
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
}

function reviewSummary(review) {
  return review?.perspective === "primary"
    ? review.result?.summary || ""
    : review?.result?.first_impression || "";
}

function reviewProjection(row) {
  return {
    review_id: row.review.review_id,
    perspective: row.review.perspective,
    round: row.round,
    execution_mode: row.review.execution?.mode,
    model: row.review.execution?.runtime?.model,
    summary: reviewSummary(row.review),
    finding_count: row.resultState.findings.length,
  };
}

function reconciliationProjection(row) {
  return {
    id: row.id,
    agreement: row.agreement,
    disposition: row.disposition,
    rationale: row.rationale,
    source_finding_refs: Array.isArray(row.source_finding_refs) ? row.source_finding_refs : [],
    final_finding_id: row.final_finding_id,
  };
}

function deriveTopIssue(report) {
  const priority = { P0: 0, P1: 1, P2: 2, P3: 3 };
  const unresolved = (report.findings || [])
    .filter(
      (finding) =>
        finding.owner === "design-critique" && ["open", "deferred"].includes(finding.status)
    )
    .sort(
      (left, right) =>
        priority[left.priority] - priority[right.priority] || left.id.localeCompare(right.id)
    );
  if (unresolved[0]) return unresolved[0].summary;
  if (report.outcome !== "passed" && text(report.reason)) return report.reason;
  return "No unresolved design issue.";
}

function findingId(finding) {
  const material = JSON.stringify([
    finding.subject_id || "",
    finding.region || "",
    finding.rule || "",
    [...(finding.evidence_ids || [])].sort(),
  ]);
  return `dc-${crypto.createHash("sha256").update(material).digest("hex").slice(0, 16)}`;
}

function reviewFindingId(reviewIdValue, finding) {
  const material = canonicalJson([
    reviewIdValue || "",
    finding.subject_id || "",
    finding.region || "",
    finding.rule || "",
    uniqueSorted(finding.coverage_ids || []),
    uniqueSorted(finding.evidence_ids || []),
  ]);
  return `drf-${crypto.createHash("sha256").update(material).digest("hex").slice(0, 16)}`;
}

function reconciliationId(row) {
  const refs = (Array.isArray(row.source_finding_refs) ? row.source_finding_refs : [])
    .map((ref) => [ref?.review_id || "", ref?.finding_id || ""])
    .sort((left, right) => `${left[0]}:${left[1]}`.localeCompare(`${right[0]}:${right[1]}`));
  const material = canonicalJson([
    row.subject_id || "",
    row.region || "",
    row.rule || "",
    uniqueSorted(row.coverage_ids || []),
    refs,
  ]);
  return `dcr-${crypto.createHash("sha256").update(material).digest("hex").slice(0, 16)}`;
}

function reviewId(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9._:-]{2,127}$/.test(value);
}

function boundedText(value, max) {
  return text(value) && Buffer.byteLength(value, "utf8") <= max;
}

function uniqueTextArray(value, maxLength) {
  return boundedUniqueTextArray(value, maxLength, false);
}

function boundedUniqueTextArray(value, maxLength, allowEmpty) {
  return (
    Array.isArray(value) &&
    (allowEmpty || value.length > 0) &&
    value.length <= maxLength &&
    value.every((item) => boundedText(item, 500)) &&
    new Set(value).size === value.length
  );
}

function uniqueSorted(value) {
  const items = Array.isArray(value) ? value : [];
  return [...new Set(items.filter((item) => typeof item === "string"))].sort();
}

function sameStringSet(left, right) {
  return isDeepStrictEqual(uniqueSorted(left), uniqueSorted(right));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (object(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value === undefined ? null : value);
}

function readJsonFile(root, rel, label, issues) {
  const file = readBoundFile(root, rel, label, issues);
  if (!file) return null;
  if (file.bytes.length > MAX_JSON_BYTES) {
    add(issues, label, `JSON exceeds ${MAX_JSON_BYTES} bytes`);
    return null;
  }
  try {
    return { ...file, value: JSON.parse(file.bytes.toString("utf8")) };
  } catch (error) {
    add(issues, label, `invalid JSON: ${error.message}`);
    return null;
  }
}

function readBoundFile(root, rel, label, issues, maxBytes = MAX_EVIDENCE_BYTES) {
  if (!text(rel) || path.isAbsolute(rel)) {
    add(issues, label, "must be a relative path");
    return null;
  }
  const resolved = path.resolve(root, rel);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    add(issues, label, "escapes the project root");
    return null;
  }
  try {
    const cacheKey = path.relative(root, resolved).split(path.sep).join("/");
    const cached = activeReadCache?.files.get(cacheKey);
    if (cached && cached.bytes.length > maxBytes)
      throw new Error(`input exceeds ${maxBytes}-byte budget`);
    const loaded = cached || readProjectInput(root, cacheKey, maxBytes);
    const file = cached || { path: loaded.path, bytes: loaded.bytes };
    if (!cached) {
      file.sha256 = digest(file.bytes);
      if (activeReadCache) {
        if (activeReadCache.bytes + file.bytes.length > MAX_CACHE_BYTES)
          throw new Error(`aggregate evidence exceeds the ${MAX_CACHE_BYTES}-byte cache budget`);
        activeReadCache.files.set(cacheKey, file);
        activeReadCache.bytes += file.bytes.length;
      }
    }
    return { ...file, relative: cacheKey };
  } catch (error) {
    const message = /^input exceeds (\d+)-byte budget$/.test(error.message)
      ? error.message.replace(
          /^input exceeds (\d+)-byte budget$/,
          "exceeds the $1-byte evidence budget"
        )
      : error.message;
    add(issues, label, message);
    return null;
  }
}

function validateFileBinding(root, binding, label, issues) {
  if (!object(binding) || !sha256(binding.sha256))
    return add(issues, label, "requires path and SHA-256");
  const file = readBoundFile(root, binding.path, `${label}.path`, issues);
  if (file && file.sha256 !== binding.sha256)
    add(issues, `${label}.sha256`, "does not match file bytes");
}

function validateBinding(binding, file, label, issues) {
  if (!object(binding) || binding.path !== file.relative || binding.sha256 !== file.sha256)
    add(issues, label, `must bind ${file.relative} at ${file.sha256}`);
}

function digest(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}
function realPathMaybe(value) {
  if (!text(value)) return "";
  try {
    return fs.realpathSync(path.resolve(value));
  } catch {
    return path.resolve(value);
  }
}
function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function slug(value) {
  return typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}
function sha(value) {
  return typeof value === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
}
function sha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function positiveInt(value) {
  return Number.isInteger(value) && value > 0;
}
function add(issues, pathName, message) {
  issues.push({ path: pathName, message });
}
function closed(value, allowed, pathName, issues) {
  const fields = new Set(allowed);
  for (const key of Object.keys(value || {}))
    if (!fields.has(key)) add(issues, `${pathName}.${key}`, "unknown field");
}

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const key = {
      "--root": "root",
      "--route": "routePath",
      "--captures": "capturesPath",
      "--report": "reportPath",
      "--commit": "commit",
      "--base": "baseRef",
      "--base-commit": "baseCommit",
      "--browser": "browserPath",
    }[arg];
    if (!key) throw new Error(`unknown argument ${arg}`);
    if (!argv[index + 1] || argv[index + 1].startsWith("--"))
      throw new Error(`${arg} requires a value`);
    out[key] = argv[++index];
  }
  for (const key of ["routePath", "capturesPath", "reportPath", "commit", "baseRef", "baseCommit"])
    if (!out[key]) throw new Error(`missing required ${key}`);
  return out;
}

function main() {
  try {
    const result = checkDesignCritique(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}

if (require.main === module) main();

module.exports = { checkDesignCritique, findingId, reconciliationId, reviewFindingId };
