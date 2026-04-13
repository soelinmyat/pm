---
name: Audit
order: 1
description: Check prerequisite context and audit existing capabilities before generating ideas
---

## Goal

Understand the current product, strategic priorities, and existing capabilities well enough to avoid generating duplicate or off-strategy ideas.

## How

### Prerequisite Check

1. Check if `{pm_dir}/strategy.md` exists. If not:
   > "No strategy doc found. Ideation without strategy is just brainstorming. Run /pm:strategy first?"
   Wait for response. Do not block — proceed if the user insists.

2. Check if `{pm_dir}/insights/business/landscape.md` exists. Note its presence for signal mining. Not required.

3. Check if `{pm_dir}/evidence/competitors/index.md` exists. Note profiled competitors. Not required.

### Audit what exists

<HARD-GATE>
Auditing existing capabilities is required before generating ideas. Do not skip because "I know the product."
Read strategy, feature matrix, and codebase (if present). Without this step, ideation produces duplicates.
</HARD-GATE>

1. **Read strategy context** — `{pm_dir}/strategy.md` describes the product identity, ICP, and what is in or out of scope.
2. **Read the feature matrix** — `{pm_dir}/evidence/competitors/index.md` shows what the product already does.
3. **Explore the project codebase (if one exists)** — scan source code to catalog existing capabilities. If no codebase exists, rely on strategy and the feature matrix.

Before proceeding, state:
- the top 3 priorities
- the 3 most relevant competitive gaps
- 1 customer evidence signal if available

## Done-when

The available strategy, market, backlog, and capability context has been audited, and you can explain the current priorities and gaps before mining signals.
