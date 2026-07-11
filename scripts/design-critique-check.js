#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { inspectHtmlArtifact } = require("./artifact-check");
const { isRfc3339DateTime } = require("./lib/iso-time");

const MODES = new Set(["product-ui", "pm-artifact"]);
const OUTCOMES = new Set(["passed", "failed", "blocked", "deferred"]);
const PRIORITIES = new Set(["P0", "P1", "P2", "P3"]);
const FINDING_STATUSES = new Set(["open", "resolved", "deferred", "dismissed"]);
const VIEWPORTS = new Set(["desktop", "tablet", "narrow", "device", "print"]);
const STATES = new Set(["primary", "empty", "error", "boundary", "responsive", "print"]);
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
  const root = fs.realpathSync(path.resolve(options.root || process.cwd()));
  const issues = [];
  const routeFile = readJsonFile(root, options.routePath, "route", issues);
  const capturesFile = readJsonFile(root, options.capturesPath, "captures", issues);
  const reportFile = readJsonFile(root, options.reportPath, "report", issues);
  if (!routeFile || !capturesFile || !reportFile) return { ok: false, issues };

  const route = routeFile.value;
  const captures = capturesFile.value;
  const report = reportFile.value;
  validateRoute(route, options.commit, issues);
  if (options.verifyDiff !== false) validateDiffIdentity(root, route, issues);
  validateCaptures(root, captures, route, routeFile, issues);
  validateReport(root, report, route, captures, routeFile, capturesFile, reportFile, issues);
  return { ok: issues.length === 0, issues };
}

function validateRoute(route, commit, issues) {
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

function validateDiffIdentity(root, route, issues) {
  if (
    !text(route?.source?.base_ref) ||
    !sha(route?.source?.commit) ||
    !sha256(route?.source?.diff_sha256)
  )
    return;
  try {
    const bytes = execFileSync(
      "git",
      ["diff", "--binary", `${route.source.base_ref}...${route.source.commit}`],
      { cwd: root, encoding: null, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024 }
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
    } else {
      for (const viewport of ["desktop", "tablet", "narrow"])
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
  const capturedCoverage = new Map();
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
    capturedCoverage.set(item.coverage_id, (capturedCoverage.get(item.coverage_id) || 0) + 1);
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
    const count = capturedCoverage.get(item.id) || 0;
    if (item.required && count !== 1)
      add(
        issues,
        `captures.captures`,
        `required coverage ${item.id} must be captured exactly once`
      );
    if (!item.required && count > 0)
      add(issues, `captures.captures`, `non-applicable coverage ${item.id} cannot have a capture`);
  }
  validateEvidence(root, captures.evidence, route, captures.captures || [], issues);
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
      structural.artifact?.sha256 !== artifactFile.sha256 ||
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
    if (
      realPathMaybe(render.source?.path) !== artifactFile.path ||
      render.source?.sha256 !== `sha256:${artifactFile.sha256}`
    )
      add(issues, `${at}.render.source`, "must bind the exact HTML bytes");
    const viewports = new Set((render.captures || []).map((item) => item.name));
    for (const viewport of ["desktop", "tablet", "narrow"])
      if (!viewports.has(viewport)) add(issues, `${at}.render.captures`, `missing ${viewport}`);
    if (
      !text(render.print?.path) ||
      !/^sha256:[a-f0-9]{64}$/.test(render.print?.sha256 || "") ||
      !positiveInt(render.print?.bytes) ||
      !positiveInt(render.print?.pages)
    )
      add(issues, `${at}.render.print`, "requires a non-empty hash-bound PDF");
    const renderedFiles = new Set();
    for (const item of render.captures || []) {
      if (item.path && item.sha256) renderedFiles.add(`${realPathMaybe(item.path)}|${item.sha256}`);
      if (item.full_page?.path && item.full_page?.sha256)
        renderedFiles.add(`${realPathMaybe(item.full_page.path)}|${item.full_page.sha256}`);
    }
    if (render.print?.path && render.print?.sha256)
      renderedFiles.add(`${realPathMaybe(render.print.path)}|${render.print.sha256}`);
    const subjectCoverage = new Set(
      (route.coverage || [])
        .filter((item) => item.subject_id === subject.id && item.required)
        .map((item) => item.id)
    );
    for (const capture of captureRows.filter((item) => subjectCoverage.has(item.coverage_id))) {
      const file = readBoundFile(root, capture.path, `${at}.capture.${capture.id}`, []);
      if (file && !renderedFiles.has(`${file.path}|sha256:${file.sha256}`))
        add(issues, `${at}.capture.${capture.id}`, "is not bound by the artifact render manifest");
    }
  }
}

function readEvidenceJson(root, entry, label, issues) {
  if (!entry) return null;
  const file = readBoundFile(root, entry.path, `${label}.path`, issues);
  if (!file) return null;
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
  if (!Number.isInteger(report.rounds) || report.rounds < 1 || report.rounds > 2)
    add(issues, "report.rounds", "must be 1 or 2");
  validateScores(report.scores, route.mode, issues);
  validateFindings(report.findings, route, captures, report.outcome, issues);
  const required = (route.coverage || []).filter((item) => item.required).length;
  const captured = new Set((captures.captures || []).map((item) => item.coverage_id));
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
  validateHumanReport(root, report.human_report, reportFile, capturesFile, issues);
}

function validateScores(scores, mode, issues) {
  if (!object(scores)) return add(issues, "report.scores", "must be an object");
  const expected = new Set(SCORE_KEYS[mode] || []);
  for (const key of Object.keys(scores))
    if (!expected.has(key)) add(issues, `report.scores.${key}`, "is not valid for this mode");
  for (const key of expected)
    if (!Number.isInteger(scores[key]) || scores[key] < 1 || scores[key] > 5)
      add(issues, `report.scores.${key}`, "must be an integer from 1 to 5");
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
      if (!before || !after || before.sha256 === after.sha256)
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
  if (item.kind === "screenshot") {
    const png = file.bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
    const jpeg = file.bytes.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"));
    const webp =
      file.bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
      file.bytes.subarray(8, 12).toString("ascii") === "WEBP";
    if (!png && !jpeg && !webp) add(issues, label, "screenshot bytes must be PNG, JPEG, or WebP");
  }
  if (item.kind === "pdf" && file.bytes.subarray(0, 5).toString("ascii") !== "%PDF-")
    add(issues, label, "PDF capture has an invalid signature");
}

function validateHumanReport(root, human, reportFile, capturesFile, issues) {
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
    const real = fs.realpathSync(resolved);
    if (real !== root && !real.startsWith(`${fs.realpathSync(root)}${path.sep}`))
      throw new Error("resolves outside project root");
    const bytes = fs.readFileSync(real);
    return {
      path: real,
      relative: path.relative(root, real).split(path.sep).join("/"),
      bytes,
      sha256: digest(bytes),
    };
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
    }[arg];
    if (!key) throw new Error(`unknown argument ${arg}`);
    if (!argv[index + 1] || argv[index + 1].startsWith("--"))
      throw new Error(`${arg} requires a value`);
    out[key] = argv[++index];
  }
  for (const key of ["routePath", "capturesPath", "reportPath", "commit"])
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
