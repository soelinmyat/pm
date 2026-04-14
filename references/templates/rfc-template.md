# RFC Section Content Guide

Describes what goes in each section of an RFC. The RFC is written directly as HTML to `{pm_dir}/backlog/rfcs/{slug}.html` — use `${CLAUDE_PLUGIN_ROOT}/references/templates/rfc-reference.html` as the visual reference for structure, styling, and quality.

This file defines the **content** for each section. The HTML reference defines the **presentation**.

## Metadata

Embedded in the HTML as data attributes or a `<script type="application/json">` block in the `<head>`:

```json
{
  "type": "rfc",
  "parent": "{proposal-slug}",
  "status": "draft | reviewed | approved",
  "created": "YYYY-MM-DD",
  "updated": "YYYY-MM-DD"
}
```

## Hero Header

Title, one-line summary, metadata strip: size, status, author, task count.
Link back to the proposal and PRD.

## Codebase Findings

{What was discovered during codebase exploration that shaped the architecture.
Include file paths and line references. Format as findings with path + explanation.
These are the facts that justify the approach below.}

## Architecture

{System-level design. Component relationships, data flow, integration points.
Include a Mermaid diagram for the system overview.
Use <details> blocks for architecture rationale (e.g., "Why X, not Y").}

**Apps/services affected:** {list affected apps, packages, or services}
**Cross-boundary sync required:** {yes/no}

## Key Decisions

{Non-obvious technical choices made during RFC creation.
For each decision, list the chosen option and rejected alternatives with pros/cons.
These may be extracted as ADRs during RFC review.}

## Data Model

{Schema changes, new tables/columns, migrations.
Include SQL or type definitions. Mark required vs optional fields.
Omit this section if no data model changes.}

## API

{New or modified endpoints. Method, path, description.
Include request/response shapes for non-trivial endpoints.
Omit this section if no API changes.}

## Risks

{Known risks with impact and mitigations:
- Technical risks (performance, compatibility, migration)
- Product risks (edge cases, user confusion)
- Dependencies on external systems or teams
Format as a table: Risk | Impact | Mitigation}

## Issues

Each issue is an independently implementable unit. Issues are ordered by dependency —
implement top-to-bottom. Each issue should produce working, testable software on its own.

### Issue 1: {Title}

**Outcome:** {What changes when this ships — one sentence.}

**Acceptance Criteria:**
1. {Specific, testable condition}
2. {Specific, testable condition}
3. {Edge cases handled: ...}

**Approach:**
{Which files to create/modify, key implementation details, patterns to follow.
Detailed enough that a developer with zero codebase context can execute.}

**Dependencies:** None | Issue {N}

**Size estimate:** XS | S | M

---

### Issue 2: {Title}

{Same structure as Issue 1}

---

{Repeat for each issue}

## Advisory Notes

{Non-blocking guidance from RFC reviewers — performance tips, edge-case warnings,
implementation suggestions, and long-term considerations that didn't rise to blocking
but are worth keeping visible during implementation.

Populated during RFC review — leave empty in the initial draft.
Each note includes the reviewer role and the specific advice.

- **[@reviewer-role]** {Specific advisory note with context}
- **[@reviewer-role]** {Specific advisory note with context}

Omit this section if reviewers raised no advisory items.}

## Resolved Questions

{Questions raised by RFC reviewers, with answers and evidence.
Populated during RFC review — leave empty in the initial draft.

**Q:** {Reviewer question}
**A:** {Answer with rationale/evidence}

### Decisions Needed
{Only questions requiring human product judgment. Each with a recommended answer.
Omit this subsection if all questions were resolved.}

## Change Log

{Review iterations, fixes applied, reviewer verdicts.
Populated during RFC review — leave empty in the initial draft.
Format: date + entry (e.g., "Apr 8 — RFC approved. All reviewers signed off.")}

## Usage Notes

- Dev writes the RFC directly as HTML to `{pm_dir}/backlog/rfcs/{slug}.html` where `{slug}` matches the proposal slug.
- After RFC is written, dev updates the proposal's frontmatter: `rfc: rfcs/{slug}.html`.
- RFC review (3 reviewers) happens before implementation begins.
- During implementation, the dev state file (`.pm/dev-sessions/{slug}.md`) tracks per-issue progress. The RFC itself is not updated with status — it's the engineering plan, not a tracker.
- Issue sizes within the RFC inform the implementation approach (TDD depth, review gates) per the dev skill's size routing.
- Developer agents read the HTML file directly during implementation — HTML sections are clearly structured with IDs and semantic markup.
