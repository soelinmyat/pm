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

const {
  MAX_DELTA_CODE_LINES,
  MAX_DELTA_SUPPLEMENTS,
  SUPPLEMENT_KIND,
  certifiedPathSet,
  commitTree,
  computeDelta,
  evaluateReviewFreshness,
  isAncestor,
  projectRelativeDir,
  readSupplements,
  rejectedDeltaStates,
  rejectsCommit,
  scopeViolation,
  validateSupplementChain,
} = require("./lib/review-freshness");
const { readProjectInput, writeProjectJsonAtomic } = require("./lib/project-file");
const { gitExec } = require("./lib/git-env");
const {
  assertCleanWorktree,
  changedFileInventory,
  resolveTrustedBase,
} = require("./review-target");
const { version: PLUGIN_VERSION } = require("../plugin.config.json");

const MAX_JSON_BYTES = 4 * 1024 * 1024;
const SEVERITIES = new Set(["critical", "high", "medium", "low"]);
const PENDING_KIND = "review-delta-pending-v1";

// cwd alone does not pin the repository; an inherited GIT_DIR would point
// every commit lookup here at a repository the gate never certified. gitExec
// is the one sanitized wrapper the whole review toolchain shares.
function git(root, args) {
  return gitExec(root, args).trim();
}

function digest(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

// readProjectInput (shared with every other evidence reader) enforces
// containment, rejects symlinked path components, and bounds the read.
function readContainedJson(root, relative, label) {
  if (typeof relative !== "string" || relative.length === 0 || path.isAbsolute(relative))
    throw new Error(`${label} must be a project-relative path`);
  let input;
  try {
    input = readProjectInput(root, relative, MAX_JSON_BYTES);
  } catch (error) {
    throw new Error(`${label}: ${error.message}`);
  }
  try {
    // Inside the label too: an evidence package holds several JSON files, and
    // a bare parser message names none of them at the operator's terminal.
    return { value: JSON.parse(input.bytes.toString("utf8")), bytes: input.bytes };
  } catch (error) {
    throw new Error(`${label} (${relative}): ${error.message}`);
  }
}

function loadCanonicalReview(root, reviewDirRel) {
  // The CLI only ever names a review directory relative to the project; the
  // containment rule itself lives once, in review-freshness.projectRelativeDir,
  // so the gate and this tool cannot drift on what a review directory is.
  if (typeof reviewDirRel !== "string" || path.isAbsolute(reviewDirRel))
    throw new Error("review directory must be a project-relative path");
  const reviewDir = projectRelativeDir(root, reviewDirRel);
  const reportRead = readContainedJson(root, `${reviewDir}/report.json`, "canonical report");
  const report = reportRead.value;
  if (report?.outcome !== "passed")
    throw new Error("canonical review report outcome is not passed; run a full review round");
  const targetRead = readContainedJson(root, report?.target?.path, "frozen review target");
  // Every scope and identity decision below reads from these bytes, so bind
  // them to the report exactly as review-check does before trusting either.
  if (
    !/^[a-f0-9]{64}$/.test(report?.target?.sha256 || "") ||
    digest(targetRead.bytes) !== report.target.sha256
  )
    throw new Error(
      "frozen review target does not match the canonical report binding; run a full review round"
    );
  const target = targetRead.value;
  if (!target?.source?.commit) throw new Error("frozen review target has no source commit");
  return { reviewDir, report, reportSha256: digest(reportRead.bytes), target };
}

function chainState(root, reviewDir, report, target) {
  const supplements = readSupplements(root, reviewDir);
  if (supplements.length === 0) return { prior: target.source.commit, count: 0 };
  const tip = supplements.at(-1).value?.source?.commit;
  const verdict = validateSupplementChain({
    root,
    reviewDir,
    report,
    target,
    currentCommit: tip,
    // Hand over what we just parsed rather than making the validator re-read
    // and re-parse the same files.
    supplements,
  });
  if (!verdict.ok) throw new Error(`existing delta chain is invalid: ${verdict.reason}`);
  return { prior: tip, count: supplements.length };
}

function buildCommand(options) {
  const root = path.resolve(options.root || process.cwd());
  assertCleanWorktree(root);
  const head = git(root, ["rev-parse", "HEAD"]);
  const { reviewDir, report, reportSha256, target } = loadCanonicalReview(root, options.reviewDir);
  // A blocking delta finding is only honoured if it survives the next build.
  // Without this, `record` -> rejected -> `build` on the unchanged HEAD ->
  // `record` a clean result certifies the very commit a reviewer blocked. The
  // check is content-keyed, so re-committing the rejected tree under a new SHA
  // is not a fix either.
  if (rejectsCommit(root, rejectedDeltaStates(root, reviewDir), head))
    throw new Error(
      `HEAD ${head.slice(0, 12)} carries content a delta review rejected; commit the fix before rebuilding, or run a full review round`
    );
  const { prior, count } = chainState(root, reviewDir, report, target);
  if (count >= MAX_DELTA_SUPPLEMENTS)
    throw new Error(
      `delta budget exhausted (${MAX_DELTA_SUPPLEMENTS} supplements); run a full review round`
    );
  if (head === prior) throw new Error("HEAD is already certified; no delta to review");
  // Same probe the chain validator applies, taken from the same place so the
  // two cannot drift apart on what "descends from" means.
  if (!isAncestor(root, prior, head))
    throw new Error(
      "certified commit is not an ancestor of HEAD; a rebase needs content identity or a full round"
    );
  const delta = computeDelta(root, prior, head);
  if (delta.ineligible) throw new Error(`delta is ineligible: ${delta.ineligible}`);
  if (delta.code_lines > MAX_DELTA_CODE_LINES)
    throw new Error(
      `delta spans ${delta.code_lines} code lines over the ${MAX_DELTA_CODE_LINES}-line budget; run a full review round`
    );
  const violation = scopeViolation(delta.files, certifiedPathSet(target));
  if (violation) throw new Error(`delta ${violation}; run a full review round`);
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
    // The tree travels with the record so a rejection outlives the commit it
    // was filed against: `--amend --date=` mints a new SHA over this same tree,
    // and rejectsCommit compares trees precisely so that cannot look like a fix.
    source: {
      commit: head,
      tree: commitTree(root, head),
      delta_diff_sha256: delta.delta_diff_sha256,
    },
    budget: {
      code_lines: delta.code_lines,
      max_code_lines: MAX_DELTA_CODE_LINES,
      max_chain: MAX_DELTA_SUPPLEMENTS,
    },
    changed_files: changedFileInventory(root, prior, head),
    delta_files: delta.files,
  };
  const pendingPath = `${reviewDir}/supplements/pending.json`;
  writeProjectJsonAtomic(root, pendingPath, pending, { maxBytes: MAX_JSON_BYTES });
  return {
    ok: true,
    pending: pendingPath,
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
  const pendingPath = `${reviewDir}/supplements/pending.json`;
  if (!fs.existsSync(path.join(root, pendingPath)))
    throw new Error("no pending delta target; run review-delta build first");
  const pending = readContainedJson(root, pendingPath, "pending delta target").value;
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

  const result = readContainedJson(root, options.result, "reviewer result").value;
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
    const file = `${reviewDir}/supplements/supplement-${pending.chain_index}.json`;
    if (fs.existsSync(path.join(root, file)))
      throw new Error(`supplement-${pending.chain_index}.json already exists; never overwrite`);
    writeProjectJsonAtomic(root, file, supplement, { replace: false, maxBytes: MAX_JSON_BYTES });
    fs.rmSync(path.join(root, pendingPath));
    return {
      ok: true,
      outcome,
      supplement: file,
      chain_index: pending.chain_index,
      commit: head,
    };
  }
  const rejected = `${reviewDir}/supplements/rejected-${head.slice(0, 12)}-${Date.now()}.json`;
  writeProjectJsonAtomic(root, rejected, supplement, { replace: false, maxBytes: MAX_JSON_BYTES });
  fs.rmSync(path.join(root, pendingPath));
  return {
    ok: false,
    outcome,
    rejected,
    blocking: blocking.map((finding) => `${finding.severity}: ${finding.file}: ${finding.issue}`),
  };
}

