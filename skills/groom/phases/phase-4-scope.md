### Phase 4: Scope

<HARD-GATE>
Formal scoping is required before review. Do NOT skip based on perceived simplicity or feature type.
Even "obvious" features benefit from explicit in-scope / out-of-scope boundaries.
If the scope is genuinely small, the exercise will be fast — that is different from skipping it.
</HARD-GATE>

Follow the full methodology in `scope-validation.md`.

1. **Codebase reality check** (if `codebase_available: true` in groom state):
   Before defining scope, review the codebase context from Phase 1 and check the current state of relevant code. This grounds the scope in implementation reality:
   - What already exists that this feature can build on? (reduces scope)
   - What infrastructure is missing that must be built? (expands scope)
   - Are there architectural constraints that make certain approaches impractical? (shapes scope)

   Surface findings to the user:
   > "Based on the codebase: {existing_thing} already handles {related_capability}. We can build on that for {in-scope items}. However, {missing_thing} doesn't exist yet and would need to be created."

2. Present the scope definition template. Fill it collaboratively with the user:
   - What is explicitly IN scope for this initiative?
   - What is explicitly OUT of scope? (with reasons — prevents scope creep)

3. Apply the 10x filter (from `scope-validation.md`):
   > "Is this meaningfully better than what competitors offer — or incremental parity?"
   Document the filter result explicitly: `10x` | `parity` | `gap-fill`.

4. If the result is `parity`: flag it.
   > "This appears to be feature parity with {competitor}. Parity is a valid reason
   > to build, but not a differentiation story. Note the strategic intent before proceeding."

5. If `visual_companion: true` in `.pm/config.json`: offer the scope grid (impact/effort).
   > "Want a scope grid? I'll plot proposed scope items on impact vs. effort axes."

6. Update state:

```yaml
phase: scope
scope:
  in_scope: []
  out_of_scope: []
  filter_result: 10x | parity | gap-fill
```
