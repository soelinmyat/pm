---
description: "Bidirectional knowledge base sync by default. Usage: /pm:sync, /pm:sync pull, /pm:sync push, /pm:sync status, /pm:sync setup"
argument-hint: "[pull|push|status|setup]"
---

Read the skill file at ${CLAUDE_PLUGIN_ROOT}/skills/sync/SKILL.md and follow it exactly. With no subcommand, run bidirectional sync: pull first, then push. The user's message after /pm:sync may contain an explicit subcommand (setup, pull, push, or status).
