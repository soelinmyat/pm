# Learnings

## 2026-04-09 — PM-154 (Insight Synthesis Workflow)

- **Shared reference docs are the right pattern for LLM-driven cross-skill workflows.** The routing sub-step is a ~250-line markdown reference read by research, ingest, and refresh — not a script. This matches the existing competitor-profiling.md pattern and avoids brittle script abstractions for LLM-executed logic.
- **Prerequisite validator fixes must land before schema-dependent tests.** Issue #1 (mixed origin + object sources) had to be done first — all downstream test fixtures for insight files depended on the validator accepting the new formats. Sequencing was correct from the RFC.
- **Bidirectional citation validation makes routing robust but unforgiving.** The existing validate.js reciprocity check (lines 525-584) means any routing write must update both the insight `sources` and evidence `cited_by` atomically. The "skip on failure" pattern in the routing doc prevents partial writes from breaking validation.
- **Version bumps need plugin.config.json as source of truth, then regenerate.** Editing generated platform files directly causes sync check failures. Always update `plugin.config.json` first, then run `node scripts/generate-platform-files.js`.

## 2026-03-22 — PM-064 Epic (Strategy Narrative Slide Deck)

- **Groom-to-epic pipeline validated again:** Full cycle from groom (research, scope, 3+3 review rounds, bar raiser) through dev-epic (2 sequential S-sized issues) completed smoothly. Reduced ceremony for groomed issues worked — zero rework.
- **Two-issue sequential epics are fast:** PM-065 and PM-066 went from plan to merged PR in one pass each. Clean dependency chain — PM-066 extended PM-065's template without conflicts.
- **Epic review catches real contract issues:** Reviewer found PM-066 silently dropped a PM-065 base slide (positioning text), breaking the 7-slide baseline guarantee. Fixed by merging the positioning map into the existing base slide as a conditional enhancement.

## 2026-03-21 — PM-057 Epic (Remove Commands)

- **Cross-epic rebase conflicts are manageable:** PM-059 branch was behind main (missing PM-055/PM-056 from a concurrent epic). Rebase had 3 README.md conflicts where both epics rewrote the same sections — resolved cleanly by taking the skill-only version.
- **Two-issue epics are fast:** One issue already shipped from a prior session. Remaining documentation issue went from dispatch to merged PR in one pass — 6 commits, 10 files, no blockers.

## 2026-03-21 — PM-052 Epic (Groom-Centric Entry Point)

- **3-wave execution with parallel final wave works cleanly:** 4 sub-issues across 3 waves (1+1+2 parallel). PM-055 [docs] and PM-056 [scripts] ran in parallel with zero merge conflicts — different file sets. Total: 4 PRs (#52-#56), ~14 files changed.
- **Epic review catches cross-plan messaging gaps:** Architect and Integration reviewers both flagged that server.js pm-not-found guards still said "/pm:setup" while all other surfaces led with "/pm:groom". Fixed in PM-056 plan before implementation.
- **Groom-to-epic handoff continues to validate:** Second consecutive epic groomed through full pm:groom pipeline then implemented via dev-epic. Reduced ceremony (skip brainstorm+spec) worked again — zero rework.

## 2026-03-21 — PM-044 Epic (Merge PM + Dev Plugins)

- **4-wave parallelism works for infrastructure epics:** 7 sub-issues across 4 waves (2+3+1+1), all groomed. Zero merge conflicts despite touching overlapping skill files — wave ordering solved this. Total: 7 PRs (#38-#44), ~143 files changed.
- **Epic review catches real cross-plan issues:** PM-046 was incorrectly in Wave 1 (needed PM-047+PM-048 first). Gitignore splitting would have inverted safety model. INSTALL.md duplication between PM-046 and PM-051. All caught and fixed before implementation.
- **Groom-to-epic handoff is now validated:** This epic was the first to be groomed through the full pm:groom pipeline (bar_raiser verdict: ready-if) then implemented via dev-epic. The reduced ceremony (skip brainstorm+spec for all 7 issues) worked — no rework, no ambiguity.

## 2026-03-21 — PM-038 Epic (Project Memory System)

- **Groom-to-ship pipeline works end-to-end:** Full cycle from groom (research, scope, 3 review rounds, bar raiser) through dev-epic (4 sequential S-sized issues) completed in one session. Groomed ACs eliminated ambiguity — zero rework during implementation.
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
