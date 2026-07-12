#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { inspectHtmlArtifact } = require("./artifact-check");
const { probeDataMarkerVisibility, resolveBrowser } = require("./artifact-render-check");
const projectWriter = require("./lib/project-atomic-write");
const { readProjectInput } = require("./lib/safe-project-output");
const {
  expectedPriorReportPath,
  expectedReviewPath,
  reviewPathContext,
} = require("./lib/review-paths");
const { isRfc3339DateTime } = require("./lib/iso-time");
const {
  MAX_CHANGED_FILE_BYTES,
  MAX_EVIDENCE_PER_FINDING,
  MAX_EVIDENCE_BYTES_PER_CHECK,
  MAX_FINDING_PROSE_CHARS,
  MAX_FINDING_RENDER_CHARS_PER_ROUND,
  MAX_FINDINGS_PER_REVIEWER,
  MAX_FINDINGS_PER_ROUND,
  MAX_HTML_BYTES,
  MAX_JSON_BYTES,
} = require("./lib/review-limits");
const {
  DECISION_ACTIONS,
  changeAnchorText,
  deriveLensApplicability,
  LENSES,
  OWNERS,
  SEVERITIES,
  findingId,
  mergeSignals,
} = require("./lib/review-contract");
const {
  assertCleanWorktree,
  changedFileInventory,
  readCommittedBlob,
  resolveTrustedBase,
} = require("./review-target");
const { version: PLUGIN_VERSION } = require("../plugin.config.json");

const EVIDENCE_KINDS = new Set([
  "source",
  "test",
  "contract",
  "trace",
  "benchmark",
  "design-token",
  "upstream-gate",
]);
const FIX_KINDS = new Set(["mechanical", "behavioral", "decision"]);
const SIGNAL_DISPOSITIONS = new Set(["open"]);
const REQUIRED_EVIDENCE = Object.freeze({
  bug: new Set(["source", "test", "trace", "contract"]),
  design: new Set(["source", "design-token", "upstream-gate"]),
  edge: new Set(["source", "test", "contract", "trace"]),
  reuse: new Set(["source"]),
  quality: new Set(["source", "contract"]),
  efficiency: new Set(["source", "benchmark", "trace"]),
});
const FROZEN_MERGE_BASE = Symbol("review-frozen-merge-base");
const CHANGE_HUNK_CACHE = Symbol("review-change-hunk-cache");
const FROZEN_BLOB_CACHE = Symbol("review-frozen-blob-cache");
const BOUND_ARTIFACT_CACHE = Symbol("review-bound-artifact-cache");
const EVIDENCE_BYTE_LEDGER = Symbol("review-evidence-byte-ledger");
const CHANGE_HUNK_ANCHOR_POLICY = "changed-hunk-anchor-v1";
const MAX_CHANGE_ANCHORS = 8;
const MAX_ANCHOR_PATHS = 500;
const MAX_ANCHOR_RELATION_CHARS = 500;

