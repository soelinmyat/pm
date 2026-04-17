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

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution and interaction pacing.

Read `${CLAUDE_PLUGIN_ROOT}/references/writing.md` before generating any output.

## Iron Law

**LIST IS READ-ONLY.** Never mutate session state, backlog entries, RFCs, or any file on disk. The skill surfaces what exists; it does not create, move, or modify anything.

**Per-skill resume is preserved, not replaced.** `/pm:list` shows what's in-flight and offers resume-hint commands. It does **not** wrap or shadow `/pm:groom resume`, `/pm:dev resume`, `/pm:rfc resume`, `/pm:think resume` — those remain the way work is picked up. `/pm:list` is the *survey* layer, not the resume layer.

**When NOT to use:**
- User wants to start a new workflow (use `/pm:start`, `/pm:groom`, `/pm:dev`, etc.).
- User wants to resume a specific session (use the per-skill resume command directly).
- User is asking a question that has nothing to do with surveying in-flight work.

**Workflow:** `list` | **Telemetry steps:** `discover`, `render`.

**Steps:** Read all `.md` files from `${CLAUDE_PLUGIN_ROOT}/skills/list/steps/` in numeric filename order. If `.pm/workflows/list/` exists, same-named files there override defaults. Execute each step in order — step 01 gathers data via the node script, step 02 is a prompt file that governs rendering and follow-up interpretation.

## Red Flags — Self-Check

If you catch yourself thinking any of these, you're drifting off-skill:

- **"I'll just open the session file and keep working."** Stop. `/pm:list` is a survey. The user is deciding what to resume, not resuming yet.
- **"The backlog has 200 items — I'll dump them all."** No. Per-section cap; "... and N more" overflow line. The user asks to expand if they want more.
- **"I don't need to run the node script — I'll scan the directories myself."** No. The emitter is the contract. Runtime differences (Claude Code vs Codex) and separate-repo path resolution are handled by `scripts/start-status.js --format list-rows`.
- **"The user asked for JSON — I'll invent a format."** No. Return the literal payload from step 01. The shape is `ListRowsPayload`.

## Escalation Paths

- **User wants to resume a specific row:** Offer the row's `resumeHint` verbatim. Do not invoke it; let the user type it.
- **User wants to edit or ship:** "That's a write operation — try `/pm:dev`, `/pm:ship`, or `/pm:groom` directly."
- **User asks something the intent map doesn't cover:** Fall through to the escalation template in step 02 — never fabricate filter logic.
- **Empty repo:** Render one line: `No in-flight work found at {pmDir}. Try /pm:start.` Do not render four empty sections.

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "I can scan `.pm/` faster than spawning node" | The emitter handles separate-repo path resolution, frontmatter edge cases, and the staleness tiers. Reinventing it drifts. |
| "The user said 'show me,' so they want JSON" | No. The default render is sectioned text. JSON only when the user explicitly asks (`--json`, "give me the raw JSON," "emit JSON"). |
| "A row has no phase — I'll drop it" | No. Emit with `phase: active`, label `(no phase)`. Missing data is visible data. |

## Before Marking Done

- Four sections rendered (or single empty-repo line).
- Each rendered row has a non-empty `shortId` and `resumeHint`.
- Per-section cap honored; overflow line present when applicable.
- User's follow-up (if any) handled via the step-02 intent map, not ad-hoc logic.
