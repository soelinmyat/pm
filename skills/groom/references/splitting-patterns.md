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
