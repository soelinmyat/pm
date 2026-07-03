---
description: "Loop orchestration — run bare /pm:loop and it reads the situation and offers the next step; or name a subcommand (status/wake/config/install/work)."
argument-hint: "[status|wake|config|install|work] [--dry-run] [--mode dev|ship|research]"
---

Read the skill file at ${CLAUDE_PLUGIN_ROOT}/skills/loop/SKILL.md and follow it exactly. With no subcommand, run the router (step 01-route) — it assesses the situation and routes. Otherwise the user's message after /pm:loop contains the subcommand and options.
