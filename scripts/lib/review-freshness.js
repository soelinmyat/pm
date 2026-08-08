"use strict";

// Post-pass Review freshness acceptance. A canonical passed review report is
// frozen at one commit against one authoritative base object. Beyond an exact
// commit match, two narrow, cryptographically bound conditions let a later
// delivery state reuse that pass without a full new round — these are the two
// evaluateReviewFreshness actually tries:
//
//   1. Content identity — the branch was rebased/amended and HEAD is a new
//      commit, but Git object identity proves it introduces the exact reviewed
//      change set: the same set of paths differs from the base, every one of
//      them resolves to the same mode and object ID as at the reviewed commit,
//      and that set is the certified inventory the reviewers actually read.
//   2. Delta supplements — a bounded post-pass fix chain (each link hash-bound
//      to the canonical report, size-budgeted, file-scoped to the certified
//      inventory, and reviewed on its own) reaches the current commit.
//
// Path 1 deliberately reads trees, never diffs. An earlier revision hashed the
// bytes of `git diff` and accepted a commit whose diff hashed equal; two
// separate review rounds then found two separate ways to move those bytes
// without moving the content (an external diff driver, then a tracked
// .gitmodules `ignore = all` erasing gitlink rows). The hash was computed over
// git's *rendering* of a change, and that rendering has an open-ended,
// config-dependent surface. Object IDs have none: `git ls-tree -r` reports one
// `<mode> <type> <oid>` row per path — gitlinks included — and nothing in
// config, gitattributes, or the environment can move it.
//
// baseEquivalence is exported alongside them but is NOT one of those paths and
// is never called from evaluateReviewFreshness. It answers a different
// question for the base-binding caller: the authoritative default branch
// moved, and the merge base of the *reviewed commit* is unchanged, so the
// reviewed three-dot diff scope is byte-identical (evidence-contract.md:
// frozen validation authenticates commits and their merge base, not the moving
// tip). That is a property of the certification, not of HEAD, so it
// deliberately does not re-derive a merge base for the delivery head; doing so
// would reject every rebase onto the advanced base.
//
// Every failure is fail-closed: any git error, object mismatch, or budget
// violation reports not-fresh and the caller demands a full new round. The
// remaining diff reads here price the delta line budget rather than decide
// identity, and they are taken through trustedDiffArgs with a sanitized
// environment so no configured driver supplies the counts.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { readProjectInput } = require("./project-file");
const { gitExec: git, trustedDiffArgs } = require("./git-env");

const MAX_DELTA_CODE_LINES = 50;
const MAX_DELTA_SUPPLEMENTS = 2;
const MAX_SUPPLEMENT_JSON_BYTES = 4 * 1024 * 1024;
const SUPPLEMENT_KIND = "review-delta-v1";
// Matches any slot index so an over-cap chain is reported as a cap violation
// rather than silently dropped by the filename filter; MAX_DELTA_SUPPLEMENTS
// stays the single place the cap is enforced.
const SUPPLEMENT_FILE_RE = /^supplement-(\d+)\.json$/;
// record writes one of these whenever a scoped delta reviewer files a
// critical or high finding. They are not decoration: without reading them
// back, a blocking finding can be retried away by re-running build on the
// unchanged HEAD until a clean result is recorded.
const REJECTED_FILE_RE = /^rejected-[0-9a-f]{7,40}-\d+\.json$/;
// Paths whose churn does not count against the delta code-line budget and may
// fall outside the certified changed-file inventory: tests and non-runtime
// documentation under the repo-root docs/ tree only — a docs/ directory
// nested under a runtime tree (skills/dev/docs/) is loadable source. Runtime
// Markdown (skills/, references/, commands/, templates/) is reviewable source
// (reviewer-briefs.md) and stays budgeted. A row is exempt only when BOTH
// rename ends are exempt; a rename crossing the exempt boundary in either
// direction is ineligible outright.
const DELTA_BUDGET_EXEMPT_RE =
  /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[cm]?[jt]sx?$|^docs\/.*\.md$/;
