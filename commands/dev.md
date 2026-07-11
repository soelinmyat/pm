---
description: "Model-adaptive development lifecycle — routes by observed risk, resumes from durable phase state, and verifies delivery evidence."
argument-hint: "[ticket-id or description]"
---

Read the skill file at ${CLAUDE_PLUGIN_ROOT}/skills/dev/SKILL.md and follow it exactly. The user's message after /pm:dev is the task context argument.

There are no safety bypass flags. M/L/XL proposal work without a groomed proposal halts with a direct `/pm:groom` instruction; routed proposal work without an approved RFC halts with a direct `/pm:rfc` instruction. Task and bug intake may skip that ceremony when scope is sufficient, but observed risk still controls review, QA, and verification.
