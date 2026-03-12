# PM-050: Formalize groom-to-dev handoff with groomed issue detection

**Date:** 2026-03-21
**Parent issue:** PM-044 (Merge PM and Dev plugins)

## Problem

Both `dev/SKILL.md` and `dev-epic/SKILL.md` have informal "from groom?" detection logic. The current mechanisms are fragile:

- **dev/SKILL.md (line 249):** Checks for "research refs, or `.pm/.groom-state.md` completed for this topic" — a file that doesn't reliably exist and uses heuristics.
- **dev-epic/SKILL.md (line 70):** Uses AC-counting heuristic ("3+ numbered, testable ACs AND research refs OR EM feasibility notes") — fragile, can false-positive on well-written raw issues.

Neither reads the actual groom session file. Neither checks the bar raiser verdict. The merged plugin has `.pm/groom-sessions/{slug}.md` as the authoritative record of grooming — detection should read it directly.

## Design

### Detection algorithm

A groom session is **groomed and ready** if and only if:

1. A file `.pm/groom-sessions/{slug}.md` exists where `{slug}` matches the issue slug or topic name (case-insensitive, hyphenated)
2. The file's YAML frontmatter contains `bar_raiser.verdict` equal to `"ready"` or `"ready-if"` (string match)
3. Verdicts `"send-back"` and `"pause"` explicitly do NOT qualify — they indicate the issue needs more work

If multiple groom session files exist, match by:
- Exact slug match against the issue slug
- Fuzzy: normalize topic name to slug form (lowercase, spaces to hyphens) and compare

If no match is found, or the match has a non-qualifying verdict, or parsing fails: **fall back to full ceremony**.

### What "groomed" means for ceremony

| Skill | Groomed behavior | Full ceremony behavior |
|-------|-----------------|----------------------|
| `dev` (M/L/XL) | Skip brainstorming (Stage 3). Skip spec review (Stage 3.5). Proceed directly to writing-plans (Stage 4). | Run brainstorming, then spec review (3 agents) |
| `dev` (M/L/XL) | Spec review: n/a (skipped) | Spec review: full (3 agents) |
| `dev-epic` | Source detection: groomed. Skip brainstorming + spec review per sub-issue. Skip individual RFC review. | Source detection: raw. Full brainstorming, spec review, RFC review |

### Research injection

When processing a groomed issue, `writing-plans` reads the groom session's `research_location` field, reads the findings file at that path, and injects a `## Upstream Context` section at the top of the plan (after the header, before Task 1).

### State logging

Skipped phases are logged in the dev session state file (`.dev-state-{slug}.md` or `.dev-epic-state-{slug}.md`) under the Decisions section.

---

## Changes

### Change 1: dev/SKILL.md — Replace spec review source detection (Stage 3.5)

**File (post-colocation):** `skills/dev/SKILL.md`

**Old text (lines 246-255):**

```markdown
### Source detection

Check the ticket or intake context:
- **From groom** (issue has research refs, or `.pm/.groom-state.md` completed for this topic): Product and competitive review already happened in groom Phase 4.5. Run **UX & User Flow review only** (1 agent).
- **From conversation** (no prior grooming): Run **full review** (3 agents: PM + UX & User Flow + Competitive Strategist).

Log the decision in `.dev-state.md`:
```
- Spec review: from-groom (UX only) | full (3 agents)
```
```

**New text:**

