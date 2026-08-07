#!/usr/bin/env node
"use strict";

// Bounded post-pass review supplements. After a canonical passed review, a
// small follow-up fix (<= 50 changed code lines, files inside the certified
// changed-file inventory, commit descending from the certified commit) may be
// certified by one scoped delta review instead of a full new round-1 lineage.
// At most two supplements may chain onto one canonical report; anything larger
// or a third fix requires a complete new review round.
//
//   build  — validate eligibility at HEAD and freeze a pending delta target.
//   record — bind one reviewer's structured result; a passing result becomes
//            supplements/supplement-{N}.json, a failing one is preserved for
//            audit and exits non-zero.
//   check  — evaluate whether current HEAD is covered by the canonical pass
//            through any sanctioned freshness path (exact binding, diff
//            identity, or a valid delta chain). Exit 0 is the recertification
//            evidence signal.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const {
  MAX_DELTA_CODE_LINES,
  MAX_DELTA_SUPPLEMENTS,
  SUPPLEMENT_KIND,
  DELTA_BUDGET_EXEMPT_RE,
  computeDelta,
  evaluateReviewFreshness,
  readSupplements,
  validateSupplementChain,
} = require("./lib/review-freshness");
const { assertCleanWorktree, changedFileInventory } = require("./review-target");
const { version: PLUGIN_VERSION } = require("../plugin.config.json");

const MAX_JSON_BYTES = 4 * 1024 * 1024;
const SEVERITIES = new Set(["critical", "high", "medium", "low"]);
const PENDING_KIND = "review-delta-pending-v1";

