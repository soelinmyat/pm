# PM-032: Add Decomposition Methodology with Splitting Patterns

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach the groom phase to decompose features using named splitting patterns from Humanizing Work, showing the user which approaches were considered and why one was chosen. This makes decomposition reasoning visible so PMs can catch structural problems before engineering picks up the work.

**Architecture:** A new reference file (`skills/groom/references/splitting-patterns.md`) encodes the 9 Humanizing Work splitting patterns plus vertical slicing and a meta-pattern. Phase 5 gains a new Step 3 ("Decompose") that reads this reference, evaluates 2-3 candidate patterns against accumulated context, shows eliminated approaches with rejection reasons, and applies boundary quality and MVP slicing checks. The existing Step 3 (Draft issues) becomes Step 4 with added good/bad examples, and Step 4 (Update state) becomes Step 5.

**Tech Stack:** Markdown (skill files, reference files)

**Current state:** Phase 5 has 4 steps (101 lines): Step 1 (feature type), Step 2a/2b (visual artifacts), Step 3 (draft issues), Step 4 (update state). No `references/` directory exists under `skills/groom/`. No decomposition guidance exists.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `skills/groom/references/splitting-patterns.md` | **Create** | 9 Humanizing Work patterns + vertical slicing + meta-pattern |
| `skills/groom/phases/phase-5-groom.md` | **Modify** | Add Step 3 (Decompose), renumber Steps 3→4 and 4→5, add good/bad examples to Step 4, add Read instruction |

---

## Task 1: Create the splitting patterns reference file

**Files:**
- Create: `skills/groom/references/splitting-patterns.md`

- [ ] **Step 1: Create the `references/` directory and write the reference file**

Create `skills/groom/references/splitting-patterns.md` with this exact content:

```markdown
# Splitting Patterns for Feature Decomposition

Reference for Phase 5 Step 3. Read on demand — do not memorize.

Based on the Humanizing Work story splitting patterns, adapted for product grooming.

---

## Meta-Pattern: Vertical Slicing

Every split must produce **vertical slices** — each issue delivers end-to-end value through all layers (UI → logic → data). Horizontal splits (e.g., "build the API" then "build the UI") are always wrong for user-facing work.

**Test:** Can a user do something new when this single issue ships? If not, it is not a vertical slice.

---

## 9 Splitting Patterns

### 1. Workflow Steps
Split along natural steps in the user's workflow.
- **When:** The feature has a clear multi-step process (wizard, onboarding, pipeline).
- **Example:** "Submit expense report" → (a) Create draft report, (b) Attach receipts, (c) Submit for approval.

### 2. Business Rule Variations
One slice per distinct business rule or policy.
- **When:** Behavior varies by user type, plan tier, region, or configuration.
- **Example:** "Apply discount" → (a) Percentage discount, (b) Fixed-amount discount, (c) Buy-one-get-one.

### 3. Major Effort
Identify the core that delivers most value, defer the rest.
- **When:** One part of the feature is disproportionately complex and the remainder is incremental.
- **Example:** "Reporting dashboard" → (a) Single summary chart (80% of user need), (b) Drill-down filters, (c) Export to CSV.

### 4. Simple/Complex
Ship the simple version first, layer complexity later.
- **When:** The happy path is straightforward but edge cases are numerous.
- **Example:** "Search" → (a) Exact match search, (b) Fuzzy matching, (c) Faceted filters.

### 5. Variations in Data
Split by the type or source of data being handled.
- **When:** The feature operates on multiple data types, formats, or sources.
- **Example:** "Import contacts" → (a) CSV import, (b) vCard import, (c) Google Contacts sync.

### 6. Data Entry Methods
Split by how the user provides input.
- **When:** Multiple input mechanisms serve the same goal.
- **Example:** "Add task" → (a) Form entry, (b) Quick-add text parsing, (c) Voice input.

### 7. Defer Performance
Ship it working first, optimize later.
- **When:** Performance optimization is significant effort but not needed for initial value.
- **Example:** "Dashboard loads" → (a) Load all data synchronously, (b) Add pagination, (c) Add caching layer.

### 8. Operations (CRUD)
Split along create/read/update/delete boundaries.
- **When:** The feature involves managing a resource through its lifecycle.
- **Example:** "Manage templates" → (a) View templates list, (b) Create template, (c) Edit template, (d) Delete template.

### 9. Break Out a Spike
When uncertainty is high, split the investigation from the implementation.
- **When:** Technical feasibility is unknown, or the right approach requires exploration.
- **Example:** "AI-powered suggestions" → (a) Spike: evaluate 3 LLM providers for accuracy/cost, (b) Implement chosen provider integration.

---

## Choosing a Pattern

1. **Read the accumulated context** — scope definition, research findings, feature type, codebase analysis.
2. **Identify 2-3 candidate patterns** that fit the feature's shape.
3. **Evaluate each candidate** against:
   - Does it produce vertical slices? (mandatory)
   - Does each slice deliver independent user value?
   - Does the split align with natural implementation boundaries in the codebase?
   - Does the thinnest slice constitute an MVP?
4. **Select one primary pattern.** Document why the others were rejected.

---

## Boundary Quality Check

After splitting, verify each issue passes:

1. **Standalone clarity:** Can each issue be understood without reading the others?
2. **Independent change:** Can one issue be modified, delayed, or dropped without breaking another?
3. **Vertical completeness:** Does each issue deliver end-to-end value through all layers?
4. **MVP viability:** Is the first issue the thinnest vertical slice that delivers end-to-end value?

If any check fails, re-split using a different pattern or combination.

---

## Anti-Patterns

- **Horizontal slicing:** "Build the backend" / "Build the frontend" — neither delivers user value alone.
- **Component slicing:** "Build the modal" / "Build the sidebar" — UI components are not user outcomes.
- **No split:** Shipping everything as one issue — hides complexity, prevents incremental delivery.
- **Too granular:** Issues that cannot be understood or delivered independently — overhead exceeds value.
```

