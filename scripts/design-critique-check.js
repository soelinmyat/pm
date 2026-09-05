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
const { compareRfc3339DateTimes, isRfc3339DateTime } = require("./lib/iso-time");
const {
  PRODUCT_UI_VISUAL_THRESHOLDS,
  inspectPdfBytes,
  inspectPngHeaderBytes,
  inspectPngVisualBytes,
  visualDifference,
} = require("./lib/media-inspect");
const { isManagedCaptureMemberPath } = require("./lib/design-critique-capture-path");
const { createProjectInputVerificationContext, readProjectInput } = require("./lib/project-file");
const { MAX_RAW_AUDIT_BYTES, normalizeAuditBytes } = require("./design-critique-audit-normalize");
const {
  ACQUISITION_METHOD: TRUSTED_CAPTURE_ACQUISITION,
  BROWSER_ARGS_PROFILE: TRUSTED_CAPTURE_BROWSER_PROFILE,
  CAPTURE_ASSURANCE: TRUSTED_CAPTURE_ASSURANCE,
  browserIdentity,
  captureVisualMetrics,
  manifestShape: validateCaptureManifestShape,
  validateAssertionVisibility,
  validateStateAssertion,
  validateSurfacePattern,
  validateUrlIdentity,
  validateViewport,
  urlMatchesSurface,
} = require("./design-critique-capture");
const { version: PLUGIN_VERSION } = require("../plugin.config.json");

const MODES = new Set(["product-ui", "pm-artifact"]);
const ROUTE_SCHEMA_VERSIONS = new Set([1, 2]);
const OUTCOMES = new Set(["passed", "failed", "blocked", "deferred"]);
const PRIORITIES = new Set(["P0", "P1", "P2", "P3"]);
const PRIORITY_RANK = Object.freeze({ P0: 0, P1: 1, P2: 2, P3: 3 });
const FINDING_STATUSES = new Set(["open", "resolved", "deferred", "dismissed"]);
const REVIEW_PERSPECTIVES = new Set(["primary", "fresh-eyes"]);
const REVIEW_EXECUTION_MODES = new Set(["delegated", "same-runtime-isolated"]);
const REVIEW_ASSURANCE = "workflow-attested-non-cryptographic";
const REVIEW_BASES = new Set(["objective", "craft", "uncertain"]);
const REVIEW_CONFIDENCE = new Set(["high", "medium", "low"]);
const FRESH_INTERFACE_TERM = new RegExp(
  String.raw`\b(?:badge|banner|breadcrumb|button|card|chart|column|dialog|field|footer|form|header|heading|icon|image|input|label|link|list|menu|message|modal|navigation|panel|row|sidebar|tab|table|title)s?\b`,
  "i"
);
const FRESH_VISUAL_DETAIL_TERM = new RegExp(
  String.raw`\b(?:above|adjacent|after|aligned|alignment|background|before|below|beneath|beside|between|blue|bold|border|bottom|bright|centered|column|contrast|cropped|dark|dense|disabled|evenly|first|focused|gray|green|grey|grid|grouped|hidden|hierarchy|inside|larger|left|light|margin|misaligned|muted|narrow|near|next to|order|overlap|overflow|padding|placement|position|prominent|red|right|scale|second|separated|short|smaller|spacing|stacked|subordinate|tall|top|truncated|weight|whitespace|wide|wrapped)\b`,
  "i"
);
const FRESH_PLACEHOLDER_PROSE = new RegExp(
  String.raw`(?:\b(?:current )?rendered evidence\b|\bwas inspected directly\b|\bshows?\s+\S+\s+with clear purpose\b|\b(?:looks|is|are)(?:\s+\w+){0,2}\s+(?:good|clear|consistent)\b)`,
  "i"
);
const RECONCILIATION_AGREEMENTS = new Set(["single-source", "aligned", "disputed"]);
const RECONCILIATION_DISPOSITIONS = new Set(["accepted", "dismissed"]);
const VIEWPORTS = new Set(["desktop", "tablet", "narrow", "device", "print"]);
const PRODUCT_UI_WEB_VIEWPORTS = new Set(["desktop", "tablet", "narrow"]);
const PRODUCT_UI_DEVICE_BOUNDS = Object.freeze({ min: 240, minHeight: 400 });
const {
  minVisiblePixelRatio: MIN_VISIBLE_PIXEL_RATIO,
  minMeaningfulPixelRatio: MIN_MEANINGFUL_PIXEL_RATIO,
  minMeaningfulTileRatio: MIN_MEANINGFUL_TILE_RATIO,
  minLuminanceRange: MIN_LUMINANCE_RANGE,
  minVisualDistance: MIN_CROSS_STATE_VISUAL_DISTANCE,
  minChangedTileRatio: MIN_CROSS_STATE_CHANGED_TILE_RATIO,
} = PRODUCT_UI_VISUAL_THRESHOLDS;
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
const MAX_ROUTE_SUBJECTS = 100;
const MAX_ROUTE_COVERAGE_ROWS = 1_000;
const MAX_CAPTURE_ROWS = MAX_ROUTE_COVERAGE_ROWS * 2;
const MAX_RULE_DIAGNOSTICS = 25;
const MAX_NETWORK_ORIGINS = 100;
const MAX_NETWORK_REQUESTS = 2_000;
const MAX_EVIDENCE_BYTES = 64 * 1024 * 1024;
const MAX_JSON_BYTES = 4 * 1024 * 1024;
const MAX_CACHE_BYTES = 256 * 1024 * 1024;
const EMPTY_SHA256 = crypto.createHash("sha256").update(Buffer.alloc(0)).digest("hex");
const TRUSTED_CAPTURE_PRODUCER = "pm:design-critique-capture";
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
  activeReadCache = {
    files: new Map(),
    bytes: 0,
    browsers: new Map(),
    media: new Map(),
    rowIndexes: new WeakMap(),
    projectInputVerificationContext: createProjectInputVerificationContext(),
  };
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

  const rawRoute = routeFile.value;
  const rawCaptures = capturesFile.value;
  const report = reportFile.value;
  validateRawCollectionCardinality(rawRoute, rawCaptures, issues);
  const { route, captures } = boundedInputViews(rawRoute, rawCaptures);
  const reviewsFile =
    report?.schema_version === 2 && object(report.reviews) && text(report.reviews.path)
      ? readJsonFile(root, report.reviews.path, "reviews", issues)
      : null;
  const gitIdentity =
    options.verifyGit === false
      ? { commit: options.commit, baseRef: options.baseRef, baseCommit: options.baseCommit }
      : resolveGitIdentity(root, options, issues);
  const currentSource =
    options.verifyGit === false ? null : currentGitTreeIdentity(root, "before", issues);
  validateRoute(route, gitIdentity.commit, gitIdentity.baseRef, gitIdentity.baseCommit, issues);
  if (options.verifyGit !== false)
    validateDiffIdentity(root, route, gitIdentity.baseCommit, issues);
  validateCaptures(root, captures, route, routeFile, { options, currentSource }, issues);
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
  if (shouldVerifyCaptureBrowser(options)) finalizeBrowserIdentities(issues);
  if (options.verifyGit !== false) {
    const sourceAfter = currentGitTreeIdentity(root, "after", issues);
    if (currentSource && sourceAfter && !isDeepStrictEqual(currentSource, sourceAfter))
      add(
        issues,
        "git",
        "Git HEAD, tree, or tracked status changed while checking trusted capture evidence"
      );
  }
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

function validateRawCollectionCardinality(route, captures, issues) {
  if (!object(route)) add(issues, "route", "must be an object");
  if (
    !Array.isArray(route?.subjects) ||
    route.subjects.length < 1 ||
    route.subjects.length > MAX_ROUTE_SUBJECTS
  )
    add(issues, "route.subjects", `must contain 1 through ${MAX_ROUTE_SUBJECTS} subjects`);
  else validateCollectionRowObjects(route.subjects, "route.subjects", issues);
  if (
    !Array.isArray(route?.coverage) ||
    route.coverage.length < 1 ||
    route.coverage.length > MAX_ROUTE_COVERAGE_ROWS
  )
    add(issues, "route.coverage", `must contain 1 through ${MAX_ROUTE_COVERAGE_ROWS} rows`);
  else validateCollectionRowObjects(route.coverage, "route.coverage", issues);
  if (!Array.isArray(captures?.captures)) add(issues, "captures.captures", "must be an array");
  else if (captures.captures.length > MAX_CAPTURE_ROWS)
    add(
      issues,
      "captures.captures",
      `must contain at most ${MAX_CAPTURE_ROWS} rows for ${MAX_ROUTE_COVERAGE_ROWS} coverage decisions and two rounds`
    );
  else validateCollectionRowObjects(captures.captures, "captures.captures", issues);
  if (!object(captures)) add(issues, "captures", "must be an object");
}

function validateCollectionRowObjects(rows, label, issues) {
  let invalidCount = 0;
  let emittedDiagnostics = 0;
  for (const [index, row] of rows.entries()) {
    if (object(row)) continue;
    invalidCount += 1;
    if (emittedDiagnostics < MAX_RULE_DIAGNOSTICS - 1) {
      add(issues, `${label}[${index}]`, "must be an object");
      emittedDiagnostics += 1;
    }
  }
  if (invalidCount > emittedDiagnostics)
    add(
      issues,
      label,
      `${invalidCount - emittedDiagnostics} additional non-object rows omitted after ${emittedDiagnostics} indexed diagnostics`
    );
}

