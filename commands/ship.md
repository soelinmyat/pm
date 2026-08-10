---
description: "Prepare the final release tree, review it, and resumably push, create or reconcile a PR, monitor CI, merge, and place any main release tag. Also resumes existing PRs without replaying verified effects."
argument-hint: "[PR-number]"
---

Read the skill file at ${CLAUDE_PLUGIN_ROOT}/skills/ship/SKILL.md and follow it exactly. The user's message after /pm:ship is the optional PR number or context.

During delivery route selection, read and follow `${CLAUDE_PLUGIN_ROOT}/skills/ship/references/capability-guidance.md`.

PM automatically discovers repository-native delivery capabilities with zero consumer edits. Ship uses every proven-safe capability, but requires an explicitly authorized machine-readable candidate-publication policy for the optimized route; otherwise, including for CleanLog's current contract, it keeps comprehensive Review → Push → PR → CI ordering. `PM_DELIVERY_COMPREHENSIVE=1` is the single comprehensive kill switch. Guidance is read-only and setup requires separate explicit authority.