This file is approximately 80 lines of content — well within the reference file size expectations.

- [ ] **Step 2: Verify the file was created**

```bash
ls -la skills/groom/references/splitting-patterns.md
wc -l skills/groom/references/splitting-patterns.md
```

---

## Task 2: Rewrite phase-5-groom.md with decomposition step, renumbered steps, Read instruction, and good/bad examples

**Files:**
- Modify: `skills/groom/phases/phase-5-groom.md`

The current file has 4 steps across 101 lines. The new file will have 5 steps. The key changes:

1. **Add Read instruction** at the top of Phase 5 (before Step 1) — mirrors the pattern from SKILL.md line 90
2. **Steps 1, 2a, 2b** — unchanged (feature type detection, visual artifacts)
3. **New Step 3: Decompose** — reads splitting-patterns.md, evaluates candidates, shows eliminated approaches
4. **Renumbered Step 4 (was Step 3): Draft issues** — with added good/bad examples for outcome statements and ACs
5. **Renumbered Step 5 (was Step 4): Update state** — unchanged content

- [ ] **Step 1: Replace the entire content of `skills/groom/phases/phase-5-groom.md`**

Replace the full file with this content (target: ≤150 lines of new content — Steps 1/2a/2b are unchanged, so "new content" = Step 3 + Step 4 additions + Step 5 renumber + Read instruction):

The specific edits:

**Edit A — Add Read instruction before Step 1:**

Insert at the very top, before `### Phase 5: Groom`:

```markdown
### Phase 5: Groom

Read the splitting patterns reference before starting this phase:

`Read ${CLAUDE_PLUGIN_ROOT}/skills/groom/references/splitting-patterns.md`
```

This replaces the existing `### Phase 5: Groom` header (line 1) with the header + Read instruction.

**Edit B — Insert new Step 3 (Decompose) after Step 2b (line 73):**

Insert between the end of Step 2b (the wireframe section ending at line 73) and the current Step 3 (which becomes Step 4):

```markdown
#### Step 3: Decompose

Before drafting issues, determine how to split the feature into discrete, deliverable pieces.

1. **Identify candidate patterns.** Using the splitting patterns reference and the accumulated context (scope definition, research findings, feature type, codebase analysis from Phase 4.5), select 2-3 splitting patterns that fit the feature's shape.

2. **Evaluate each candidate.** For each pattern, assess:
   - Does it produce vertical slices (end-to-end user value per issue)?
   - Does each slice align with natural implementation boundaries in the codebase?
   - Can the thinnest slice serve as an MVP?

3. **Show your reasoning.** Present the evaluation to the user:

   > **Decomposition approach:**
   >
   > | Pattern | Fit | Verdict |
   > |---------|-----|---------|
   > | {Pattern 1} | {Why it fits or doesn't} | **Selected** / Rejected |
   > | {Pattern 2} | {Why it fits or doesn't} | **Selected** / Rejected |
   > | {Pattern 3} | {Why it fits or doesn't} | **Selected** / Rejected |
   >
   > **Rationale:** {1-2 sentences on why the selected pattern best fits this feature, citing specific findings from prior phases. If prior phases are absent, note which context is missing and explain the choice based on available information.}

4. **Apply the selected pattern** to produce the issue breakdown. Then run the boundary quality check on every issue:
   - **Standalone clarity:** Can each issue be understood without reading the others?
   - **Independent change:** Can one issue be modified, delayed, or dropped without breaking another?

   If any issue fails, re-split or combine until all pass.

5. **MVP slicing.** Verify the first issue is the thinnest vertical slice delivering end-to-end value. If the first issue could be split further while still delivering user value, split it.
```

**Edit C — Renumber Step 3 → Step 4 and add good/bad examples:**

Replace the current Step 3 header and content (lines 75-89) with:

