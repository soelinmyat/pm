# Learnings

## 2026-03-18 — PM-025 Epic (Dashboard Proposal-Centric Redesign)

- **Pre-implementation discovery saves time:** 4 of 6 groomed issues were already fully implemented. Planning agents caught this, avoiding redundant work.
- **API overload kills agents silently:** 529 errors cause agents to go idle without reporting back. Orchestrator needs timeout/heartbeat detection.
- **Worktree + PR flow required:** Pre-push hook blocks direct main pushes, so all sub-issues needed PR flow regardless of size classification.
