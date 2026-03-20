# Learnings

## 2026-03-20 — PM-032/033 Epic (Groom Phase 5 Decomposition Methodology)

- **Groomed issues are fast:** Both S-sized issues went from plan to merged PR in ~10 min each. Detailed ACs from pm:groom eliminated brainstorming/spec review overhead.
- **Sequential dependency on same files works cleanly:** PM-033 branched from post-PM-032 main. No merge conflicts because the insertion points were well-specified by name, not line number.
- **No agent failures this run:** Both agents completed without 529/idle issues. Small S-sized issues reduce the risk of agent death mid-implementation.

## 2026-03-18 — PM-025 Epic (Dashboard Proposal-Centric Redesign)

- **Pre-implementation discovery saves time:** 4 of 6 groomed issues were already fully implemented. Planning agents caught this, avoiding redundant work.
- **API overload kills agents silently:** 529 errors cause agents to go idle without reporting back. Orchestrator needs timeout/heartbeat detection.
- **Worktree + PR flow required:** Pre-push hook blocks direct main pushes, so all sub-issues needed PR flow regardless of size classification.
