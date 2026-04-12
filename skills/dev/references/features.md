# pm:features

## Purpose

`pm:features` scans the codebase and produces a structured feature inventory at `pm/product/features.md`. The inventory describes what the product does in user-facing terms — not code modules or file structures.

The output feeds two consumers:
- **productmemory.io** — renders the feature inventory online
- **Groom intake** — reads existing capabilities to inform scope review

## Interaction Pacing

Ask ONE question at a time. Wait for the user's answer before asking the next.

## Overwrite Guard

Before scanning, check if `pm/product/features.md` already exists.

If it exists:
1. Parse frontmatter to get `feature_count`.
2. Prompt: "This will replace your existing inventory (N features). Continue?"
3. If the user declines, stop. Do not scan or overwrite.

If it does not exist, proceed directly to scanning.

## Scanning Pipeline

### Pass 1: Structure Scan

Walk the file tree to build a directory map. Do not read file contents in this pass.

**File discovery:**
- Use `git ls-files` to list tracked/unignored files.
- **Fallback:** If not a git repo (`git ls-files` fails), walk the file tree but exclude common vendor directories (`node_modules`, `vendor`, `.venv`, `dist`, `build`, `target`, `__pycache__`) and hidden directories (starting with `.`). Log a note: "Not a git repository — using heuristic file filtering."

**Identify key entry points:**
- Package manifests: `package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, `Gemfile`
- Route directories: `routes/`, `pages/`, `app/`, `api/`
- Component directories: `components/`, `views/`, `screens/`
- Config files: `*.config.*`, `Dockerfile`, `docker-compose.*`
- Main entry files: `main.*`, `index.*`, `app.*`, `server.*`
- README and documentation files

**Output:** A structured directory map with file counts per directory and flagged key entry points.

### Pass 2: Key File Analysis

Read high-signal files identified in Pass 1:
- Route handlers and page components
- Component directory indexes
- Config and manifest files
- README and API definitions
- Model/schema files

**Chunking strategy:** When total scannable files exceed 500, prioritize by file type:
1. Route files, pages, API handlers (highest priority)
2. Components and views
3. Models, schemas, types
4. Config files
5. README, docs

Batch into groups of 50–100 key files per chunk. Track files scanned vs total.

**Output:** Extracted code artifacts — route definitions, component names, API endpoints, data models, configuration patterns.

### Pass 3: AI Interpretation

Using the structure map (Pass 1) and file contents (Pass 2), translate code artifacts into user-facing features grouped by product area.

**Writing principles:**

1. **Lead with the problem, then the outcome.** Not "Three-tier discovery flow (quick/standard/full) that takes a raw idea through strategy check..." but "Turn a rough idea into a buildable spec. Choose how deep to go — quick for small things, full for features that need research, design, and team sign-off."
2. **Plain language over jargon.** Not "SHA-256 hash-based change detection" but "Only syncs files that actually changed." Not "Assertion-driven QA testing" but "Test the UI." The reader is a product person or new team member, not the developer who built it.
3. **Name features as actions or outcomes.** Prefer "Sync your knowledge base" over "Knowledge base sync." Prefer "Turn ideas into specs" over "Feature grooming and PRD generation."
4. **Consolidate sub-steps into their parent feature.** If a capability is only invoked as a phase of a larger workflow (e.g., TDD, debugging, code review are all phases of a dev command), it's a highlight of that feature — not a standalone feature. Reserve standalone features for things a user discovers and uses independently.
5. **Merge infrastructure into user-facing outcomes.** If the product has multiple auth methods, that's one "Sign in" feature with highlights, not two features. Same for storage mechanisms, sync protocols, etc.

**Grouping:**

Group by user journey — how someone progresses through the product — not by technical architecture (plugin vs. server, frontend vs. backend).

Suggested journey stages (adapt to the actual product):
- **Think & Research** — ideation, market analysis, competitor intel
- **Plan** — strategy, scoping, proposals
- **Build** — implementation, testing, review, debugging
- **Ship** — PR, CI, merge, deploy
- **Learn** — notes, evidence, knowledge base maintenance
- **Collaborate** — sharing, teams, access control

Not every product maps to these stages. Use what fits. The key constraint: a reader should be able to say "I'm at stage X, what can I do?" and find their answer in one area.

Do not split by internal architecture boundaries (plugin/server, frontend/backend, client/API). If the user experiences "team sharing" as one thing, it's one area — even if it spans three microservices.

**Calibration:**
- Target 8–20 features total. Fewer than 8 means you're too coarse. More than 20 means you're promoting sub-steps to features.
- Target 3–6 areas. Fewer than 3 means you're grouping unrelated things. More than 6 means you're slicing too thin.
- Each area should have 2–5 features. A single-feature area should be merged into an adjacent one.

**Output:** Structured feature list grouped by product area.

## User Review

After Pass 3 completes, present the extracted features for user review before writing to disk.

### Presentation Format

Present a concise summary — the full descriptions live in the file, not in the review prompt:

```
Feature inventory for {project name} ({N} features, {M} areas):

