"use strict";

const { execFileSync } = require("node:child_process");

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
// differently. Under default config these flags are byte-for-byte no-ops, so
// they do not invalidate any previously frozen hash.
const GIT_DIFF_TRUST_FLAGS = Object.freeze(["--no-ext-diff", "--no-textconv", "--find-renames"]);

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

module.exports = { GIT_ENV_KEYS_TO_CLEAR, GIT_DIFF_TRUST_FLAGS, cleanGitEnv, gitExec };
