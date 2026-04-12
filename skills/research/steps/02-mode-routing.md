---
name: Mode Routing
order: 2
description: Select research mode (landscape, competitor, or topic) based on arguments and KB state
---

## Mode Routing

Read `${CLAUDE_PLUGIN_ROOT}/skills/research/references/mode-routing.md` for the full routing table and menu logic.

Route to the appropriate mode step based on the argument:
- `landscape` argument -> Step 3 (Landscape Mode)
- `competitors` argument -> Step 4 (Competitor Mode)
- No argument and no `{pm_dir}/insights/business/landscape.md` -> Step 3 (Landscape Mode, first-time default)
- No argument and `{pm_dir}/insights/business/landscape.md` exists -> present the mode selection menu and wait for user choice
- Any other argument -> Step 5 (Topic Mode, argument is the topic name)

Only one mode executes per invocation. After the selected mode step completes, skip remaining mode steps and proceed to Step 6 (SEO Provider).
