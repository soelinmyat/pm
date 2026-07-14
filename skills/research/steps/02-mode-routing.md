---
name: Mode Routing
order: 2
description: Select research mode (landscape, competitor, or topic) based on arguments and KB state
---

## Mode Routing

## Goal

Determine which research mode to execute based on the user's argument and the current state of the knowledge base.

## How

Read `${CLAUDE_PLUGIN_ROOT}/skills/research/references/mode-routing.md` — it is the sole authority for the routing table and the no-argument menu logic. Select the single mode it resolves to (landscape → Step 3, competitor → Step 4, topic → Step 5) and proceed to that step; only one mode executes per invocation, so skip the remaining mode steps.

SEO provider configuration is a shared reference consulted during each mode — see `${CLAUDE_PLUGIN_ROOT}/skills/research/references/seo-provider.md`.

## Done-when

Exactly one mode is selected from user intent and existing KB state, with ambiguous scope confirmed before provider calls or writeback.

**Advance:** proceed to Step 3, Step 4, or Step 5 according to the selected research mode.