function boundedInputViews(route, captures) {
  return {
    route: object(route)
      ? {
          ...route,
          subjects: boundedArrayView(route.subjects, MAX_ROUTE_SUBJECTS),
          coverage: boundedArrayView(route.coverage, MAX_ROUTE_COVERAGE_ROWS),
        }
      : { subjects: [], coverage: [] },
    captures: object(captures)
      ? { ...captures, captures: boundedArrayView(captures.captures, MAX_CAPTURE_ROWS) }
      : { captures: [] },
  };
}

function boundedArrayView(value, limit) {
  if (!Array.isArray(value) || value.length > limit) return [];
  return value.filter((row, index) => {
    if (!object(row)) return false;
    activeReadCache?.rowIndexes.set(row, index);
    return true;
  });
}

function collectionRowIndex(row, fallback) {
  return activeReadCache?.rowIndexes.get(row) ?? fallback;
}

function validateRoute(route, commit, baseRef, baseCommit, issues) {
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
  const subjects = route.subjects;
  const subjectIds = new Set();
  for (const [index, subject] of subjects.entries()) {
    const at = `route.subjects[${collectionRowIndex(subject, index)}]`;
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
  validateCoverage(route, subjects, subjectIds, issues);
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

function currentGitTreeIdentity(root, phase, issues) {
  try {
    const head = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    const status = execFileSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=no"], {
      cwd: root,
      encoding: null,
    });
    if (!sha(head) || !sha(tree)) throw new Error("Git returned an invalid object identity");
    const identity = {
      head,
      tree,
      tracked_status_sha256: digest(status),
      clean: status.length === 0,
    };
    if (!identity.clean)
      add(issues, "git", `${phase} tracked source must be clean before certification`);
    return identity;
  } catch (error) {
    add(issues, "git", `cannot resolve ${phase} Git tree identity: ${error.message}`);
    return null;
  }
}

function validateCurrentBrowserIdentity(expected, options, label, issues) {
  if (!object(expected) || !text(expected.path)) return;
  let key;
  let expectedPath;
  try {
    key = fs.realpathSync(resolveBrowser(options.browserPath));
    expectedPath = fs.realpathSync(expected.path);
  } catch (error) {
    add(issues, label, `cannot resolve current browser executable: ${error.message}`);
    return;
  }
  if (expectedPath !== key) {
    add(
      issues,
      label,
      "does not name the configured current browser executable; pass --browser for a non-default capture browser"
    );
    return;
  }
  let entry = activeReadCache?.browsers.get(key);
  if (!entry) {
    try {
      entry = { before: browserIdentity(key).public, expected: [] };
      activeReadCache?.browsers.set(key, entry);
    } catch (error) {
      add(issues, label, `cannot revalidate current browser executable: ${error.message}`);
      return;
    }
  }
  entry.expected.push({ identity: expected, label });
  if (!isDeepStrictEqual(entry.before, expected))
    add(issues, label, "does not match the current browser executable identity");
}

