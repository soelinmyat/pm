# PM-141: Template Schema Docs + Skill Integration

## Summary

Create 5 reference docs under `references/templates/` that document the exact frontmatter fields, content structure, and rendering expectations for each dashboard template type (detail, detail-tabs, detail-toc, list, kanban). Then update skill phase files (groom, research, refresh) with `Read` instructions pointing to the relevant schema doc so that skills produce dashboard-compatible output on first attempt. Finally, add tests verifying that example data from each schema doc passes through the rendering pipeline without errors.

PM-138/139/140 will create a `renderTemplate()` function that consolidates the current inline handler code. This issue documents the schema contract those templates expect and wires skills to it. If PM-138/139/140 are not yet merged when implementation starts, the schema docs still describe the existing handler expectations (the templates are a refactor, not a behavior change), and the test in AC 8 will call whatever exported render function exists at that point.

## Current Architecture

The dashboard has no formal template engine yet. Each page type is an inline handler in `scripts/server.js`:

| Page type | Handler | Route | Template concept |
|---|---|---|---|
| Backlog issue detail | `handleBacklogItem()` (line 3985) | `/roadmap/:slug` | **detail** |
| Competitor detail | `handleCompetitorDetail()` (line 3511) | `/competitors/:slug` | **detail-tabs** |
| Research topic detail | `handleResearchTopic()` (line 3588) | `/research/:topic` | **detail-toc** |
| Landscape overview | `handleKbLandscapeDetail()` (line 3446) | `/kb/landscape` | **detail-toc** |
| Backlog kanban | `handleBacklog()` (line 3682) | `/roadmap` | **kanban** |
| Competitors list | `handleCompetitorsList()` (line 3138) | `/competitors` | **list** |
| Research topics list | `handleResearchPage()` (line 2377) | `/kb?tab=research` | **list** |

Skills that produce dashboard-consumed content:
- `pm:groom` (Phase 5) writes backlog `.md` files read by `handleBacklogItem`
- `pm:research` (Topic Mode) writes `findings.md` read by `handleResearchTopic`
- `pm:research` (Landscape Mode) writes `landscape.md` read by `handleKbLandscapeDetail`
- `pm:research` (Competitor Mode) writes 5 section files read by `handleCompetitorDetail`
- `pm:refresh` patches all of the above

## Tasks

### Task 1: Write `references/templates/detail.md`
- **Files:** `references/templates/detail.md` (create)
- **Changes:** Document the schema for the backlog issue detail page:
  - Required frontmatter: `title`, `status`
  - Optional frontmatter: `id`, `priority`, `parent`, `outcome`, `acceptance_criteria` (array), `children` (array), `updated`, `created`, `labels` (array), `scope_signal`
  - Field types and allowed values (e.g., `status`: `idea|drafted|approved|in-progress|done`)
  - Content structure: body markdown, `## Acceptance Criteria` section (parsed if not in frontmatter), `## Wireframes` section
  - Example frontmatter block + example content
  - "How to add a new template type" section (generic, same in all 5 docs)
- **Tests:** Covered by Task 8
- **Depends on:** none

### Task 2: Write `references/templates/detail-tabs.md`
- **Files:** `references/templates/detail-tabs.md` (create)
- **Changes:** Document the schema for the competitor detail page (tabbed sections):
  - Directory structure: `pm/competitors/{slug}/` with 5 files
  - Each file's frontmatter and expected h2 sections
  - Section keys: `profile`, `features`, `api`, `seo`, `sentiment`
  - profile.md: `name`/`company` in frontmatter or `# {Name} ` h1, SWOT rendering
  - features.md / api.md / seo.md / sentiment.md: type, company, slug, profiled, sources
  - Example frontmatter for each file
  - Example content structure per file (referencing `competitor-profiling.md` as canonical source)
- **Tests:** Covered by Task 8
- **Depends on:** none

### Task 3: Write `references/templates/detail-toc.md`
- **Files:** `references/templates/detail-toc.md` (create)
- **Changes:** Document the schema for research topic and landscape detail pages:
  - Research topic: frontmatter (`type`, `topic`, `created`, `updated`, `source_origin`, `sources`, `evidence_count`, `segments`, `confidence`), body split at `## Sources`/`## References`
  - Landscape: frontmatter (`type`, `created`, `updated`, `sources`), h2 sections auto-detected for TOC, stat comments (`<!-- stat: ... -->`), positioning map comments
  - How h2 headings become TOC entries (auto-detection, no explicit TOC field needed)
  - Example frontmatter + content for both variants
- **Tests:** Covered by Task 8
- **Depends on:** none

### Task 4: Write `references/templates/list.md`
- **Files:** `references/templates/list.md` (create)
- **Changes:** Document the card grid list template:
  - Competitors list: reads `profile.md` from each subdirectory, extracts `company`/`name`, category from body, file presence count as badge
  - Research topics list: reads `findings.md`, uses `buildTopicMeta()` for label/subtitle/badges
  - Card anatomy: title (linked), meta line, footer with badges and "View" link
  - Required data: a directory of items, each with a parseable markdown file
  - Example file structure + expected card output
- **Tests:** Covered by Task 8
- **Depends on:** none

