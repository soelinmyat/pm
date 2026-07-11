#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { inspectHtmlArtifact, structuralMarkup } = require("./artifact-check");
const { VIEWPORTS: ARTIFACT_VIEWPORTS } = require("./artifact-render-check");
const { isRfc3339DateTime } = require("./lib/iso-time");

const MODES = new Set(["product-ui", "pm-artifact"]);
const OUTCOMES = new Set(["passed", "failed", "blocked", "deferred"]);
const PRIORITIES = new Set(["P0", "P1", "P2", "P3"]);
const FINDING_STATUSES = new Set(["open", "resolved", "deferred", "dismissed"]);
const VIEWPORTS = new Set(["desktop", "tablet", "narrow", "device", "print"]);
const STATES = new Set(["primary", "empty", "error", "boundary", "responsive", "print"]);
const MAX_EVIDENCE_BYTES = 64 * 1024 * 1024;
const MAX_JSON_BYTES = 4 * 1024 * 1024;
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

function checkDesignCritique(options) {
  const previousCache = activeReadCache;
  activeReadCache = new Map();
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
  const gitIdentity =
    options.verifyGit === false
      ? { commit: options.commit, baseRef: options.baseRef }
      : resolveGitIdentity(root, options, issues);
  validateRoute(route, gitIdentity.commit, gitIdentity.baseRef, issues);
  if (options.verifyGit !== false) validateDiffIdentity(root, route, gitIdentity.baseRef, issues);
  validateCaptures(root, captures, route, routeFile, issues);
  validateReport(root, report, route, captures, routeFile, capturesFile, reportFile, issues);
  return { ok: issues.length === 0, issues };
}

