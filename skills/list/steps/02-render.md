---
name: Render
order: 2
description: Prompt — render the cached ListRowsPayload as four sectioned lists and interpret conversational follow-ups
---

## Goal

Render the cached `ListRowsPayload` (from step 01) as four sectioned lists with stable formatting, and interpret the user's natural-language follow-ups into one of the five documented intents — **without fabricating filter logic**.

This step is a **prompt file**. There is no node function to call. You, the agent, are the renderer and classifier. Follow the spec below verbatim.

## Section order and caps

1. **Active Sessions** — `payload.active`. Cap: 7 rows.
2. **Backlog Proposals** — `payload.proposals`. Cap: 5 rows.
3. **RFCs awaiting dev** — `payload.rfcs`. Cap: 5 rows.
4. **Recently Shipped** — `payload.shipped`. Cap: 3 rows (already capped by the emitter).

When a section exceeds its cap, print the capped rows, then one overflow line:

```text
… and N more — say "show all <section>" to expand
```

## Row format spec

Each rendered row is a single line in this format (fields separated by two spaces):

```text
<shortId>  <topic>  <phaseLabel>  <ageRelative>  <staleness-marker>  <resumeHint>  [<linkage-arrow>]
```

- **shortId** — bare Linear ID (e.g. `PM-45`) when present; else `g/`, `r/`, `d/`, `t/`, `p/`, `s/` prefix + slug. Collisions within a kind get a `-N` suffix.
- **topic** — from row.topic (title or frontmatter `topic`, falls back to filename).
- **phaseLabel** — from row.phaseLabel (e.g. "Scoping", "Implementation", "Ready for dev").
- **ageRelative** — "Xh ago", "yesterday", "Xd ago".
- **staleness-marker** — one of: `● fresh`, `● default`, `● stale`, `● cold`. Treat the dot as a color cue (green / white / amber / red) when the terminal supports color; otherwise plain.
- **resumeHint** — literal row.resumeHint string.
- **linkage-arrow** (optional) — present only when row.linkage is non-null:
  - `linkage.rfc` present, `linkage.branch` absent → `→ rfc ready`
  - `linkage.branch` present, `linkage.rfc` absent → `→ /pm:dev <shortId>`
  - both present → `→ rfc ready · /pm:dev <shortId>`

When row.linkage is null, **omit the arrow entirely** — do not render an empty arrow placeholder.

## Five intents

Interpret the user's follow-up as one of exactly these five intents. If the message maps to none, use the fall-through escalation (below). Do **not** invent a sixth intent on the fly.

### 1. expand-section

Triggers: "show all proposals", "show all", "expand the RFCs", "everything under shipped", "more proposals please".

Response: re-render just that one section uncapped. Other sections are not re-rendered.

### 2. filter-to-section

Triggers: "just the RFCs", "only active sessions", "only shipped", "hide the shipped stuff" (inverse filter).

Response: re-render only the requested section(s), using the default caps unless combined with expand-section.

### 3. emit-json

Triggers: "give me the raw JSON", "emit JSON", "dump the payload", "I want json".

Response: emit the cached payload as-is, formatted with 2-space indentation. No other commentary.

### 4. expand-row-detail

Triggers: "what's PM-45 about?", "tell me more about g/list-active-work", "details on the search-v2 rfc".

Response: read the row's `sourcePath` file and summarize the most informative 2–4 lines (topic, phase, last action, next step). Do not reinterpret or speculate — only surface what the file already says.

### 5. show-staleness

Triggers: "what's stale?", "what needs attention?", "anything cold?".

Response: re-render only rows where `staleness` is `stale` or `cold`, grouped by staleness tier, sorted by age desc. If none match, say so in one line.

## Fall-through escalation

If the user's message maps to none of the five intents, do not guess. Use this template:

```text
I'm not sure how to map that onto `/pm:list`. Closest match:
- <suggestion>

Or: the per-skill resume commands still work directly — e.g. `/pm:groom resume <shortId>`, `/pm:dev resume <shortId>`.
```

Pick the closest matching workflow command as `<suggestion>` based on what the user asked. Examples:

- User wants to edit → suggest `/pm:groom resume <id>` or `/pm:dev resume <id>`.
- User wants to start something new → suggest `/pm:start` or `/pm:groom <topic>`.
- User wants analytics / counts → say no, surface the sections they can see.

**Log the fall-through follow-up** to `.pm/.list-telemetry.jsonl` (one JSON object per line: `{ ts, user_utterance, fallback_suggestion }`). This is a silent write — no user-visible effect.

## Per-row resume-hint reference

For cross-reference (the emitter already populates `resumeHint`; do not reinvent):

| kind | resumeHint format |
|---|---|
| groom    | `/pm:groom resume <shortId>` |
| rfc (session) | `/pm:rfc resume <shortId>` |
| dev      | `/pm:dev resume <shortId>` |
| think    | `/pm:think resume <shortId>` |
| proposal | `/pm:rfc <shortId>` |
| rfc (awaiting-dev backlog) | `/pm:dev <shortId>` |
| shipped  | `view <shortId>` |

## JSON example (contract cross-reference)

Concrete examples of the `ListRowsPayload` shape live in `tests/fixtures/list-rows/*.json` — these six fixtures (`empty-repo.json`, `single-section.json`, `all-sections.json`, `over-cap.json`, `separate-repo.json`, `missing-frontmatter.json`) are the authoritative contract. When emitting JSON (intent 3), match that shape.

## Before marking done

- Sections rendered in the order above (or the user's requested filter).
- Every rendered row has the full spec line (no missing fields except linkage when null).
- Overflow line present when any section exceeds its cap.
- If the user's follow-up hit the fall-through path, the telemetry line was written.
