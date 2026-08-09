---
name: Intake
order: 1
description: Resolve proposal identity, source context, tier, and canonical session state
phase: intake
applies_to: [quick, standard, full, agent]
required_evidence: [intake]
result_schema: groom-phase-result-v1
---

## Goal

Create one canonical Groom session with a confirmed problem, audience, outcome, source lineage, eligible tier, and runtime profile.

## How

1. Resolve `{source_dir}`, `{pm_dir}`, and an existing backlog/thinking/Linear source without creating a workspace implicitly. When source frontmatter names a decision companion, validate and record its `{pm_dir}`-relative path as origin lineage; legacy sources without one remain valid.
2. Confirm the problem and intended outcome; ask only the smallest question not answered by supplied context or the KB.
3. Derive a stable slug and reject collisions unless the user is resuming that exact proposal.
4. Before initializing or writing any proposal artifact, prepare its isolated Git workspace:

   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/artifact-worktree.js prepare \
     --pm-dir "{pm_dir}" --slug "{slug}" --kind groom --json
   ```

   Use the returned artifact worktree as `groom-session.js init --source-dir`, and use the returned `pm_dir` for every later Groom artifact path and commit. The helper fetches the authoritative remote default branch without moving the shared checkout, creates a `codex/{slug}-groom` branch from that exact base, and reuses only a worktree it previously marked as owned. If it reports an existing unowned branch or path, stop with its recovery message; never switch, clean, commit, or attach an upstream in the shared KB checkout.
5. Detect codebase context, strategy/evidence freshness, and tier eligibility using `references/tier-gating.md`. `agent` uses stricter evidence gates but is not provider-locked.
6. Initialize with `groom-session.js init`, write intake facts with `context`, build the phase prompt, and record one strict result. Never edit session JSON directly.

## Done-when

Identity, problem, audience, outcome, source, tier, runtime, evidence availability, and codebase context are durably recorded in the returned isolated artifact worktree with no ambiguous duplicate session.

**Advance:** proceed to Step 2 (Research).
