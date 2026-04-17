---
description: "Development lifecycle — auto-detects scope. Whether work is 1 task or N tasks emerges from the RFC."
argument-hint: "[ticket-id or description] [--skip-rfc] [--skip-groom]"
---

Read the skill file at ${CLAUDE_PLUGIN_ROOT}/skills/dev/SKILL.md and follow it exactly. The user's message after /pm:dev is the task context argument.

**Flags (parsed from the invocation args):**
- `--skip-rfc` — for M+ work without an approved RFC, skip the RFC halt in Step 04 and proceed with inline planning.
- `--skip-groom` — for M+ work without a groomed proposal, skip the groom halt in Step 04 and proceed with available context.

Flags are sticky for the current invocation only. They do not persist to session state.