function validateRoute(route, commit, baseRef, issues) {
  if (!object(route)) return add(issues, "route", "must be an object");
  if (route.schema_version !== 1) add(issues, "route.schema_version", "must equal 1");
  if (!text(route.run_id)) add(issues, "route.run_id", "is required");
  if (!isRfc3339DateTime(route.created_at)) add(issues, "route.created_at", "must be RFC 3339");
  if (!MODES.has(route.mode)) add(issues, "route.mode", "must be product-ui or pm-artifact");
  if (!object(route.source)) add(issues, "route.source", "is required");
  else {
    if (!sha(route.source.commit))
      add(issues, "route.source.commit", "must be a SHA-1 or SHA-256 commit");
    if (commit && route.source.commit !== commit)
      add(issues, "route.source.commit", `must equal current commit ${commit}`);
    if (!text(route.source.base_ref)) add(issues, "route.source.base_ref", "is required");
    if (baseRef && route.source.base_ref !== baseRef)
      add(issues, "route.source.base_ref", `must equal expected base ${baseRef}`);
    if (!sha256(route.source.diff_sha256))
      add(issues, "route.source.diff_sha256", "must be SHA-256");
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
  const trustedBase =
    options.verifyBase === false ? options.baseRef : resolveTrustedBase(root, issues);
  if (trustedBase && options.baseRef && trustedBase !== options.baseRef)
    add(issues, "base", `supplied base must equal repository default ${trustedBase}`);
  return { commit: head || options.commit, baseRef: trustedBase || options.baseRef };
}

function resolveTrustedBase(root, issues) {
  try {
    const symbolic = execFileSync(
      "git",
      ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
      { cwd: root, encoding: "utf8" }
    ).trim();
    if (symbolic) return symbolic;
  } catch {
    // Fall through to the conventional remote default only when it exists.
  }
  try {
    execFileSync("git", ["rev-parse", "--verify", "origin/main"], {
      cwd: root,
      stdio: "ignore",
    });
    return "origin/main";
  } catch {
    add(issues, "base", "cannot resolve trusted origin default branch");
    return "";
  }
}

function validateDiffIdentity(root, route, baseRef, issues) {
  if (
    !text(route?.source?.base_ref) ||
    !sha(route?.source?.commit) ||
    !sha256(route?.source?.diff_sha256)
  )
    return;
  try {
    const bytes = execFileSync("git", ["diff", "--binary", `${baseRef}...${route.source.commit}`], {
      cwd: root,
      encoding: null,
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 32 * 1024 * 1024,
    });
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
      for (const state of ["primary", "empty", "error", "boundary"])
        if (!rows.some((item) => item.state === state))
          add(issues, `route.coverage.${subject.id}`, `must decide applicability for ${state}`);
      if (!required("primary", "desktop") && subject.platform === "web")
        add(issues, `route.coverage.${subject.id}`, "web primary desktop capture is required");
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
  if (captures.schema_version !== 1) add(issues, "captures.schema_version", "must equal 1");
  if (captures.run_id !== route.run_id || captures.mode !== route.mode)
    add(issues, "captures", "run_id and mode must match route");
  if (captures.commit !== route.source?.commit)
    add(issues, "captures.commit", "must match route commit");
  if (!isRfc3339DateTime(captures.checked_at))
    add(issues, "captures.checked_at", "must be RFC 3339");
  validateBinding(captures.route, routeFile, "captures.route", issues);
  const coverage = new Map((route.coverage || []).map((item) => [item.id, item]));
  const captureIds = new Set();
  const activeCoverage = new Map();
  const allCoverage = new Map();
  if (!Array.isArray(captures.captures)) add(issues, "captures.captures", "must be an array");
  for (const [index, item] of (captures.captures || []).entries()) {
    const at = `captures.captures[${index}]`;
    if (!object(item) || !slug(item.id) || captureIds.has(item.id)) {
      add(issues, `${at}.id`, "must be unique kebab-case");
      continue;
    }
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
    validateCaptureBytes(root, item, at, issues);
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
  validateEvidence(root, captures.evidence, route, captures.captures || [], issues);
}

function validateAuditEvidence(root, entry, route, captureRows, label, issues) {
  const audit = readEvidenceJson(root, entry, label, issues);
  if (!audit) return;
  if (
    audit.schema_version !== 1 ||
    audit.subject_id !== entry.subject_id ||
    audit.commit !== route.source?.commit
  )
    add(issues, label, "audit schema, subject, and commit must match the route");
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
  else if (activeCaptureIds.some((id) => !audit.capture_ids.includes(id)))
    add(issues, `${label}.capture_ids`, "must include every active capture for the subject");
  const requiredChecks =
    entry.kind === "accessibility-tree"
      ? ["landmarks", "names", "focus_order"]
      : ["overflow", "edge_alignment", "hierarchy"];
  if (!object(audit.checks) || requiredChecks.some((name) => audit.checks[name] !== true))
    add(issues, `${label}.checks`, `requires passing ${requiredChecks.join(", ")}`);
  if (!Array.isArray(audit.findings)) add(issues, `${label}.findings`, "must be an array");
}

function validateEvidence(root, evidence, route, captureRows, issues) {
  if (!Array.isArray(evidence)) return add(issues, "captures.evidence", "must be an array");
  const ids = new Set();
  for (const [index, item] of evidence.entries()) {
    const at = `captures.evidence[${index}]`;
    if (!object(item) || !slug(item.id) || ids.has(item.id))
      add(issues, `${at}.id`, "must be unique kebab-case");
    ids.add(item?.id);
    if (!(route.subjects || []).some((subject) => subject.id === item?.subject_id))
      add(issues, `${at}.subject_id`, "must reference a subject");
    if (
      !["accessibility-tree", "dom-audit", "artifact-structural", "artifact-render"].includes(
        item?.kind
      )
    )
      add(issues, `${at}.kind`, "is invalid");
    validateFileBinding(root, item, at, issues);
    if (["accessibility-tree", "dom-audit"].includes(item?.kind))
      validateAuditEvidence(root, item, route, captureRows, at, issues);
  }
  for (const subject of route.subjects || []) {
    const kinds = new Set(
      evidence.filter((item) => item.subject_id === subject.id).map((item) => item.kind)
    );
    if (!kinds.has("accessibility-tree"))
      add(issues, `captures.evidence.${subject.id}`, "requires accessibility-tree evidence");
    if (route.mode === "product-ui" && subject.platform === "web" && !kinds.has("dom-audit"))
      add(issues, `captures.evidence.${subject.id}`, "web UI requires dom-audit evidence");
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
    if (
      realPathMaybe(render.source?.path) !== artifactFile.path ||
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
      if (
        !object(item.metrics) ||
        item.metrics.horizontalOverflow !== false ||
        item.metrics.mainVisible !== true ||
        item.metrics.h1Visible !== true ||
        !Number.isFinite(item.metrics.bodyText) ||
        item.metrics.bodyText < 100 ||
        !Number.isFinite(item.metrics.anchorCount) ||
        item.metrics.anchorCount < 1
      )
        add(issues, `${at}.render.${expected.name}.metrics`, "requires passing render metrics");
    }
    if (
      !text(render.print?.path) ||
      !/^sha256:[a-f0-9]{64}$/.test(render.print?.sha256 || "") ||
      !positiveInt(render.print?.bytes) ||
      !positiveInt(render.print?.pages)
    )
      add(issues, `${at}.render.print`, "requires a non-empty hash-bound PDF");
    else {
      const printFile = readAbsoluteProjectFile(
        root,
        render.print.path,
        `${at}.render.print.path`,
        issues
      );
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
      if (item.path && item.sha256) files.add(`${realPathMaybe(item.path)}|${item.sha256}`);
      if (item.full_page?.path && item.full_page?.sha256)
        files.add(`${realPathMaybe(item.full_page.path)}|${item.full_page.sha256}`);
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
          ? new Set([`${realPathMaybe(render.print?.path)}|${render.print?.sha256}`])
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
  const file = readAbsoluteProjectFile(root, item.path, `${label}.path`, issues);
  if (!file) return;
  if (seen.has(file.path)) add(issues, label, "render files must be distinct");
  seen.add(file.path);
  if (item.sha256 !== `sha256:${file.sha256}` || item.bytes !== file.bytes.length)
    add(issues, label, "render hash and byte count must match the file");
  try {
    const dimensions = inspectPngStrict(file.bytes);
    if (dimensions.width !== width || dimensions.height !== height)
      add(issues, label, `render dimensions must equal ${width}x${height}`);
  } catch (error) {
    add(issues, label, error.message);
  }
}

function readAbsoluteProjectFile(root, absolute, label, issues) {
  if (!text(absolute) || !path.isAbsolute(absolute)) {
    add(issues, label, "must be an absolute renderer path");
    return null;
  }
  const relative = path.relative(root, realPathMaybe(absolute));
  return readBoundFile(root, relative, label, issues);
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
  reportFile,
  issues
) {
  if (!object(report)) return add(issues, "report", "must be an object");
  if (report.schema_version !== 1) add(issues, "report.schema_version", "must equal 1");
  if (!isRfc3339DateTime(report.checked_at)) add(issues, "report.checked_at", "must be RFC 3339");
  if (
    report.run_id !== route.run_id ||
    report.mode !== route.mode ||
    report.commit !== route.source?.commit
  )
    add(issues, "report", "run_id, mode, and commit must match route");
  validateBinding(report.route, routeFile, "report.route", issues);
  validateBinding(report.captures, capturesFile, "report.captures", issues);
  if (!OUTCOMES.has(report.outcome)) add(issues, "report.outcome", "is invalid");
  if (!text(report.next_action)) add(issues, "report.next_action", "is required");
  if (!Number.isInteger(report.rounds) || report.rounds < 1 || report.rounds > 2)
    add(issues, "report.rounds", "must be 1 or 2");
  if ((captures.captures || []).some((item) => item.round > report.rounds))
    add(issues, "report.rounds", "must include every recorded capture round");
  validateScores(report.scores, route.mode, captures, issues);
  validateFindings(report.findings, route, captures, report.outcome, issues);
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
  if (
    report.outcome === "deferred" &&
    (!object(report.authority) ||
      !text(report.authority.approver) ||
      !text(report.authority.decision))
  )
    add(issues, "report.authority", "deferred requires approver and decision");
  validateHumanReport(root, report.human_report, report, reportFile, capturesFile, issues);
}

function validateScores(scores, mode, captures, issues) {
  if (!object(scores)) return add(issues, "report.scores", "must be an object");
  const expected = new Set(SCORE_KEYS[mode] || []);
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
    if (!Number.isInteger(score.value) || score.value < 1 || score.value > 5)
      add(issues, `report.scores.${key}.value`, "must be an integer from 1 to 5");
    if (!text(score.rationale)) add(issues, `report.scores.${key}.rationale`, "is required");
    if (
      !Array.isArray(score.evidence_ids) ||
      score.evidence_ids.length === 0 ||
      score.evidence_ids.some((id) => !evidenceIds.has(id))
    )
      add(issues, `report.scores.${key}.evidence_ids`, "must cite known evidence");
  }
}

function validateFindings(findings, route, captures, outcome, issues) {
  if (!Array.isArray(findings)) return add(issues, "report.findings", "must be an array");
  const captureById = new Map((captures.captures || []).map((item) => [item.id, item]));
  const evidenceIds = new Set((captures.evidence || []).map((item) => item.id));
  const ids = new Set();
  for (const [index, finding] of findings.entries()) {
    const at = `report.findings[${index}]`;
    if (!object(finding)) {
      add(issues, at, "must be an object");
      continue;
    }
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
      for (const id of finding.evidence_ids)
        if (!captureById.has(id) && !evidenceIds.has(id))
          add(issues, `${at}.evidence_ids`, `unknown evidence ${id}`);
    if (["P0", "P1"].includes(finding.priority) && finding.status === "resolved") {
      const before = captureById.get(finding.before_capture_id);
      const after = captureById.get(finding.after_capture_id);
      const subjectCoverage = new Set(
        (route.coverage || [])
          .filter((item) => item.subject_id === finding.subject_id)
          .map((item) => item.id)
      );
      if (
        !before ||
        !after ||
        before.sha256 === after.sha256 ||
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
        add(issues, at, "resolved P0/P1 requires distinct before and after capture hashes");
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
        ["open", "deferred"].includes(f.status)
    )
  )
    add(issues, "report.outcome", "passed cannot contain open or deferred P0/P1 findings");
}

function validateCaptureBytes(root, item, label, issues) {
  if (!object(item) || !text(item.path)) return;
  const file = readBoundFile(root, item.path, `${label}.path`, []);
  if (!file) return;
  try {
    if (item.kind === "screenshot") {
      const dimensions = inspectPngStrict(file.bytes);
      if (dimensions.width !== item.width || dimensions.height !== item.height)
        add(
          issues,
          label,
          `declared dimensions must equal ${dimensions.width}x${dimensions.height}`
        );
    }
    if (item.kind === "pdf") {
      const inspected = inspectPdfStrict(file.bytes);
      if (!positiveInt(item.pages) || item.pages !== inspected.pages)
        add(issues, label, `declared pages must equal ${inspected.pages}`);
    }
  } catch (error) {
    add(issues, label, error.message);
  }
}

function inspectPngStrict(bytes) {
  const signature = Buffer.from("89504e470d0a1a0a", "hex");
  if (bytes.length < 1024 || !bytes.subarray(0, 8).equals(signature))
    throw new Error("invalid PNG capture");
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let sawHeader = false;
  let sawEnd = false;
  const compressed = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) throw new Error("invalid PNG chunk length");
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    const expectedCrc = bytes.readUInt32BE(offset + 8 + length);
    if (crc32(Buffer.concat([Buffer.from(type, "ascii"), data])) !== expectedCrc)
      throw new Error(`invalid PNG ${type} checksum`);
    if (type === "IHDR") {
      if (sawHeader || length !== 13 || offset !== 8) throw new Error("invalid PNG header");
      sawHeader = true;
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
      if (!positiveInt(width) || !positiveInt(height) || data[10] !== 0 || data[11] !== 0)
        throw new Error("invalid PNG dimensions or compression");
    } else if (type === "IDAT") compressed.push(data);
    else if (type === "IEND") {
      if (length !== 0) throw new Error("invalid PNG end chunk");
      sawEnd = true;
      offset = end;
      break;
    }
    offset = end;
  }
  if (!sawHeader || !sawEnd || compressed.length === 0 || interlace !== 0)
    throw new Error("PNG must contain non-interlaced IHDR, IDAT, and IEND chunks");
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels || ![1, 2, 4, 8, 16].includes(bitDepth)) throw new Error("unsupported PNG format");
  let pixels;
  try {
    pixels = zlib.inflateSync(Buffer.concat(compressed), { maxOutputLength: 256 * 1024 * 1024 });
  } catch (error) {
    throw new Error(`invalid PNG pixel stream: ${error.message}`);
  }
  const rowBytes = Math.ceil((width * channels * bitDepth) / 8);
  if (pixels.length !== (rowBytes + 1) * height) throw new Error("invalid PNG pixel length");
  for (let row = 0; row < height; row += 1)
    if (pixels[row * (rowBytes + 1)] > 4) throw new Error("invalid PNG row filter");
  return { width, height };
}

function inspectPdfStrict(bytes) {
  if (bytes.length < 1024 || !/^%PDF-1\.[0-7]/.test(bytes.subarray(0, 8).toString("ascii")))
    throw new Error("invalid PDF header");
  const textValue = bytes.toString("latin1");
  if (!/%%EOF\s*$/.test(textValue)) throw new Error("invalid PDF end marker");
  const startMatches = [...textValue.matchAll(/startxref\s+(\d+)\s+%%EOF/g)];
  if (startMatches.length === 0) throw new Error("PDF startxref is required");
  const xrefOffset = Number(startMatches.at(-1)[1]);
  if (!Number.isSafeInteger(xrefOffset) || xrefOffset < 9 || xrefOffset >= bytes.length)
    throw new Error("invalid PDF xref offset");
  const xrefText = textValue.slice(xrefOffset, xrefOffset + 200);
  if (!xrefText.startsWith("xref") && !/\d+\s+\d+\s+obj[\s\S]*\/Type\s*\/XRef/.test(xrefText))
    throw new Error("invalid PDF xref structure");
  const catalog = textValue.match(/\d+\s+\d+\s+obj[\s\S]*?\/Type\s*\/Catalog[\s\S]*?endobj/);
  const pagesRoot = textValue.match(
    /\d+\s+\d+\s+obj[\s\S]*?\/Type\s*\/Pages\b[\s\S]*?\/Count\s+(\d+)[\s\S]*?endobj/
  );
  const pages = (textValue.match(/\/Type\s*\/Page\b/g) || []).length;
  if (!catalog || !pagesRoot || pages < 1 || Number(pagesRoot[1]) !== pages)
    throw new Error("invalid PDF catalog or page tree");
  return { pages };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let value = 0; value < 256; value += 1) {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    table[value] = crc >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function validateHumanReport(root, human, report, reportFile, capturesFile, issues) {
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
  const html = structuralMarkup(htmlFile.bytes.toString("utf8"));
  const outcome = visibleMarker(html, { "data-dc-outcome": report.outcome });
  if (!outcome || normalizeVisible(outcome.text).toLowerCase() !== report.outcome)
    add(issues, "report.human_report", "visible outcome marker must match report JSON");
  const coverage = visibleMarker(html, {
    "data-dc-coverage": String(report.coverage?.percent),
  });
  if (!coverage || !normalizeVisible(coverage.text).includes(`${report.coverage?.percent}%`))
    add(issues, "report.human_report", "visible coverage marker must match report JSON");
  const nextAction = visibleMarker(html, {
    "data-dc-next-action-sha256": digest(Buffer.from(report.next_action || "")),
  });
  if (
    !nextAction ||
    !normalizeVisible(nextAction.text).includes(normalizeVisible(report.next_action))
  )
    add(issues, "report.human_report", "visible next action must match report JSON");
  for (const [key, score] of Object.entries(report.scores || {})) {
    const marker = visibleMarker(html, {
      "data-dc-score-key": key,
      "data-dc-score-value": score.value,
    });
    if (!marker || !normalizeVisible(marker.text).includes(normalizeVisible(score.rationale)))
      add(issues, "report.human_report", `visible score ${key} must match report JSON`);
  }
  for (const finding of report.findings || []) {
    const projection = findingProjection(finding);
    const marker = visibleMarker(html, {
      "data-dc-finding-id": finding.id,
      "data-dc-finding-priority": finding.priority,
      "data-dc-finding-status": finding.status,
      "data-dc-finding-sha256": digest(Buffer.from(JSON.stringify(projection))),
    });
    const visibleText = normalizeVisible(marker?.text || "");
    if (
      !marker ||
      ![finding.summary, finding.remediation, finding.owner, ...finding.evidence_ids].every(
        (value) => visibleText.includes(normalizeVisible(value))
      )
    )
      add(issues, "report.human_report", `missing visible finding ${finding.id}`);
  }
}

function hasDataValue(html, attribute, value) {
  const escaped = String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${attribute}=["']${escaped}["']`, "i").test(html);
}

function visibleMarker(html, attributes) {
  const firstAttribute = Object.keys(attributes)[0];
  const pattern = new RegExp(
    `<([a-z][a-z0-9-]*)\\b(?=[^>]*\\b${firstAttribute}=["'])[^>]*>([\\s\\S]*?)<\\/\\1>`,
    "gi"
  );
  for (const match of String(html).matchAll(pattern)) {
    const opening = match[0].slice(0, match[0].indexOf(">") + 1);
    if (!Object.entries(attributes).every(([name, value]) => hasDataValue(opening, name, value)))
      continue;
    if (
      /\bhidden\b|\baria-hidden=["']true["']|style=["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(
        opening
      )
    )
      continue;
    const textValue = match[2].replace(/<[^>]+>/g, " ");
    if (normalizeVisible(textValue)) return { text: textValue };
  }
  return null;
}

function normalizeVisible(value) {
  return String(value)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
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

function findingId(finding) {
  const material = JSON.stringify([
    finding.subject_id || "",
    finding.region || "",
    finding.rule || "",
    [...(finding.evidence_ids || [])].sort(),
  ]);
  return `dc-${crypto.createHash("sha256").update(material).digest("hex").slice(0, 16)}`;
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

function readBoundFile(root, rel, label, issues) {
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
    const stat = fs.lstatSync(resolved);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error("must be a regular non-symlink file");
    if (stat.size > MAX_EVIDENCE_BYTES)
      throw new Error(`exceeds the ${MAX_EVIDENCE_BYTES}-byte evidence budget`);
    const real = fs.realpathSync(resolved);
    if (real !== root && !real.startsWith(`${fs.realpathSync(root)}${path.sep}`))
      throw new Error("resolves outside project root");
    const cached = activeReadCache?.get(real);
    const file = cached || {
      path: real,
      bytes: fs.readFileSync(real),
    };
    if (!cached) {
      file.sha256 = digest(file.bytes);
      activeReadCache?.set(real, file);
    }
    return { ...file, relative: path.relative(root, real).split(path.sep).join("/") };
  } catch (error) {
    add(issues, label, error.message);
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
    }[arg];
    if (!key) throw new Error(`unknown argument ${arg}`);
    if (!argv[index + 1] || argv[index + 1].startsWith("--"))
      throw new Error(`${arg} requires a value`);
    out[key] = argv[++index];
  }
  for (const key of ["routePath", "capturesPath", "reportPath", "commit", "baseRef"])
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

module.exports = { checkDesignCritique, findingId };
