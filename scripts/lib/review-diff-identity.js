"use strict";

const crypto = require("node:crypto");
const { gitExec, trustedDiffArgs } = require("./git-env");

const DIFF_FORMAT = "full-index-v1";
const digest = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

function reviewDiffBytes(root, range) {
  return gitExec(root, trustedDiffArgs("--binary", "--full-index", range), null);
}

// Legacy core.abbrev=auto depended on the repository object population. Only
// exact historical bytes may authenticate an old hash: do not normalize the
// stored evidence or compare a subset of a patch. Every candidate is produced
// by Git from the same authenticated commit range with the complete trust set.
// A collision that prevents reproducing old abbreviations remains fail-closed.
function matchesReviewDiff(root, range, expected, format) {
  if (!/^[a-f0-9]{64}$/.test(expected || "")) return false;
  if (format !== undefined && format !== DIFF_FORMAT) return false;
  if (digest(reviewDiffBytes(root, range)) === expected) return true;
  if (format === DIFF_FORMAT) return false;
  if (digest(gitExec(root, trustedDiffArgs("--binary", range), null)) === expected) return true;
  const objectFormat = gitExec(root, ["rev-parse", "--show-object-format"]).trim();
  const width = objectFormat === "sha1" ? 40 : objectFormat === "sha256" ? 64 : 0;
  for (let abbreviation = 4; abbreviation < width; abbreviation += 1) {
    const bytes = gitExec(
      root,
      trustedDiffArgs("--binary", `--abbrev=${abbreviation}`, range),
      null
    );
    if (digest(bytes) === expected) return true;
  }
  return false;
}

module.exports = { DIFF_FORMAT, reviewDiffBytes, matchesReviewDiff };