function checkReview(options) {
  const root = fs.realpathSync(path.resolve(options.root || process.cwd()));
  const issues = [];
  const warnings = [];
  const targetFile = readJson(root, options.targetPath, "target", issues);
  if (!targetFile) return { ok: false, issues, report: null };
  const target = targetFile.value;
  validateTarget(target, issues);
  if (issues.length > 0) return { ok: false, issues, report: null };
  let reviewRoot = null;
  let canonicalReviewRoot = null;
  try {
    const context = reviewPathContext(targetFile.relative, target.review_round, target.run_id);
    reviewRoot = context.evidenceRoot;
    canonicalReviewRoot = context.canonicalRoot;
  } catch (error) {
    add(issues, "target.path", error.message);
  }
  validateTargetBindings(root, target, reviewRoot, issues);
  if (options.verifyGit !== false) validateLiveTarget(root, target, issues);
  else if (options.verifyFrozenGit === true) validateFrozenTarget(root, target, issues);

  const planned = new Map((target.allocation || []).map((item) => [item.worker_id, item]));
  const resultFiles = (options.resultPaths || []).map((resultPath, index) =>
    readJson(root, resultPath, `results[${index}]`, issues)
  );
  const signals = [];
  const seenWorkers = new Set();
  for (const [index, resultFile] of resultFiles.entries()) {
    if (!resultFile) continue;
    validateResult(
      root,
      resultFile.value,
      resultFile,
      target,
      targetFile,
      planned,
      seenWorkers,
      signals,
      `results[${index}]`,
      issues
    );
    if (reviewRoot && object(resultFile.value) && slug(resultFile.value.worker_id)) {
      try {
        const expected = expectedReviewPath(reviewRoot, target.review_round, "result", {
          workerId: resultFile.value.worker_id,
        });
        if (resultFile.relative !== expected)
          add(issues, `results[${index}].path`, `must equal ${expected}`);
      } catch (error) {
        add(issues, `results[${index}].path`, error.message);
      }
    }
  }
  for (const workerId of planned.keys())
    if (!seenWorkers.has(workerId)) add(issues, "results", `missing planned reviewer ${workerId}`);
  if (resultFiles.filter(Boolean).length !== planned.size)
    add(issues, "results", "must contain exactly one result for every planned reviewer");

  const decisionsFile = options.decisionsPath
    ? readJson(root, options.decisionsPath, "decisions", issues)
    : null;
  if (
    reviewRoot &&
    decisionsFile &&
    decisionsFile.relative !== expectedReviewPath(reviewRoot, target.review_round, "decisions")
  )
    add(
      issues,
      "decisions.path",
      `must equal ${expectedReviewPath(reviewRoot, target.review_round, "decisions")}`
    );
  const decisions = validateDecisions(
    decisionsFile?.value,
    decisionsFile,
    target,
    targetFile,
    new Set(signals.map((item) => item.id)),
    issues
  );
  const merged = mergeSignals(signals, decisions);
  validateDecisionCoverage(merged, decisions, issues);
  const report = buildCanonicalReport(
    target,
    targetFile,
    resultFiles.filter(Boolean),
    decisionsFile,
    merged,
    options.humanReportPath
  );
  const reportStage = options.reportStage || "final";
  if (
    reportStage === "final" &&
    report.outcome === "passed" &&
    target.relevance_policy !== CHANGE_HUNK_ANCHOR_POLICY
  )
    add(
      issues,
      "target.relevance_policy",
      `final passing review evidence requires ${CHANGE_HUNK_ANCHOR_POLICY}; legacy targets are inspection-only`
    );
  if (reviewRoot && options.validateOnly !== true) {
    if (!new Set(["draft", "final"]).has(reportStage))
      add(issues, "report.stage", "must be draft or final");
    const expectedReport = expectedReviewPath(reviewRoot, target.review_round, "report", {
      outcome: report.outcome,
      stage: reportStage,
      canonicalRoot: canonicalReviewRoot,
    });
    const expectedHuman = expectedReviewPath(reviewRoot, target.review_round, "human", {
      outcome: report.outcome,
      stage: reportStage,
      canonicalRoot: canonicalReviewRoot,
    });
    if (options.reportPath !== expectedReport)
      add(issues, "report.path", `must equal ${expectedReport}`);
    if (options.humanReportPath !== expectedHuman)
      add(issues, "report.human_report.path", `must equal ${expectedHuman}`);
  }

  let validatedHumanReport = null;
  if (options.reportPath && !options.writeReport) {
    const reportFile = readJson(root, options.reportPath, "report", issues);
    if (reportFile)
      validatedHumanReport = validateReport(
        root,
        reportFile.value,
        report,
        reportFile,
        options,
        issues
      );
  }
  if (options.writeReport && options.reportPath && issues.length === 0)
    if (projectPath(options.reportPath)) {
      try {
        const immutable =
          (options.reportStage || "final") === "final" && report.outcome !== "passed";
        const publication = projectWriter.writeProjectJsonAtomic(root, options.reportPath, report, {
          fileMode: 0o600,
          directoryMode: 0o700,
          replace: !immutable,
          maxBytes: MAX_JSON_BYTES,
        });
        if (!publication.directory_synced)
          warnings.push({
            path: "report.path",
            message: `committed with unsupported directory sync ${publication.directory_sync_error}`,
          });
      } catch (error) {
        add(
          issues,
          "report.path",
          /EEXIST|file exists/i.test(error.message)
            ? "refusing to overwrite immutable non-passing round report"
            : error.message
        );
        return { ok: false, issues, report };
      }
    } else add(issues, "report.path", "must be project-relative without traversal");
  return {
    ok: issues.length === 0,
    issues,
    report,
    target,
    validated_human_report: validatedHumanReport,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

function validateTarget(target, issues) {
  if (!object(target)) return add(issues, "target", "must be an object");
  closed(
    target,
    [
      "schema_version",
      "relevance_policy",
      "run_id",
      "review_round",
      "iteration_cap",
      "created_at",
      "mode",
      "source",
      "changed_files",
      "dev_context",
      "acceptance",
      "upstream",
      "ownership",
      "lenses",
      "allocation",
      "prior_report",
    ],
    "target",
    issues
  );
  if (target.schema_version !== 1) add(issues, "target.schema_version", "must equal 1");
  if (
    target.relevance_policy !== undefined &&
    target.relevance_policy !== CHANGE_HUNK_ANCHOR_POLICY
  )
    add(issues, "target.relevance_policy", `must equal ${CHANGE_HUNK_ANCHOR_POLICY} when present`);
  if (!slug(target.run_id)) add(issues, "target.run_id", "must be kebab-case");
  if (!isRfc3339DateTime(target.created_at)) add(issues, "target.created_at", "must be RFC 3339");
  if (!Number.isInteger(target.review_round) || target.review_round < 1 || target.review_round > 3)
    add(issues, "target.review_round", "must be 1 through 3");
  if (target.iteration_cap !== 3) add(issues, "target.iteration_cap", "must equal 3");
  if (!new Set(["full", "code-scan"]).has(target.mode)) add(issues, "target.mode", "is invalid");
  validateSource(target.source, "target.source", issues);
  validateDevContext(target.dev_context, issues);
  validateBindingShape(target.acceptance, "target.acceptance", issues, true);
  validateBindingShape(target.prior_report, "target.prior_report", issues, true);
  if (target.review_round === 1 && target.prior_report !== null)
    add(issues, "target.prior_report", "round 1 cannot bind a prior report");
  if (target.review_round > 1 && !object(target.prior_report))
    add(issues, "target.prior_report", "later rounds require a prior report binding");
  if (!object(target.upstream)) add(issues, "target.upstream", "must be an object");
  else {
    closed(target.upstream, ["design_critique"], "target.upstream", issues);
    const design = target.upstream.design_critique;
    if (design !== null) {
      validateBindingShape(design, "target.upstream.design_critique", issues, false, [
        "commit",
        "outcome",
      ]);
      if (
        !sha(design?.commit) ||
        !new Set(["passed", "failed", "blocked", "deferred"]).has(design?.outcome)
      )
        add(issues, "target.upstream.design_critique", "requires commit and outcome");
      else if (design.commit !== target.source?.commit)
        add(
          issues,
          "target.upstream.design_critique.commit",
          "must attest the target source commit"
        );
    }
  }
  validateOwnership(target.ownership, issues);
  validateChangedFiles(target.changed_files, issues);
  validateLensesAndAllocation(target, issues);
}

function validateDevContext(context, issues) {
  if (context === null || context === undefined) return;
  if (!object(context)) return add(issues, "target.dev_context", "must be null or an object");
  closed(
    context,
    ["run_id", "slug", "review_mode", "decision_version", "acceptance_sha256"],
    "target.dev_context",
    issues
  );
  if (
    typeof context.run_id !== "string" ||
    !context.run_id.startsWith("dev_") ||
    !text(context.slug) ||
    !new Set(["full", "code-scan"]).has(context.review_mode) ||
    !Number.isInteger(context.decision_version) ||
    context.decision_version < 1 ||
    !sha256(context.acceptance_sha256)
  )
    add(issues, "target.dev_context", "must contain a valid canonical Dev context");
}

function validateSource(source, label, issues) {
  if (!object(source)) return add(issues, label, "must be an object");
  closed(source, ["commit", "base_ref", "base_commit", "diff_sha256"], label, issues);
  if (!sha(source.commit)) add(issues, `${label}.commit`, "must be a Git object ID");
  if (!text(source.base_ref)) add(issues, `${label}.base_ref`, "is required");
  if (!sha(source.base_commit)) add(issues, `${label}.base_commit`, "must be a Git object ID");
  if (!sha256(source.diff_sha256)) add(issues, `${label}.diff_sha256`, "must be SHA-256");
}

function validateOwnership(ownership, issues) {
  if (!object(ownership)) return add(issues, "target.ownership", "must be an object");
  closed(ownership, ["review", "design_critique", "qa"], "target.ownership", issues);
  for (const key of ["review", "design_critique", "qa"])
    if (
      !Array.isArray(ownership[key]) ||
      ownership[key].length === 0 ||
      ownership[key].some((v) => !text(v))
    )
      add(issues, `target.ownership.${key}`, "must be a non-empty string array");
}

function validateTargetBindings(root, target, reviewRoot, issues) {
  if (target.acceptance) validateExactBinding(root, target.acceptance, "target.acceptance", issues);
  if (target.upstream?.design_critique) {
    const value = validateExactJsonBinding(
      root,
      target.upstream.design_critique,
      "target.upstream.design_critique",
      issues
    );
    if (
      value &&
      (value.commit !== target.upstream.design_critique.commit ||
        value.outcome !== target.upstream.design_critique.outcome)
    )
      add(
        issues,
        "target.upstream.design_critique",
        "stored commit and outcome must match bound JSON"
      );
  }
  if (target.prior_report) {
    if (
      reviewRoot &&
      target.review_round > 1 &&
      target.prior_report.path !== expectedPriorReportPath(reviewRoot, target.review_round)
    )
      add(
        issues,
        "target.prior_report.path",
        `must equal ${expectedPriorReportPath(reviewRoot, target.review_round)}`
      );
    const value = validateExactJsonBinding(
      root,
      target.prior_report,
      "target.prior_report",
      issues
    );
    if (
      value &&
      (value.run_id !== target.run_id ||
        value.review_round !== target.review_round - 1 ||
        value.outcome === "passed")
    )
      add(
        issues,
        "target.prior_report",
        "must bind the immediately prior non-passing report for the same run"
      );
    if (value?.source?.commit) {
      if (value.source.commit === target.source.commit)
        add(issues, "target.prior_report", "later review rounds require a source mutation");
      else {
        try {
          git(root, ["merge-base", "--is-ancestor", value.source.commit, target.source.commit]);
        } catch {
          add(
            issues,
            "target.prior_report",
            "prior report source commit must be an ancestor of current target commit"
          );
        }
      }
    }
    if (value && object(value) && value.outcome !== "passed") {
      try {
        const prior = checkReview(
          expandFromReport({
            root,
            reportPath: target.prior_report.path,
            fromReport: true,
            verifyGit: false,
            verifyFrozenGit: true,
            verifyBrowser: false,
          })
        );
        if (!prior.ok)
          add(
            issues,
            "target.prior_report",
            `must be a canonical finalized Review report: ${prior.issues
              .map((item) => `${item.path} ${item.message}`)
              .join("; ")}`
          );
      } catch (error) {
        add(
          issues,
          "target.prior_report",
          `must be a canonical finalized Review report: ${error.message}`
        );
      }
    }
  }
}

function validateExactBinding(root, value, label, issues) {
  const file = readBoundFile(root, value.path, `${label}.path`, issues);
  if (file && file.sha256 !== value.sha256)
    add(issues, `${label}.sha256`, "does not match file bytes");
  return file;
}

function validateExactJsonBinding(root, value, label, issues) {
  const file = validateExactBinding(root, value, label, issues);
  if (!file) return null;
  if (file.bytes.length > MAX_JSON_BYTES) {
    add(issues, label, `exceeds ${MAX_JSON_BYTES} bytes`);
    return null;
  }
  try {
    return JSON.parse(file.bytes.toString("utf8"));
  } catch (error) {
    add(issues, label, `invalid JSON: ${error.message}`);
    return null;
  }
}

function validateChangedFiles(files, issues) {
  if (!Array.isArray(files) || files.length === 0)
    return add(issues, "target.changed_files", "must be a non-empty array");
  if (files.length > 500)
    add(issues, "target.changed_files", "must not exceed the 500-file budget");
  const seen = new Set();
  let committedBytes = 0;
  let aggregateIssue = false;
  for (const [index, item] of files.entries()) {
    const at = `target.changed_files[${index}]`;
    if (!object(item)) {
      add(issues, at, "must be an object");
      continue;
    }
    closed(item, ["path", "old_path", "status", "sha256", "bytes"], at, issues);
    if (!projectPath(item.path) || seen.has(item.path))
      add(issues, `${at}.path`, "must be unique and project-relative");
    seen.add(item.path);
    if (item.old_path !== null && !projectPath(item.old_path))
      add(issues, `${at}.old_path`, "is invalid");
    if (!/^(?:[ACDMRTUXB]|R\d{1,3}|C\d{1,3})$/.test(item.status || ""))
      add(issues, `${at}.status`, "is invalid");
    if (item.status === "D") {
      if (item.sha256 !== null || item.bytes !== null)
        add(issues, at, "deleted files require null bytes and hash");
    } else if (!sha256(item.sha256) || !Number.isSafeInteger(item.bytes) || item.bytes < 0)
      add(issues, at, "current files require SHA-256 and safe byte count");
    else if (!aggregateIssue) {
      if (item.bytes > MAX_CHANGED_FILE_BYTES - committedBytes) {
        add(
          issues,
          "target.changed_files",
          `must not exceed the ${MAX_CHANGED_FILE_BYTES}-byte aggregate committed-byte budget`
        );
        aggregateIssue = true;
      } else committedBytes += item.bytes;
    }
  }
}

function validateLensesAndAllocation(target, issues) {
  if (!Array.isArray(target.lenses) || target.lenses.length === 0)
    add(issues, "target.lenses", "must be a non-empty array");
  const logical = new Map();
  const lensRows = Array.isArray(target.lenses) ? target.lenses : [];
  for (const [index, item] of lensRows.entries()) {
    const at = `target.lenses[${index}]`;
    if (!object(item)) {
      add(issues, at, "must be an object");
      continue;
    }
    closed(item, ["name", "applicable", "reason"], at, issues);
    if (!LENSES.includes(item.name) || logical.has(item.name))
      add(issues, `${at}.name`, "must be a unique logical lens");
    logical.set(item.name, item);
    if (typeof item.applicable !== "boolean" || !text(item.reason))
      add(issues, at, "requires applicability and reason");
  }
  const expected = target.mode === "full" ? LENSES : LENSES.filter((lens) => lens !== "design");
  if (expected.some((lens) => !logical.has(lens)) || logical.size !== expected.length)
    add(issues, "target.lenses", `must exactly cover ${expected.join(", ")}`);
  if (
    new Set(["full", "code-scan"]).has(target.mode) &&
    Array.isArray(target.changed_files) &&
    target.changed_files.every((item) => object(item) && typeof item.path === "string")
  ) {
    const derived = new Map(
      deriveLensApplicability(target.mode, target.changed_files).map((item) => [item.name, item])
    );
    for (const [name, lens] of logical) {
      const expectedLens = derived.get(name);
      if (
        expectedLens &&
        (lens.applicable !== expectedLens.applicable || lens.reason !== expectedLens.reason)
      )
        add(issues, "target.lenses", `lens ${name} applicability must match the frozen diff`);
    }
  }
  if (!Array.isArray(target.allocation) || target.allocation.length === 0)
    return add(issues, "target.allocation", "must plan at least one reviewer");
  const workers = new Set();
  const assigned = new Map();
  for (const [index, worker] of target.allocation.entries()) {
    const at = `target.allocation[${index}]`;
    if (!object(worker)) {
      add(issues, at, "must be an object");
      continue;
    }
    closed(worker, ["worker_id", "profile", "lenses", "independent", "runtime"], at, issues);
    if (!slug(worker.worker_id) || workers.has(worker.worker_id))
      add(issues, `${at}.worker_id`, "must be unique kebab-case");
    workers.add(worker.worker_id);
    if (!text(worker.profile) || worker.independent !== true)
      add(issues, at, "requires profile and independent true");
    validateRuntime(worker.runtime, `${at}.runtime`, issues);
    if (!Array.isArray(worker.lenses) || worker.lenses.length === 0)
      add(issues, `${at}.lenses`, "must be non-empty");
    for (const lens of worker.lenses || []) {
      if (!logical.get(lens)?.applicable)
        add(issues, `${at}.lenses`, `cannot assign inapplicable lens ${lens}`);
      assigned.set(lens, (assigned.get(lens) || 0) + 1);
    }
  }
  for (const [name, lens] of logical)
    if ((assigned.get(name) || 0) !== (lens.applicable ? 1 : 0))
      add(
        issues,
        "target.allocation",
        `lens ${name} must be assigned exactly ${lens.applicable ? 1 : 0} times`
      );
}

function validateRuntime(runtime, label, issues) {
  if (!object(runtime)) return add(issues, label, "must be an object");
  closed(runtime, ["provider", "model", "effort", "external_effects"], label, issues);
  if (
    !new Set(["codex", "claude", "inline"]).has(runtime.provider) ||
    !text(runtime.model) ||
    !text(runtime.effort) ||
    runtime.external_effects !== false
  )
    add(issues, label, "must contain a safe exact runtime profile");
}

function validateLiveTarget(root, target, issues) {
  let head = "";
  try {
    assertCleanWorktree(root);
    head = git(root, ["rev-parse", "HEAD"]).toString().trim();
    if (target.source?.commit !== head)
      add(issues, "target.source.commit", `is stale for current HEAD ${head}`);
    const trusted = resolveTrustedBase(root);
    if (target.source?.base_ref !== trusted.ref || target.source?.base_commit !== trusted.commit)
      add(issues, "target.source", "does not match the authoritative remote default");
    const diff = git(root, ["diff", "--binary", `${trusted.commit}...${head}`], null);
    target[FROZEN_MERGE_BASE] = git(root, ["merge-base", trusted.commit, head]).toString().trim();
    if (target.source?.diff_sha256 !== digest(diff))
      add(issues, "target.source.diff_sha256", "does not match current diff bytes");
    const inventory = changedFileInventory(root, trusted.commit, head);
    if (JSON.stringify(target.changed_files) !== JSON.stringify(inventory))
      add(issues, "target.changed_files", "does not match current changed-file bytes");
  } catch (error) {
    add(issues, "target.source", `cannot verify live Git identity: ${error.message}`);
  }
}

function validateFrozenTarget(root, target, issues) {
  try {
    git(root, ["cat-file", "-e", `${target.source.commit}^{commit}`]);
    git(root, ["cat-file", "-e", `${target.source.base_commit}^{commit}`]);
    target[FROZEN_MERGE_BASE] = git(root, [
      "merge-base",
      target.source.base_commit,
      target.source.commit,
    ])
      .toString()
      .trim();
    if (!sha(target[FROZEN_MERGE_BASE])) throw new Error("source and base have no merge base");
    const diff = git(
      root,
      ["diff", "--binary", `${target.source.base_commit}...${target.source.commit}`],
      null
    );
    if (target.source.diff_sha256 !== digest(diff))
      add(issues, "target.source.diff_sha256", "does not match frozen Git diff bytes");
    const inventory = changedFileInventory(root, target.source.base_commit, target.source.commit);
    if (JSON.stringify(target.changed_files) !== JSON.stringify(inventory))
      add(issues, "target.changed_files", "does not match frozen Git changed-file bytes");
  } catch (error) {
    add(issues, "target.source", `cannot authenticate frozen Git identity: ${error.message}`);
  }
}

function validateResult(
  root,
  result,
  resultFile,
  target,
  targetFile,
  planned,
  seenWorkers,
  signals,
  label,
  issues
) {
  const renderCharsBefore = signals.reduce((sum, finding) => sum + findingRenderChars(finding), 0);
  if (!object(result)) return add(issues, label, "must be an object");
  closed(
    result,
    [
      "schema_version",
      "run_id",
      "review_round",
      "target",
      "source",
      "worker_id",
      "profile",
      "runtime",
      "lenses",
      "verdicts",
      "findings",
      "checked_at",
    ],
    label,
    issues
  );
  if (
    result.schema_version !== 1 ||
    result.run_id !== target.run_id ||
    result.review_round !== target.review_round
  )
    add(issues, label, "schema, run, and round must match target");
  validateBinding(result.target, targetFile, `${label}.target`, issues);
  if (JSON.stringify(result.source) !== JSON.stringify(target.source))
    add(issues, `${label}.source`, "must exactly match target source");
  validateSource(result.source, `${label}.source`, issues);
  const plan = planned.get(result.worker_id);
  if (!plan || seenWorkers.has(result.worker_id))
    add(issues, `${label}.worker_id`, "must identify one unused planned reviewer");
  seenWorkers.add(result.worker_id);
  if (plan) {
    if (result.profile !== plan.profile) add(issues, `${label}.profile`, "must match allocation");
    if (JSON.stringify(result.runtime) !== JSON.stringify(plan.runtime))
      add(issues, `${label}.runtime`, "must match allocation runtime");
    if (JSON.stringify(result.lenses) !== JSON.stringify(plan.lenses))
      add(issues, `${label}.lenses`, "must exactly match assigned lenses");
  }
  validateRuntime(result.runtime, `${label}.runtime`, issues);
  if (!isRfc3339DateTime(result.checked_at)) add(issues, `${label}.checked_at`, "must be RFC 3339");
  if (!Array.isArray(result.findings)) return add(issues, `${label}.findings`, "must be an array");
  if (result.findings.length > MAX_FINDINGS_PER_REVIEWER)
    return add(
      issues,
      `${label}.findings`,
      `must contain at most ${MAX_FINDINGS_PER_REVIEWER} findings`
    );
  if (signals.length + result.findings.length > MAX_FINDINGS_PER_ROUND)
    return add(
      issues,
      `${label}.findings`,
      `round must contain at most ${MAX_FINDINGS_PER_ROUND} findings`
    );
  const ids = new Set();
  for (const [index, finding] of result.findings.entries()) {
    const at = `${label}.findings[${index}]`;
    if (validateSignal(root, finding, result.worker_id, plan?.lenses || [], target, at, issues)) {
      if (ids.has(finding.id)) add(issues, `${at}.id`, "is duplicated within one reviewer");
      ids.add(finding.id);
      signals.push({
        ...structuredClone(finding),
        reviewer_id: result.worker_id,
        result_sha256: resultFile.sha256,
      });
    }
  }
  const renderCharsAfter = signals.reduce((sum, finding) => sum + findingRenderChars(finding), 0);
  if (
    renderCharsBefore <= MAX_FINDING_RENDER_CHARS_PER_ROUND &&
    renderCharsAfter > MAX_FINDING_RENDER_CHARS_PER_ROUND
  )
    add(
      issues,
      `${label}.findings`,
      `round finding text must not exceed ${MAX_FINDING_RENDER_CHARS_PER_ROUND} rendered characters`
    );
  validateVerdicts(
    result.verdicts,
    plan?.lenses || [],
    result.findings,
    `${label}.verdicts`,
    issues
  );
}

function validateVerdicts(verdicts, assignedLenses, findings, label, issues) {
  if (!Array.isArray(verdicts)) return add(issues, label, "must be an array");
  const byLens = new Map();
  for (const [index, verdict] of verdicts.entries()) {
    const at = `${label}[${index}]`;
    if (!object(verdict)) {
      add(issues, at, "must be an object");
      continue;
    }
    closed(verdict, ["lens", "outcome", "summary"], at, issues);
    if (!assignedLenses.includes(verdict.lens) || byLens.has(verdict.lens))
      add(issues, `${at}.lens`, "must uniquely reference an assigned lens");
    byLens.set(verdict.lens, verdict);
    if (!new Set(["clean", "findings"]).has(verdict.outcome) || !text(verdict.summary))
      add(issues, at, "requires clean/findings outcome and summary");
    const count = (findings || []).filter(
      (finding) => object(finding) && finding.category === verdict.lens
    ).length;
    if (
      (verdict.outcome === "clean" && count !== 0) ||
      (verdict.outcome === "findings" && count === 0)
    )
      add(issues, at, "outcome must agree with emitted findings for this lens");
  }
  if (assignedLenses.some((lens) => !byLens.has(lens)) || byLens.size !== assignedLenses.length)
    add(issues, label, "must exactly cover assigned lenses");
}

function validateSignal(root, finding, reviewerId, assignedLenses, target, label, issues) {
  if (!object(finding)) {
    add(issues, label, "must be an object");
    return false;
  }
  closed(
    finding,
    [
      "id",
      "category",
      "severity",
      "confidence",
      "file",
      "line_start",
      "line_end",
      "rule",
      "issue",
      "impact",
      "fix",
      "fix_kind",
      "verify",
      "evidence",
      "change_anchors",
      "owner",
      "disposition",
      "decision_required",
    ],
    label,
    issues
  );
  let valid = true;
  if (!assignedLenses.includes(finding.category)) {
    add(issues, `${label}.category`, "must be assigned to this reviewer");
    valid = false;
  }
  if (!SEVERITIES.includes(finding.severity)) add(issues, `${label}.severity`, "is invalid");
  if (!Number.isInteger(finding.confidence) || finding.confidence < 0 || finding.confidence > 100)
    add(issues, `${label}.confidence`, "must be 0 through 100");
  const changed = new Map((target.changed_files || []).map((item) => [item.path, item]));
  if (!projectPath(finding.file) || !changed.has(finding.file)) {
    add(issues, `${label}.file`, "must reference a changed file");
    valid = false;
  }
  if (
    !positiveLine(finding.line_start) ||
    !positiveLine(finding.line_end) ||
    finding.line_end < finding.line_start
  )
    add(issues, label, "requires a valid positive line range");
  const changedFile = changed.get(finding.file);
  if (changedFile && positiveLine(finding.line_end))
    validateChangedLineRange(
      root,
      target,
      changedFile,
      finding.line_end,
      `${label}.line_end`,
      issues
    );
  if (target.relevance_policy === CHANGE_HUNK_ANCHOR_POLICY)
    validateChangeAnchors(root, finding, target, `${label}.change_anchors`, issues);
  for (const field of ["rule", "issue", "impact", "fix", "verify"])
    if (!text(finding[field]) || finding[field].length > MAX_FINDING_PROSE_CHARS)
      add(
        issues,
        `${label}.${field}`,
        `is required and must not exceed ${MAX_FINDING_PROSE_CHARS} characters`
      );
  if (!FIX_KINDS.has(finding.fix_kind)) add(issues, `${label}.fix_kind`, "is invalid");
  if (!OWNERS.includes(finding.owner)) add(issues, `${label}.owner`, "is invalid");
  else if (finding.owner !== "review")
    add(
      issues,
      `${label}.owner`,
      "reviewer signals must remain Review-owned; only an authenticated external approval may hand off ownership"
    );
  if (!SIGNAL_DISPOSITIONS.has(finding.disposition))
    add(
      issues,
      `${label}.disposition`,
      "reviewer signals must be open; only decisions may dismiss"
    );
  if (typeof finding.decision_required !== "boolean")
    add(issues, `${label}.decision_required`, "must be boolean");
  let identityReady = true;
  if (!Array.isArray(finding.evidence) || finding.evidence.length === 0) {
    add(issues, `${label}.evidence`, "must be non-empty");
    identityReady = false;
  } else {
    let categoryEvidence = false;
    const refs = new Set();
    let duplicateEvidence = false;
    const overEvidenceBudget = finding.evidence.length > MAX_EVIDENCE_PER_FINDING;
    if (overEvidenceBudget) {
      add(issues, `${label}.evidence`, `must contain at most ${MAX_EVIDENCE_PER_FINDING} entries`);
      identityReady = false;
    }
    for (const [index, evidence] of finding.evidence.entries()) {
      const at = `${label}.evidence[${index}]`;
      if (!object(evidence)) {
        add(issues, at, "must be an object");
        identityReady = false;
        continue;
      }
      closed(evidence, ["kind", "ref", "sha256"], at, issues);
      if (!EVIDENCE_KINDS.has(evidence.kind) || !text(evidence.ref) || evidence.ref.length > 1000) {
        add(issues, at, "requires a known kind and bounded reference");
        identityReady = false;
      }
      const evidenceKey = evidenceIdentityKey(evidence);
      if (refs.has(evidenceKey)) {
        add(issues, at, "duplicates evidence in this finding");
        duplicateEvidence = true;
        identityReady = false;
      }
      refs.add(evidenceKey);
      if (REQUIRED_EVIDENCE[finding.category]?.has(evidence.kind)) categoryEvidence = true;
    }
    if (!overEvidenceBudget && !duplicateEvidence)
      for (const [index, evidence] of finding.evidence.entries()) {
        if (
          !object(evidence) ||
          !EVIDENCE_KINDS.has(evidence.kind) ||
          !text(evidence.ref) ||
          evidence.ref.length > 1000
        )
          continue;
        const at = `${label}.evidence[${index}]`;
        if (
          ["source", "test", "contract", "design-token"].includes(evidence.kind) &&
          evidence.sha256 !== undefined
        )
          add(issues, `${at}.sha256`, "Git-backed evidence must not include sha256");
        validateEvidenceReference(
          root,
          evidence,
          target,
          at,
          issues,
          evidenceAnchorSide(finding, evidence, at, issues)
        );
      }
    if (!categoryEvidence) add(issues, `${label}.evidence`, `does not support ${finding.category}`);
    if (finding.category === "bug") {
      const kinds = new Set(
        finding.evidence.filter((item) => object(item)).map((item) => item.kind)
      );
      if (!kinds.has("source") || !["test", "trace", "contract"].some((kind) => kinds.has(kind)))
        add(
          issues,
          `${label}.evidence`,
          "bug requires source plus test, trace, or contract corroboration"
        );
    }
    if (
      finding.category === "reuse" &&
      new Set(
        finding.evidence
          .filter((item) => object(item) && item.kind === "source" && text(item.ref))
          .map((item) => item.ref)
      ).size < 2
    )
      add(
        issues,
        `${label}.evidence`,
        "reuse requires distinct changed-source and reusable-source locators"
      );
  }
  if (identityReady) {
    const expectedId = findingId(finding);
    if (finding.id !== expectedId) {
      add(issues, `${label}.id`, `must equal deterministic identity ${expectedId}`);
      valid = false;
    }
  } else {
    valid = false;
  }
  if (finding.fix_kind === "decision" && finding.decision_required !== true)
    add(issues, label, "decision fixes must set decision_required true");
  return valid;
}

function validateEvidenceReference(root, evidence, target, label, issues, anchorSide = null) {
  if (["source", "test", "contract", "design-token"].includes(evidence.kind)) {
    const match = evidence.ref.match(/^(.+):(\d+)(?:-(\d+))?$/);
    if (!match || !projectPath(match[1]))
      return add(issues, `${label}.ref`, "must be a project path with a line or line range");
    const start = Number(match[2]);
    const end = Number(match[3] || match[2]);
    if (!positiveLine(start) || !positiveLine(end) || end < start)
      return add(issues, `${label}.ref`, "has an invalid line range");
    const changed = (target.changed_files || []).find(
      (item) => item.path === match[1] || item.old_path === match[1]
    );
    try {
      const commit =
        anchorSide === "base" ||
        changed?.status === "D" ||
        (changed?.old_path === match[1] && changed.path !== match[1])
          ? target[FROZEN_MERGE_BASE] || target.source.base_commit
          : target.source.commit;
      const bytes = readFrozenBlob(root, target, commit, match[1]);
      validateTextLineRange(bytes, end, `${label}.ref`, issues);
    } catch (error) {
      add(issues, `${label}.ref`, `cannot resolve frozen evidence: ${error.message}`);
    }
    return;
  }
  if (evidence.kind === "upstream-gate") {
    if (!projectPath(evidence.ref))
      return add(issues, `${label}.ref`, "must be a project-relative gate artifact path");
    const file = readBoundArtifact(root, target, evidence.ref, `${label}.ref`, issues);
    validateArtifactEvidence(file, evidence, label, issues, true, target.source.commit);
    return;
  }
  const match = evidence.ref.match(/^artifact:([^#]+)#([^#\r\n]{1,500})$/);
  if (!match || !projectPath(match[1]))
    return add(
      issues,
      `${label}.ref`,
      "trace and benchmark evidence must use artifact:<project-path>#locator"
    );
  const file = readBoundArtifact(root, target, match[1], `${label}.ref`, issues);
  if (!validateArtifactEvidence(file, evidence, label, issues, false)) return;
  if (!file.bytes.toString("utf8").includes(match[2]))
    add(issues, `${label}.ref`, "locator is not present in the bound artifact bytes");
}

function evidenceAnchorSide(finding, evidence, label, issues) {
  if (!object(evidence) || !["source", "test", "contract", "design-token"].includes(evidence.kind))
    return null;
  const locator = parseGitLocator(evidence.ref);
  if (!locator) return null;
  const sides = new Set(
    (finding.change_anchors || [])
      .filter(
        (anchor) =>
          object(anchor) &&
          (anchor.side === "head" || anchor.side === "base") &&
          anchor.path === locator.path &&
          positiveLine(anchor.line_start) &&
          positiveLine(anchor.line_end) &&
          anchor.line_start <= locator.end &&
          locator.start <= anchor.line_end
      )
      .map((anchor) => anchor.side)
  );
  if (sides.size > 1) {
    add(
      issues,
      `${label}.ref`,
      "cannot bind the same Git evidence range to both head and base anchors"
    );
    return null;
  }
  return sides.size === 1 ? [...sides][0] : null;
}

function evidenceIdentityKey(evidence) {
  if (!object(evidence)) return `invalid:${String(evidence)}`;
  const digestIdentity = new Set(["trace", "benchmark", "upstream-gate"]).has(evidence.kind)
    ? String(evidence.sha256 || "")
    : "unbound";
  return `${String(evidence.kind)}\0${String(evidence.ref)}\0${digestIdentity}`;
}

function readFrozenBlob(root, target, commit, relative) {
  let cache = target[FROZEN_BLOB_CACHE];
  if (!cache) {
    cache = new Map();
    target[FROZEN_BLOB_CACHE] = cache;
  }
  const key = `${commit}\0${relative}`;
  if (!cache.has(key)) {
    const remaining = remainingEvidenceBytes(target);
    const bytes = readCommittedBlob(
      root,
      commit,
      relative,
      remaining,
      `review evidence exceeds the ${MAX_EVIDENCE_BYTES_PER_CHECK}-byte aggregate byte budget`
    );
    consumeEvidenceBytes(target, bytes.length);
    cache.set(key, bytes);
  }
  return cache.get(key);
}

function readBoundArtifact(root, target, relative, label, issues) {
  let cache = target[BOUND_ARTIFACT_CACHE];
  if (!cache) {
    cache = new Map();
    target[BOUND_ARTIFACT_CACHE] = cache;
  }
  if (cache.has(relative)) return cache.get(relative);
  const remaining = remainingEvidenceBytes(target);
  const file = readBoundFile(root, relative, label, issues, remaining, {
    budgetMessage: `review evidence exceeds the ${MAX_EVIDENCE_BYTES_PER_CHECK}-byte aggregate byte budget`,
  });
  if (file) {
    consumeEvidenceBytes(target, file.bytes.length);
    cache.set(relative, file);
  }
  return file;
}

function remainingEvidenceBytes(target) {
  return MAX_EVIDENCE_BYTES_PER_CHECK - (target[EVIDENCE_BYTE_LEDGER] || 0);
}

function consumeEvidenceBytes(target, bytes) {
  const used = target[EVIDENCE_BYTE_LEDGER] || 0;
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > MAX_EVIDENCE_BYTES_PER_CHECK - used)
    throw new Error(
      `review evidence exceeds the ${MAX_EVIDENCE_BYTES_PER_CHECK}-byte aggregate byte budget`
    );
  target[EVIDENCE_BYTE_LEDGER] = used + bytes;
}

function validateArtifactEvidence(file, evidence, label, issues, gate, targetCommit = null) {
  if (!sha256(evidence.sha256)) {
    add(issues, `${label}.sha256`, "artifact evidence requires an exact SHA-256 binding");
    return false;
  }
  if (!file) return false;
  if (file.sha256 !== evidence.sha256) {
    add(issues, `${label}.sha256`, "does not match artifact bytes");
    return false;
  }
  if (gate) {
    try {
      const value = JSON.parse(file.bytes.toString("utf8"));
      if (
        !object(value) ||
        !new Set(["passed", "failed", "blocked", "deferred"]).has(value.outcome)
      )
        add(issues, `${label}.ref`, "upstream gate JSON requires a recognized outcome");
      else if (!sha(value.commit))
        add(issues, `${label}.ref`, "upstream gate JSON requires a valid commit attestation");
      else if (value.commit !== targetCommit)
        add(issues, `${label}.ref`, "upstream gate commit must equal the target source commit");
    } catch (error) {
      add(issues, `${label}.ref`, `upstream gate must be JSON: ${error.message}`);
    }
  }
  return true;
}

function validateChangedLineRange(root, target, changed, end, label, issues) {
  try {
    const commit =
      changed.status === "D"
        ? target[FROZEN_MERGE_BASE] || target.source.base_commit
        : target.source.commit;
    const bytes = readFrozenBlob(root, target, commit, changed.path);
    validateTextLineRange(bytes, end, label, issues);
  } catch (error) {
    add(issues, label, `cannot resolve frozen source: ${error.message}`);
  }
}

function validateChangeAnchors(root, finding, target, label, issues) {
  const anchors = finding.change_anchors;
  if (!Array.isArray(anchors) || anchors.length < 1 || anchors.length > MAX_CHANGE_ANCHORS)
    return add(issues, label, `must contain 1 through ${MAX_CHANGE_ANCHORS} causal anchors`);
  const gitEvidence = (finding.evidence || [])
    .filter(
      (item) =>
        object(item) &&
        ["source", "test", "contract", "design-token"].includes(item.kind) &&
        text(item.ref)
    )
    .map((item) => ({ ref: item.ref, locator: parseGitLocator(item.ref) }))
    .filter((item) => item.locator);
  const primaryRefs = new Set([
    `${finding.file}:${finding.line_start}`,
    `${finding.file}:${finding.line_start}-${finding.line_end}`,
  ]);
  const affectedRefs = new Set([...primaryRefs, ...gitEvidence.map((item) => item.ref)]);
  const changedByPath = new Map();
  for (const changed of target.changed_files || []) {
    changedByPath.set(changed.path, changed);
    if (changed.old_path) changedByPath.set(changed.old_path, changed);
  }
  for (const [index, anchor] of anchors.entries()) {
    const at = `${label}[${index}]`;
    if (!object(anchor)) {
      add(issues, at, "must be an object");
      continue;
    }
    closed(
      anchor,
      ["path", "side", "line_start", "line_end", "affected_ref", "relation"],
      at,
      issues
    );
    if (
      !text(anchor.relation) ||
      anchor.relation.length > MAX_ANCHOR_RELATION_CHARS ||
      /[\r\n]/.test(anchor.relation)
    )
      add(
        issues,
        `${at}.relation`,
        `is required, single-line, and must not exceed ${MAX_ANCHOR_RELATION_CHARS} characters`
      );
    if (!text(anchor.affected_ref) || !affectedRefs.has(anchor.affected_ref))
      add(
        issues,
        `${at}.affected_ref`,
        "must exactly bind the finding primary locator or one Git-backed evidence locator"
      );
    const changed = changedByPath.get(anchor.path);
    if (!projectPath(anchor.path) || !changed) {
      add(issues, `${at}.path`, "must reference a frozen changed path or its old rename path");
      continue;
    }
    if (!new Set(["head", "base", "path"]).has(anchor.side)) {
      add(issues, `${at}.side`, "must be head, base, or path");
      continue;
    }
    if (anchor.side === "head" && anchor.path !== changed.path)
      add(issues, `${at}.path`, "head anchors must use the frozen current path");
    if (anchor.side === "base" && anchor.path !== (changed.old_path || changed.path))
      add(issues, `${at}.path`, "base anchors must use the frozen base or old rename path");
    let change;
    try {
      change = frozenPathChange(root, target, changed);
    } catch (error) {
      add(issues, at, `cannot resolve frozen change hunks: ${error.message}`);
      continue;
    }
    if (anchor.side === "path") {
      if (
        (anchor.line_start !== null && anchor.line_start !== undefined) ||
        (anchor.line_end !== null && anchor.line_end !== undefined)
      )
        add(issues, at, "path anchors must omit line_start and line_end");
      if (!change.non_textual)
        add(issues, at, "path anchors require a changed path with no textual hunks");
      continue;
    }
    if (
      !positiveLine(anchor.line_start) ||
      !positiveLine(anchor.line_end) ||
      anchor.line_end < anchor.line_start
    ) {
      add(issues, at, "head and base anchors require a valid positive line range");
      continue;
    }
    const intersects = change.hunks.some((hunk) => {
      const start = anchor.side === "head" ? hunk.new_start : hunk.old_start;
      const count = anchor.side === "head" ? hunk.new_count : hunk.old_count;
      return count > 0 && anchor.line_start <= start + count - 1 && start <= anchor.line_end;
    });
    if (!intersects)
      add(issues, at, `does not intersect a ${anchor.side} changed hunk in the frozen diff`);
    const evidenceOverlap = gitEvidence.some(
      ({ locator }) =>
        locator.path === anchor.path &&
        anchor.line_start <= locator.end &&
        locator.start <= anchor.line_end
    );
    if (!evidenceOverlap)
      add(
        issues,
        at,
        "head and base anchors require overlapping Git-backed evidence on the same path"
      );
  }
}

function parseGitLocator(value) {
  const match = String(value || "").match(/^(.+):(\d+)(?:-(\d+))?$/);
  if (!match || !projectPath(match[1])) return null;
  const start = Number(match[2]);
  const end = Number(match[3] || match[2]);
  if (!positiveLine(start) || !positiveLine(end) || end < start) return null;
  return { path: match[1], start, end };
}

function frozenPathChange(root, target, changed) {
  let cache = target[CHANGE_HUNK_CACHE];
  if (!cache) {
    cache = new Map();
    target[CHANGE_HUNK_CACHE] = cache;
  }
  const key = `${changed.old_path || ""}\0${changed.path}`;
  if (cache.has(key)) return cache.get(key);
  if (cache.size >= MAX_ANCHOR_PATHS)
    throw new Error(`anchor verification exceeds the ${MAX_ANCHOR_PATHS}-path budget`);
  let mergeBase = target[FROZEN_MERGE_BASE];
  if (!mergeBase) {
    mergeBase = git(root, ["merge-base", target.source.base_commit, target.source.commit])
      .toString()
      .trim();
    if (!sha(mergeBase)) throw new Error("source and base have no merge base");
    target[FROZEN_MERGE_BASE] = mergeBase;
  }
  const paths = [...new Set([changed.old_path, changed.path].filter(Boolean))];
  const common = [mergeBase, target.source.commit, "--", ...paths];
  const patch = git(
    root,
    ["diff", "--unified=0", "--no-color", "--no-ext-diff", ...common],
    "utf8"
  );
  const hunks = [];
  const pattern = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm;
  for (const match of patch.matchAll(pattern))
    hunks.push({
      old_start: Number(match[1]),
      old_count: match[2] === undefined ? 1 : Number(match[2]),
      new_start: Number(match[3]),
      new_count: match[4] === undefined ? 1 : Number(match[4]),
    });
  const summary = git(root, ["diff", "--summary", ...common], "utf8").trim();
  const numstat = git(root, ["diff", "--numstat", ...common], "utf8").trim();
  const value = {
    hunks,
    non_textual: hunks.length === 0 && (summary.length > 0 || numstat.length > 0),
  };
  cache.set(key, value);
  return value;
}

function validateTextLineRange(bytes, end, label, issues) {
  if (bytes.includes(0)) return add(issues, label, "cannot line-address a binary file");
  const content = bytes.toString("utf8");
  const lines =
    content.length === 0 ? 0 : content.split(/\r?\n/).length - (/\r?\n$/.test(content) ? 1 : 0);
  if (end > lines) add(issues, label, `line range exceeds file length ${lines}`);
}

function validateDecisions(value, file, target, targetFile, findingIds, issues) {
  if (value === undefined || value === null) return [];
  if (!object(value)) {
    add(issues, "decisions", "must be an object");
    return [];
  }
  closed(
    value,
    ["schema_version", "run_id", "review_round", "target", "decisions", "checked_at"],
    "decisions",
    issues
  );
  if (
    value.schema_version !== 1 ||
    value.run_id !== target.run_id ||
    value.review_round !== target.review_round
  )
    add(issues, "decisions", "schema, run, and round must match target");
  validateBinding(value.target, targetFile, "decisions.target", issues);
  if (!isRfc3339DateTime(value.checked_at)) add(issues, "decisions.checked_at", "must be RFC 3339");
  if (!Array.isArray(value.decisions)) {
    add(issues, "decisions.decisions", "must be an array");
    return [];
  }
  const seen = new Set();
  for (const [index, decision] of value.decisions.entries()) {
    const at = `decisions.decisions[${index}]`;
    if (!object(decision)) {
      add(issues, at, "must be an object");
      continue;
    }
    closed(decision, ["finding_id", "approver", "action", "rationale", "decided_at"], at, issues);
    if (!findingIds.has(decision.finding_id) || seen.has(decision.finding_id))
      add(issues, `${at}.finding_id`, "must uniquely reference a current finding");
    seen.add(decision.finding_id);
    if (
      !text(decision.approver) ||
      !text(decision.rationale) ||
      !isRfc3339DateTime(decision.decided_at)
    )
      add(issues, at, "requires approver, rationale, and RFC 3339 timestamp");
    if (!DECISION_ACTIONS.includes(decision.action)) add(issues, `${at}.action`, "is invalid");
  }
  return value.decisions.filter(object);
}

function validateDecisionCoverage(merged, decisions, issues) {
  const decisionIds = new Set((decisions || []).map((item) => item.finding_id));
  for (const finding of merged.findings)
    if (finding.decision && !decisionIds.has(finding.id))
      add(issues, "decisions", `decision for ${finding.id} is invalid`);
}

function buildCanonicalReport(
  target,
  targetFile,
  resultFiles,
  decisionsFile,
  merged,
  humanReportPath
) {
  const blockers = merged.findings.filter(
    (finding) =>
      finding.owner === "review" &&
      finding.disposition === "open" &&
      ["critical", "high"].includes(finding.severity) &&
      finding.confidence >= 80
  );
  const deferredBlockers = merged.findings.filter(
    (finding) =>
      finding.owner === "review" &&
      finding.disposition === "deferred" &&
      ["critical", "high"].includes(finding.severity)
  );
  const capReached = target.review_round >= target.iteration_cap;
  const outcome =
    merged.unresolved_disagreements.length > 0 || deferredBlockers.length > 0
      ? "blocked"
      : blockers.length > 0
        ? capReached
          ? "blocked"
          : "failed"
        : "passed";
  const priorityFindingIds = new Set([
    ...blockers.map((finding) => finding.id),
    ...deferredBlockers.map((finding) => finding.id),
    ...merged.unresolved_disagreements,
  ]);
  const topFinding = [...merged.findings].sort(
    (left, right) =>
      Number(priorityFindingIds.has(right.id)) - Number(priorityFindingIds.has(left.id)) ||
      SEVERITIES.indexOf(right.severity) - SEVERITIES.indexOf(left.severity) ||
      right.confidence - left.confidence ||
      left.id.localeCompare(right.id)
  )[0];
  const nextAction =
    outcome === "passed"
      ? "Proceed to full verification."
      : outcome === "failed"
        ? "Fix Review-owned blockers and create the next review round."
        : capReached && blockers.length > 0
          ? "Review reached its three-round cap. Preserve this report and ask the user for direction."
          : "Resolve reviewer disagreement or deferred blockers before continuing.";
  const applicable = target.lenses.filter((item) => item.applicable).map((item) => item.name);
  const notApplicable = target.lenses.filter((item) => !item.applicable).map((item) => item.name);
  const autoFixEligible = capReached
    ? []
    : merged.findings
        .filter(
          (finding) =>
            finding.owner === "review" &&
            finding.disposition === "open" &&
            finding.confidence >= 80 &&
            finding.fix_kind === "mechanical" &&
            finding.disputed === false &&
            finding.decision_required === false
        )
        .map((finding) => finding.id);
  return {
    schema_version: 1,
    run_id: target.run_id,
    review_round: target.review_round,
    source: structuredClone(target.source),
    target: binding(targetFile),
    results: resultFiles.map(binding).sort((left, right) => left.path.localeCompare(right.path)),
    decisions: decisionsFile ? binding(decisionsFile) : null,
    prior_report: target.prior_report,
    coverage: { required: applicable, completed: applicable, not_applicable: notApplicable },
    outcome,
    top_issue: topFinding ? topFinding.issue : "No unresolved Review finding.",
    blockers: [...blockers, ...deferredBlockers].map((item) => item.id),
    unresolved_disagreements: merged.unresolved_disagreements,
    auto_fix_eligible: autoFixEligible,
    handoffs: {
      design_critique: merged.findings
        .filter((item) => item.owner === "design-critique")
        .map((item) => item.id),
      qa: merged.findings.filter((item) => item.owner === "qa").map((item) => item.id),
    },
    findings: merged.findings,
    next_action: nextAction,
    human_report: humanReportPath ? { path: humanReportPath } : null,
    checked_at: new Date().toISOString(),
  };
}

function validateReport(root, report, canonical, reportFile, options, issues) {
  if (!object(report)) {
    add(issues, "report", "must be an object");
    return null;
  }
  closed(
    report,
    [
      "schema_version",
      "run_id",
      "review_round",
      "source",
      "target",
      "results",
      "decisions",
      "prior_report",
      "coverage",
      "outcome",
      "top_issue",
      "blockers",
      "unresolved_disagreements",
      "auto_fix_eligible",
      "handoffs",
      "findings",
      "next_action",
      "human_report",
      "checked_at",
    ],
    "report",
    issues
  );
  const comparable = structuredClone(report);
  const expected = structuredClone(canonical);
  comparable.checked_at = "<timestamp>";
  expected.checked_at = "<timestamp>";
  if (JSON.stringify(comparable) !== JSON.stringify(expected))
    add(issues, "report", "does not match the canonical merge of current evidence");
  if (!isRfc3339DateTime(report.checked_at)) add(issues, "report.checked_at", "must be RFC 3339");
  if (report.human_report !== null)
    return validateHumanReport(root, report.human_report, report, reportFile, options, issues);
  return null;
}

function validateHumanReport(root, human, report, reportFile, options, issues) {
  if (!object(human) || !text(human.path))
    return add(issues, "report.human_report", "requires a path");
  const htmlFile = readBoundFile(
    root,
    human.path,
    "report.human_report.path",
    issues,
    MAX_HTML_BYTES
  );
  if (!htmlFile) return null;
  const inspected = inspectHtmlArtifact(htmlFile.bytes, { expectedKind: "report" });
  for (const item of inspected.issues || [])
    add(issues, `report.human_report${item.path || ""}`, item.message);
  const metadata = inspected.metadata;
  if (
    metadata &&
    (metadata.generator?.name !== "pm:review" ||
      metadata.generator?.version !== PLUGIN_VERSION ||
      metadata.source?.path !== reportFile.relative ||
      metadata.source?.sha256 !== `sha256:${reportFile.sha256}`)
  )
    add(issues, "report.human_report", "metadata must bind the exact Review report JSON");
  const expectedEvidence = [report.target, ...(report.results || []), report.decisions].filter(
    Boolean
  );
  for (const expected of expectedEvidence)
    if (
      !(metadata?.evidence || []).some(
        (item) => item.path === expected.path && item.sha256 === `sha256:${expected.sha256}`
      )
    )
      add(issues, "report.human_report", `metadata evidence must bind ${expected.path}`);
  const html = htmlFile.bytes.toString("utf8");
  for (const [attribute, value] of [
    ["data-review-outcome", report.outcome],
    ["data-review-round", String(report.review_round)],
    ["data-review-blockers", String(report.blockers.length)],
    [
      "data-review-coverage",
      `${report.coverage?.completed?.length || 0}/${report.coverage?.required?.length || 0}`,
    ],
  ])
    if (!new RegExp(`${attribute}=["']${escapeRegex(value)}["']`, "i").test(html))
      add(issues, "report.human_report", `missing ${attribute}=${value}`);
  for (const finding of report.findings || [])
    if (!new RegExp(`data-review-finding-id=["']${escapeRegex(finding.id)}["']`, "i").test(html))
      add(issues, "report.human_report", `missing finding ${finding.id}`);
  if (options.verifyBrowser !== false) {
    try {
      const markers = options.markerProbe
        ? options.markerProbe(htmlFile.path)
        : probeDataMarkerVisibility(
            resolveBrowser(options.browserPath),
            htmlFile.path,
            path.dirname(htmlFile.path),
            "data-review-"
          );
      validateRenderedReportMarkers(markers, report, issues);
    } catch (error) {
      add(issues, "report.human_report", `cannot verify rendered markers: ${error.message}`);
    }
  }
  return { path: htmlFile.relative, sha256: htmlFile.sha256 };
}

function validateRenderedReportMarkers(markers, report, issues) {
  const expected = [
    {
      attributes: { "data-review-outcome": report.outcome },
      exact: report.outcome,
      firstScreen: true,
    },
    {
      attributes: { "data-review-round": String(report.review_round) },
      exact: String(report.review_round),
      firstScreen: true,
    },
    {
      attributes: { "data-review-blockers": String(report.blockers.length) },
      exact: String(report.blockers.length),
      firstScreen: true,
    },
    {
      attributes: {
        "data-review-coverage": `${report.coverage?.completed?.length || 0}/${report.coverage?.required?.length || 0}`,
      },
      exact: `${report.coverage?.completed?.length || 0}/${report.coverage?.required?.length || 0}`,
      firstScreen: true,
    },
    {
      attributes: {
        "data-review-source-sha256": digest(Buffer.from(report.source?.commit || "")),
      },
      required: [report.source?.commit || ""],
      firstScreen: true,
    },
    {
      attributes: {
        "data-review-base-sha256": digest(
          Buffer.from(`${report.source?.base_ref || ""}:${report.source?.base_commit || ""}`)
        ),
      },
      required: [report.source?.base_ref || "", report.source?.base_commit || ""],
      firstScreen: true,
    },
    {
      attributes: { "data-review-top-issue-sha256": digest(Buffer.from(report.top_issue)) },
      required: [report.top_issue],
      firstScreen: true,
    },
    {
      attributes: { "data-review-next-action-sha256": digest(Buffer.from(report.next_action)) },
      required: [report.next_action],
      firstScreen: true,
    },
    ...(report.findings || []).map((finding) => ({
      attributes: { "data-review-finding-id": finding.id },
      required: [
        finding.issue,
        finding.impact,
        finding.fix,
        finding.verify,
        finding.owner,
        `Decision required: ${finding.decision_required ? "yes" : "no"}`,
        `Disputed: ${finding.disputed ? "yes" : "no"}`,
        ...(finding.decision
          ? [finding.decision.action, finding.decision.approver, finding.decision.rationale]
          : ["No recorded decision."]),
        ...finding.evidence.map((item) => item.ref),
        ...(finding.change_anchors || []).map(changeAnchorText),
        ...(finding.signals || []).flatMap((signal) => [
          signal.reviewer_id,
          signal.category,
          signal.severity,
          `${signal.confidence}%`,
          `owner ${signal.owner}`,
          `disposition ${signal.disposition}`,
          `fix ${signal.fix_kind}`,
          `decision required ${signal.decision_required ? "yes" : "no"}`,
          ...(signal.change_anchors || []).map(changeAnchorText),
          ...(signal.issue !== finding.issue ? [signal.issue] : []),
          ...(signal.fix !== finding.fix ? [signal.fix] : []),
        ]),
      ],
      firstScreen: false,
    })),
  ];
  for (const item of expected) {
    const matches = markers.filter((marker) =>
      Object.entries(item.attributes).every(([name, value]) => marker.attributes?.[name] === value)
    );
    const marker = matches[0];
    const visibleText = normalizeText(
      (item.firstScreen ? marker?.firstScreenText : marker?.text) || ""
    );
    const textMatches = item.exact
      ? visibleText.toLowerCase() === normalizeText(item.exact).toLowerCase()
      : (item.required || []).every((value) => visibleText.includes(normalizeText(value)));
    if (
      matches.length !== 1 ||
      marker?.visible !== true ||
      (item.firstScreen && marker?.inViewport !== true) ||
      !textMatches
    )
      add(
        issues,
        "report.human_report",
        `rendered marker ${JSON.stringify(item.attributes)} must be uniquely visible with matching text${item.firstScreen ? " in the first screenful" : ""}`
      );
  }
}

function readJson(root, relative, label, issues) {
  const file = readBoundFile(root, relative, `${label}.path`, issues, MAX_JSON_BYTES);
  if (!file) return null;
  if (file.bytes.length > MAX_JSON_BYTES) {
    add(issues, label, `exceeds ${MAX_JSON_BYTES} bytes`);
    return null;
  }
  try {
    return { ...file, value: JSON.parse(file.bytes.toString("utf8")) };
  } catch (error) {
    add(issues, label, `invalid JSON: ${error.message}`);
    return null;
  }
}

function readBoundFile(root, relative, label, issues, maxBytes = 64 * 1024 * 1024, options = {}) {
  if (!projectPath(relative)) {
    add(issues, label, "must be project-relative without traversal");
    return null;
  }
  try {
    const loaded = readProjectInput(root, relative, maxBytes);
    const { bytes } = loaded;
    return {
      path: loaded.path,
      relative: loaded.relative,
      bytes,
      sha256: digest(bytes),
    };
  } catch (error) {
    add(
      issues,
      label,
      options.budgetMessage && error.message === `input exceeds ${maxBytes}-byte budget`
        ? options.budgetMessage
        : error.message
    );
    return null;
  }
}

function validateBinding(value, file, label, issues) {
  validateBindingShape(value, label, issues);
  if (file && (value?.path !== file.relative || value?.sha256 !== file.sha256))
    add(issues, label, "must bind the exact file bytes");
}

function validateBindingShape(value, label, issues, nullable = false, extra = []) {
  if (nullable && value === null) return;
  if (!object(value)) return add(issues, label, "must be an object");
  closed(value, ["path", "sha256", ...extra], label, issues);
  if (!projectPath(value.path) || !sha256(value.sha256))
    add(issues, label, "requires path and SHA-256");
}

function binding(file) {
  return { path: file.relative, sha256: file.sha256 };
}

function parseArgs(argv) {
  const out = { resultPaths: [] };
  const valueArgs = new Map([
    ["--root", "root"],
    ["--target", "targetPath"],
    ["--result", "resultPaths"],
    ["--decisions", "decisionsPath"],
    ["--report", "reportPath"],
    ["--human-report", "humanReportPath"],
    ["--stage", "reportStage"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--write-report") {
      out.writeReport = true;
      continue;
    }
    if (argv[index] === "--from-report") {
      out.fromReport = true;
      continue;
    }
    const key = valueArgs.get(argv[index]);
    if (!key) throw new Error(`unknown argument ${argv[index]}`);
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`${argv[index - 1]} requires a value`);
    if (key === "resultPaths") out.resultPaths.push(value);
    else out[key] = value;
  }
  if (!out.reportPath) throw new Error("--report is required");
  if (!out.fromReport && !out.targetPath) throw new Error("--target is required");
  if (!out.fromReport && out.resultPaths.length === 0)
    throw new Error("at least one --result is required");
  if (out.writeReport && !out.humanReportPath)
    throw new Error("--write-report requires --human-report");
  if (out.writeReport && out.fromReport)
    throw new Error("--write-report and --from-report cannot be combined");
  return out;
}

function expandFromReport(options) {
  if (!options.fromReport) return options;
  const root = path.resolve(options.root || process.cwd());
  if (!projectPath(options.reportPath)) throw new Error("--report must be project-relative");
  const reportFile = readProjectInput(root, options.reportPath, MAX_JSON_BYTES);
  const report = JSON.parse(reportFile.bytes.toString("utf8"));
  if (!object(report.target) || !Array.isArray(report.results) || report.results.length === 0)
    throw new Error("report does not contain target and result bindings");
  return {
    ...options,
    targetPath: report.target.path,
    resultPaths: report.results.map((item) => item.path),
    decisionsPath: report.decisions?.path,
    humanReportPath: report.human_report?.path,
  };
}

function main(argv = process.argv.slice(2)) {
  try {
    const options = expandFromReport(parseArgs(argv));
    const result = checkReview(options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.ok ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 2;
  }
}

function git(root, args, encoding = "utf8") {
  return execFileSync("git", args, {
    cwd: root,
    encoding,
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

function digest(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}
function findingRenderChars(finding) {
  const fields = [
    finding.category,
    finding.severity,
    finding.file,
    finding.rule,
    finding.issue,
    finding.impact,
    finding.fix,
    finding.fix_kind,
    finding.verify,
    finding.owner,
    finding.disposition,
    ...(finding.evidence || []).flatMap((item) => [item?.kind, item?.ref]),
    ...(finding.change_anchors || []).flatMap((item) => [
      item?.path,
      item?.side,
      item?.affected_ref,
      item?.relation,
      Number.isInteger(item?.line_start) ? String(item.line_start) : "",
      Number.isInteger(item?.line_end) ? String(item.line_end) : "",
    ]),
  ];
  return fields.reduce((sum, value) => sum + (typeof value === "string" ? value.length : 0), 0);
}
function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text(value) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 10_000;
}
function sha(value) {
  return typeof value === "string" && /^[a-f0-9]{40,64}$/.test(value);
}
function sha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function slug(value) {
  return typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}
function projectPath(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 4096 &&
    !path.isAbsolute(value) &&
    !value.split(/[\\/]/).includes("..") &&
    !value.includes("\0")
  );
}
function positiveLine(value) {
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
function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function normalizeText(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

if (require.main === module) process.exitCode = main();

module.exports = {
  buildCanonicalReport,
  checkReview,
  expandFromReport,
  findingRenderChars,
  parseArgs,
  validateFrozenTarget,
  validateRenderedReportMarkers,
  validateSignal,
};
