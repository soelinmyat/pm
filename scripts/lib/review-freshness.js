"use strict";

// Post-pass Review freshness acceptance. A canonical passed review report is
// frozen at one commit against one authoritative base object. Three narrow,
// cryptographically bound conditions let later delivery states reuse that pass
// without a full new round:
//
//   1. Base equivalence — the authoritative default branch moved, but the
//      merge base of the delivery head is unchanged, so the reviewed three-dot
//      diff scope is byte-identical (evidence-contract.md: frozen validation
//      authenticates commits and their merge base, not the moving tip).
//   2. Diff identity — the branch was rebased/amended and HEAD is a new
//      commit, but `git patch-id --stable` proves the branch introduces the
//      exact reviewed change set.
//   3. Delta supplements — a bounded post-pass fix chain (each link hash-bound
//      to the canonical report, size-budgeted, file-scoped to the certified
//      inventory, and reviewed on its own) reaches the current commit.
//
// Every failure is fail-closed: any git error, hash mismatch, or budget
// violation reports not-fresh and the caller demands a full new round.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const MAX_DELTA_CODE_LINES = 50;
const MAX_DELTA_SUPPLEMENTS = 2;
const MAX_SUPPLEMENT_JSON_BYTES = 4 * 1024 * 1024;
const SUPPLEMENT_KIND = "review-delta-v1";
const SUPPLEMENT_FILE_RE = /^supplement-([12])\.json$/;
// Paths whose churn does not count against the delta code-line budget and may
// fall outside the certified changed-file inventory: tests and prose docs.
const DELTA_BUDGET_EXEMPT_RE = /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[cm]?[jt]sx?$|\.md$/;
const COMMITISH_RE = /^[0-9a-f]{7,64}$/;