// `--base` widens what diff identity will accept: it replaces the frozen base
// with a moved one, so whoever names it decides which upstream content is
// treated as already-reviewed. Passing it through unchecked lets any
// branch-local commit -- including one carrying the very change under review --
// pose as the authoritative base, and exit 0 here is the sanctioned recertify
// evidence. So the flag is an assertion, not an input: it must equal the
// delivery remote's current default-branch tip, resolved from the frozen
// target's own base_ref rather than a hardcoded `origin`.
function authenticateBase(root, target, declaredBase) {
  const baseRef = String(target?.source?.base_ref || "");
  const remotes = git(root, ["remote"])
    .split(/\r?\n/)
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  const remote = remotes.find((candidate) => baseRef.startsWith(`${candidate}/`));
  if (!remote)
    throw new Error(
      `frozen target base_ref ${baseRef || "(missing)"} does not name a configured remote; --base cannot be authenticated`
    );
  const trusted = resolveTrustedBase(root, remote);
  if (!/^[0-9a-f]{7,64}$/.test(trusted?.commit || ""))
    throw new Error(`cannot resolve the authoritative base from ${remote}`);
  // The remote name alone is not the binding: resolveTrustedBase follows the
  // remote's live HEAD symref, so an upstream default-branch switch would
  // otherwise let a different branch's tip authenticate as the reviewed base.
  // review-target.js and review-check.js both assert this; so does this path.
  if (trusted.ref !== baseRef)
    throw new Error(
      `${remote} now defaults to ${trusted.ref}, not the reviewed base ${baseRef}; run a full review round`
    );
  // The target also froze *which* destination it was reviewed against, so a
  // remote renamed or repointed since the pass cannot silently supply a base.
  const frozenUrlSha = target?.source?.remote_push_url_sha256;
  if (frozenUrlSha && trusted.remote_push_url_sha256 !== frozenUrlSha)
    throw new Error(`${remote} no longer points at the delivery URL the review froze`);
  if (!trusted.commit.startsWith(declaredBase) && !declaredBase.startsWith(trusted.commit))
    throw new Error(
      `--base ${declaredBase} is not the authoritative base ${trusted.commit} on ${remote}`
    );
  return trusted.commit;
}

function checkCommand(options) {
  const root = path.resolve(options.root || process.cwd());
  const commit = options.commit || git(root, ["rev-parse", "HEAD"]);
  const { reviewDir, report, target } = loadCanonicalReview(root, options.reviewDir);
  // No --base means the frozen base still stands, which needs no network and
  // no authentication; only the moved-base claim has to be proven.
  const base = options.base ? authenticateBase(root, target, options.base) : null;
  const verdict = evaluateReviewFreshness({
    root,
    reviewDir,
    report,
    target,
    currentCommit: commit,
    authoritativeBaseCommit: base,
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
