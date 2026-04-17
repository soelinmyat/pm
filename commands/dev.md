---
description: "Development lifecycle — auto-detects scope. Whether work is 1 task or N tasks emerges from the RFC."
argument-hint: "[ticket-id or description]"
---

Read the skill file at ${CLAUDE_PLUGIN_ROOT}/skills/dev/SKILL.md and follow it exactly. The user's message after /pm:dev is the task context argument.

There are no bypass flags. M+ work without a groomed proposal halts with a direct `/pm:groom` instruction; M+ work without an RFC halts with a direct `/rfc` instruction. If the groom or RFC cost feels disproportionate, the work is probably smaller than classified — downscope first.