function git(root, args, encoding = "utf8", input = undefined) {
  return execFileSync("git", args, {
    cwd: root,
    encoding,
    input,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

function digest(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function validCommitish(value) {
  return typeof value === "string" && COMMITISH_RE.test(value);
}

function commitExists(root, commitish) {
  try {
    git(root, ["cat-file", "-e", `${commitish}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

function isAncestor(root, ancestor, descendant) {
  try {
    git(root, ["merge-base", "--is-ancestor", ancestor, descendant]);
    return true;
  } catch {
    return false;
  }
}

function mergeBase(root, left, right) {
  try {
    return git(root, ["merge-base", left, right]).trim() || null;
  } catch {
    return null;
  }
}

function frozenDiff(root, baseCommit, commit) {
  // Must byte-match review-target.js's frozen invocation exactly.
  return git(root, ["diff", "--binary", `${baseCommit}...${commit}`], null);
}

function patchIdOfDiff(root, diffBytes) {
  if (!diffBytes || diffBytes.length === 0) return null;
  const out = git(root, ["patch-id", "--stable"], "utf8", diffBytes);
  const match = out.match(/^([0-9a-f]{40,64}) /);
  return match ? match[1] : null;
}

// --- 1. Base equivalence -------------------------------------------------

function baseEquivalence({ root, commit, frozenBaseCommit, liveBaseCommit }) {
  try {
    if (!validCommitish(commit)) return fail("current commit is not a valid object name");
    if (!validCommitish(frozenBaseCommit)) return fail("frozen base is not a valid object name");
    if (!validCommitish(liveBaseCommit)) return fail("live base is not a valid object name");
    if (frozenBaseCommit === liveBaseCommit) return ok("exact base match");
    for (const [label, sha] of [
      ["current commit", commit],
      ["frozen base", frozenBaseCommit],
      ["live base", liveBaseCommit],
    ]) {
      if (!commitExists(root, sha)) return fail(`${label} ${sha} is not present locally`);
    }
    if (!isAncestor(root, frozenBaseCommit, liveBaseCommit))
      return fail("frozen base is not an ancestor of the live authoritative base");
    const withLive = mergeBase(root, commit, liveBaseCommit);
    const withFrozen = mergeBase(root, commit, frozenBaseCommit);
    if (!withLive || !withFrozen || withLive !== withFrozen)
      return fail("merge base with the live base differs from the frozen base merge base");
    return ok("merge-base equivalent");
  } catch (error) {
    return fail(`cannot authenticate base equivalence: ${error.message}`);
  }
}

// --- 2. Diff identity ----------------------------------------------------

function diffIdentity({ root, source, currentCommit, currentBaseCommit = null }) {
  try {
    if (!source || typeof source !== "object") return fail("review target source is missing");
    const { commit, base_commit: baseCommit, diff_sha256: diffSha } = source;
    if (!validCommitish(commit) || !validCommitish(baseCommit))
      return fail("frozen source commits are not valid object names");
    if (!/^[a-f0-9]{64}$/.test(diffSha || "")) return fail("frozen diff_sha256 is missing");
    if (!validCommitish(currentCommit)) return fail("current commit is not a valid object name");
    const compareBase = currentBaseCommit || baseCommit;
    if (!validCommitish(compareBase)) return fail("comparison base is not a valid object name");
    for (const [label, sha] of [
      ["frozen commit", commit],
      ["frozen base", baseCommit],
      ["current commit", currentCommit],
      ["comparison base", compareBase],
    ]) {
      if (!commitExists(root, sha)) return fail(`${label} ${sha} is not present locally`);
    }
    const reviewed = frozenDiff(root, baseCommit, commit);
    if (digest(reviewed) !== diffSha)
      return fail("frozen diff bytes no longer match the reviewed diff_sha256");
    const current = frozenDiff(root, compareBase, currentCommit);
    const reviewedId = patchIdOfDiff(root, reviewed);
    const currentId = patchIdOfDiff(root, current);
    if (!reviewedId || !currentId)
      return fail("reviewed or current diff is empty and cannot prove identity");
    if (reviewedId !== currentId)
      return fail("current branch diff is not patch-identical to the reviewed diff");
    return ok("patch-identical to the reviewed diff");
  } catch (error) {
    return fail(`cannot authenticate diff identity: ${error.message}`);
  }
}

// --- 3. Delta supplement chain -------------------------------------------

function computeDelta(root, priorCommit, commit) {
  // priorCommit is required to be an ancestor of commit, so three-dot equals
  // two-dot and stays consistent with the frozen-diff invocation.
  const range = `${priorCommit}...${commit}`;
  const diffBytes = git(root, ["diff", "--binary", range], null);
  const numstat = parseNumstat(git(root, ["diff", "--numstat", "-z", range], null));
  let codeLines = 0;
  let ineligible = null;
  for (const row of numstat) {
    const exempt = DELTA_BUDGET_EXEMPT_RE.test(row.path);
    if (row.binary && !exempt) {
      ineligible = `binary change to non-exempt path ${row.path}`;
      continue;
    }
    if (!exempt) codeLines += row.added + row.deleted;
  }
  return {
    delta_diff_sha256: digest(diffBytes),
    code_lines: codeLines,
    files: numstat,
    ineligible,
  };
}

function parseNumstat(raw) {
  const fields = raw.toString("utf8").split("\0");
  if (fields.at(-1) === "") fields.pop();
  const rows = [];
  for (let index = 0; index < fields.length; ) {
    const head = fields[index++];
    const match = head.match(/^(\d+|-)\t(\d+|-)\t([\s\S]*)$/);
    if (!match) throw new Error(`unsupported numstat record: ${head.slice(0, 120)}`);
    const binary = match[1] === "-" || match[2] === "-";
    let filePath = match[3];
    let oldPath = null;
    if (filePath === "") {
      oldPath = fields[index++];
      filePath = fields[index++];
      if (typeof filePath !== "string" || typeof oldPath !== "string")
        throw new Error("unsupported numstat rename record");
    }
    rows.push({
      path: filePath,
      old_path: oldPath,
      added: binary ? 0 : Number(match[1]),
      deleted: binary ? 0 : Number(match[2]),
      binary,
    });
  }
  return rows.sort((left, right) => left.path.localeCompare(right.path));
}

function readSupplements(reviewDir) {
  const dir = path.join(reviewDir, "supplements");
  if (!fs.existsSync(dir)) return [];
  const names = fs
    .readdirSync(dir)
    .filter((name) => SUPPLEMENT_FILE_RE.test(name))
    .sort();
  return names.map((name) => {
    const file = path.join(dir, name);
    const stat = fs.lstatSync(file);
    if (!stat.isFile()) throw new Error(`${name} must be a regular file`);
    if (stat.size > MAX_SUPPLEMENT_JSON_BYTES) throw new Error(`${name} exceeds 4 MiB`);
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    const index = Number(name.match(SUPPLEMENT_FILE_RE)[1]);
    return { name, index, value };
  });
}

function certifiedPathSet(target) {
  const certified = new Set();
  for (const row of target?.changed_files || []) {
    if (typeof row?.path === "string") certified.add(row.path);
    if (typeof row?.old_path === "string") certified.add(row.old_path);
  }
  return certified;
}

function validateSupplementChain({ root, reviewDir, report, target, currentCommit }) {
  try {
    const supplements = readSupplements(reviewDir);
    if (supplements.length === 0) return fail("no delta supplements recorded");
    if (supplements.length > MAX_DELTA_SUPPLEMENTS)
      return fail(`delta chain exceeds the ${MAX_DELTA_SUPPLEMENTS}-supplement cap`);
    const reportFile = path.join(reviewDir, "report.json");
    const reportSha = digest(fs.readFileSync(reportFile));
    const frozenCommit = target?.source?.commit || report?.source?.commit;
    if (!validCommitish(frozenCommit)) return fail("frozen report commit is missing");
    if (!validCommitish(currentCommit)) return fail("current commit is not a valid object name");
    const certified = certifiedPathSet(target);
    if (certified.size === 0) return fail("frozen target has no certified changed files");
    let prior = frozenCommit;
    for (let position = 0; position < supplements.length; position++) {
      const { name, index, value } = supplements[position];
      if (index !== position + 1) return fail(`delta chain is not contiguous at ${name}`);
      if (value?.kind !== SUPPLEMENT_KIND || value?.schema_version !== 1)
        return fail(`${name} is not a ${SUPPLEMENT_KIND} supplement`);
      if (value?.canonical_report?.sha256 !== reportSha)
        return fail(`${name} does not bind the current canonical report bytes`);
      if (value?.canonical_report?.commit !== frozenCommit)
        return fail(`${name} does not bind the frozen report commit`);
      if (value?.prior_commit !== prior)
        return fail(`${name} prior commit does not continue the chain`);
      const commit = value?.source?.commit;
      if (!validCommitish(commit) || commit === prior)
        return fail(`${name} supplement commit is invalid`);
      if (!commitExists(root, prior) || !commitExists(root, commit))
        return fail(`${name} chain commits are not present locally`);
      if (!isAncestor(root, prior, commit))
        return fail(`${name} supplement commit does not descend from its prior commit`);
      const delta = computeDelta(root, prior, commit);
      if (delta.ineligible) return fail(`${name}: ${delta.ineligible}`);
      if (delta.delta_diff_sha256 !== value?.source?.delta_diff_sha256)
        return fail(`${name} delta diff bytes drifted from the reviewed delta`);
      if (delta.code_lines > MAX_DELTA_CODE_LINES)
        return fail(
          `${name} delta spans ${delta.code_lines} code lines over the ${MAX_DELTA_CODE_LINES}-line budget`
        );
      for (const row of delta.files) {
        if (DELTA_BUDGET_EXEMPT_RE.test(row.path)) continue;
        if (!certified.has(row.path) && !(row.old_path && certified.has(row.old_path)))
          return fail(`${name} touches ${row.path} outside the certified changed-file set`);
      }
      if (value?.result?.outcome !== "passed")
        return fail(`${name} delta review outcome is not passed`);
      prior = commit;
    }
    if (prior !== currentCommit)
      return fail(`delta chain ends at ${prior.slice(0, 12)}, not the current commit`);
    return ok(`accepted through ${supplements.length} delta supplement(s)`);
  } catch (error) {
    return fail(`cannot validate delta supplement chain: ${error.message}`);
  }
}

// --- Combined acceptance --------------------------------------------------

function evaluateReviewFreshness({
  root,
  reviewDir,
  report,
  target,
  currentCommit,
  authoritativeBaseCommit = null,
}) {
  try {
    if (report?.outcome !== "passed") return fail("canonical report outcome is not passed");
    const source = target?.source || report?.source;
    if (source?.commit === currentCommit)
      return { ...ok("bound to current commit"), method: "exact" };
    const identity = diffIdentity({
      root,
      source,
      currentCommit,
      currentBaseCommit: authoritativeBaseCommit,
    });
    if (identity.ok) return { ...identity, method: "diff-identity" };
    const chain = validateSupplementChain({ root, reviewDir, report, target, currentCommit });
    if (chain.ok) return { ...chain, method: "delta-chain" };
    return fail(`diff identity: ${identity.reason}; delta chain: ${chain.reason}`);
  } catch (error) {
    return fail(`cannot evaluate review freshness: ${error.message}`);
  }
}

function ok(reason) {
  return { ok: true, reason };
}

function fail(reason) {
  return { ok: false, reason };
}

module.exports = {
  MAX_DELTA_CODE_LINES,
  MAX_DELTA_SUPPLEMENTS,
  SUPPLEMENT_KIND,
  DELTA_BUDGET_EXEMPT_RE,
  baseEquivalence,
  computeDelta,
  diffIdentity,
  evaluateReviewFreshness,
  readSupplements,
  validateSupplementChain,
};