{Product summary sentence}

  {Area 1}
    1. {Feature name} — {one-line what it does}
    2. {Feature name} — {one-line what it does}

  {Area 2}
    3. {Feature name} — {one-line what it does}
    4. {Feature name} — {one-line what it does}

Accept all, or tell me what to change (merge, rename, split, remove, regroup).
```

### Accept Path

User says "looks good" / "accept all" / "yes" — write to `pm/product/features.md`.

### Edit Path

User specifies edits using natural language:
- "merge features 3 and 4" — combine into one feature
- "rename feature 2 to X" — change the feature name
- "remove feature 7" — delete from inventory
- "split feature 5 into A and B" — create two features from one

Apply edits to the in-memory feature list. Re-present the updated list. Repeat until the user approves.

## Output Format

Write `pm/product/features.md` with this structure:

```yaml
---
generated: YYYY-MM-DD
source_project: {project root directory name}
files_scanned: {number of source files read in Pass 2}
files_total: {total files in project, only when chunking occurs}
feature_count: {total number of features}
area_count: {number of product areas}
tech_stack:
  - {language/framework 1}
  - {language/framework 2}
areas:
  - name: "{Area Name}"
    features:
      - "{feature-slug-1}"
      - "{feature-slug-2}"
  - name: "{Area Name}"
    features:
      - "{feature-slug-3}"
---
```

The markdown body follows this structure:

```markdown
{Product name} is {one sentence — what it is and who it's for}.

{One sentence — the core workflow or value loop, e.g., "You think through ideas, research the market, build with guardrails, and ship with confidence."}

## {Area Name}

### {Feature name}
{What problem this solves and what the user gets. 2-3 sentences, plain language. Lead with the situation ("You have a rough idea..."), then the outcome ("...this turns it into a clear spec ready to build"). Never describe internal mechanics.}

**Highlights:**
- {What you can do — framed as user action or outcome, not implementation}
- {Another highlight}
- {Another highlight}

### {Feature name}
...
```

**Body rules:**
- The product summary (first two lines before any `##`) is required. It orients the reader before they hit the feature list.
- Use `**Highlights:**` not "Key capabilities." Cap at 2–4 items per feature. Each highlight should pass the test: "Would a non-technical PM understand this and care?"
- Do **not** include an "Integration points" line. If a feature connects to another, mention it naturally in the description ("After research, your strategy doc updates automatically") — but only when the connection is something the user experiences, not internal wiring.
- Do **not** add section headers like "Part 1: Plugin" or "Part 2: Server". The split should be invisible.

## Completion

After writing the file:
1. Confirm: "Feature inventory written to pm/product/features.md ({N} features, {M} areas)."
2. Suggest: "Run /pm:groom to use it in feature discovery."

## Notes

- Re-running `pm:features` regenerates the entire inventory from scratch. Manual edits are replaced.
- The feature inventory is a snapshot — it reflects the codebase at scan time.
- Quality varies by codebase structure. Well-named routes and components produce better results than deeply nested legacy code.
