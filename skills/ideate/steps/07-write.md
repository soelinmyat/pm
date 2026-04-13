---
name: Write
order: 7
description: Save confirmed ideas into the backlog as idea-stage artifacts
---

## Goal

Write the user-approved ideas into `{pm_dir}/backlog/` in a consistent format that can be groomed later.

## How

Only run this step when the user confirms they want ideas written to backlog.

Write each approved idea to `{pm_dir}/backlog/{idea-slug}.md`.

**ID rule:** If a Linear issue is created for this idea, use the Linear identifier as `id`. Otherwise fall back to the local `PM-{NNN}` sequence (scan `{pm_dir}/backlog/*.md` for the highest `id`, increment by 1).

Use this structure:

```markdown
---
type: backlog
id: "{linear_id or PM-NNN}"
title: "{Idea Name}"
outcome: "{One-liner}"
status: idea
parent: null
labels:
  - "ideate"
priority: {critical|high|medium|low}
evidence_strength: {strong|moderate|hypothesis}
scope_signal: {small|medium|large}
strategic_fit: "{which priority}"
competitor_gap: {unique|partial|parity}
dependencies: [] | ["{dependency}"]
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

## Outcome
{What the user can do after this ships.}

## Signal Sources
- {source path}: {what it revealed}

## Competitor Context
{Who has this, who doesn't, how ours would differ.}

## Dependencies
{What needs to exist first, or "None."}

## Open Questions
{What to validate before building.}
```

After writing, say:

> "Wrote {N} ideas to {pm_dir}/backlog/. Run /pm:groom {slug} to promote any idea to a fully scoped proposal."

## Done-when

All user-approved ideas have been written with valid frontmatter and evidence references, or the step has been skipped because the user did not ask to save ideas yet.
