---
description: "Write or revise the technical implementation design for a groomed feature, including dependencies and verification."
argument-hint: "<feature-slug>"
---

Read the skill file at ${CLAUDE_PLUGIN_ROOT}/skills/rfc/SKILL.md and follow it exactly. The user's message after /pm:rfc is the feature slug argument.

For routine updates within an already approved RFC, use the reviewed maintenance path in `skills/rfc/references/maintenance.md` without asking for fresh human approval. Material product behavior, scope or significant-risk changes still require the user's decision.

When the exact Groom product decision includes a verified delivery delegation, independently reviewed in-scope initial technical derivation can hand off without another human RFC approval. Preserve the original product decision and escalate material or uncertain product, commercial, security, privacy or operational changes.
