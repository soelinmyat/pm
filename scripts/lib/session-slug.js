"use strict";

const SESSION_BRANCH_PREFIXES = ["codex/", "feat/", "fix/", "chore/", "release/"];

function deriveSessionSlug(branchName) {
  let slug = String(branchName || "").trim();
  for (const prefix of SESSION_BRANCH_PREFIXES) {
    if (slug.startsWith(prefix)) {
      slug = slug.slice(prefix.length);
      break;
    }
  }
  slug = slug.replace(/\//g, "-");
  return slug || "current";
}

module.exports = { deriveSessionSlug, SESSION_BRANCH_PREFIXES };
