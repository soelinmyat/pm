### Phase 4: Scope

<HARD-GATE>
Formal scoping is required before review. Do NOT skip based on perceived simplicity or feature type.
Even "obvious" features benefit from explicit in-scope / out-of-scope boundaries.
If the scope is genuinely small, the exercise will be fast — that is different from skipping it.
</HARD-GATE>

Follow the full methodology in `scope-validation.md`.

1. Present the scope definition template. Fill it collaboratively with the user:
   - What is explicitly IN scope for this initiative?
   - What is explicitly OUT of scope? (with reasons — prevents scope creep)

2. Apply the 10x filter (from `scope-validation.md`):
   > "Is this meaningfully better than what competitors offer — or incremental parity?"
   Document the filter result explicitly: `10x` | `parity` | `gap-fill`.

3. If the result is `parity`: flag it.
   > "This appears to be feature parity with {competitor}. Parity is a valid reason
   > to build, but not a differentiation story. Note the strategic intent before proceeding."

4. If `visual_companion: true` in `.pm/config.json`: offer the scope grid (impact/effort).
   > "Want a scope grid? I'll plot proposed scope items on impact vs. effort axes."

5. Update state:

```yaml
phase: scope
scope:
  in_scope: []
  out_of_scope: []
  filter_result: 10x | parity | gap-fill
```
