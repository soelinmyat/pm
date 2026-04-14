---
name: Prerequisite Check
order: 1
description: Check if landscape research exists and recommend running it first if missing
---

## Prerequisite Check

**Goal:** Surface missing landscape context before the strategy interview starts, without blocking the user from proceeding.

Check if `{pm_dir}/insights/business/landscape.md` exists.

If it does NOT exist, say:

> "Consider running $pm-research landscape first. Strategy interviews are more
> productive with landscape context — knowing the key players and market segments
> sharpens your positioning answers. This is a recommendation, not a requirement."

Then ask: "Continue with strategy now, or run landscape research first?"
Respect the user's answer. Do not block.

**Done-when:** The user has been told whether landscape context exists, and strategy can proceed with either confirmed context or an explicit decision to continue without it.

**Advance:** proceed to Step 2 (Detect Existing Strategy).