function finalizeBrowserIdentities(issues) {
  for (const [browserPath, entry] of activeReadCache?.browsers || []) {
    try {
      const after = browserIdentity(browserPath).public;
      if (!isDeepStrictEqual(entry.before, after))
        add(issues, "captures", "browser executable changed while checking trusted evidence");
      for (const expected of entry.expected)
        if (!isDeepStrictEqual(after, expected.identity))
          add(issues, expected.label, "does not match the final browser executable identity");
    } catch (error) {
      add(issues, "captures", `cannot complete browser executable revalidation: ${error.message}`);
    }
  }
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

function validateCoverage(route, subjects, subjectIds, issues) {
  const coverageRows = route.coverage;
  const subjectsById = new Map(subjects.filter(object).map((subject) => [subject.id, subject]));
  const ids = new Set();
  const decisions = new Map();
  let duplicateDecisionCount = 0;
  let duplicateDecisionDiagnostics = 0;
  for (const [index, item] of coverageRows.entries()) {
    const sourceIndex = collectionRowIndex(item, index);
    const at = `route.coverage[${sourceIndex}]`;
    if (!object(item)) {
      add(issues, at, "must be an object");
      continue;
    }
    closed(item, ["id", "subject_id", "state", "viewport", "required", "reason"], at, issues);
    if (!slug(item.id) || ids.has(item.id)) add(issues, `${at}.id`, "must be unique kebab-case");
    ids.add(item.id);
    const decisionKey = JSON.stringify([item.subject_id, item.state, item.viewport]);
    const priorDecision = decisions.get(decisionKey);
    if (priorDecision !== undefined) {
      duplicateDecisionCount += 1;
      if (duplicateDecisionDiagnostics < MAX_RULE_DIAGNOSTICS - 1) {
        add(
          issues,
          at,
          `duplicates the subject/state/viewport decision at route.coverage[${priorDecision}]`
        );
        duplicateDecisionDiagnostics += 1;
      }
    } else decisions.set(decisionKey, sourceIndex);
    if (!subjectIds.has(item.subject_id))
      add(issues, `${at}.subject_id`, "must reference a subject");
    if (!STATES.has(item.state)) add(issues, `${at}.state`, "is invalid");
    if (!VIEWPORTS.has(item.viewport)) add(issues, `${at}.viewport`, "is invalid");
    const platform = subjectsById.get(item.subject_id)?.platform;
    if (
      route.mode === "product-ui" &&
      platform === "web" &&
      VIEWPORTS.has(item.viewport) &&
      !PRODUCT_UI_WEB_VIEWPORTS.has(item.viewport)
    )
      add(issues, `${at}.viewport`, "web product-ui coverage must use desktop, tablet, or narrow");
    if (
      route.mode === "product-ui" &&
      platform === "mobile" &&
      VIEWPORTS.has(item.viewport) &&
      item.viewport !== "device"
    )
      add(issues, `${at}.viewport`, "mobile product-ui coverage must use device");
    if (typeof item.required !== "boolean") add(issues, `${at}.required`, "must be boolean");
    if (item.required === false && !text(item.reason))
      add(issues, `${at}.reason`, "is required when not applicable");
  }
  if (duplicateDecisionCount > duplicateDecisionDiagnostics)
    add(
      issues,
      "route.coverage",
      `${duplicateDecisionCount - duplicateDecisionDiagnostics} additional duplicate subject/state/viewport decisions omitted after ${duplicateDecisionDiagnostics} diagnostics`
    );
  for (const subject of subjects.filter(object)) {
    const rows = coverageRows.filter((item) => item?.subject_id === subject?.id);
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

function validateCaptures(root, captures, route, routeFile, runtime, issues) {
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
  const coverageRows = route.coverage;
  const subjectRows = route.subjects;
  const validCoverageRows = coverageRows.filter(object);
  const coverage = new Map(validCoverageRows.map((item) => [item.id, item]));
  const subjects = new Map(subjectRows.filter(object).map((item) => [item.id, item]));
  const captureIds = new Set();
  const captureDecisions = new Map();
  let duplicateDecisionCount = 0;
  let duplicateDecisionDiagnostics = 0;
  const activeCoverage = new Map();
  const allCoverage = new Map();
  const decodedByCapture = new Map();
  const observationByCapture = new Map();
  const captureRows = captures.captures;
  const acceptedCaptureRows = [];
  captures.captures = acceptedCaptureRows;
  const capturesByCoverage = new Map();
  for (const [index, item] of captureRows.entries()) {
    const sourceIndex = collectionRowIndex(item, index);
    const at = `captures.captures[${sourceIndex}]`;
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
        "observation",
      ],
      at,
      issues
    );
    captureIds.add(item.id);
    const decisionKey =
      typeof item.coverage_id === "string" && Number.isInteger(item.round)
        ? JSON.stringify([item.coverage_id, item.round])
        : null;
    const priorDecision = decisionKey === null ? undefined : captureDecisions.get(decisionKey);
    if (priorDecision !== undefined) {
      duplicateDecisionCount += 1;
      if (duplicateDecisionDiagnostics < MAX_RULE_DIAGNOSTICS - 1) {
        add(
          issues,
          at,
          `duplicates the coverage/round capture at captures.captures[${priorDecision}]`
        );
        duplicateDecisionDiagnostics += 1;
      }
      continue;
    }
    if (decisionKey !== null) captureDecisions.set(decisionKey, sourceIndex);
    acceptedCaptureRows.push(item);
    if (!coverage.has(item.coverage_id))
      add(issues, `${at}.coverage_id`, "must reference route coverage");
    allCoverage.set(item.coverage_id, (allCoverage.get(item.coverage_id) || 0) + 1);
    const matchingCaptures = capturesByCoverage.get(item.coverage_id) || [];
    matchingCaptures.push(item);
    capturesByCoverage.set(item.coverage_id, matchingCaptures);
    if (item.active === true)
      activeCoverage.set(item.coverage_id, (activeCoverage.get(item.coverage_id) || 0) + 1);
    if (typeof item.active !== "boolean") add(issues, `${at}.active`, "must be boolean");
    if (!Number.isInteger(item.round) || item.round < 1 || item.round > 2)
      add(issues, `${at}.round`, "must be 1 or 2");
    if (!["screenshot", "pdf"].includes(item.kind))
      add(issues, `${at}.kind`, "must be screenshot or pdf");
    validateFileBinding(root, item, at, issues);
    const routeCoverage = coverage.get(item.coverage_id);
    const webViewport =
      route.schema_version === 2 &&
      route.mode === "product-ui" &&
      subjects.get(routeCoverage?.subject_id)?.platform === "web"
        ? routeCoverage?.viewport
        : null;
    const decoded = validateCaptureBytes(root, item, at, issues, { webViewport });
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
    if (
      route.schema_version === 2 &&
      route.mode === "product-ui" &&
      subjects.get(coverage.get(item.coverage_id)?.subject_id)?.platform === "web"
    ) {
      const observation = validateTrustedCaptureObservation(
        root,
        item,
        route,
        routeFile,
        coverage.get(item.coverage_id),
        decoded,
        runtime,
        at,
        issues
      );
      if (observation) observationByCapture.set(item.id, observation);
    }
    if (!isRfc3339DateTime(item.captured_at)) add(issues, `${at}.captured_at`, "must be RFC 3339");
    if (item.kind === "screenshot" && (!positiveInt(item.width) || !positiveInt(item.height)))
      add(issues, at, "screenshots require positive width and height");
    if (coverage.get(item.coverage_id)?.state === "print" && item.kind !== "pdf")
      add(issues, `${at}.kind`, "print coverage requires a PDF");
  }
  if (duplicateDecisionCount > duplicateDecisionDiagnostics)
    add(
      issues,
      "captures.captures",
      `${duplicateDecisionCount - duplicateDecisionDiagnostics} additional duplicate coverage/round captures omitted after ${duplicateDecisionDiagnostics} diagnostics`
    );
  for (const item of validCoverageRows) {
    const activeCount = activeCoverage.get(item.id) || 0;
    const totalCount = allCoverage.get(item.id) || 0;
    if (item.required && activeCount !== 1)
      add(
        issues,
        `captures.captures`,
        `required coverage ${item.id} must have exactly one active capture`
      );
    if (item.required && activeCount === 1) {
      const rows = capturesByCoverage.get(item.id) || [];
      const active = rows.find((capture) => capture.active === true);
      const latestRound = Math.max(...rows.map((capture) => capture.round));
      if (active.round !== latestRound)
        add(issues, `captures.captures`, `active coverage ${item.id} must use the latest round`);
    }
    if (!item.required && totalCount > 0)
      add(issues, `captures.captures`, `non-applicable coverage ${item.id} cannot have a capture`);
  }
  validateDistinctActiveCaptures(root, acceptedCaptureRows, coverage, decodedByCapture, issues);
  validateCrossStateVisualDistance(acceptedCaptureRows, coverage, decodedByCapture, issues);
  validateEvidence(
    root,
    captures.evidence,
    route,
    acceptedCaptureRows,
    observationByCapture,
    issues
  );
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

function validateCrossStateVisualDistance(captureRows, coverage, decodedByCapture, issues) {
  const groups = new Map();
  for (const capture of captureRows) {
    const routeCoverage = coverage.get(capture?.coverage_id);
    if (
      capture?.active !== true ||
      routeCoverage?.required !== true ||
      capture.kind !== "screenshot" ||
      !decodedByCapture.has(capture.id)
    )
      continue;
    const groupKey = JSON.stringify([routeCoverage.subject_id, routeCoverage.viewport]);
    const states = groups.get(groupKey) || new Map();
    if (!states.has(routeCoverage.state))
      states.set(routeCoverage.state, { capture, coverage: routeCoverage });
    groups.set(groupKey, states);
  }

  let violationCount = 0;
  let emittedDiagnostics = 0;
  for (const states of groups.values()) {
    const active = [...states.values()];
    for (let leftIndex = 0; leftIndex < active.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < active.length; rightIndex += 1) {
        const left = active[leftIndex];
        const right = active[rightIndex];
        const difference = visualDifference(
          decodedByCapture.get(left.capture.id),
          decodedByCapture.get(right.capture.id)
        );
        if (!isMaterialVisualDifference(difference)) {
          violationCount += 1;
          if (emittedDiagnostics < MAX_RULE_DIAGNOSTICS - 1) {
            add(
              issues,
              `captures.captures.${right.capture.id}`,
              `states ${left.coverage.state} and ${right.coverage.state} for the same subject and viewport require materially different decoded pixels`
            );
            emittedDiagnostics += 1;
          }
        }
      }
    }
  }
  if (violationCount > emittedDiagnostics)
    add(
      issues,
      "captures.captures",
      `${violationCount - emittedDiagnostics} additional cross-state visual-distance failures omitted after ${emittedDiagnostics} diagnostics`
    );
}

function validateTrustedCaptureObservation(
  root,
  capture,
  route,
  routeFile,
  coverage,
  decoded,
  runtime,
  label,
  issues
) {
  const at = `${label}.observation`;
  if (!object(capture.observation)) {
    add(issues, at, "schema-v2 product UI captures require a trusted capture manifest");
    return null;
  }
  closed(capture.observation, ["path", "sha256"], at, issues);
  if (!sha256(capture.observation.sha256)) {
    add(issues, at, "requires path and SHA-256");
    return null;
  }
  const file = readBoundFile(root, capture.observation.path, `${at}.path`, issues, MAX_JSON_BYTES);
  if (!file) return null;
  if (file.sha256 !== capture.observation.sha256)
    add(issues, `${at}.sha256`, "does not match trusted capture manifest bytes");
  let manifest;
  try {
    manifest = JSON.parse(file.bytes.toString("utf8"));
    validateCaptureManifestShape(manifest);
  } catch (error) {
    add(issues, at, `invalid trusted capture manifest: ${error.message}`);
    return null;
  }

  if (
    manifest.schema_version !== 2 ||
    manifest.kind !== "product-ui-capture" ||
    manifest.run_id !== route.run_id ||
    manifest.mode !== "product-ui" ||
    manifest.commit !== route.source?.commit
  )
    add(issues, at, "schema, run, mode, and commit must match the route");
  if (manifest.route.path !== routeFile.relative || manifest.route.sha256 !== routeFile.sha256)
    add(issues, `${at}.route`, "must bind the exact frozen route bytes");
  if (
    !coverage ||
    manifest.subject_id !== coverage.subject_id ||
    !isDeepStrictEqual(manifest.coverage, {
      id: coverage.id,
      state: coverage.state,
      viewport: coverage.viewport,
    })
  )
    add(issues, `${at}.coverage`, "must match the routed subject, state, and viewport");
  const expectedCapture = {
    id: capture.id,
    path: capture.path,
    sha256: capture.sha256,
    pixel_sha256: capture.pixel_sha256,
    visual_metrics: decoded ? captureVisualMetrics(decoded) : manifest.capture.visual_metrics,
    width: capture.width,
    height: capture.height,
    full_page: capture.full_page,
    round: capture.round,
    captured_at: capture.captured_at,
  };
  if (!isDeepStrictEqual(manifest.capture, expectedCapture))
    add(issues, `${at}.capture`, "must exactly bind the capture row and decoded-pixel hash");

  const assertion = validateTrustedStateAssertion(root, manifest, routeFile, coverage, at, issues);
  const a11y = validateTrustedRawAudit(
    root,
    manifest.raw_evidence.accessibility_tree,
    "accessibility-tree",
    manifest,
    `${at}.raw_evidence.accessibility_tree`,
    issues
  );
  const dom = validateTrustedRawAudit(
    root,
    manifest.raw_evidence.dom_audit,
    "dom-audit",
    manifest,
    `${at}.raw_evidence.dom_audit`,
    issues
  );
  const network = validateTrustedNetworkLedger(root, manifest, at, issues);
  validateTrustedPage(manifest, capture, route, coverage, at, issues);
  validateTrustedObservationIdentity(
    manifest,
    route,
    routeFile,
    assertion,
    a11y,
    dom,
    network,
    runtime,
    at,
    issues
  );
  validateTrustedTimestamps(manifest, at, issues);
  return { manifest, manifestFile: file };
}

function validateTrustedStateAssertion(root, manifest, routeFile, coverage, label, issues) {
  const assertion = manifest.page.state_assertion;
  const expectedPath = `${path.posix.dirname(routeFile.relative)}/state-assertions/${coverage?.id}.json`;
  if (assertion.path !== expectedPath)
    add(
      issues,
      `${label}.page.state_assertion.path`,
      "must be the canonical coverage assertion path"
    );
  if (assertion.passed !== true)
    add(issues, `${label}.page.state_assertion.passed`, "must equal true");
  const visibility = assertion.visibility;
  try {
    validateAssertionVisibility(visibility, "capture manifest.page.state_assertion.visibility");
  } catch (error) {
    add(issues, `${label}.page.state_assertion.visibility`, error.message);
  }
  const file = readBoundFile(
    root,
    assertion.path,
    `${label}.page.state_assertion.path`,
    issues,
    64 * 1024
  );
  if (!file) return null;
  if (file.sha256 !== assertion.sha256)
    add(issues, `${label}.page.state_assertion.sha256`, "does not match assertion bytes");
  try {
    const value = JSON.parse(file.bytes.toString("utf8"));
    validateStateAssertion(value, {
      subject_id: coverage?.subject_id,
      coverage_id: coverage?.id,
      state: coverage?.state,
    });
    const expectedVisibleNodes =
      1 + value.all.filter((clause) => clause.expect.kind === "visible").length;
    validateAssertionVisibility(visibility, "capture manifest.page.state_assertion.visibility", [
      "state marker",
      ...value.all.flatMap((clause, index) =>
        clause.expect.kind === "visible" ? [`state assertion clause ${index + 1}`] : []
      ),
    ]);
    if (visibility.verified_nodes !== expectedVisibleNodes)
      throw new Error("state assertion visibility count does not match the assertion");
  } catch (error) {
    add(issues, `${label}.page.state_assertion`, `invalid declarative assertion: ${error.message}`);
  }
  return file;
}

function validateTrustedRawAudit(root, binding, kind, manifest, label, issues) {
  const file = readBoundFile(root, binding.path, `${label}.path`, issues, MAX_RAW_AUDIT_BYTES);
  if (!file) return null;
  if (file.sha256 !== binding.sha256)
    add(issues, `${label}.sha256`, "does not match raw audit bytes");
  let raw;
  try {
    raw = JSON.parse(file.bytes.toString("utf8"));
    normalizeAuditBytes(file.bytes, { path: file.relative, sha256: file.sha256 });
  } catch (error) {
    add(issues, label, `invalid normalized-audit source: ${error.message}`);
    return null;
  }
  if (
    raw.schema_version !== 1 ||
    raw.kind !== kind ||
    raw.subject_id !== manifest.subject_id ||
    raw.commit !== manifest.commit ||
    !isDeepStrictEqual(raw.capture_ids, [manifest.capture.id])
  )
    add(issues, label, "must identify the same kind, subject, commit, and single capture");
  return { file, raw };
}

function validateTrustedNetworkLedger(root, manifest, label, issues) {
  const binding = manifest.raw_evidence.network_ledger;
  const at = `${label}.raw_evidence.network_ledger`;
  const file = readBoundFile(root, binding.path, `${at}.path`, issues, MAX_JSON_BYTES);
  if (!file) return null;
  if (file.sha256 !== binding.sha256)
    add(issues, `${at}.sha256`, "does not match network ledger bytes");
  let ledger;
  try {
    ledger = JSON.parse(file.bytes.toString("utf8"));
  } catch (error) {
    add(issues, at, `invalid JSON: ${error.message}`);
    return null;
  }
  if (!object(ledger)) {
    add(issues, at, "must be an object");
    return null;
  }
  closed(
    ledger,
    ["schema_version", "policy", "allowed_origins", "observed_origins", "requests", "violations"],
    at,
    issues
  );
  if (ledger.schema_version !== 1 || ledger.policy !== "explicit-origin-allowlist")
    add(issues, at, "requires schema 1 and the explicit-origin-allowlist policy");
  const allowedOrigins = Array.isArray(ledger.allowed_origins)
    ? ledger.allowed_origins.slice(0, MAX_NETWORK_ORIGINS)
    : [];
  const observedOrigins = Array.isArray(ledger.observed_origins)
    ? ledger.observed_origins.slice(0, MAX_NETWORK_ORIGINS)
    : [];
  if (!boundedUniqueTextArray(ledger.allowed_origins, MAX_NETWORK_ORIGINS, false))
    add(issues, `${at}.allowed_origins`, "must be a bounded unique origin array");
  if (!boundedUniqueTextArray(ledger.observed_origins, MAX_NETWORK_ORIGINS, true))
    add(issues, `${at}.observed_origins`, "must be a bounded unique origin array");
  const requests = Array.isArray(ledger.requests)
    ? ledger.requests.slice(0, MAX_NETWORK_REQUESTS)
    : [];
  if (!Array.isArray(ledger.requests) || ledger.requests.length > MAX_NETWORK_REQUESTS)
    add(issues, `${at}.requests`, `must contain at most ${MAX_NETWORK_REQUESTS} requests`);
  let priorSequence = 0;
  for (const [index, request] of requests.entries()) {
    const requestAt = `${at}.requests[${index}]`;
    if (!object(request)) {
      add(issues, requestAt, "must be an object");
      continue;
    }
    closed(
      request,
      ["sequence", "method", "resource_type", "origin", "url_sha256"],
      requestAt,
      issues
    );
    if (!Number.isSafeInteger(request.sequence) || request.sequence <= priorSequence)
      add(issues, `${requestAt}.sequence`, "must increase monotonically");
    priorSequence = request.sequence;
    if (!boundedText(request.method, 20) || !boundedText(request.resource_type, 40))
      add(issues, requestAt, "requires bounded method and resource type");
    if (!boundedText(request.origin, 4096) || !sha256(request.url_sha256))
      add(issues, requestAt, "requires an origin and redacted URL SHA-256");
  }
  if (!Array.isArray(ledger.violations) || ledger.violations.length !== 0)
    add(issues, `${at}.violations`, "must be empty");
  const observed = uniqueSorted(requests.map((request) => request?.origin));
  if (!isDeepStrictEqual(observedOrigins, observed))
    add(issues, `${at}.observed_origins`, "must exactly equal the sorted request origins");
  const allowed = new Set(allowedOrigins);
  if (observed.some((origin) => !allowed.has(origin) && !new Set(["about:", "data:"]).has(origin)))
    add(issues, `${at}.observed_origins`, "contains an origin outside the explicit allowlist");
  return {
    file,
    ledger: {
      ...ledger,
      allowed_origins: allowedOrigins,
      observed_origins: observedOrigins,
      requests,
    },
  };
}

function validateTrustedPage(manifest, capture, route, coverage, label, issues) {
  const page = manifest.page;
  const subject = (route.subjects || []).find((item) => item.id === coverage?.subject_id);
  if (!subject || page.route_surface !== subject.surface)
    add(issues, `${label}.page.route_surface`, "must equal the routed subject surface");
  try {
    validateSurfacePattern(page.route_surface);
  } catch (error) {
    add(issues, `${label}.page.route_surface`, error.message);
  }
  for (const field of ["requested_url", "expected_url", "final_url"]) {
    try {
      validateUrlIdentity(page[field], `capture manifest.page.${field}`);
      if (!urlMatchesSurface(`${page[field].origin}${page[field].pathname}`, page.route_surface))
        add(issues, `${label}.page.${field}`, "path must match the routed subject surface");
    } catch (error) {
      add(issues, `${label}.page.${field}`, error.message);
    }
  }
  if (
    new Set(
      [page.requested_url, page.expected_url, page.final_url]
        .map((identity) => identity?.origin)
        .filter(Boolean)
    ).size !== 1
  )
    add(
      issues,
      `${label}.page.requested_url`,
      "requested, expected, and final URL origins must match"
    );
  if (!isDeepStrictEqual(page.final_url, page.expected_url))
    add(issues, `${label}.page.final_url`, "must equal the asserted expected URL");
  for (const field of ["target_id", "main_frame_id", "loader_id"])
    if (!boundedText(page[field], 500)) add(issues, `${label}.page.${field}`, "is required");
  const viewport = page.css_viewport;
  for (const field of [
    "inner_width",
    "inner_height",
    "client_width",
    "client_height",
    "scroll_width",
    "scroll_height",
  ])
    if (!positiveInt(viewport[field]))
      add(issues, `${label}.page.css_viewport.${field}`, "must be positive");
  if (
    viewport.inner_width !== capture.width ||
    viewport.inner_height !== capture.height ||
    viewport.client_width !== capture.width ||
    viewport.client_height !== capture.height ||
    viewport.scroll_width < capture.width ||
    viewport.scroll_height < capture.height ||
    viewport.device_scale_factor !== 1 ||
    viewport.scroll_x !== 0 ||
    viewport.scroll_y !== 0 ||
    viewport.visual_scale !== 1 ||
    viewport.page_zoom !== 1
  )
    add(issues, `${label}.page.css_viewport`, "must exactly attest the routed CSS viewport");
}

function validateTrustedObservationIdentity(
  manifest,
  route,
  routeFile,
  assertion,
  a11y,
  dom,
  network,
  runtime,
  label,
  issues
) {
  const observation = manifest.observation;
  if (
    observation.assurance_level !== TRUSTED_CAPTURE_ASSURANCE ||
    observation.producer.name !== TRUSTED_CAPTURE_PRODUCER ||
    observation.producer.version !== PLUGIN_VERSION
  )
    add(
      issues,
      label,
      "must identify the current workflow-attested, non-cryptographic capture producer"
    );
  const browser = observation.browser;
  if (browser.engine !== "chromium" || !isDeepStrictEqual(browser.before, browser.after))
    add(issues, `${label}.browser`, "must attest one unchanged Chromium executable");
  for (const [side, identity] of Object.entries({ before: browser.before, after: browser.after })) {
    if (
      !text(identity.path) ||
      !path.isAbsolute(identity.path) ||
      !positiveInt(identity.bytes) ||
      !sha256(identity.sha256) ||
      !boundedText(identity.version, 500) ||
      !/(chrome|chromium|edge)/i.test(identity.version)
    )
      add(issues, `${label}.browser.${side}`, "has an invalid executable identity");
  }
  if (shouldVerifyCaptureBrowser(runtime.options))
    validateCurrentBrowserIdentity(browser.before, runtime.options, `${label}.browser`, issues);
  const source = observation.source;
  if (
    source.guard !== "clean-tracked-tree-before-and-after" ||
    !isDeepStrictEqual(source.before, source.after)
  )
    add(issues, `${label}.source`, "must attest one unchanged clean tracked tree");
  for (const [side, identity] of Object.entries({ before: source.before, after: source.after })) {
    if (
      identity.head !== route.source?.commit ||
      !sha(identity.tree) ||
      identity.tracked_status_sha256 !== EMPTY_SHA256 ||
      identity.clean !== true
    )
      add(issues, `${label}.source.${side}`, "must match the clean routed source identity");
  }
  if (runtime.currentSource && !isDeepStrictEqual(source.before, runtime.currentSource))
    add(
      issues,
      `${label}.source`,
      "does not match the current local Git HEAD and tree or clean tracked status identity"
    );
  const configuration = observation.configuration;
  if (
    !Number.isSafeInteger(configuration.readiness_timeout_ms) ||
    configuration.readiness_timeout_ms < 1000 ||
    configuration.readiness_timeout_ms > 30000 ||
    !Number.isSafeInteger(configuration.settle_ms) ||
    configuration.settle_ms < 100 ||
    configuration.settle_ms > 2000 ||
    configuration.browser_args_profile !== TRUSTED_CAPTURE_BROWSER_PROFILE ||
    configuration.acquisition !== TRUSTED_CAPTURE_ACQUISITION
  )
    add(issues, `${label}.configuration`, "contains an unsupported trusted capture configuration");
  const net = observation.network;
  if (
    !network ||
    net.policy !== "explicit-origin-allowlist" ||
    !isDeepStrictEqual(net.allowed_origins, network.ledger.allowed_origins) ||
    !isDeepStrictEqual(net.observed_origins, network.ledger.observed_origins) ||
    net.request_count !== network.ledger.requests.length ||
    net.ledger_sha256 !== network.file.sha256 ||
    net.violations !== 0
  )
    add(issues, `${label}.network`, "must exactly summarize the bound violation-free ledger");
  try {
    const requestedOrigin = manifest.page.requested_url.origin;
    if (!net.allowed_origins.includes(requestedOrigin))
      add(issues, `${label}.network.allowed_origins`, "must include the requested page origin");
  } catch {
    // The URL-specific issue is reported by validateTrustedPage.
  }
  const invocation = {
    producer: { name: TRUSTED_CAPTURE_PRODUCER, version: PLUGIN_VERSION },
    route_sha256: routeFile.sha256,
    run_id: manifest.run_id,
    commit: manifest.commit,
    subject_id: manifest.subject_id,
    coverage: manifest.coverage,
    capture_id: manifest.capture.id,
    route_surface: manifest.page.route_surface,
    requested_url: manifest.page.requested_url,
    expected_url: manifest.page.expected_url,
    viewport: { width: manifest.capture.width, height: manifest.capture.height },
    assertion: {
      path: manifest.page.state_assertion.path,
      sha256: assertion?.sha256 || manifest.page.state_assertion.sha256,
    },
    allowed_origins: net.allowed_origins,
    readiness_timeout_ms: configuration.readiness_timeout_ms,
    settle_ms: configuration.settle_ms,
    browser_args_profile: configuration.browser_args_profile,
    acquisition: configuration.acquisition,
  };
  if (
    observation.invocation_configuration_sha256 !== digest(Buffer.from(JSON.stringify(invocation)))
  )
    add(issues, `${label}.invocation_configuration_sha256`, "does not match the bound invocation");
  const pageIdentity = {
    target_id: manifest.page.target_id,
    main_frame_id: manifest.page.main_frame_id,
    loader_id: manifest.page.loader_id,
    final_url: manifest.page.final_url,
    css_viewport: manifest.page.css_viewport,
  };
  const nativeObservations = {
    page: pageIdentity,
    assertion_visibility: manifest.page.state_assertion.visibility,
    accessibility: a11y?.raw.observations,
    dom: dom?.raw.observations,
  };
  if (
    !a11y ||
    !dom ||
    observation.stability.samples !== 2 ||
    observation.stability.native_observations_sha256 !==
      digest(Buffer.from(JSON.stringify(nativeObservations))) ||
    observation.stability.decoded_pixels_sha256 !== manifest.capture.pixel_sha256
  )
    add(
      issues,
      `${label}.stability`,
      "must bind two stable native observations and decoded pixels"
    );
}

function validateTrustedTimestamps(manifest, label, issues) {
  let previous = null;
  for (const field of ["started_at", "page_ready_at", "captured_at", "completed_at"]) {
    const timestamp = manifest.timestamps[field];
    if (
      !isRfc3339DateTime(timestamp) ||
      (previous !== null && compareRfc3339DateTimes(timestamp, previous) < 0)
    )
      add(issues, `${label}.timestamps`, "must contain ordered RFC 3339 timestamps");
    if (isRfc3339DateTime(timestamp)) previous = timestamp;
  }
  if (manifest.timestamps.captured_at !== manifest.capture.captured_at)
    add(issues, `${label}.timestamps.captured_at`, "must equal the capture timestamp");
}

function validateAuditEvidence(
  root,
  entry,
  route,
  captureRows,
  observationByCapture,
  label,
  issues
) {
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
    const trusted = observationByCapture.get(audit.capture_ids[0]);
    const rawKey = entry.kind === "accessibility-tree" ? "accessibility_tree" : "dom_audit";
    if (trusted && raw && !isDeepStrictEqual(audit.raw, trusted.manifest.raw_evidence[rawKey]))
      add(
        issues,
        `${label}.raw`,
        "must bind the raw observations from the trusted capture manifest"
      );
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

function validateEvidence(root, evidence, route, captureRows, observationByCapture, issues) {
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
      const audit = validateAuditEvidence(
        root,
        item,
        route,
        captureRows,
        observationByCapture,
        at,
        issues
      );
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
    const dimensions = inspectMediaOnce(file, "png", inspectPngVisualBytes);
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
      ...(report.schema_version === 2 ? ["review_assurance"] : []),
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
    if (report.review_assurance !== REVIEW_ASSURANCE)
      add(
        issues,
        "report.review_assurance",
        `must equal ${REVIEW_ASSURANCE}; reviewer independence is workflow-attested, not cryptographically proven`
      );
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
  validateFindings(root, report.findings, route, captures, report.outcome, issues);
  if (report.schema_version === 2 && reviewState) {
    validateReconciliation(report, route, captures, reviewState, issues);
    validateSourceBlockingOutcome(report, reviewState, issues);
  }
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
    reconciledFinalBySource: new Map(),
    finalPrimaryScores: null,
    rows: [],
  };
  if (!object(reviews)) {
    add(issues, "reviews", "must be an object");
    return state;
  }
  closed(
    reviews,
    [
      "schema_version",
      "run_id",
      "mode",
      "commit",
      "route",
      "captures",
      "assurance",
      "rounds",
      "checked_at",
    ],
    "reviews",
    issues
  );
  if (reviews.schema_version !== 1) add(issues, "reviews.schema_version", "must equal 1");
  if (reviews.assurance !== REVIEW_ASSURANCE)
    add(
      issues,
      "reviews.assurance",
      `must equal ${REVIEW_ASSURANCE}; reviewer independence is workflow-attested, not cryptographically proven`
    );
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
    compareRfc3339DateTimes(reviews.checked_at, report.checked_at) > 0
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
        routeFile,
        captures,
        captureById,
        evidenceById,
        at,
        issues
      );
      const executionState = validateReviewExecution(
        root,
        review,
        inputState,
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
        executionState,
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
  validateReviewRoundChronology(state, captures, report.rounds, issues);
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
  routeFile,
  captures,
  captureById,
  evidenceById,
  at,
  issues
) {
  const label = `${at}.input`;
  const state = {
    captureIds: [],
    evidenceIds: [],
    priorFindingRefs: [],
    payloadSha256: "",
    contextBinding: null,
    contextCreatedAt: null,
    captureManifestBinding: null,
    captureManifestCreatedAt: null,
  };
  if (!object(input)) {
    add(issues, label, "must be an object");
    return state;
  }
  const common = [
    "prompt_profile",
    "prompt_sha256",
    "context_source",
    "capture_manifest",
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
  const contextState = validateReviewContextSource(
    root,
    input.context_source,
    route,
    routeFile,
    `${label}.context_source`,
    issues
  );
  state.contextBinding = contextState.binding;
  state.contextCreatedAt = contextState.createdAt;
  if (!uniqueTextArray(input.capture_ids, 200))
    add(issues, `${label}.capture_ids`, "must be a non-empty unique bounded array");
  else {
    state.captureIds = input.capture_ids;
    for (const id of input.capture_ids)
      if (!captureById.has(id)) add(issues, `${label}.capture_ids`, `unknown capture ${id}`);
  }
  const captureManifestState = validateReviewCaptureManifest(
    root,
    input.capture_manifest,
    state.captureIds,
    round,
    route,
    routeFile,
    captureById,
    `${label}.capture_manifest`,
    issues
  );
  state.captureManifestBinding = captureManifestState.binding;
  state.captureManifestCreatedAt = captureManifestState.createdAt;
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
    if (!sameStringSet(state.evidenceIds, requiredEvidence))
      add(
        issues,
        `${label}.evidence_ids`,
        `must exactly equal the evidence bound to this round's captures: ${requiredEvidence.join(", ")}`
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

function validateReviewContextSource(root, binding, route, routeFile, label, issues) {
  const state = { binding: null, createdAt: null };
  if (!object(binding)) {
    add(issues, label, "requires a path and SHA-256 binding");
    return state;
  }
  closed(binding, ["path", "sha256"], label, issues);
  const file = text(binding.path) ? readJsonFile(root, binding.path, label, issues) : null;
  if (!file) return state;
  validateBinding(binding, file, label, issues);
  state.binding = { path: file.relative, sha256: file.sha256 };
  const source = file.value;
  if (!object(source)) {
    add(issues, label, "must bind a JSON object");
    return state;
  }
  closed(
    source,
    ["schema_version", "run_id", "commit", "route", "brief", "design_principles", "created_at"],
    label,
    issues
  );
  if (source.schema_version !== 1) add(issues, `${label}.schema_version`, "must equal 1");
  if (source.run_id !== route.run_id || source.commit !== route.source?.commit)
    add(issues, label, "run_id and commit must match the route");
  if (object(source.route)) closed(source.route, ["path", "sha256"], `${label}.route`, issues);
  validateBinding(source.route, routeFile, `${label}.route`, issues);
  if (!object(source.brief)) add(issues, `${label}.brief`, "must be an object");
  else {
    closed(
      source.brief,
      ["page_description", "persona", "job_to_be_done"],
      `${label}.brief`,
      issues
    );
    for (const key of ["page_description", "persona", "job_to_be_done"])
      if (!boundedText(source.brief[key], 2_000))
        add(issues, `${label}.brief.${key}`, "is required");
  }
  if (
    !Array.isArray(source.design_principles) ||
    source.design_principles.length > 20 ||
    source.design_principles.some((item) => !boundedText(item, 1_000))
  )
    add(issues, `${label}.design_principles`, "must contain at most 20 bounded text principles");
  if (!isRfc3339DateTime(source.created_at)) add(issues, `${label}.created_at`, "must be RFC 3339");
  else {
    state.createdAt = source.created_at;
    if (
      isRfc3339DateTime(route.created_at) &&
      compareRfc3339DateTimes(source.created_at, route.created_at) < 0
    )
      add(issues, `${label}.created_at`, "must not precede route.created_at");
  }
  return state;
}

function validateReviewCaptureManifest(
  root,
  binding,
  inputCaptureIds,
  round,
  route,
  routeFile,
  captureById,
  label,
  issues
) {
  const state = { binding: null, createdAt: null };
  if (!object(binding)) {
    add(issues, label, "requires a path and SHA-256 binding");
    return state;
  }
  closed(binding, ["path", "sha256"], label, issues);
  const file = text(binding.path) ? readJsonFile(root, binding.path, label, issues) : null;
  if (!file) return state;
  validateBinding(binding, file, label, issues);
  state.binding = { path: file.relative, sha256: file.sha256 };
  const manifest = file.value;
  if (!object(manifest)) {
    add(issues, label, "must bind a JSON object");
    return state;
  }
  closed(
    manifest,
    ["schema_version", "run_id", "round", "commit", "route", "capture_ids", "created_at"],
    label,
    issues
  );
  if (manifest.schema_version !== 1) add(issues, `${label}.schema_version`, "must equal 1");
  if (
    manifest.run_id !== route.run_id ||
    manifest.commit !== route.source?.commit ||
    manifest.round !== round
  )
    add(issues, label, "run_id, commit, and round must match the review round");
  if (object(manifest.route)) closed(manifest.route, ["path", "sha256"], `${label}.route`, issues);
  validateBinding(manifest.route, routeFile, `${label}.route`, issues);
  if (!uniqueTextArray(manifest.capture_ids, 200))
    add(issues, `${label}.capture_ids`, "must be a non-empty unique bounded array");
  else if (!sameStringSet(manifest.capture_ids, inputCaptureIds))
    add(issues, `${label}.capture_ids`, "must exactly match input.capture_ids");
  if (!isRfc3339DateTime(manifest.created_at))
    add(issues, `${label}.created_at`, "must be RFC 3339");
  else {
    state.createdAt = manifest.created_at;
    if (
      isRfc3339DateTime(route.created_at) &&
      compareRfc3339DateTimes(manifest.created_at, route.created_at) < 0
    )
      add(issues, `${label}.created_at`, "must not precede route.created_at");
  }
  for (const id of manifest.capture_ids || []) {
    const capture = captureById.get(id);
    if (!capture) continue;
    if (!Number.isInteger(capture.round) || capture.round > round)
      add(issues, `${label}.capture_ids`, `capture ${id} belongs to a later round`);
    if (
      isRfc3339DateTime(capture.captured_at) &&
      state.createdAt &&
      compareRfc3339DateTimes(capture.captured_at, state.createdAt) > 0
    )
      add(issues, `${label}.created_at`, `must not precede capture ${id}`);
  }
  return state;
}

function requiredReviewEvidenceIds(root, route, captures, captureIds) {
  const selected = new Set(captureIds);
  return (captures.evidence || [])
    .filter((item) => {
      if (["accessibility-tree", "dom-audit"].includes(item.kind)) {
        const audit = readEvidenceJson(root, item, `captures.evidence.${item.id}`, []);
        return (
          Array.isArray(audit?.capture_ids) &&
          audit.capture_ids.length > 0 &&
          audit.capture_ids.every((id) => selected.has(id))
        );
      }
      if (route.mode !== "pm-artifact") return false;
      if (item.kind === "artifact-structural") return true;
      if (item.kind !== "artifact-render") return false;
      const render = readEvidenceJson(root, item, `captures.evidence.${item.id}`, []);
      if (!render) return false;
      const renderedFiles = [
        ...(render.captures || []).map((capture) => capture.full_page),
        render.print,
      ].filter(Boolean);
      const renderedIdentities = renderedFiles.map(fileBindingIdentity);
      const selectedIdentities = (captures.captures || [])
        .filter((capture) => selected.has(capture.id))
        .map(fileBindingIdentity);
      return sameStringSet(renderedIdentities, selectedIdentities);
    })
    .map((item) => item.id);
}

function fileBindingIdentity(binding) {
  const normalizedPath = String(binding?.path || "")
    .replaceAll("\\", "/")
    .replace(/^\.\//, "");
  const normalizedSha = String(binding?.sha256 || "").replace(/^sha256:/, "");
  return `${normalizedPath}|${normalizedSha}`;
}

function validateReviewExecution(
  root,
  review,
  inputState,
  execution,
  reviewsCheckedAt,
  seenContextIds,
  seenInvocationIds,
  at,
  issues
) {
  const label = `${at}.execution`;
  const state = { startedAt: null, completedAt: null, receiptRecordedAt: null };
  if (!object(execution)) {
    add(issues, label, "must be an object");
    return state;
  }
  closed(
    execution,
    [
      "mode",
      "runtime",
      "context_id",
      "invocation_id",
      "assurance",
      "receipt",
      "started_at",
      "completed_at",
    ],
    label,
    issues
  );
  if (!REVIEW_EXECUTION_MODES.has(execution.mode))
    add(issues, `${label}.mode`, "must be delegated or same-runtime-isolated");
  if (execution.assurance !== REVIEW_ASSURANCE)
    add(
      issues,
      `${label}.assurance`,
      `must equal ${REVIEW_ASSURANCE}; identities are workflow attestations, not provider signatures`
    );
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
  else state.startedAt = execution.started_at;
  if (!isRfc3339DateTime(execution.completed_at))
    add(issues, `${label}.completed_at`, "must be RFC 3339");
  else state.completedAt = execution.completed_at;
  if (
    isRfc3339DateTime(execution.started_at) &&
    isRfc3339DateTime(execution.completed_at) &&
    compareRfc3339DateTimes(execution.started_at, execution.completed_at) > 0
  )
    add(issues, label, "completed_at must not precede started_at");
  if (
    isRfc3339DateTime(execution.completed_at) &&
    isRfc3339DateTime(reviewsCheckedAt) &&
    compareRfc3339DateTimes(execution.completed_at, reviewsCheckedAt) > 0
  )
    add(issues, `${label}.completed_at`, "must not be later than reviews.checked_at");
  for (const [sourceLabel, sourceTime] of [
    ["context source", inputState.contextCreatedAt],
    ["capture manifest", inputState.captureManifestCreatedAt],
  ])
    if (
      isRfc3339DateTime(sourceTime) &&
      isRfc3339DateTime(execution.started_at) &&
      compareRfc3339DateTimes(sourceTime, execution.started_at) > 0
    )
      add(issues, `${label}.started_at`, `must not precede the bound ${sourceLabel}`);
  state.receiptRecordedAt = validateReviewReceipt(
    root,
    execution.receipt,
    review,
    inputState,
    reviewsCheckedAt,
    label,
    issues
  );
  return state;
}

function validateReviewReceipt(root, binding, review, inputState, reviewsCheckedAt, label, issues) {
  const at = `${label}.receipt`;
  if (!object(binding)) {
    add(issues, at, "requires a path and SHA-256 binding");
    return null;
  }
  closed(binding, ["path", "sha256"], at, issues);
  const file = text(binding.path) ? readJsonFile(root, binding.path, at, issues) : null;
  if (!file) return null;
  validateBinding(binding, file, at, issues);
  const receipt = file.value;
  if (!object(receipt)) {
    add(issues, at, "must bind a JSON object");
    return null;
  }
  closed(
    receipt,
    [
      "schema_version",
      "assurance",
      "review_id",
      "perspective",
      "context_id",
      "invocation_id",
      "input_payload_sha256",
      "prompt_sha256",
      "result_sha256",
      "started_at",
      "completed_at",
      "recorded_at",
    ],
    at,
    issues
  );
  if (receipt.schema_version !== 1) add(issues, `${at}.schema_version`, "must equal 1");
  if (receipt.assurance !== REVIEW_ASSURANCE)
    add(issues, `${at}.assurance`, `must equal ${REVIEW_ASSURANCE}`);
  const expected = {
    review_id: review.review_id,
    perspective: review.perspective,
    context_id: review.execution?.context_id,
    invocation_id: review.execution?.invocation_id,
    input_payload_sha256: inputState.payloadSha256,
    prompt_sha256: review.input?.prompt_sha256,
    result_sha256: digest(Buffer.from(canonicalJson(review.result ?? null))),
    started_at: review.execution?.started_at,
    completed_at: review.execution?.completed_at,
  };
  for (const [key, value] of Object.entries(expected))
    if (receipt[key] !== value) add(issues, `${at}.${key}`, "must match the exact review record");
  if (!isRfc3339DateTime(receipt.recorded_at)) add(issues, `${at}.recorded_at`, "must be RFC 3339");
  else {
    if (
      isRfc3339DateTime(receipt.completed_at) &&
      compareRfc3339DateTimes(receipt.recorded_at, receipt.completed_at) < 0
    )
      add(issues, `${at}.recorded_at`, "must not precede completed_at");
    if (
      isRfc3339DateTime(reviewsCheckedAt) &&
      compareRfc3339DateTimes(receipt.recorded_at, reviewsCheckedAt) > 0
    )
      add(issues, `${at}.recorded_at`, "must not be later than reviews.checked_at");
  }
  return isRfc3339DateTime(receipt.recorded_at) ? receipt.recorded_at : null;
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
    closed(result, ["first_impression", "answers", "observations", "findings"], label, issues);
    if (!boundedText(result.first_impression, 10_000))
      add(issues, `${label}.first_impression`, "is required");
    else
      validateFreshVisualProse(result.first_impression, `${label}.first_impression`, issues, {
        minimumBytes: 60,
        requireVisualDetail: false,
      });
    validateFreshAnswers(result.answers, inputState, label, issues);
    validateFreshObservations(result.observations, inputState, route, captureById, label, issues);
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

function validateFreshObservations(observations, inputState, route, captureById, label, issues) {
  const at = `${label}.observations`;
  if (!Array.isArray(observations)) return add(issues, at, "must be an array");
  const expected = new Set(inputState.captureIds);
  const seen = new Set();
  const seenObservationText = new Map();
  for (const [index, observation] of observations.entries()) {
    const rowAt = `${at}[${index}]`;
    if (!object(observation)) {
      add(issues, rowAt, "must be an object");
      continue;
    }
    closed(
      observation,
      ["capture_id", "coverage_id", "state", "viewport", "observation"],
      rowAt,
      issues
    );
    if (!expected.has(observation.capture_id))
      add(issues, `${rowAt}.capture_id`, "must reference a supplied rendered capture");
    if (seen.has(observation.capture_id)) add(issues, `${rowAt}.capture_id`, "must be unique");
    seen.add(observation.capture_id);
    const capture = captureById.get(observation.capture_id);
    const coverage = (route.coverage || []).find((item) => item.id === capture?.coverage_id);
    if (
      !coverage ||
      observation.coverage_id !== coverage.id ||
      observation.state !== coverage.state ||
      observation.viewport !== coverage.viewport
    )
      add(
        issues,
        rowAt,
        "coverage_id, state, and viewport must match the supplied capture's route coverage"
      );
    if (!boundedText(observation.observation, 10_000))
      add(issues, `${rowAt}.observation`, "is required");
    else {
      const normalized = normalizeVisible(observation.observation);
      const normalizedKey = normalized.toLowerCase();
      const substanceKey = freshObservationSubstanceKey(normalized, observation, coverage);
      if (Buffer.byteLength(normalized, "utf8") < 40)
        add(
          issues,
          `${rowAt}.observation`,
          "must contain a substantive capture-specific observation"
        );
      validateFreshVisualProse(normalized, `${rowAt}.observation`, issues, {
        minimumBytes: 40,
        requireVisualDetail: true,
      });
      if (
        coverage &&
        (!containsObservationToken(normalizedKey, coverage.state) ||
          !containsObservationToken(normalizedKey, coverage.viewport))
      )
        add(
          issues,
          `${rowAt}.observation`,
          `must explicitly name the routed ${coverage.state} state and ${coverage.viewport} viewport`
        );
      const priorCapture = seenObservationText.get(substanceKey);
      if (priorCapture && priorCapture !== observation.capture_id)
        add(
          issues,
          `${rowAt}.observation`,
          `must contain visual substance distinct from the observation for capture ${priorCapture}, not only different capture metadata`
        );
      else seenObservationText.set(substanceKey, observation.capture_id);
    }
  }
  const missing = [...expected].filter((id) => !seen.has(id));
  if (missing.length > 0)
    add(
      issues,
      at,
      `must contain one observation for every supplied capture: ${missing.join(", ")}`
    );
}

function validateFreshVisualProse(value, label, issues, { minimumBytes, requireVisualDetail }) {
  const normalized = normalizeVisible(value);
  const words = normalized.match(/[\p{L}\p{N}]+/gu) || [];
  if (Buffer.byteLength(normalized, "utf8") < minimumBytes || words.length < 8)
    add(issues, label, "must contain substantive visual reasoning, not a short conclusion");
  if (
    FRESH_PLACEHOLDER_PROSE.test(normalized) ||
    !FRESH_INTERFACE_TERM.test(normalized) ||
    (requireVisualDetail && !FRESH_VISUAL_DETAIL_TERM.test(normalized))
  )
    add(
      issues,
      label,
      requireVisualDetail
        ? "must name a concrete interface element and a directly observed visual property or relationship"
        : "must name a concrete interface element instead of giving a generic conclusion"
    );
}

function freshObservationSubstanceKey(value, observation, coverage) {
  let normalized = value.toLowerCase();
  for (const token of [
    observation.capture_id,
    observation.coverage_id,
    observation.state,
    observation.viewport,
    coverage?.id,
  ]) {
    const candidate = normalizeVisible(String(token || "")).toLowerCase();
    if (candidate) normalized = normalized.replace(new RegExp(escapeRegex(candidate), "g"), " ");
  }
  return normalized
    .replace(/\b(?:capture|coverage|state|viewport)\b/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function containsObservationToken(value, token) {
  const normalizedToken = String(token || "")
    .toLowerCase()
    .replace(/[-_]+/g, " ");
  const normalizedValue = String(value).replace(/[-_]+/g, " ");
  return new RegExp(`(?:^|[^a-z0-9])${escapeRegex(normalizedToken)}(?:$|[^a-z0-9])`).test(
    normalizedValue
  );
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
    else
      validateFreshVisualProse(answer.text, `${at}.${key}.text`, issues, {
        minimumBytes: 50,
        requireVisualDetail: key !== "purpose",
      });
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
  if (!isDeepStrictEqual(primary.inputState.contextBinding, fresh.inputState.contextBinding))
    add(issues, label, "Primary and Fresh Eyes must bind the same brief and design principles");
  if (
    !isDeepStrictEqual(
      primary.inputState.captureManifestBinding,
      fresh.inputState.captureManifestBinding
    )
  )
    add(issues, label, "Primary and Fresh Eyes must bind the same round capture manifest");
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

function validateReviewRoundChronology(state, captures, reportRounds, issues) {
  if (!Number.isInteger(reportRounds) || reportRounds < 2) return;
  const rowsByRound = new Map();
  for (const row of state.rows) {
    if (!rowsByRound.has(row.round)) rowsByRound.set(row.round, []);
    rowsByRound.get(row.round).push(row);
  }
  const captureById = new Map((captures.captures || []).map((item) => [item.id, item]));
  for (let round = 2; round <= reportRounds; round += 1) {
    const previousRows = rowsByRound.get(round - 1) || [];
    const currentRows = rowsByRound.get(round) || [];
    const previousBoundary = latestTimestamp(
      previousRows.flatMap((row) => [
        row.executionState?.completedAt,
        row.executionState?.receiptRecordedAt,
      ])
    );
    const currentStart = earliestTimestamp(currentRows.map((row) => row.executionState?.startedAt));
    const currentManifest = earliestTimestamp(
      currentRows.map((row) => row.inputState?.captureManifestCreatedAt)
    );
    if (
      previousBoundary !== null &&
      (currentManifest === null || compareRfc3339DateTimes(currentManifest, previousBoundary) <= 0)
    )
      add(
        issues,
        `reviews.rounds[${round - 1}]`,
        `round ${round} capture manifest must be created after every round ${round - 1} review receipt`
      );
    if (
      previousBoundary !== null &&
      (currentStart === null || compareRfc3339DateTimes(currentStart, previousBoundary) <= 0)
    )
      add(
        issues,
        `reviews.rounds[${round - 1}]`,
        `round ${round} execution must start after every round ${round - 1} review receipt`
      );

    const selectedIds = new Set(currentRows.flatMap((row) => row.inputState?.captureIds || []));
    const newRoundCaptures = [...selectedIds]
      .map((id) => captureById.get(id))
      .filter((capture) => capture?.round === round);
    if (newRoundCaptures.length === 0)
      add(
        issues,
        `reviews.rounds[${round - 1}]`,
        `round ${round} must include at least one capture produced after the prior review round`
      );
    for (const capture of newRoundCaptures)
      if (
        previousBoundary !== null &&
        isRfc3339DateTime(capture.captured_at) &&
        compareRfc3339DateTimes(capture.captured_at, previousBoundary) <= 0
      )
        add(
          issues,
          `reviews.rounds[${round - 1}]`,
          `round ${round} capture ${capture.id} must postdate every round ${round - 1} review receipt`
        );
  }
}

function earliestTimestamp(values) {
  const timestamps = values.filter((value) => isRfc3339DateTime(value));
  return timestamps.reduce(
    (earliest, value) =>
      earliest === null || compareRfc3339DateTimes(value, earliest) < 0 ? value : earliest,
    null
  );
}

function latestTimestamp(values) {
  const timestamps = values.filter((value) => isRfc3339DateTime(value));
  return timestamps.reduce(
    (latest, value) =>
      latest === null || compareRfc3339DateTimes(value, latest) > 0 ? value : latest,
    null
  );
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
  const evidenceIdentityById = new Map([
    ...(captures.captures || []).map((item) => [
      item.id,
      item.pixel_sha256 ? `pixels:${item.pixel_sha256}` : `bytes:${item.sha256}`,
    ]),
    ...(captures.evidence || []).map((item) => [item.id, `bytes:${item.sha256}`]),
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
      const sourceEvidenceIdentities = new Set(
        sourceEvidence.map((id) => evidenceIdentityById.get(id)).filter(Boolean)
      );
      const hasNovelDecisionEvidence = decisionEvidenceIds.some((id) => {
        const identity = evidenceIdentityById.get(id);
        return identity && !sourceEvidenceIdentities.has(identity);
      });
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
      if (
        worstPriority &&
        PRIORITIES.has(finalFinding.priority) &&
        PRIORITY_RANK[finalFinding.priority] > PRIORITY_RANK[worstPriority]
      )
        add(
          issues,
          `${at}.final_finding_id`,
          `cannot lower reviewer priority below ${worstPriority}`
        );
      if (
        worstPriority &&
        PRIORITIES.has(finalFinding.priority) &&
        PRIORITY_RANK[finalFinding.priority] < PRIORITY_RANK[worstPriority] &&
        (!hasNovelDecisionEvidence || normalizeVisible(row.rationale).length < 20)
      )
        add(
          issues,
          `${at}.final_finding_id`,
          "severity escalation requires new decision evidence and a concrete rationale"
        );
      const designOwnedSource = sources.some((item) => item.finding.owner === "design-critique");
      if (
        designOwnedSource &&
        ["P0", "P1"].includes(finalFinding.priority) &&
        finalFinding.owner !== "design-critique"
      )
        add(
          issues,
          `${at}.final_finding_id`,
          "a Design Critique source that remains or becomes P0/P1 cannot be reassigned to another gate"
        );
      for (const source of sources)
        reviewState.reconciledFinalBySource.set(
          `${source.review_id}:${source.finding.id}`,
          finalFinding
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

function validateSourceBlockingOutcome(report, reviewState, issues) {
  if (report.outcome !== "passed") return;
  for (const [key, source] of reviewState.findings.entries()) {
    if (
      source.finding.owner !== "design-critique" ||
      !["P0", "P1"].includes(source.finding.priority)
    )
      continue;
    const finalFinding = reviewState.reconciledFinalBySource.get(key);
    if (
      !finalFinding ||
      finalFinding.owner !== "design-critique" ||
      finalFinding.status !== "resolved"
    )
      add(
        issues,
        "report.outcome",
        `passed requires source Design Critique blocker ${key} to remain Design-owned and resolve with before/after proof`
      );
  }
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

function validateFindings(root, findings, route, captures, outcome, issues) {
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
      const resolvedVisualDifference =
        requiresPixelIdentity && before && after
          ? visualDifferenceForCaptures(root, before, after)
          : null;
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
            before.pixel_sha256 === after.pixel_sha256 ||
            !isMaterialVisualDifference(resolvedVisualDifference))) ||
        before.coverage_id !== after.coverage_id ||
        !subjectCoverage.has(before.coverage_id) ||
        before.active !== false ||
        after.active !== true ||
        !Number.isInteger(before.round) ||
        !Number.isInteger(after.round) ||
        before.round >= after.round ||
        !isRfc3339DateTime(before.captured_at) ||
        !isRfc3339DateTime(after.captured_at) ||
        compareRfc3339DateTimes(before.captured_at, after.captured_at) >= 0 ||
        !finding.evidence_ids.includes(before.id) ||
        !finding.evidence_ids.includes(after.id)
      )
        add(
          issues,
          at,
          "resolved P0/P1 requires chronologically ordered, distinct before and after capture hashes, including decoded pixels for product UI; decoded pixels must differ materially"
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

function visualDifferenceForCaptures(root, before, after) {
  try {
    const beforeFile = readBoundFile(root, before.path, "before capture", []);
    const afterFile = readBoundFile(root, after.path, "after capture", []);
    if (!beforeFile || !afterFile) return null;
    return visualDifference(
      inspectMediaOnce(beforeFile, "png", inspectPngVisualBytes),
      inspectMediaOnce(afterFile, "png", inspectPngVisualBytes)
    );
  } catch {
    return null;
  }
}

function isMaterialVisualDifference(difference) {
  return (
    difference !== null &&
    difference.distance >= MIN_CROSS_STATE_VISUAL_DISTANCE &&
    difference.changedTileRatio >= MIN_CROSS_STATE_CHANGED_TILE_RATIO
  );
}

function inspectMediaOnce(file, profile, inspect) {
  const cacheKey = `${profile}:${file.sha256}`;
  let cached = activeReadCache?.media.get(cacheKey);
  if (!cached) {
    try {
      cached = { value: inspect(file.bytes) };
    } catch (error) {
      cached = { error: error instanceof Error ? error.message : String(error) };
    }
    activeReadCache?.media.set(cacheKey, cached);
  }
  if (cached.error !== undefined) throw new Error(cached.error);
  return cached.value;
}

function validateCaptureBytes(root, item, label, issues, options = {}) {
  if (!object(item) || !text(item.path)) return;
  const file = readBoundFile(root, item.path, `${label}.path`, []);
  if (!file) return;
  try {
    if (item.kind === "screenshot") {
      if (options.webViewport) {
        const header = inspectPngHeaderBytes(file.bytes);
        validateViewport(options.webViewport, header.width, header.height);
      }
      const dimensions = inspectMediaOnce(file, "png", inspectPngVisualBytes);
      if (dimensions.width !== item.width || dimensions.height !== item.height)
        add(
          issues,
          label,
          `declared dimensions must equal ${dimensions.width}x${dimensions.height}`
        );
      return dimensions;
    }
    if (item.kind === "pdf") {
      const inspected = inspectMediaOnce(file, "pdf", inspectPdfBytes);
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
        `product UI screenshot effective visible coverage must be at least ${Math.round(MIN_VISIBLE_PIXEL_RATIO * 100)}% of the image`
      );
    if (!decoded.hasVisualVariation)
      add(issues, label, "product UI screenshot must contain non-uniform visible content");
    if (
      decoded.meaningfulPixelRatio === null ||
      decoded.meaningfulPixelRatio < MIN_MEANINGFUL_PIXEL_RATIO
    )
      add(
        issues,
        label,
        `product UI screenshot meaningful pixels must cover at least ${MIN_MEANINGFUL_PIXEL_RATIO * 100}%`
      );
    if (
      decoded.meaningfulTileRatio === null ||
      decoded.meaningfulTileRatio < MIN_MEANINGFUL_TILE_RATIO
    )
      add(
        issues,
        label,
        `product UI screenshot meaningful content must occupy at least ${MIN_MEANINGFUL_TILE_RATIO * 100}% of spatial tiles`
      );
    if (!Number.isSafeInteger(decoded.colorBucketCount) || decoded.colorBucketCount < 2)
      add(
        issues,
        label,
        "product UI screenshot must contain at least two meaningful color buckets"
      );
    if (
      !Number.isSafeInteger(decoded.luminanceRange) ||
      decoded.luminanceRange < MIN_LUMINANCE_RANGE
    )
      add(
        issues,
        label,
        `product UI screenshot luminance range must be at least ${MIN_LUMINANCE_RANGE}`
      );
  }
  const platform = subjects.get(coverage.subject_id)?.platform;
  if (platform === "web") {
    try {
      validateViewport(coverage.viewport, decoded.width, decoded.height);
    } catch (error) {
      add(issues, label, error.message);
    }
    return;
  }
  const bounds =
    platform === "mobile" && coverage.viewport === "device" ? PRODUCT_UI_DEVICE_BOUNDS : null;
  if (!bounds) return;
  if (bounds.min && decoded.width < bounds.min)
    add(
      issues,
      label,
      `${coverage.viewport} product UI capture width must be at least ${bounds.min} pixels; decoded width is ${decoded.width}`
    );
  if (bounds.max && decoded.width > bounds.max)
    add(
      issues,
      label,
      `${coverage.viewport} product UI capture width must be at most ${bounds.max} pixels; decoded width is ${decoded.width}`
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
  if (report.schema_version === 2) {
    const assurance = visibleMarker(
      html,
      { "data-dc-review-assurance": report.review_assurance },
      css
    );
    if (
      !assurance ||
      !normalizeVisible(assurance.text).includes(normalizeVisible(report.review_assurance))
    )
      add(
        issues,
        "report.human_report",
        "visible reviewer assurance must state the workflow-attested non-cryptographic level"
      );
  }
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
        row.review.execution?.assurance,
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
    ...(report.schema_version === 2
      ? [
          {
            attributes: { "data-dc-review-assurance": report.review_assurance },
            requiredText: [report.review_assurance],
          },
        ]
      : []),
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
        row.review.execution?.assurance,
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
    assurance: row.review.execution?.assurance,
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
    const loaded =
      cached ||
      readProjectInput(root, cacheKey, maxBytes, {
        allowManagedDirectoryPointers: isManagedCaptureMemberPath(cacheKey),
        managedDirectoryVerificationContext: activeReadCache?.projectInputVerificationContext,
      });
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
function shouldVerifyCaptureBrowser(options) {
  return options.verifyCaptureBrowser === undefined
    ? options.verifyBrowser !== false
    : options.verifyCaptureBrowser !== false;
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
