### Phase 5.5: Groom (Issue Drafting)

Read the splitting patterns reference before starting this phase:

`Read ${CLAUDE_PLUGIN_ROOT}/skills/groom/references/splitting-patterns.md`

#### Step 1: Feature-type detection

Before drafting issues, classify the feature type to determine which visual artifacts to generate:

- **UI feature:** Has user-facing screens, workflows, or interactions → generate user flow diagram + HTML wireframe
- **Workflow feature:** Has multi-step processes, decision points, or state transitions → generate user flow diagram only
- **API feature:** Exposes or consumes APIs → no visual artifacts (API contracts are engineering's domain)
- **Data feature:** Introduces new data structures or storage → no visual artifacts (data models are engineering's domain)
- **Infrastructure feature:** Config, tooling, or plumbing → no visual artifacts

Confirm with the user:
> "This looks like a [UI/workflow/API/data/infrastructure] feature. I'll generate [user flow diagram + HTML wireframe / user flow diagram / no visual artifacts]. Sound right?"

Wait for confirmation before proceeding.

#### Step 2a: Generate Mermaid user flow diagrams (if applicable)

If the feature type is UI or workflow, generate **one flow diagram per job** from the JTBD list defined in Phase 4 scope. Each flow traces how a specific job gets done — from the trigger situation through to the desired outcome.

**Generating the flow set:**

1. **Read the jobs list** from `.pm/groom-sessions/{slug}.md` → `jobs` (top-level key). Each job with its `when/want/so` structure defines one flow. A job that has no decision points or edge cases (e.g., a simple read-only display) doesn't need a flow — skip it.

2. **For each flow, include:**
   - Primary happy path from user intent to completion
   - Key decision points as diamond nodes
   - Error states and edge cases as branching paths (tier skips, review failures, resume from saved state, validation errors, etc.)
   - Start and end states clearly labeled
   - Max ~15 nodes per diagram. If a flow exceeds this, split into sub-flows within the same section.

3. **Include citation trails** — at least one `%% Source:` comment per diagram referencing the research finding or competitor gap that informed a design decision:
   ```
   %% Source: pm/research/{topic}/findings.md — Finding N: {description}
   %% Source: pm/competitors/{slug}/features.md — {gap or pattern}
   ```

4. **Rank and tag flows.** Use the job `rank` from Phase 4 scope. The top 3 ranked jobs get `featured: true` — these display inline in the progressive proposal. The rest are accessible via a "View all flows" modal. If fewer than 4 jobs have flows, all are featured.

5. **Collapse simple sections.** If two adjacent sections share decision points or the second section is trivially simple (no branches), combine them into one flow rather than producing a stub diagram.

6. **Render flows in the browser for review.** Do NOT dump Mermaid source into the terminal — it's unreadable. Instead:
   - Write a self-contained HTML file to `.pm/sessions/groom-{slug}/user-flows-draft.html` with:
     - Mermaid.js loaded from CDN for client-side rendering
     - One section per flow: rank badge, job title, featured tag, Mermaid diagram, edge cases list
     - Top 3 flows above a divider, remaining flows below
   - **Auto-start dashboard if not running** — follow `${CLAUDE_PLUGIN_ROOT}/references/visual.md`:
     ```bash
     bash "${CLAUDE_PLUGIN_ROOT}/scripts/start-server.sh" --project-dir "$PWD" --mode dashboard
     ```
     Parse the returned JSON for the `port`. Never ask the user to start the dashboard manually.
   - Open in browser via the dashboard flows route:
     ```bash
     open "http://localhost:${PORT}/session/${SLUG}/flows"
     ```
   - Tell the user: "Flows are open in your browser. Any changes before I proceed?"
   - Wait for user response. If they request changes, update the HTML and re-open.

7. **Write flows to issue files.** After user confirms, write each flow as a separate fenced mermaid block in the parent issue file with a heading and featured tag:
   ```markdown
   ### Flow: {Job Title}
   <!-- featured: true -->
   ```mermaid
   graph TD
       A[Start] --> B{Decision}
       ...
   ```
   ```

   Non-featured flows use `<!-- featured: false -->`. Edge cases go as a bullet list below each flow diagram.

#### Step 2b: Generate HTML wireframe (UI features only)

**If no wireframe is needed** (non-UI feature, or UI changes applied directly without a separate wireframe), set `wireframes: []` in the state file. The progressive proposal will show a "skipped" badge with "No wireframes needed — UI changes applied directly." Skip the rest of Step 2b.

If the feature type is UI, generate a standalone HTML wireframe file:

1. **Create the wireframes directory** if it doesn't exist: `pm/backlog/wireframes/`

2. **Write a self-contained HTML file** to `pm/backlog/wireframes/{parent-issue-slug}.html` with:
   - A `<style>` block — no external dependencies. Use lo-fi wireframe CSS: gray boxes, borders, labels, placeholder areas.
   - Component vocabulary: `.wireframe-screen`, `.wireframe-header`, `.wireframe-nav`, `.wireframe-sidebar`, `.wireframe-content`, `.wireframe-form`, `.wireframe-button`, `.wireframe-input`, `.wireframe-table`, `.wireframe-card`, `.wireframe-placeholder`
   - Layout using CSS flexbox/grid — simple, reliable, LLM-friendly
   - A title bar showing the feature name and "Lo-fi Wireframe"
   - Labeled components matching the feature scope (e.g., form fields with real labels from the spec, nav items matching the user flow, table columns matching the data model)

3. **Ground the wireframe in scope, research, and existing UI** (if `codebase_available: true`):
   - Component labels should match the terminology from the scope definition
   - Screen layout should reflect the user flow from Step 2a
   - Add HTML comments citing sources: `<!-- Source: pm/research/{topic}/findings.md -->`
   - If the project has existing UI, scan for current layout patterns, navigation structure, component conventions, and design language. The wireframe should feel like a natural extension of the existing product, not a disconnected screen. Reference existing patterns: `<!-- Matches existing pattern in: {file path} -->`

4. **Keep it lo-fi.** The wireframe communicates layout and component placement, not visual design:
   - Gray backgrounds, black borders, system fonts
   - No colors, icons, or images (use text placeholders: `[Icon]`, `[Image]`)
   - No interactivity (static HTML only)
   - Max 2-3 screens per wireframe file (use sections or scroll)
   - Include a `<title>` tag with the wireframe name — the dashboard extracts this for the chrome header displayed above the iframe embed

5. **Reference the wireframe** in the parent issue's `## Wireframes` section:
   ```
   [Wireframe preview](pm/backlog/wireframes/{issue-slug}.html)
   ```

6. **Open the wireframe in the dashboard** immediately after writing it. Follow the standard invocation pattern in `${CLAUDE_PLUGIN_ROOT}/references/visual.md`:
   - Ensure dashboard is running
   - Open `http://localhost:{port}/backlog/wireframes/{parent-issue-slug}`
   - Tell the user:
     > "Wireframe ready — opening in dashboard."
     > File: `pm/backlog/wireframes/{parent-issue-slug}.html`

7. **Wait for user review.** Do not proceed to decomposition until the user confirms the wireframe:
   > "Wireframe is open in your browser. Any changes before I proceed?"

   Wait for user response. If they request changes, update the wireframe and re-open. If they confirm, proceed.

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

#### Step 5: Draft issues

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
   - **Technical Feasibility:** Key findings from the EM review in Phase 4.5, referencing specific file paths. If dependency mapping was produced (Step 4), include sequencing constraints and parallelization notes. If no EM review was conducted, note "No codebase context available."

#### Step 5.5: Companion screen

Check `.pm/config.json` → `preferences.visual_companion`. If `false`, skip.

Read the companion template at `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/companion-template.md`.

Write `.pm/sessions/groom-{slug}/current.html` with:

- `{TOPIC}`: the topic from groom state
- `{PHASE_LABEL}`: "Issue Drafting"
- `{STEPPER_HTML}`: `groom` as current; `intake` through `scope-review` as completed
- `{CONTENT}`: Build from the decomposition and drafted issues:

  ```html
  <h2>Decomposition</h2>
  <table>
    <thead><tr><th>Pattern</th><th>Fit</th><th>Verdict</th></tr></thead>
    <tbody>
      <tr><td>{pattern}</td><td>{fit rationale}</td><td><strong>{Selected/Rejected}</strong></td></tr>
      <!-- one row per candidate pattern from Step 3 -->
    </tbody>
  </table>

  <h2>Issues</h2>
  <!-- One card per drafted issue -->
  <div class="card">
    <h3>{issue title}</h3>
    <p class="outcome">{outcome statement}</p>
  </div>
  <!-- Repeat for each child issue -->

  <h2>User Flow</h2>
  <pre class="mermaid">
  {mermaid diagram source from Step 2a — raw text, not rendered}
  </pre>
  <!-- Mermaid.js script in template head renders this client-side -->
  ```

  If no Mermaid diagram was generated (non-UI feature type), omit the User Flow section.

Create `.pm/sessions/groom-{slug}/` directory if it doesn't exist.
Do not mention this step to the user.

#### Step 6: Write flows.json

After user confirms the flows, write `.pm/sessions/groom-{slug}/flows.json` — a JSON array the progressive proposal renderer reads to display inline flows:

```json
[
  {
    "rank": 1,
    "featured": true,
    "title": "{job want text}",
    "job": "{When ... — so ...}",
    "mermaid": "graph TD\n    A[Start] --> B{Decision}\n    ...",
    "edges": ["edge case 1", "edge case 2"]
  }
]
```

The renderer shows the top 3 `featured: true` flows inline and links to `/session/{slug}/flows` for all flows.

#### Step 7: Update state

Do NOT present issues to the user yet. Proceed directly to Phase 6 (Team Review).

```yaml
phase: groom
wireframes:
  - "{wireframe-slug}"
issues:
  - slug: "{issue-slug}"
    title: "{title}"
    status: drafted
```

Add `wireframes` list with the slug of each wireframe file generated in Step 2b (filename without `.html`). This lets the progressive proposal renderer find wireframes that don't match the session slug.
