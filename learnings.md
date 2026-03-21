# Learnings

## 2026-03-21 — PM-044 Epic (Merge PM + Dev Plugins)

- **4-wave parallelism works for infrastructure epics:** 7 sub-issues across 4 waves (2+3+1+1), all groomed. Zero merge conflicts despite touching overlapping skill files — wave ordering solved this. Total: 7 PRs (#38-#44), ~143 files changed.
- **Epic review catches real cross-plan issues:** PM-046 was incorrectly in Wave 1 (needed PM-047+PM-048 first). Gitignore splitting would have inverted safety model. INSTALL.md duplication between PM-046 and PM-051. All caught and fixed before implementation.
- **Groom-to-epic handoff is now validated:** This epic was the first to be groomed through the full pm:groom pipeline (bar_raiser verdict: ready-if) then implemented via dev-epic. The reduced ceremony (skip brainstorm+spec for all 7 issues) worked — no rework, no ambiguity.

## 2026-03-21 — PM-038 Epic (Project Memory System)

- **Groom-to-ship pipeline works end-to-end:** Full cycle from /pm:groom (research, scope, 3 review rounds, bar raiser) through /dev-epic (4 sequential S-sized issues) completed in one session. Groomed ACs eliminated ambiguity — zero rework during implementation.
- **Epic review catches real cross-cutting gaps:** Serialization format mismatch (write vs read YAML) and missing AC6 guard were caught by architect + integration reviewers. Golden serialization format in plans prevented runtime parsing failures.
- **Idle-without-result detection works:** PM-040 agent went idle without reporting — status check ping recovered it immediately. The heartbeat pattern from learnings is now validated.

## 2026-03-20 — PM-034/035 Epic (Readable Output Foundation)

- **Agents may jump ahead:** PM-035 agent implemented before receiving "go implement" — harmless but required re-applying in the correct worktree. Monitor for this with sequential dependencies.
- **Style guide + proposal template are a clean pair:** Both S-sized, no conflicts, and the template naturally follows the style guide. Good decomposition boundary.
- **Concurrent session activity creates dirty working trees:** Other groom/dev sessions left untracked files that complicated git operations. Keep working tree clean between epics.

## 2026-03-20 — PM-032/033 Epic (Groom Phase 5 Decomposition Methodology)

- **Groomed issues are fast:** Both S-sized issues went from plan to merged PR in ~10 min each. Detailed ACs from pm:groom eliminated brainstorming/spec review overhead.
- **Sequential dependency on same files works cleanly:** PM-033 branched from post-PM-032 main. No merge conflicts because the insertion points were well-specified by name, not line number.
- **No agent failures this run:** Both agents completed without 529/idle issues. Small S-sized issues reduce the risk of agent death mid-implementation.

## 2026-03-18 — PM-025 Epic (Dashboard Proposal-Centric Redesign)

- **Pre-implementation discovery saves time:** 4 of 6 groomed issues were already fully implemented. Planning agents caught this, avoiding redundant work.
- **API overload kills agents silently:** 529 errors cause agents to go idle without reporting back. Orchestrator needs timeout/heartbeat detection.
- **Worktree + PR flow required:** Pre-push hook blocks direct main pushes, so all sub-issues needed PR flow regardless of size classification.
