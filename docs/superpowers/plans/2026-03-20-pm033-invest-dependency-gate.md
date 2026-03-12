# PM-033: Add INVEST Validation Gate and Dependency Mapping

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure every issue produced by the groom phase is independently scoped, valuable, and testable — with visible evidence for each INVEST dimension — so PMs spend review time on strategic judgment rather than catching structural defects. Add conditional dependency mapping for larger issue sets.

**Architecture:** A new Step 4 ("INVEST Validation") inserts between PM-032's Step 3 ("Decompose") and PM-032's Step 4 ("Draft issues"). The INVEST step validates all six dimensions with grounding citations (not just pass/fail), includes a conditional dependency mapping sub-step for 4+ issues, and feeds dependency output into the Technical Feasibility section of drafted issues. PM-032's Step 4 (Draft issues) becomes Step 5, Step 5 (Update state) becomes Step 6.

**Tech Stack:** Markdown (skill file)

**Current state (post-PM-032):** Phase 5 has 5 steps: Step 1 (feature type), Step 2a/2b (visual artifacts), Step 3 (Decompose), Step 4 (Draft issues with good/bad examples), Step 5 (Update state). A Read instruction for splitting-patterns.md exists at the top.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `skills/groom/phases/phase-5-groom.md` | **Modify** | Insert Step 4 (INVEST Validation + Dependency Mapping), renumber Steps 4→5 and 5→6, add dependency output reference to Step 5's Technical Feasibility field |

---

## Task 1: Insert INVEST Validation step and renumber downstream steps

**Files:**
- Modify: `skills/groom/phases/phase-5-groom.md`

This is a single-file change with three edits applied in sequence.

- [ ] **Step 1: Insert new Step 4 (INVEST Validation) after Step 3 (Decompose)**

Insert the following content between the end of Step 3 (the MVP slicing paragraph) and the current Step 4 header (`#### Step 4: Draft issues`):

```markdown
#### Step 4: INVEST validation

Before drafting issues, validate that every issue from the decomposition passes all six INVEST dimensions with grounding evidence — not just pass/fail.

For each issue, produce an evidence row per dimension:

| Dimension | Evidence | Source |
|-----------|----------|--------|
| **Independent** | "{Issue A} and {Issue B} can be implemented by different engineers without coordination" OR flag as explicit dependency: "{Issue A} requires {Issue B}'s API surface" | Step 3 decomposition |
| **Negotiable** | Verified: outcome statement describes user value, not a locked implementation | Outcome statement |
| **Valuable** | Delivers end-user value OR explicitly marked as enabling prerequisite: "Enables {Issue X} by providing {capability}" | Scope definition, research findings |
| **Estimable** | Grounded in EM feasibility findings: "{File/pattern} exists, estimated touch points: {N}" | Phase 4.5 findings (if absent, state: "No EM review — assumed feasible based on {reasoning}") |
| **Small** | Completable within a sprint: single splitting pattern applied, bounded scope | Step 3 boundary check |
| **Testable** | Every AC has clear pass/fail condition — cite the AC number | Draft ACs |

**"Independent" means understandable independently, not zero dependencies.** Two issues may have a sequencing dependency and still pass — the key test is whether each can be *understood, reviewed, and estimated* by different engineers without reading the other. Flag issues that cannot be understood alone as failing Independent.

**Reject and re-evaluate** if any dimension produces only pass/fail without a grounding citation. If a prior phase (e.g., Phase 4.5 EM review) was not completed, state which phase was absent and what was assumed — the drafter must re-evaluate these assumptions before proceeding.

**Conditional dependency mapping** (4+ issues only; skip if 3 or fewer — sequencing is implicit):

If the decomposition produced 4 or more issues, add a dependency sub-step:

1. **Dependency list:** For each issue, list issues it depends on (if any) and issues that depend on it.
2. **Sequencing rationale:** Explain why the proposed order is correct — cite technical constraints from Phase 4.5 or logical prerequisites from the decomposition.
3. **Parallelization:** Identify which issues can be worked in parallel by different engineers, and which must be sequential.

The dependency mapping output feeds the **Technical Feasibility** section of each drafted issue in the next step.
```

This content is 27 lines (within the 50-line budget for PM-033).

- [ ] **Step 2: Renumber Step 4 (Draft issues) → Step 5**

Replace `#### Step 4: Draft issues` with `#### Step 5: Draft issues`.

- [ ] **Step 3: Add dependency reference to Step 5's Technical Feasibility field**

In the Step 5 (Draft issues) field list, update the Technical Feasibility bullet to include dependency context:

Replace:
```
- **Technical Feasibility:** Key findings from the EM review in Phase 4.5, referencing specific file paths. If no EM review was conducted, note "No codebase context available."
```

With:
```
- **Technical Feasibility:** Key findings from the EM review in Phase 4.5, referencing specific file paths. If dependency mapping was produced (Step 4), include sequencing constraints and parallelization notes. If no EM review was conducted, note "No codebase context available."
```

- [ ] **Step 4: Renumber Step 5 (Update state) → Step 6**

Replace `#### Step 5: Update state` with `#### Step 6: Update state`.

- [ ] **Step 5: Verify the final file**

Verify:
- Step numbering: 1, 2a, 2b, 3, 4, 5, 6
- INVEST validation content is between Decompose (Step 3) and Draft issues (Step 5)
- Total new content from PM-033 is ≤50 lines
- Dependency mapping skip condition is present ("3 or fewer issues")
- INVEST rejection clause is present ("Reject and re-evaluate if any dimension...")
- Technical Feasibility field in Step 5 references dependency mapping output

---

## Task 2: Commit

- [ ] **Step 1: Stage and commit**

```bash
git add skills/groom/phases/phase-5-groom.md
git commit -m "feat(PM-033): add INVEST validation gate and dependency mapping"
```

---

## Verification Checklist

| AC | Task.Step | Evidence |
|----|-----------|----------|
| 1. INVEST step between Decompose and Draft issues | T1.S1 | Step 4 inserted between Step 3 and Step 5 |
| 2. Evidence trail per INVEST dimension | T1.S1 | Table with Evidence + Source columns per dimension |
| 3. Independent handles dependency tension | T1.S1 | Bold paragraph: "understandable independently, not zero dependencies" |
| 4. Conditional dependency mapping (4+ issues) | T1.S1 | Sub-step with skip condition |
| 5. Skip condition (3 or fewer) | T1.S1 | "skip if 3 or fewer — sequencing is implicit" |
| 6. Dependency output feeds Technical Feasibility | T1.S3 | Updated field in Step 5 |
| 7. Rejection + fallback for absent phases | T1.S1 | "Reject and re-evaluate" paragraph with fallback |
| 8. Total new content ≤50 lines | T1.S5 | ~27 lines of INVEST content + ~3 lines Technical Feasibility update = ~30 lines |
