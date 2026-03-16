### Phase 2: Strategy Check

<HARD-GATE>
Strategy misalignment must be flagged explicitly. Do NOT silently proceed.
If pm/strategy.md is missing, do NOT skip this phase — offer to create it first.
</HARD-GATE>

1. Check if `pm/strategy.md` exists.

   If it does NOT exist:
   > "No strategy doc found. Strategy check requires one. Options:
   > (a) Run $pm-strategy now to create it, then continue grooming
   > (b) Skip strategy check and proceed at your own risk"
   Wait for selection. If (a): invoke pm:strategy, then return here when complete.

2. Read `pm/strategy.md`. Check the idea against:

   **Current priorities** (Section 6): Does this advance the stated top 3 priorities? Or does it pull focus away from them?

   **Explicit non-goals** (Section 7): Does this idea touch anything on the non-goals list?

   **ICP fit** (Section 2): Does the target user match the ICP? Or is this serving a secondary segment?

3. Determine alignment:

   - **Aligned:** Proceed. Note which priority this supports.
   - **Misaligned with non-goal:** STOP. Say:
     > "This conflicts with the explicit non-goal: '{non-goal}'.
     > Proceeding would undermine a deliberate product decision. Proceed anyway?"
     Wait for explicit yes/no. Do not soft-pedal this.
   - **Off-priority but not a non-goal:** Flag it:
     > "This doesn't map to any current top-3 priority. It's not a non-goal, but it
     > competes for focus. Proceed anyway?"

4. Update state:

```yaml
strategy_check:
  status: passed | failed | override | skipped
  checked_against: pm/strategy.md | null
  conflicts: [] | ["{non-goal text}"]
  supporting_priority: "{priority text}" | null
```