function git(root, args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

function digest(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function readBoundedJson(file, label) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile()) throw new Error(`${label} must be a regular file`);
  if (stat.size > MAX_JSON_BYTES) throw new Error(`${label} exceeds 4 MiB`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function containedPath(root, relative, label) {
  if (
    typeof relative !== "string" ||
    relative.length === 0 ||
    path.isAbsolute(relative) ||
    relative.split(/[\\/]/).includes("..")
  )
    throw new Error(`${label} must be a project-relative path`);
  const resolved = path.resolve(root, relative);
  if (resolved !== path.resolve(root) && !resolved.startsWith(path.resolve(root) + path.sep))
    throw new Error(`${label} escapes the project root`);
  return resolved;
}

function loadCanonicalReview(root, reviewDirRel) {
  const reviewDir = containedPath(root, reviewDirRel, "review directory");
  const reportFile = path.join(reviewDir, "report.json");
  const reportBytes = fs.readFileSync(reportFile);
  if (reportBytes.length > MAX_JSON_BYTES) throw new Error("canonical report exceeds 4 MiB");
  const report = JSON.parse(reportBytes.toString("utf8"));
  if (report?.outcome !== "passed")
    throw new Error("canonical review report outcome is not passed; run a full review round");
  const targetFile = containedPath(root, report?.target?.path, "report target binding");
  const target = readBoundedJson(targetFile, "frozen review target");
  if (!target?.source?.commit) throw new Error("frozen review target has no source commit");
  return { reviewDir, report, reportSha256: digest(reportBytes), target };
}

function chainState(root, reviewDir, report, target) {
  const supplements = readSupplements(reviewDir);
  if (supplements.length === 0) return { prior: target.source.commit, count: 0 };
  const tip = supplements.at(-1).value?.source?.commit;
  const verdict = validateSupplementChain({
    root,
    reviewDir,
    report,
    target,
    currentCommit: tip,
  });
  if (!verdict.ok) throw new Error(`existing delta chain is invalid: ${verdict.reason}`);
  return { prior: tip, count: supplements.length };
}

function atomicWriteJson(file, value) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

function buildCommand(options) {
  const root = path.resolve(options.root || process.cwd());
  assertCleanWorktree(root);
  const head = git(root, ["rev-parse", "HEAD"]);
  const { reviewDir, report, reportSha256, target } = loadCanonicalReview(root, options.reviewDir);
  const { prior, count } = chainState(root, reviewDir, report, target);
  if (count >= MAX_DELTA_SUPPLEMENTS)
    throw new Error(
      `delta budget exhausted (${MAX_DELTA_SUPPLEMENTS} supplements); run a full review round`
    );
  if (head === prior) throw new Error("HEAD is already certified; no delta to review");
  try {
    git(root, ["merge-base", "--is-ancestor", prior, head]);
  } catch {
    throw new Error(
      "certified commit is not an ancestor of HEAD; a rebase needs diff-identity or a full round"
    );
  }
  const delta = computeDelta(root, prior, head);
  if (delta.ineligible) throw new Error(`delta is ineligible: ${delta.ineligible}`);
  if (delta.code_lines > MAX_DELTA_CODE_LINES)
    throw new Error(
      `delta spans ${delta.code_lines} code lines over the ${MAX_DELTA_CODE_LINES}-line budget; run a full review round`
    );
  const certified = new Set();
  for (const row of target.changed_files || []) {
    if (typeof row?.path === "string") certified.add(row.path);
    if (typeof row?.old_path === "string") certified.add(row.old_path);
  }
  for (const row of delta.files) {
    if (DELTA_BUDGET_EXEMPT_RE.test(row.path)) continue;
    if (!certified.has(row.path) && !(row.old_path && certified.has(row.old_path)))
      throw new Error(
        `delta touches ${row.path} outside the certified changed-file set; run a full review round`
      );
  }
  const pending = {
    schema_version: 1,
    kind: PENDING_KIND,
    created_at: new Date().toISOString(),
    generator: { name: "pm:review-delta", version: PLUGIN_VERSION },
    canonical_report: {
      path: "report.json",
      sha256: reportSha256,
      commit: target.source.commit,
    },
    prior_commit: prior,
    chain_index: count + 1,
    source: { commit: head, delta_diff_sha256: delta.delta_diff_sha256 },
    budget: {
      code_lines: delta.code_lines,
      max_code_lines: MAX_DELTA_CODE_LINES,
      max_chain: MAX_DELTA_SUPPLEMENTS,
    },
    changed_files: changedFileInventory(root, prior, head),
    delta_files: delta.files,
  };
  const pendingPath = path.join(reviewDir, "supplements", "pending.json");
  atomicWriteJson(pendingPath, pending);
  return {
    ok: true,
    pending: path.relative(root, pendingPath).split(path.sep).join("/"),
    chain_index: pending.chain_index,
    prior_commit: prior,
    commit: head,
    code_lines: delta.code_lines,
    files: delta.files.map((row) => row.path),
  };
}

function validateResult(result, deltaPaths) {
  const issues = [];
  if (!result || typeof result !== "object") return ["result must be a JSON object"];
  if (!result.reviewer || typeof result.reviewer !== "object")
    issues.push("result.reviewer must describe the reviewer runtime");
  if (
    !Array.isArray(result.lenses) ||
    result.lenses.length === 0 ||
    result.lenses.some((lens) => typeof lens !== "string" || lens.length === 0)
  )
    issues.push("result.lenses must be a non-empty array of lens names");
  if (
    typeof result.summary !== "string" ||
    result.summary.length === 0 ||
    result.summary.length > 2000
  )
    issues.push("result.summary must be 1-2000 characters");
  if (!Array.isArray(result.findings)) issues.push("result.findings must be an array");
  else
    result.findings.forEach((finding, index) => {
      const at = `result.findings[${index}]`;
      if (!finding || typeof finding !== "object") return issues.push(`${at} must be an object`);
      if (!SEVERITIES.has(finding.severity))
        issues.push(`${at}.severity must be critical|high|medium|low`);
      if (typeof finding.file !== "string" || !deltaPaths.has(finding.file))
        issues.push(`${at}.file must name a file in the delta`);
      if (
        typeof finding.issue !== "string" ||
        finding.issue.length === 0 ||
        finding.issue.length > 2000
      )
        issues.push(`${at}.issue must be 1-2000 characters`);
      if ("line" in finding && (!Number.isInteger(finding.line) || finding.line < 1))
        issues.push(`${at}.line must be a positive integer when present`);
    });
  return issues;
}

function recordCommand(options) {
  const root = path.resolve(options.root || process.cwd());
  const { reviewDir, reportSha256 } = loadCanonicalReview(root, options.reviewDir);
  const pendingPath = path.join(reviewDir, "supplements", "pending.json");
  if (!fs.existsSync(pendingPath))
    throw new Error("no pending delta target; run review-delta build first");
  const pending = readBoundedJson(pendingPath, "pending delta target");
  if (pending?.kind !== PENDING_KIND || pending?.schema_version !== 1)
    throw new Error("pending delta target is malformed");
  const head = git(root, ["rev-parse", "HEAD"]);
  if (pending.source?.commit !== head)
    throw new Error("HEAD moved after build; rebuild the pending delta target");
  if (pending.canonical_report?.sha256 !== reportSha256)
    throw new Error("canonical report changed after build; rebuild the pending delta target");
  const delta = computeDelta(root, pending.prior_commit, head);
  if (delta.delta_diff_sha256 !== pending.source?.delta_diff_sha256)
    throw new Error("delta diff bytes drifted after build; rebuild the pending delta target");

  const resultFile = containedPath(root, options.result, "reviewer result");
  const result = readBoundedJson(resultFile, "reviewer result");
  const deltaPaths = new Set(delta.files.map((row) => row.path));
  const issues = validateResult(result, deltaPaths);
  if (issues.length > 0)
    throw new Error(`reviewer result is invalid: ${issues.slice(0, 5).join("; ")}`);

  const blocking = result.findings.filter(
    (finding) => finding.severity === "critical" || finding.severity === "high"
  );
  const outcome = blocking.length === 0 ? "passed" : "failed";
  const supplement = {
    ...pending,
    kind: SUPPLEMENT_KIND,
    recorded_at: new Date().toISOString(),
    result: {
      reviewer: result.reviewer,
      lenses: result.lenses,
      findings: result.findings,
      summary: result.summary,
      outcome,
    },
  };
  if (outcome === "passed") {
    const file = path.join(reviewDir, "supplements", `supplement-${pending.chain_index}.json`);
    if (fs.existsSync(file))
      throw new Error(`supplement-${pending.chain_index}.json already exists; never overwrite`);
    atomicWriteJson(file, supplement);
    fs.rmSync(pendingPath);
    return {
      ok: true,
      outcome,
      supplement: path.relative(root, file).split(path.sep).join("/"),
      chain_index: pending.chain_index,
      commit: head,
    };
  }
  const rejected = path.join(
    reviewDir,
    "supplements",
    `rejected-${head.slice(0, 12)}-${Date.now()}.json`
  );
  atomicWriteJson(rejected, supplement);
  fs.rmSync(pendingPath);
  return {
    ok: false,
    outcome,
    rejected: path.relative(root, rejected).split(path.sep).join("/"),
    blocking: blocking.map((finding) => `${finding.severity}: ${finding.file}: ${finding.issue}`),
  };
}

function checkCommand(options) {
  const root = path.resolve(options.root || process.cwd());
  const commit = options.commit || git(root, ["rev-parse", "HEAD"]);
  const { reviewDir, report, target } = loadCanonicalReview(root, options.reviewDir);
  const verdict = evaluateReviewFreshness({
    root,
    reviewDir,
    report,
    target,
    currentCommit: commit,
    authoritativeBaseCommit: options.base || null,
  });
  return { ok: verdict.ok, method: verdict.method || null, reason: verdict.reason, commit };
}

function parseArgs(argv) {
  const out = { command: argv[0] };
  const map = {
    "--root": "root",
    "--review-dir": "reviewDir",
    "--result": "result",
    "--commit": "commit",
    "--base": "base",
  };
  for (let index = 1; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--json") {
      out.json = true;
      continue;
    }
    const key = map[arg];
    if (!key) throw new Error(`unknown argument ${arg}`);
    const value = argv[++index];
    if (value === undefined) throw new Error(`${arg} requires a value`);
    out[key] = value;
  }
  if (!new Set(["build", "record", "check"]).has(out.command))
    throw new Error("usage: review-delta.js <build|record|check> --review-dir <path> [options]");
  if (!out.reviewDir) throw new Error("--review-dir is required");
  if (out.command === "record" && !out.result) throw new Error("record requires --result");
  return out;
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 2;
  }
  try {
    const handlers = { build: buildCommand, record: recordCommand, check: checkCommand };
    const outcome = handlers[options.command](options);
    process.stdout.write(
      options.json ? `${JSON.stringify(outcome, null, 2)}\n` : `${formatText(outcome)}\n`
    );
    return outcome.ok ? 0 : 1;
  } catch (error) {
    const failure = { ok: false, error: error.message };
    process.stdout.write(
      options.json ? `${JSON.stringify(failure, null, 2)}\n` : `error: ${error.message}\n`
    );
    return 1;
  }
}

function formatText(outcome) {
  return Object.entries(outcome)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`)
    .join("\n");
}

module.exports = { buildCommand, checkCommand, parseArgs, recordCommand, validateResult };

if (require.main === module) process.exitCode = main();
