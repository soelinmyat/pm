"use strict";

/**
 * Stub for the git boundary — just enough to let a skill reason about the
 * current branch, worktree status, and log history without shelling out.
 *
 * @param {{
 *   currentBranch?: string,
 *   status?: string,
 *   log?: Array<{sha: string, subject: string, dateIso: string}>,
 * }} state  Fixture state.
 *
 * @returns {{
 *   currentBranch(): string,
 *   status(): string,
 *   log(): Array<{sha: string, subject: string, dateIso: string}>,
 * }}
 */
function createGitStub(state) {
  const s = Object.assign({ currentBranch: "main", status: "", log: [] }, state || {});
  return {
    currentBranch() {
      return s.currentBranch;
    },
    status() {
      return s.status;
    },
    log() {
      return s.log.slice();
    },
  };
}

module.exports = { createGitStub };