```markdown
#### Step 4: Draft issues

Draft a structured issue set: one parent issue + child issues for discrete work, following the decomposition from Step 3.

**Outcome statements** — each issue's outcome must describe what changes for the user, not what the team builds:
- BAD: "Implement the notification system" (task description, not a user outcome)
- BAD: "Add email notifications" (feature label, not what changes for the user)
- GOOD: "Users learn about time-sensitive updates within minutes, without checking the app"

**Acceptance criteria** — each AC must be specific enough that two engineers would independently agree on pass/fail:
- BAD: "Notifications work correctly" (untestable — what does "correctly" mean?)
- BAD: "Performance is acceptable" (unmeasurable — acceptable to whom?)
- GOOD: "When a task is assigned, the assignee receives an email within 60 seconds containing the task title and a direct link"
- GOOD: "If email delivery fails, the system retries twice with exponential backoff and logs the failure"

Each issue must contain:
   - **Outcome statement:** What changes for the user when this ships? (not a task description)
   - **Acceptance criteria:** Numbered list. Testable, specific. If `codebase_available: true`, ground ACs in actual code patterns — reference existing APIs, data models, or conventions that the AC must integrate with. ACs like "follows existing auth pattern in `src/middleware/auth.ts`" are more useful than abstract requirements.
   - **Research links:** Paths to relevant findings in `pm/research/`.
   - **Customer evidence:** Include internal evidence count, affected segment, or source theme when available.
   - **Competitor context:** How competitors handle this, with specific references from Phase 3.
   - **Scope note:** Which in-scope items this issue covers.
   - **Decomposition rationale:** Which splitting pattern was applied and why (from Step 3). If prior phases were not completed, note which context is missing and explain the rationale based on available information.
   - **User Flows:** Mermaid flowchart (if generated in Step 2a), or "N/A — no user-facing workflow for this feature type"
   - **Wireframes:** Link to the HTML wireframe file (if generated in Step 2b), or "N/A — no user-facing workflow for this feature type"
   - **Technical Feasibility:** Key findings from the EM review in Phase 4.5, referencing specific file paths. If no EM review was conducted, note "No codebase context available."
```

**Edit D — Renumber Step 4 → Step 5:**

Replace `#### Step 4: Update state` with `#### Step 5: Update state`. Content unchanged.

- [ ] **Step 2: Count lines to verify ≤150 lines of new content**

New content additions:
- Read instruction: ~3 lines
- Step 3 (Decompose): ~35 lines
- Step 4 good/bad examples + decomposition rationale field: ~20 lines
- Total new content: ~58 lines (well within 150 limit)

Total file length estimate: 101 (original) - 2 (removed headers) + 58 (new) = ~157 lines total file, with ~58 lines of genuinely new content.

```bash
wc -l skills/groom/phases/phase-5-groom.md
```

- [ ] **Step 3: Verify step numbering is correct (1, 2a, 2b, 3, 4, 5)**

Visually confirm the headers read:
- `#### Step 1: Feature-type detection`
- `#### Step 2a: Generate Mermaid user flow diagram`
- `#### Step 2b: Generate HTML wireframe`
- `#### Step 3: Decompose`
- `#### Step 4: Draft issues`
- `#### Step 5: Update state`

---

## Task 3: Commit both files

- [ ] **Step 1: Stage and commit**

```bash
git add skills/groom/references/splitting-patterns.md skills/groom/phases/phase-5-groom.md
git commit -m "feat(PM-032): add decomposition methodology with splitting patterns"
```

---

## Verification Checklist

| AC | Task | Evidence |
|----|------|----------|
| 1. New reference file with 9 patterns + vertical slicing + meta-pattern | Task 1 | `skills/groom/references/splitting-patterns.md` |
| 2. Step 3 "Decompose" with Read instruction, 2-3 candidate evaluation | Task 2, Edit A + Edit B | Read instruction at top, Step 3 evaluates candidates |
| 2a. Eliminated approaches with rejection reasons visible | Task 2, Edit B | Table format shows Selected/Rejected with reasoning |
| 3. Boundary quality check per issue | Task 2, Edit B | Step 3.4 — standalone clarity + independent change |
| 4. MVP slicing per issue | Task 2, Edit B | Step 3.5 — thinnest vertical slice check |
| 5. Good/bad decomposition examples | Task 1 | Anti-patterns section in reference file |
| 6. Decomposition rationale cites prior phases with fallback | Task 2, Edit B + Edit C | "Rationale" in Step 3, "Decomposition rationale" field in Step 4 |
| 7. Good/bad examples for outcomes and ACs | Task 2, Edit C | BAD/GOOD examples in Step 4 |
| 8. Step renumbering + Read instruction | Task 2, Edit A + D | Steps 1, 2a, 2b, 3, 4, 5 |
| 9. New `references/` directory | Task 1 | `skills/groom/references/` |
| 10. Total new content ≤150 lines | Task 2 | ~58 lines new content in phase-5-groom.md |
