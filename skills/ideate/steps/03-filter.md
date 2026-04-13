---
name: Filter Ideas
order: 3
description: Generate candidate ideas and apply the full five-filter screen
---

## Goal

Convert raw opportunity signals into candidate ideas, then reject anything that is duplicate, vague, badly timed, or off-strategy.

## How

Generate candidate ideas from the mined signals, then apply all five filters to every candidate.

<HARD-GATE>
All 5 filters must be applied to every candidate idea. Do not skip filters.
</HARD-GATE>

### Filter 1: Already built?
Check against the Step 1 audit. Drop the idea if the capability already exists.

### Filter 2: Is this a discrete, groomable feature?
Each idea must be specific and shippable. Drop vague themes, process changes, and ongoing efforts.
Test: can you write acceptance criteria? If not, it is not a feature.

### Filter 3: Are dependencies met?
Flag ideas requiring unbuilt features. Deprioritize those with 2+ unbuilt dependencies.

### Filter 4: Is this needed now?
Drop ideas solving hypothetical future problems or optimizing non-bottlenecks.

### Filter 5: Non-goal conflict?
Check against `{pm_dir}/strategy.md` § 7. Flag conflicts explicitly — do not silently drop them.

Keep a short filtered-out list with the rejection reason for each dropped candidate so the user can override if they want.

## Done-when

Every surviving idea has passed all five filters, and every rejected idea has a concrete reason it was filtered out.
