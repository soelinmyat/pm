---
description: "Configure or reconcile unattended PM workers, schedules, leases, and recovery. Use Board to view their progress."
argument-hint: "[status|wake|config|install|work|reconcile] [--dry-run|--apply] [--mode dev|ship|research]"
---

Read the skill file at ${CLAUDE_PLUGIN_ROOT}/skills/loop/SKILL.md and follow it exactly. With no subcommand, run the router (step 01-route) — it assesses the situation and routes. Otherwise the user's message after /pm:loop contains the subcommand and options.