```markdown
### Source detection

Detect whether this issue was groomed by reading the groom session file:

1. Glob `.pm/groom-sessions/*.md` for a file whose slug matches the current issue slug or topic (normalize: lowercase, spaces to hyphens).
2. If found, parse YAML frontmatter and read `bar_raiser.verdict`.
3. **Groomed** = verdict is `"ready"` or `"ready-if"`. Skip brainstorming (Stage 3) entirely. Skip spec review (this stage) entirely. Proceed directly to Stage 4 (writing-plans).
4. **Not groomed** = no matching file, verdict is `"send-back"` / `"pause"` / missing, or parse error. Run **full ceremony**: brainstorming (Stage 3) then full spec review (3 agents: PM + UX & User Flow + Competitive Strategist).

**Ambiguity fallback:** If the slug match is uncertain (multiple partial matches, no exact match), fall back to full ceremony. Never reduce ceremony on ambiguous detection.

Log the decision in `.dev-state-{slug}.md` under Decisions:
```
- Groom detection: groomed (session: {slug}.md, verdict: {verdict}) | not-groomed (reason: {reason})
- Skipped phases: brainstorming, spec-review | none
```
```

### Change 2: dev/SKILL.md — Update stage routing table note

**File (post-colocation):** `skills/dev/SKILL.md`

**Old text (line 173):**

```markdown
| Spec review | — | — | UX only (from groom) or full (3 agents) | UX only (from groom) or full (3 agents) | UX only (from groom) or full (3 agents) |
```

**New text:**

```markdown
| Brainstorm | — | — | Skip (from groom) or `dev:brainstorming` | Skip (from groom) or `dev:brainstorming` | Skip (from groom) or `dev:brainstorming` |
| Spec review | — | — | Skip (from groom) or full (3 agents) | Skip (from groom) or full (3 agents) | Skip (from groom) or full (3 agents) |
```

Note: This replaces both the existing Brainstorm row (line 172) and Spec review row (line 173). The Brainstorm row currently reads `dev:brainstorming` without a groom conditional — it needs one.

### Change 3: dev/SKILL.md — Add groom detection before Stage 3

**File (post-colocation):** `skills/dev/SKILL.md`

Insert before the existing `## Stage 3: Brainstorm (M/L/XL)` heading (line 236):

```markdown
## Stage 2.5: Groom Detection (M/L/XL)

Before brainstorming, check if this issue was groomed:

1. Glob `.pm/groom-sessions/*.md` for a file whose slug matches the current issue slug or topic.
2. Parse YAML frontmatter. Read `bar_raiser.verdict`.
3. If verdict is `"ready"` or `"ready-if"`:
   - Log in state file: `Groom detection: groomed (session: {filename}, verdict: {verdict})`
   - Log: `Skipped phases: brainstorming, spec-review`
   - Read `research_location` from the session frontmatter. Store the path for research injection in Stage 4.
   - **Skip Stage 3 (brainstorming) and Stage 3.5 (spec review).** Proceed directly to Stage 4 (writing-plans).
4. If not groomed: proceed to Stage 3 as normal.
```

### Change 4: dev/SKILL.md — Remove legacy "PM + Competitive Strategist" groom guard

**File (post-colocation):** `skills/dev/SKILL.md`

**Old text (lines 382-384):**

```markdown
### PM + Competitive Strategist (only when NOT from groom)

These only run when the work did NOT come through `/pm:groom`. If groom already ran, its Phase 4.5 covered these concerns.
```

**New text:**

```markdown
### PM + Competitive Strategist (only when NOT from groom)

These only run when groom detection (Stage 2.5) determined the issue is NOT groomed. If groomed, both brainstorming and spec review are skipped entirely — this section is never reached.
```

### Change 5: dev-epic/SKILL.md — Replace source detection (Stage 1.2)

**File (post-colocation):** `skills/dev-epic/SKILL.md`

**Old text (lines 66-73):**

```markdown
### 1.2 Source detection (groomed vs raw)

| Signal | Verdict |
|--------|---------|
| 3+ numbered, testable ACs AND (research refs OR EM feasibility notes with file paths) | **Groomed** (from pm:groom) |
| Just titles or thin descriptions | **Raw** |

Groomed issues get reduced ceremony (skip brainstorming + spec review). This is the pm -> dev handoff.
```

**New text:**

```markdown
### 1.2 Source detection (groomed vs raw)

For each sub-issue, detect groomed status by reading the groom session file:

1. Glob `.pm/groom-sessions/*.md` for a file whose slug matches the sub-issue slug or topic name (normalize: lowercase, spaces to hyphens).
2. If found, parse YAML frontmatter and read `bar_raiser.verdict`.
3. **Groomed** = verdict is `"ready"` or `"ready-if"`. Mark sub-issue as groomed in state file.
4. **Raw** = no matching file, verdict is `"send-back"` / `"pause"` / missing, or parse error. Mark as raw.

| Signal | Verdict |
|--------|---------|
| Groom session exists with `bar_raiser.verdict` = `"ready"` or `"ready-if"` | **Groomed** |
| No matching session, or verdict is `"send-back"` / `"pause"` / missing | **Raw** |

**Ambiguity fallback:** If slug matching is uncertain (multiple partial matches, no exact match), classify as Raw. Never reduce ceremony on ambiguous detection.

Groomed issues get reduced ceremony (skip brainstorming + spec review). This is the pm -> dev handoff.

**Multiple groom sessions:** When the parent issue maps to a single groom session (e.g., an epic groomed as one initiative), all sub-issues inherit the groomed status from the parent session. When individual sub-issues have their own groom sessions, match per sub-issue.
```

### Change 6: dev-epic/SKILL.md — Log groomed status in state file

In the state template reference (Stage 1.6), the sub-issue table already has a `Source` column. Ensure the groomed detection result is recorded per sub-issue:

**Add to the Sub-Issues table in state file (after Size column):**

```
| Source | groomed (pm-dev-merge.md, ready-if) | raw (no session) | ...
```

And add to the Decisions section:

```
- Groom detection: {slug} → groomed (session: {file}, verdict: {verdict}) | raw (reason: {reason})
- Skipped phases ({slug}): brainstorming, spec-review, individual-rfc | none
```

### Change 7: writing-plans/SKILL.md — Add research injection

**File (post-colocation):** `skills/writing-plans/SKILL.md`

Insert after the `## Plan Document Header` section (after line 64, before `## Task Structure`):

```markdown
## Upstream Context (groomed issues only)

When the invoking skill (dev or dev-epic) passes a `research_location` path from the groom session:

1. Read `research_location` from the groom session YAML frontmatter (passed by the invoking skill as context).
2. Read the findings file at that path (e.g., `pm/research/pm-dev-merge/findings.md`).
3. Extract key findings: competitor landscape summary, market signals, and any decision rationale.
4. Inject as `## Upstream Context` in the plan document, after the header block and before the first task.

**Format:**

```markdown
## Upstream Context

> Injected from groom session `{session-slug}` — research at `{research_location}`.

### Key Findings
- {finding 1}
- {finding 2}
- ...

### Groom Conditions
- {bar_raiser condition 1}
- {team_review condition relevant to this sub-issue}

---
```

**Rules:**
- If `research_location` is missing or the file doesn't exist, skip injection — do not error.
- Keep the section concise (max ~20 lines). Summarize, don't paste the full findings file.
- The `## Upstream Context` section MUST be non-empty when processing a groomed issue that has a valid research_location. This is a verifiable AC.
```

### Change 8: dev/SKILL.md — Pass research context to writing-plans

In Stage 4 (writing-plans invocation), add research context passing.

**Insert after the Stage 2.5 groom detection stores the research_location:**

When invoking `dev:writing-plans` for a groomed issue, include in the context:

```
**Groom context:**
- Session: .pm/groom-sessions/{slug}.md
- Research location: {research_location from session frontmatter}
- Bar raiser verdict: {verdict}
- Conditions: {list of bar_raiser.conditions and team_review.conditions}
```

This context is what writing-plans reads to produce the `## Upstream Context` section.

---

## State Logging Format

### For dev (single-issue) — `.dev-state-{slug}.md`

Add under Decisions:

```markdown
## Decisions
- Groom detection: groomed (session: pm-dev-merge.md, verdict: ready-if) | not-groomed (reason: no matching session)
- Skipped phases: brainstorming, spec-review | none
- Research location: pm/research/pm-dev-merge/ | none
```

### For dev-epic (multi-issue) — `.dev-epic-state-{parent-slug}.md`

Add per-sub-issue entries under Decisions:

```markdown
## Decisions
- Source: groomed
- Groom detection:
  - pm-dev-strategy-rewrite → groomed (session: pm-dev-merge.md, verdict: ready-if)
  - pm-dev-manifest-unification → groomed (session: pm-dev-merge.md, verdict: ready-if)
- Skipped phases (all groomed): brainstorming, spec-review, individual-rfc
- Research location: pm/research/pm-dev-merge/
```

---

## Groom Session Schema Reference

The detection algorithm reads these fields from `.pm/groom-sessions/{slug}.md` YAML frontmatter:

```yaml
# Required for detection
bar_raiser:
  verdict: ready | ready-if | send-back | pause  # ONLY "ready" and "ready-if" trigger reduced ceremony

# Required for research injection
research_location: pm/research/{topic}/  # Path to findings file

# Used for condition injection into plans
bar_raiser:
  conditions:
    - "condition text"
team_review:
  conditions:
    - "condition text"

# Used for slug matching
topic: "Human-readable topic name"  # Normalized to slug: lowercase, spaces→hyphens
issues:
  - slug: "issue-slug"  # Direct slug match
```

---

## Verification Checklist

| AC | How to verify |
|----|--------------|
| 1. Detection reads groom session, checks verdict = ready/ready-if | Read the detection logic in dev/SKILL.md Stage 2.5 and dev-epic/SKILL.md Stage 1.2. Confirm they glob `.pm/groom-sessions/`, parse frontmatter, check verdict. |
| 2. Both skills skip brainstorming + spec review when groomed | dev/SKILL.md: Stage 2.5 skips to Stage 4. dev-epic/SKILL.md: groomed sub-issues skip brainstorm+spec in Stage 2.1. |
| 3. Detection updated in both files, replacing legacy path | grep for `.groom-state.md` in both files — should return 0 matches. |
| 4. Multiple groom sessions: match by slug or topic | Detection algorithm normalizes topic to slug form, checks all `.pm/groom-sessions/*.md` files. |
| 5. Skipped phases logged in state file | State file Decisions section includes `Skipped phases:` line. |
| 6. Ambiguous detection falls back to full ceremony | Detection explicitly states: "If slug match is uncertain, fall back to full ceremony." |
| 7. Research injection produces non-empty ## Upstream Context | writing-plans/SKILL.md has `## Upstream Context` section with MUST be non-empty rule. |
| 8. Follow-on tracked separately | Not in scope for this plan. |

---

## Summary of File Changes

| # | File (post-colocation path) | Change |
|---|---|---|
| 1 | `skills/dev/SKILL.md` | Replace spec review source detection (lines 246-255) with groom session reading |
| 2 | `skills/dev/SKILL.md` | Update stage routing table rows for Brainstorm + Spec review |
| 3 | `skills/dev/SKILL.md` | Add Stage 2.5: Groom Detection before Stage 3 |
| 4 | `skills/dev/SKILL.md` | Update PM + Competitive Strategist guard text |
| 5 | `skills/dev-epic/SKILL.md` | Replace Stage 1.2 source detection with groom session reading |
| 6 | `skills/dev-epic/SKILL.md` | Add per-sub-issue groom logging to state file |
| 7 | `skills/writing-plans/SKILL.md` | Add ## Upstream Context injection section |
| 8 | `skills/dev/SKILL.md` | Pass research context when invoking writing-plans |

## Task Count: 8 tasks
