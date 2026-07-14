---
name: Done
order: 2
description: Final sample step
---

## Done

### Goal

Save and validate the sample record while preserving every pre-existing fixture artifact.

### How

Create the record atomically at the chosen destination, fail on collision instead of overwriting, then validate its required fields and report the resulting path.

### Done-when

The artifact exists at a unique path, its contract validates, and the result summarizes what was captured. Offer the concrete next action of running plugin validation.
