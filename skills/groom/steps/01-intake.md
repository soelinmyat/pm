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
4. Detect codebase context, strategy/evidence freshness, and tier eligibility using `references/tier-gating.md`. `agent` uses stricter evidence gates but is not provider-locked.
5. Initialize with `groom-session.js init`, write intake facts with `context`, build the phase prompt, and record one strict result. Never edit session JSON directly.

## Done-when

Identity, problem, audience, outcome, source, tier, runtime, evidence availability, and codebase context are durably recorded with no ambiguous duplicate session.

**Advance:** proceed to Step 2 (Research).
