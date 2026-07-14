---
name: list
description: "Use when the user wants a terminal view of in-flight PM artefacts — active sessions, backlog proposals, RFCs awaiting dev, and recently shipped. Read-only surveying."
---

# pm:list

## Purpose

Give terminal users a `git-status`-style view of every in-flight PM artefact. Four sectioned lists:

1. **Active Sessions** — groom, rfc, dev, think (from `{source_dir}/.pm/*-sessions/`).
2. **Backlog Proposals** — unshipped backlog items not yet promoted to RFC.
3. **RFCs awaiting dev** — backlog items with an `rfc:` field set but not yet in-progress or shipped.
4. **Recently Shipped** — last 3 items with `status: shipped`.

Each row shows a stable short-ID, topic, phase label, relative age with staleness tier, and a per-row resume-hint command. Follow-ups ("show all," "just the RFCs," "give me JSON," "what's PM-45 about?") are interpreted conversationally — no user-visible flags.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution and runtime conventions.
Read `${CLAUDE_PLUGIN_ROOT}/references/writing.md` before generating any output.

## When NOT to use

- User wants to start a new workflow (use `/pm:start`, `/pm:groom`, `/pm:dev`, etc.).
- User wants to resume a specific session (use the per-skill resume command directly).
- User is asking a question that has nothing to do with surveying in-flight work.

**Workflow:** `list` | **Telemetry steps:** `discover`, `render`

**Steps:** Read all `.md` files from `${CLAUDE_PLUGIN_ROOT}/skills/list/steps/` in numeric filename order. If `.pm/workflows/list/` exists, same-named files there override defaults. Execute each step in order — step 01 gathers data via the node script, step 02 is a prompt file that governs rendering and follow-up interpretation.

## Iron Law

**NEVER MUTATE THE SURVEYED STATE.**

## Hard rules

- LIST IS READ-ONLY — never mutate session state, backlog entries, RFCs, or any file on disk. The skill surveys what exists; it does not create, move, or modify anything.
- Per-skill resume is preserved, not replaced. `/pm:list` shows what's in-flight and offers resume-hint commands; it never wraps or shadows `/pm:groom resume`, `/pm:dev resume`, `/pm:rfc resume`, or `/pm:think resume` — those remain the way work is picked up. `/pm:list` is the survey layer, not the resume layer.
- The emitter is the contract — gather data via `scripts/start-status.js --format list-rows` (step 01); never scan `.pm/` yourself. It owns runtime differences (Claude Code vs Codex), separate-repo path resolution, frontmatter edge cases, and the staleness tiers. Return the literal `ListRowsPayload`; render JSON only when the user explicitly asks.
- Honor the per-section cap with an "... and N more" overflow line. Missing data is visible data: emit a phase-less row as `(no phase)`, never drop it.

## Escalation Paths

- **User wants to resume a specific row:** Stop the projection and offer the row's `resumeHint` verbatim. Do not invoke it; let the user type it.
- **User wants to edit or ship:** "That's a write operation — try `/pm:dev`, `/pm:ship`, or `/pm:groom` directly."
- **User asks something the intent map doesn't cover:** Fall through to the escalation template in step 02 — never fabricate filter logic.
- **Empty repo:** Render one line: `No in-flight work found at {pmDir}. Try /pm:start.` Do not render four empty sections.

## Red Flags — Self-Check

- **"I can fix this stale row while listing it."** Stop and preserve the read-only boundary.
- **"A fresh scan is always better."** Use the cached payload until the user asks to refresh.
- **"Missing phase means omit the row."** Keep the row visible with the documented empty-state label.
- **"A custom filter is easy."** Use only the five supported intents or route the user elsewhere.

## Common Rationalizations

| Excuse | Reality |
|---|---|
| "Telemetry is not a meaningful write." | A read-only projection must not mutate project state at all. |
| "The emitter output is easy to recreate." | Reimplementation causes path and staleness drift. |

## Before Marking Done

- [ ] The shared emitter supplied the payload and no project file was mutated.
- [ ] Empty, missing, and malformed rows remained visible with useful guidance.
- [ ] Rendering caps, ordering, and follow-up intent gates passed.
