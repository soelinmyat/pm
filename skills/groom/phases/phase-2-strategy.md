### Phase 2: Strategy Check

**Tier routing:** Read `groom_tier` from groom session state. If the field is absent, default to `quick`.

**Quick tier:** Skip this phase entirely.
  - Log: "Strategy check skipped (quick tier)."
  - Update state and proceed to Phase 3:
    ```yaml
    strategy_check:
      status: skipped
      reason: "quick tier"
      checked_against: null
      conflicts: []
      supporting_priority: null
    ```

**Standard and full tiers:** Continue below.

---

1. Check if `{pm_dir}/strategy.md` exists.

   **Standard tier — file missing:**
   > "No strategy doc yet — skipping alignment check."
   Update state and proceed to Phase 3:
   ```yaml
   strategy_check:
     status: skipped
     reason: "no strategy doc (standard tier)"
     checked_against: null
     conflicts: []
     supporting_priority: null
   ```

   **Full tier — file missing:**
   <HARD-GATE>
   Strategy alignment is required for full-tier grooming.
   </HARD-GATE>
   > "No strategy doc found. Full-tier grooming checks alignment against your
   > product strategy. Options:
   > (a) Run pm:strategy now to create it, then continue grooming
   > (b) Skip strategy check for now"
   Wait for selection. If (a): invoke pm:strategy, then return here when complete.

   **File exists (any tier):** Continue to step 2.

2. Read `{pm_dir}/strategy.md`. Check the idea against:

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
  checked_against: {pm_dir}/strategy.md | null
  conflicts: [] | ["{non-goal text}"]
  supporting_priority: "{priority text}" | null
```