### Task 5: Write `references/templates/kanban.md`
- **Files:** `references/templates/kanban.md` (create)
- **Changes:** Document the kanban board template:
  - Column mapping: `STATUS_MAP` (`idea`->`idea`, `drafted`/`approved`/`in-progress`->`groomed`, `done`->`shipped`)
  - Per-card fields: `slug` (filename), `title`, `status`, `priority` (default `medium`), `labels` (array), `scope_signal`, `id`, `parent`, `updated`/`created`
  - Column caps (10 items), sort order (by `updated` desc), "View all" overflow link
  - Card anatomy: ID badge, parent ref, title, labels, scope signal, priority class
  - Hint rendering for idea-column items
  - Example frontmatter that produces a properly rendered kanban card
- **Tests:** Covered by Task 8
- **Depends on:** none

### Task 6: Update skill phase files with `Read` instructions
- **Files:**
  - `skills/groom/phases/phase-5-groom.md` (modify)
  - `skills/research/SKILL.md` (modify)
  - `skills/refresh/SKILL.md` (modify)
- **Changes:**
  - In `phase-5-groom.md` Step 3 (Draft issues): add instruction to `Read references/templates/detail.md` and `Read references/templates/kanban.md` before writing issue files, to ensure frontmatter and content structure match what the dashboard expects.
  - In `skills/research/SKILL.md` Landscape Mode step 4 (Write landscape.md): add instruction to `Read references/templates/detail-toc.md` before writing, to ensure h2 sections and stat comments match dashboard expectations.
  - In `skills/research/SKILL.md` Topic Mode step 5 (Write findings): add instruction to `Read references/templates/detail-toc.md` before writing findings.md.
  - In `skills/research/SKILL.md` Competitor Mode Phase 2 (Profile): add instruction to `Read references/templates/detail-tabs.md` before writing competitor files.
  - In `skills/refresh/SKILL.md` Phase 2 (Execute): add instruction to `Read` the relevant schema doc before patching each file type.
- **Tests:** none (skill files are markdown instructions, not code)
- **Depends on:** Tasks 1-5

### Task 7: Verify AC 3-6 manually (no code change)
- **Verification:** After Tasks 1-6, confirm that:
  - AC 3: The `detail-toc.md` schema matches what `handleResearchTopic` reads from `findings.md`
  - AC 4: The `detail.md` and `kanban.md` schemas match what `handleBacklogItem` and `handleBacklog` expect
  - AC 5: The `detail-tabs.md` schema matches what `handleCompetitorDetail` reads from the 5 section files
  - AC 6: The `detail-toc.md` schema documents h2 auto-detection for landscape content
- **Depends on:** Tasks 1-5

### Task 8: Add tests for schema doc examples
- **Files:** `tests/server.test.js` (modify)
- **Changes:** Add a test group "PM-141: Template schema doc examples render correctly" with one test per template type:
  1. **detail**: Create a temp `pm/backlog/test-item.md` using the example frontmatter/content from `detail.md`. HTTP GET `/roadmap/test-item`. Assert 200, no error, body includes `detail-page`, `detail-title`, `detail-section`.
  2. **detail-tabs**: Create a temp `pm/competitors/test-comp/` with 5 files using example frontmatter from `detail-tabs.md`. HTTP GET `/competitors/test-comp`. Assert 200, body includes all 5 section headings.
  3. **detail-toc**: Create a temp `pm/research/test-topic/findings.md` using example from `detail-toc.md`. HTTP GET `/research/test-topic`. Assert 200, body includes `detail-page`, `detail-section`, `Findings`.
  4. **list**: Create temp competitor directories and research topics. HTTP GET `/competitors` and `/kb?tab=research`. Assert 200, body includes `card` class.
  5. **kanban**: Create temp backlog items with various statuses using example from `kanban.md`. HTTP GET `/roadmap`. Assert 200, body includes `kanban-col`, items appear in correct columns.
- **Pattern:** Follow existing test pattern using `withPmDir()`, `startDashboardServer()`, `httpGet()`.
- **Depends on:** Tasks 1-5

## File Structure

```
references/templates/
  detail.md          (new) — backlog issue detail page schema
  detail-tabs.md     (new) — competitor detail page schema (5-file tabbed)
  detail-toc.md      (new) — research/landscape detail page schema (h2 TOC)
  list.md            (new) — card grid list template schema
  kanban.md          (new) — kanban board template schema
  proposal-reference.html  (existing, untouched)
  strategy-deck.html       (existing, untouched)
```

## Contract

**Files in scope:**
- `references/templates/detail.md` (create)
- `references/templates/detail-tabs.md` (create)
- `references/templates/detail-toc.md` (create)
- `references/templates/list.md` (create)
- `references/templates/kanban.md` (create)
- `skills/groom/phases/phase-5-groom.md` (modify)
- `skills/research/SKILL.md` (modify)
- `skills/refresh/SKILL.md` (modify)
- `tests/server.test.js` (modify)

**Files out of scope:**
- `scripts/server.js` (no code changes; PM-138/139/140 refactor the handlers)
- `skills/research/competitor-profiling.md` (already has detailed structure docs; schema doc references it)
- `references/templates/proposal-reference.html` (existing, unrelated)
- `references/templates/strategy-deck.html` (existing, unrelated)

**Verification commands:**
```bash
cd /Users/soelinmyat/Projects/pm/pm_plugin && node --test tests/server.test.js
```
