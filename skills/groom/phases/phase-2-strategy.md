### Phase 2: Strategy Check

<HARD-GATE>
Strategy misalignment must be flagged explicitly. Do NOT silently proceed.
If pm/strategy.md is missing, do NOT skip this phase — offer to create it first.
</HARD-GATE>

1. Check if `pm/strategy.md` exists.

   If it does NOT exist:
   > "No strategy doc found. Strategy check requires one. Options:
   > (a) Run /pm:strategy now to create a full strategy, then continue grooming
   > (b) Quick-start — answer 3 questions and get a minimal strategy that unblocks grooming (~2 min)
   > (c) Skip strategy check and proceed at your own risk"
   Wait for selection.

   If (a): invoke pm:strategy, then return here when complete.

   If (b) — Quick-start strategy:

   Ask exactly 3 questions, **one at a time** (do not bundle):

   **Question 1:** "Who is your target user? (role, company type, rough size)"
   Wait for answer. Store as `icp_answer`.

   **Question 2:** "What are your top 3 priorities right now?"
   Wait for answer. Store as `priorities_answer`.

   **Question 3:** "What are you explicitly NOT building? (at least 3 items)"
   Wait for answer. Store as `nongoals_answer`.

   After all 3 answers, write `pm/strategy.md` with this exact structure:

   ```markdown
   ---
   type: strategy
   created: {today's date YYYY-MM-DD}
   updated: {today's date YYYY-MM-DD}
   ---

   # Product Strategy

   ## 1. Product Identity
   {Synthesize one sentence from the 3 answers: "[Product] helps [icp_answer] by focusing on [first priority from priorities_answer]."}

   ## 2. ICP and Segmentation
   {icp_answer — use the user's words, lightly formatted into prose}

   ## 3. Core Value Prop and Differentiation
   Not yet defined — run /pm:strategy to expand.

   ## 4. Competitive Positioning
   Not yet defined — run /pm:strategy to expand.

   ## 6. Current Phase and Priorities
   {priorities_answer — format as a numbered list of up to 3 items with brief reasoning if provided}

   ## 7. Explicit Non-Goals
   {nongoals_answer — format as a numbered list with brief reasoning if provided}
   ```

   Sections 5, 8, and 9 are intentionally omitted.

   After writing, say:
   > "Minimal strategy written to pm/strategy.md. This covers ICP, priorities, and non-goals — enough to unblock grooming. Run /pm:strategy later to fill in value prop, competitive positioning, and the rest."

   Then continue to step 2 below using the just-written file.

   If (c): Set `strategy_check.status = skipped` and proceed to Phase 3.

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
