---
name: Scope
order: 4
description: Define in-scope and out-of-scope boundaries, apply the 10x filter
---

### Step 4: Scope

<HARD-GATE>
Formal scoping is required before review. Do NOT skip based on perceived simplicity or feature type.
Even "obvious" features benefit from explicit in-scope / out-of-scope boundaries.
If the scope is genuinely small, the exercise will be fast — that is different from skipping it.
</HARD-GATE>

Follow the full methodology in `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/scope-validation.md`.

1. **Codebase reality check** (if `codebase_available: true` in groom state):
   Read `codebase_context` from session state (captured in Step 1 intake). Do NOT rescan the codebase — Step 1 already did the exploration. Use the findings to ground scope:
   - What already exists that this feature can build on? (reduces scope)
   - What infrastructure is missing that must be built? (expands scope)
   - Are there architectural constraints that make certain approaches impractical? (shapes scope)

   Surface findings to the user:
   > "Based on the codebase: {existing_thing} already handles {related_capability}. We can build on that for {in-scope items}. However, {missing_thing} doesn't exist yet and would need to be created."

2. Present the scope definition template. Fill it collaboratively with the user:
   - What is explicitly IN scope for this initiative?
   - What is explicitly OUT of scope? (with reasons — prevents scope creep)

3. Apply the 10x filter (from `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/scope-validation.md`):
   > "Is this meaningfully better than what competitors offer, or is it something users simply expect?"
   Document the filter result explicitly: `10x` | `gap-fill` | `table-stakes` | `parity`.

4. If the result is `table-stakes`: proceed without warning — users expect this feature to exist.
   If the result is `parity`: flag it.
   > "This appears to be feature parity with {competitor}. Parity is a valid reason
   > to build, but not a differentiation story. Note the strategic intent before proceeding."

5. Update state:

```yaml
phase: scope
scope:
  in_scope: []
  out_of_scope: []
  filter_result: 10x | gap-fill | table-stakes | parity
```
