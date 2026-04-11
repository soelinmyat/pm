---
name: features
description: "Scan the codebase, extract user-facing features via a 3-pass pipeline, and write a structured feature inventory to pm/product/features.md. Triggers on 'features,' 'feature inventory,' 'scan features,' 'what does this product do,' 'product capabilities.'"
---

# pm:features

## Purpose

`pm:features` scans the codebase and produces a structured feature inventory at `pm/product/features.md`. The inventory describes what the product does in user-facing terms — not code modules or file structures.

The output feeds two consumers:
- **Dashboard** — renders the inventory at `/product`
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

**Prompt guidance for feature extraction:**
- Describe features from the user's perspective, not the developer's
- Use language like "team file sharing with permissions" not "upload endpoint with ACL middleware"
- Target 5–25 features total — if you find fewer than 5 or more than 25, recalibrate granularity
- Group features into 2–8 product areas
- Each feature should have:
  - A descriptive name (3–8 words)
  - A one-paragraph description of what it does for the user
  - Key capabilities (3–6 bullet points)
  - Integration points with other features (if any)

**Output:** Structured feature list grouped by product area.

## User Review

After Pass 3 completes, present the extracted features for user review before writing to disk.

### Presentation Format

Format features as a numbered list grouped by area:

```
Feature inventory for {project name} ({N} features, {M} areas):

## {Area 1}
  1. {Feature name} — {one-line description}
  2. {Feature name} — {one-line description}

## {Area 2}
  3. {Feature name} — {one-line description}
  4. {Feature name} — {one-line description}

Accept all, or tell me what to change (merge, rename, split, remove).
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
## {Area Name}

### {Feature name}
{One-paragraph description of what this feature does for the user.}

**Key capabilities:**
- {Capability 1}
- {Capability 2}
- {Capability 3}

**Integration points:** {other features or systems this connects to}

### {Feature name}
...
```

## Completion

After writing the file:
1. Confirm: "Feature inventory written to pm/product/features.md ({N} features, {M} areas)."
2. Suggest: "View it on the dashboard at /product, or run /pm:groom to use it in feature discovery."

## Notes

- Re-running `pm:features` regenerates the entire inventory from scratch. Manual edits are replaced.
- The feature inventory is a snapshot — it reflects the codebase at scan time.
- Quality varies by codebase structure. Well-named routes and components produce better results than deeply nested legacy code.
