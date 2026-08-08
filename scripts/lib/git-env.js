"use strict";

const { execFileSync } = require("node:child_process");
const os = require("node:os");

const GIT_ENV_KEYS_TO_CLEAR = Object.freeze([
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_PREFIX",
  "GIT_NAMESPACE",
  "GIT_SUPER_PREFIX",
  // GIT_EXTERNAL_DIFF replaces git's diff output wholesale with a shim's
  // stdout. Every review hash is computed over those bytes, so leaving it set
  // hands an attacker the content the gate believes was reviewed.
  "GIT_EXTERNAL_DIFF",
]);

// Clearing the environment is not sufficient on its own: `diff.external` and a
// gitattributes textconv driver reach the same output through config, which no
// env scrub can reach. Every diff whose bytes or line counts are hash-bound or
// budget-bound must therefore ask git for its own diff explicitly.
// --find-renames pins rename detection too, so an inherited `diff.renames`
// setting cannot move the recorded bytes on a clone that merely configures git
// differently. --ignore-submodules=none overrides the `ignore` key a tracked
// .gitmodules may set: `ignore = all` is ordinary repo content, needs no env or
// local config, and erases gitlink rows from both the diff bytes and the
// numstat line pricing, so a submodule pointer bump to arbitrary code would
// otherwise render byte-identical to the change that was reviewed.
// --no-color overrides `color.ui = always`, which emits SGR escapes even into a
// pipe, and `-O <devnull>` overrides `diff.orderFile`, which reorders the file
// sections. Both move the bytes of an otherwise fully pinned invocation, and
// neither is reachable from the -c set below: an empty `diff.orderFile=` is a
// fatal error rather than a disable, so the override has to be the flag.
const GIT_DIFF_TRUST_FLAGS = Object.freeze([
  "--no-ext-diff",
  "--no-textconv",
  "--find-renames",
  "--ignore-submodules=none",
  "--no-color",
  "-O",
  os.devNull,
]);

// Command-line flags cannot reach every knob that moves diff bytes: hunk
// splitting, context width, path prefixes, blank-context rendering and object
// abbreviation are config-only. Each value below is git's own default, so the
// pinned invocation is byte-for-byte identical to the unpinned one on a
// default clone (tests/review-freshness.test.js proves this against a repo
// configured otherwise) and no previously frozen hash is invalidated. These are
// `git -c` options, so they must precede the subcommand -- use trustedDiffArgs
// rather than assembling them by hand.
//
// `diff.relative` is the one entry here that is not merely a rendering knob.
// Every other setting reshapes bytes; this one *removes rows*. Set true, a
// diff run from a subdirectory drops every path outside that directory and
// rewrites the rest relative to it. Unpinned, a delta taken with a
// non-toplevel root prices one file where two changed -- but it does not slip
// through: the tree cross-check in computeDelta sees the dropped paths and
// returns ineligible, so the observable failure is that the supplement path
// stops working from a subdirectory root rather than that it under-prices.
// The pin is here so that backstop is not the only thing standing between
// inherited config and a wrong budget, and so a legitimate delta is not
// forced into a full round by a setting that has nothing to do with it.
// Pinned via -c rather than the equivalent --no-relative flag so the list
// stays one uniform mechanism.
const GIT_DIFF_TRUST_CONFIG = Object.freeze([
  "-c",
  "core.abbrev=auto",
  "-c",
  "core.quotePath=true",
  "-c",
  "diff.algorithm=myers",
  "-c",
  "diff.context=3",
  "-c",
  "diff.dstPrefix=b/",
  "-c",
  "diff.indentHeuristic=true",
  "-c",
  "diff.mnemonicPrefix=false",
  "-c",
  "diff.noprefix=false",
  "-c",
  "diff.relative=false",
  "-c",
  "diff.renames=true",
  "-c",
  "diff.srcPrefix=a/",
  "-c",
  "diff.submodule=short",
  "-c",
  "diff.suppressBlankEmpty=false",
]);

// The one way to spell a trusted diff. Every hash-bound, budget-bound, or
// anchor-bound diff in the review toolchain goes through here so a call site
// cannot ship with a partial copy of the trust set -- which is exactly how the
// anchor-hunk reader ended up carrying only --no-ext-diff.
function trustedDiffArgs(...args) {
  return [...GIT_DIFF_TRUST_CONFIG, "diff", ...GIT_DIFF_TRUST_FLAGS, ...args];
}

function cleanGitEnv(extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  for (const key of GIT_ENV_KEYS_TO_CLEAR) delete env[key];
  return env;
}

// The single git exec wrapper for the review toolchain. It exists so the
// environment hardening above cannot drift between call sites: four separate
// copies previously diverged, and two of them never sanitized the environment
// at all.
function gitExec(root, args, encoding = "utf8", input = undefined) {
  return execFileSync("git", args, {
    cwd: root,
    encoding,
    input,
    env: cleanGitEnv(),
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

module.exports = {
  GIT_ENV_KEYS_TO_CLEAR,
  GIT_DIFF_TRUST_CONFIG,
  GIT_DIFF_TRUST_FLAGS,
  cleanGitEnv,
  gitExec,
  trustedDiffArgs,
};