// The exemption is about content the runtime never loads, so the runtime trees
// override it outright. `plugin.json` maps ./skills/ and ./commands/ straight
// into the agent's instruction surface, and a directory named `tests` under
// either one is still `skills/tests/SKILL.md` — a loaded skill. Without this
// gate the nested-directory alternation above exempts that path from both the
// line budget and the certified-file scope check, so a post-pass delta could
// add unbounded agent instructions no reviewer read. `docs/` is already
// root-anchored for the same reason; this is the same anchoring applied to the
// alternation that was left unanchored.
const RUNTIME_TREE_RE = /^(skills|references|commands|templates)\//;
const COMMITISH_RE = /^[0-9a-f]{7,64}$/;

function isExemptPath(value) {
  if (typeof value !== "string" || value === "") return false;
  if (RUNTIME_TREE_RE.test(value)) return false;
  return DELTA_BUDGET_EXEMPT_RE.test(value);
}

function isExemptRow(row) {
  if (!isExemptPath(row?.path)) return false;
  return !row?.old_path || isExemptPath(row.old_path);
}

function boundaryCrossingRename(row) {
  if (typeof row?.old_path !== "string") return false;
  return isExemptPath(row.path) !== isExemptPath(row.old_path);
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

function commitTree(root, commitish) {
  try {
    const tree = git(root, ["rev-parse", `${commitish}^{tree}`]).trim();
    return /^[0-9a-f]{40,64}$/.test(tree) ? tree : null;
  } catch {
    return null;
  }
}

// A Git path is an arbitrary byte string, and `latin1` is the only lossless
// byte<->JS-string mapping Node offers: one code unit per byte, no
// normalization, no replacement. Decoding tree output as UTF-8 instead is a
// forgery route rather than a cosmetic bug, because every byte sequence that is
// not valid UTF-8 decodes to the same U+FFFD REPLACEMENT CHARACTER. Two
// distinct paths (`a\xFE` and `a\xFF`) then collapse onto one Map key and the
// later one silently overwrites the earlier, erasing its entry from the
// inventory — so a commit that rewrites the shadowed path introduces content no
// reviewer read while every changed-path set and object ID still compares
// equal. Paths therefore key on bytes everywhere in this module, and anything
// arriving as a JSON string (a certified inventory row, a numstat record) is
// converted with pathKey before it is compared.
function pathKey(value) {
  return Buffer.from(String(value), "utf8").toString("latin1");
}

// Inverse of pathKey, for human-facing failure reasons only. Never compare
// against the result: a path whose bytes are not valid UTF-8 does not survive
// the round trip, which is precisely why comparison stays in byte space.
function displayPath(key) {
  return Buffer.from(key, "latin1").toString("utf8");
}

// Every path a commit records, as `<mode> <type> <oid>`, keyed by exact path
// bytes. `ls-tree -r` walks subtrees but stops at gitlinks, so a submodule
// pointer is a leaf row of type `commit` and its bump changes this map — the
// single reason identity is decided here rather than over diff output. Nothing
// about this reading passes through diff config, gitattributes, or a diff
// driver.
function treeInventory(root, commitish) {
  // --full-tree is load-bearing, not tidiness: without it ls-tree is scoped to
  // the process cwd and emits cwd-relative names, while every other path source
  // here (numstat, the certified inventory) is repo-root-relative. When root is
  // not the repository top level the two namespaces cannot agree and, worse,
  // content above root vanishes from the comparison entirely.
  //
  // latin1 is a byte-for-byte decode, so splitting the decoded string on NUL is
  // identical to splitting the raw buffer on 0x00.
  const raw = git(
    root,
    ["ls-tree", "-r", "--full-tree", "-z", `${commitish}^{tree}`],
    null
  ).toString("latin1");
  const entries = new Map();
  for (const record of raw.split("\0")) {
    if (record === "") continue;
    const match = record.match(/^([0-7]{6}) (blob|commit|tree) ([0-9a-f]{40,64})\t([\s\S]+)$/);
    if (!match) throw new Error(`unsupported ls-tree record: ${record.slice(0, 120)}`);
    // A tree cannot list one path twice, so a collision here means the decode
    // lost information. Fail closed rather than overwrite.
    if (entries.has(match[4])) throw new Error(`ls-tree reported ${displayPath(match[4])} twice`);
    entries.set(match[4], `${match[1]} ${match[2]} ${match[3]}`);
  }
  return entries;
}

// The set of paths whose recorded object differs between two commits, plus the
// post-image inventory so callers can compare content without re-reading. Mode
// is part of the compared value: a 100644 -> 100755 flip is a real change that
// carries no content bytes at all.
function changedTreePaths(root, fromCommit, toCommit, readTree = treeInventory.bind(null, root)) {
  const from = readTree(fromCommit);
  const to = readTree(toCommit);
  const changed = new Set();
  for (const [file, entry] of to) if (from.get(file) !== entry) changed.add(file);
  for (const file of from.keys()) if (!to.has(file)) changed.add(file);
  return { changed, to };
}

function sameStringSet(left, right) {
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}

function listPaths(files) {
  const shown = files.slice(0, 3).map(displayPath).join(", ");
  return files.length > 3 ? `${shown} (+${files.length - 3} more)` : shown;
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

// --- 2. Content identity -------------------------------------------------

// Accepts a later commit only when Git objects say it carries the reviewed
// change and nothing else. Three facts, all read from trees:
//
//   a. The reviewed commit and the current commit change the same set of paths
//      against their respective bases. A branch that grew or lost a path is
//      outside what anyone scoped.
//   b. Every one of those paths resolves to the same mode and object ID at
//      both commits. Files the moved base absorbed may differ — they are not
//      in the changed set — but a changed path whose object differs is content
//      no reviewer read.
//   c. That path set is exactly the certified inventory frozen in the target,
//      which is the list the reviewers were handed. A path the reviewed commit
//      genuinely changed but the inventory omits was never in scope, however
//      it came to be omitted.
//
// (c) is what makes this fail closed on the suppression class rather than
// merely on one instance of it: a change git declined to render still changes
// the tree, so it shows up in (a) and fails the comparison against the frozen
// list. Passing `target` is therefore strongly preferred; `source` alone still
// gets (a) and (b).
function contentIdentity({ root, target, source, currentCommit, currentBaseCommit = null }) {
  try {
    const frozen = source || target?.source;
    if (!frozen || typeof frozen !== "object") return fail("review target source is missing");
    const { commit, base_commit: baseCommit } = frozen;
    if (!validCommitish(commit) || !validCommitish(baseCommit))
      return fail("frozen source commits are not valid object names");
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
    // Both scopes are three-dot: the reviewed inventory was frozen over
    // base...commit, so identity has to be judged over the same span or a
    // branch that merged its base would compare against the wrong content.
    const reviewedBase = mergeBase(root, baseCommit, commit);
    const currentMergeBase = mergeBase(root, compareBase, currentCommit);
    if (!reviewedBase) return fail("reviewed commit and its base have no merge base");
    if (!currentMergeBase) return fail("current commit and the comparison base have no merge base");

    // On the ordinary accept path (an amend, or a rebase onto an unchanged
    // base) reviewedBase and currentMergeBase are the same commit, so cache by
    // resolved tree OID and read each distinct tree once.
    const trees = new Map();
    const readTree = (commitish) => {
      const oid = commitTree(root, commitish) || commitish;
      if (!trees.has(oid)) trees.set(oid, treeInventory(root, commitish));
      return trees.get(oid);
    };

    const reviewed = changedTreePaths(root, reviewedBase, commit, readTree);
    if (reviewed.changed.size === 0)
      return fail("the reviewed commit changes nothing against its base");
    const current = changedTreePaths(root, currentMergeBase, currentCommit, readTree);
    if (!sameStringSet(reviewed.changed, current.changed)) {
      const added = [...current.changed].filter((file) => !reviewed.changed.has(file));
      const missing = [...reviewed.changed].filter((file) => !current.changed.has(file));
      return fail(
        added.length > 0
          ? `current branch changes ${listPaths(added)} outside the reviewed change set`
          : `current branch no longer changes ${listPaths(missing)} from the reviewed change set`
      );
    }
    // A deleted path is absent from both post-image inventories, so the
    // undefined === undefined case is identity, not a hole.
    const drifted = [...reviewed.changed].filter(
      (file) => reviewed.to.get(file) !== current.to.get(file)
    );
    if (drifted.length > 0) return fail(`reviewed content differs at ${listPaths(drifted)}`);

    const certified = certifiedPathSet(target);
    if (certified.size > 0 && !sameStringSet(reviewed.changed, certified)) {
      const unlisted = [...reviewed.changed].filter((file) => !certified.has(file));
      return fail(
        unlisted.length > 0
          ? `reviewed commit changes ${listPaths(unlisted)}, which the certified inventory does not list`
          : "certified inventory lists paths the reviewed commit does not change"
      );
    }
    return ok(
      compareBase === baseCommit
        ? "identical objects across the reviewed change set"
        : "identical objects across the reviewed change set on the moved base"
    );
  } catch (error) {
    return fail(`cannot authenticate content identity: ${error.message}`);
  }
}

// --- 3. Delta supplement chain -------------------------------------------

function computeDelta(root, priorCommit, commit) {
  // priorCommit is required to be an ancestor of commit, so three-dot equals
  // two-dot and stays consistent with the frozen-diff invocation.
  const range = `${priorCommit}...${commit}`;
  // Both calls carry the trust set. --find-renames matters twice over: the
  // boundary-crossing-rename guard below can only fire on a rename row, so
  // `diff.renames = false` in any inherited config would otherwise split the
  // rename into a free exempt addition plus a priced deletion and let source
  // relocate into tests/ unscoped; and delta_diff_sha256 is hash-bound, so the
  // same setting would drift a legitimately certified chain into a forced full
  // round on any clone configured differently.
  const diffBytes = git(root, trustedDiffArgs("--binary", range), null);
  const numstat = parseNumstat(git(root, trustedDiffArgs("--numstat", "-z", range), null));
  let codeLines = 0;
  let ineligible = null;
  for (const row of numstat) {
    if (boundaryCrossingRename(row)) {
      // A rename across the exempt boundary relocates source with zero
      // counted lines; neither budget nor scope can price it honestly.
      ineligible = `rename between exempt and non-exempt paths (${row.old_path} -> ${row.path})`;
      continue;
    }
    const exempt = isExemptRow(row);
    if (row.binary && !exempt) {
      ineligible = `binary change to non-exempt path ${row.path}`;
      continue;
    }
    if (!exempt) codeLines += row.added + row.deleted;
  }
  // The budget and the scope check are only as honest as the row list they are
  // computed from, and that list comes out of the diff machinery. Trees are the
  // independent account of what changed: any path the objects say moved but the
  // diff declined to price is unpriced and unscoped, so the delta is ineligible
  // rather than free. This is what keeps a suppressed row from riding the
  // supplement path after content identity closed the front door.
  const deltaBase = mergeBase(root, priorCommit, commit);
  if (!deltaBase) {
    ineligible = ineligible || "delta commits have no merge base";
  } else {
    // Tree keys are path bytes; numstat rows arrive as decoded strings, so the
    // comparison happens in byte space. A path whose bytes are not valid UTF-8
    // cannot round-trip through the row, so it stays unpriced and the delta is
    // ineligible — which is the correct fail-closed answer.
    const unpriced = [...changedTreePaths(root, deltaBase, commit).changed].filter((file) => {
      return !numstat.some(
        (row) => pathKey(row.path) === file || (row.old_path && pathKey(row.old_path) === file)
      );
    });
    if (unpriced.length > 0 && !ineligible)
      ineligible = `change to ${listPaths(unpriced)} is absent from the priced diff`;
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

function projectRelativeDir(root, dir) {
  const relative = path.isAbsolute(dir) ? path.relative(path.resolve(root), dir) : dir;
  const normalized = relative.split(path.sep).join("/").replace(/\/+$/, "");
  if (
    normalized === "" ||
    normalized === "." ||
    normalized.split("/").some((part) => part === "..")
  )
    throw new Error("review directory must resolve inside the project root");
  return normalized;
}

function supplementFileNames(root, reviewDir) {
  const relative = projectRelativeDir(root, reviewDir);
  const dir = path.join(path.resolve(root), relative, "supplements");
  if (!fs.existsSync(dir)) return { relative, names: [] };
  // Order by slot index, not lexicographically, so a two-digit slot cannot
  // sort ahead of supplement-2.json and disguise itself as a contiguous chain.
  const names = fs
    .readdirSync(dir)
    .filter((name) => SUPPLEMENT_FILE_RE.test(name))
    .sort(
      (left, right) =>
        Number(left.match(SUPPLEMENT_FILE_RE)[1]) - Number(right.match(SUPPLEMENT_FILE_RE)[1])
    );
  return { relative, names };
}

// Cheap existence probe for acceptance ordering. It deliberately does not
// parse: a corrupt supplement must not turn a content-identical amend, which
// the content-identity path can authenticate on its own, into a hard failure.
// If the chain is actually needed, readSupplements parses and reports the
// corruption.
function hasSupplements(root, reviewDir) {
  try {
    return supplementFileNames(root, reviewDir).names.length > 0;
  } catch {
    return false;
  }
}

// What a scoped delta reviewer already blocked. Reading these makes a rejection
// stick: the only way past it is a commit that actually carries the fix, which
// is what delta-supplement.md has always described. A malformed audit record
// throws rather than resolving to "nothing was rejected".
//
// Keying on the commit SHA alone was not that rule. `--amend -m`, `--amend
// --date=` and `--allow-empty` all mint a fresh SHA over an unchanged tree, so
// any of them walked a rejected HEAD straight back into `build`. The tree OID
// is the content the reviewer read and rejected; a commit that genuinely
// carries the fix has a different one, and no amount of re-committing the same
// content can produce a tree that differs. The SHA set stays as a cheap first
// hit and as the record for a rejected commit whose objects are gone.
function rejectedDeltaStates(root, reviewDir) {
  const relative = projectRelativeDir(root, reviewDir);
  const dir = path.join(path.resolve(root), relative, "supplements");
  const commits = new Set();
  const trees = new Set();
  if (!fs.existsSync(dir)) return { commits, trees };
  for (const name of fs.readdirSync(dir).filter((entry) => REJECTED_FILE_RE.test(entry))) {
    const input = readProjectInput(
      root,
      `${relative}/supplements/${name}`,
      MAX_SUPPLEMENT_JSON_BYTES
    );
    const value = JSON.parse(input.bytes.toString("utf8"));
    const commit = value?.source?.commit;
    if (!validCommitish(commit)) throw new Error(`${name} does not name the commit it rejected`);
    commits.add(commit);
    // Prefer the tree recorded at rejection time; fall back to reading it back
    // off the commit, which still works until the object is pruned.
    const recorded = value?.source?.tree;
    const tree = validCommitish(recorded) ? recorded : commitTree(root, commit);
    if (tree) trees.add(tree);
  }
  return { commits, trees };
}

// True when `commit` re-presents content a delta review already rejected.
function rejectsCommit(root, rejected, commit) {
  if (rejected.commits.has(commit)) return true;
  const tree = commitTree(root, commit);
  return Boolean(tree) && rejected.trees.has(tree);
}

function readSupplements(root, reviewDir) {
  const { relative, names } = supplementFileNames(root, reviewDir);
  return names.map((name) => {
    // readProjectInput enforces containment, rejects symlinked components,
    // and bounds the read; a redirected supplements/ directory fails closed.
    const input = readProjectInput(
      root,
      `${relative}/supplements/${name}`,
      MAX_SUPPLEMENT_JSON_BYTES
    );
    const value = JSON.parse(input.bytes.toString("utf8"));
    const index = Number(name.match(SUPPLEMENT_FILE_RE)[1]);
    return { name, index, value };
  });
}

// Byte keys, not JSON strings: the certified inventory is compared against
// tree-derived path sets, and those key on exact path bytes (see pathKey).
function certifiedPathSet(target) {
  const certified = new Set();
  for (const row of target?.changed_files || []) {
    if (typeof row?.path === "string") certified.add(pathKey(row.path));
    if (typeof row?.old_path === "string") certified.add(pathKey(row.old_path));
  }
  return certified;
}

// Shared by validateSupplementChain and review-delta's build so eligibility
// and gate enforcement can never diverge.
function scopeViolation(deltaFiles, certified) {
  for (const row of deltaFiles || []) {
    if (isExemptRow(row)) continue;
    // certified holds byte keys (certifiedPathSet); rows hold decoded strings.
    if (
      !certified.has(pathKey(row.path)) &&
      !(row.old_path && certified.has(pathKey(row.old_path)))
    )
      return `touches ${row.path} outside the certified changed-file set`;
  }
  return null;
}

// `supplements` may be supplied by a caller that has already read and ordered
// them (review-delta's chainState does), which keeps a single parse per
// evaluation instead of two.
function validateSupplementChain({
  root,
  reviewDir,
  report,
  target,
  currentCommit,
  supplements: preread = null,
}) {
  try {
    const supplements = preread || readSupplements(root, reviewDir);
    if (supplements.length === 0) return fail("no delta supplements recorded");
    const rejected = rejectedDeltaStates(root, reviewDir);
    if (supplements.length > MAX_DELTA_SUPPLEMENTS)
      return fail(`delta chain exceeds the ${MAX_DELTA_SUPPLEMENTS}-supplement cap`);
    const reportSha = digest(
      readProjectInput(
        root,
        `${projectRelativeDir(root, reviewDir)}/report.json`,
        MAX_SUPPLEMENT_JSON_BYTES
      ).bytes
    );
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
      if (rejectsCommit(root, rejected, commit))
        return fail(`${name} certifies ${commit.slice(0, 12)}, which a delta review rejected`);
      // The supplement records the tree it was reviewed over. Re-reading it
      // keeps a rewritten commit from inheriting a supplement written for
      // different content while still naming the same SHA-shaped field.
      const recordedTree = value?.source?.tree;
      if (recordedTree !== undefined && commitTree(root, commit) !== recordedTree)
        return fail(
          `${name} certifies content that is no longer the tree of ${commit.slice(0, 12)}`
        );
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
      const violation = scopeViolation(delta.files, certified);
      if (violation) return fail(`${name} ${violation}`);
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
    // Recorded supplements mean the delta chain is the intended path, and it
    // reads only the per-supplement deltas. Trying it first avoids buffering
    // and hashing the whole branch diff twice on every recertification and
    // every ship retry. Both paths stay fail-closed and both are attempted
    // either way, so order changes only which accepted method is reported and
    // how much work a pass costs — never whether a commit is accepted.
    const chainFirst = hasSupplements(root, reviewDir);
    const evaluateChain = () =>
      validateSupplementChain({ root, reviewDir, report, target, currentCommit });
    const evaluateIdentity = () =>
      contentIdentity({
        root,
        target,
        source,
        currentCommit,
        currentBaseCommit: authoritativeBaseCommit,
      });

    if (chainFirst) {
      const chain = evaluateChain();
      if (chain.ok) return { ...chain, method: "delta-chain" };
      const identity = evaluateIdentity();
      if (identity.ok) return { ...identity, method: "content-identity" };
      return fail(`content identity: ${identity.reason}; delta chain: ${chain.reason}`);
    }
    const identity = evaluateIdentity();
    if (identity.ok) return { ...identity, method: "content-identity" };
    const chain = evaluateChain();
    if (chain.ok) return { ...chain, method: "delta-chain" };
    return fail(`content identity: ${identity.reason}; delta chain: ${chain.reason}`);
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
  certifiedPathSet,
  changedTreePaths,
  commitTree,
  computeDelta,
  contentIdentity,
  evaluateReviewFreshness,
  isExemptRow,
  projectRelativeDir,
  readSupplements,
  rejectedDeltaStates,
  rejectsCommit,
  scopeViolation,
  treeInventory,
  validateSupplementChain,
};
