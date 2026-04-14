---
name: Mode Routing
order: 2
description: Select research mode (landscape, competitor, or topic) based on arguments and KB state
---

## Mode Routing

**Goal:** Determine which research mode to execute based on the user's argument and the current state of the knowledge base.

**How:** Read `${CLAUDE_PLUGIN_ROOT}/skills/research/references/mode-routing.md` for the full routing table and menu logic.

Route to the appropriate mode step based on the argument:
- `landscape` argument -> Step 3 (Landscape Mode)
- `competitors` argument -> Step 4 (Competitor Mode)
- No argument and no `{pm_dir}/insights/business/landscape.md` -> Step 3 (Landscape Mode, first-time default)
- No argument and `{pm_dir}/insights/business/landscape.md` exists -> present the mode selection menu and wait for user choice
- Any other argument -> Step 5 (Topic Mode, argument is the topic name)

Only one mode executes per invocation. After the selected mode step completes, skip remaining mode steps. SEO provider configuration is a shared reference consulted during each mode — see `${CLAUDE_PLUGIN_ROOT}/skills/research/references/seo-provider.md`.

**Done-when:** A single research mode has been selected. The agent knows which step to jump to next.
