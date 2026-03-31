# PM-062: Dashboard Session Links + Groom Session Cleanup

> **For agentic workers:** REQUIRED SUB-SKILL: Use dev:subagent-dev to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make groom session banners on the dashboard home page link to `/session/{slug}` when a companion directory exists, and clean up `.pm/sessions/groom-{slug}/` after Phase 6 completes.

**Architecture:** Two independent changes: (1) the session banner template in `handleDashboardHome()` conditionally checks for `.pm/sessions/groom-{slug}/` before rendering the `<a href>`, and (2) Phase 6 skill markdown gains a cleanup step that deletes the companion directory after issues are created.

**Tech Stack:** Node.js (scripts/server.js), Markdown (skills/groom/phases/phase-6-link.md)

---

## Current State

What **already works** (no changes needed):

| AC | Feature | Location |
|----|---------|----------|
| AC2 | Groom session banner renders topic, phase, date | server.js:2097-2122 |
| AC5 | State file `.pm/groom-sessions/{slug}.md` cleaned up by Phase 6 step 8 | phase-6-link.md:115 |

What **needs building:**

| AC | Gap | Task |
|----|-----|------|
| AC1 | Banner always links to `/session/{slug}` — should only link when companion dir exists | Task 1 |
| AC2 | No-companion sessions should render without a link | Task 1 |
| AC3 | Phase 6 does not delete `.pm/sessions/groom-{slug}/` | Task 2 |
| AC4 | Phase 6 should skip cleanup silently if companion dir doesn't exist | Task 2 |

---

## Task 1: Conditional Session Link in Dashboard Home Banner

**Files:**
- Modify: `scripts/server.js:2097-2122` (groom session banner in `handleDashboardHome`)
- Test: `scripts/validate.js` (existing validation)

The groom session banner currently wraps every session in `<a href="/session/{slug}">` unconditionally (line 2100-2110). Per AC1, the link should only appear when `.pm/sessions/groom-{slug}/` exists. When it doesn't exist (AC2), render the same content but as a `<div>` instead of an `<a>`.

- [ ] **Step 1: Add companion directory existence check**

In `scripts/server.js`, inside the `allSessions.map()` callback at line 2099, for the `s._type === 'groom'` branch (line 2102), add a check for the companion directory before building the HTML. Replace the groom branch (lines 2102-2110):

```js
      if (s._type === 'groom') {
        const d = groomSessionDisplay(s);
        const companionDir = path.resolve(pmDir, '..', '.pm', 'sessions', 'groom-' + (s._slug || ''));
        const hasCompanion = s._slug && fs.existsSync(companionDir);
        const tag = hasCompanion ? 'a' : 'div';
        const hrefAttr = hasCompanion ? ` href="${link}"` : '';
        return `<${tag}${hrefAttr} class="groom-session">
  <div class="groom-session-dot" style="background:#2563eb"></div>
  <div>
    <div class="groom-session-topic">${d.topic}</div>
    <div class="groom-session-meta">Grooming · Phase: ${d.phase} · Started ${d.started}</div>
  </div>
</${tag}>`;
      }
```

Key points:
- `companionDir` resolves to `.pm/sessions/groom-{slug}/` relative to the project root (one level up from `pmDir`).
- When `hasCompanion` is true, renders `<a href="/session/{slug}">` (clickable link).
- When `hasCompanion` is false, renders `<div>` (no link, same visual as today).
- The `class="groom-session"` stays on both tags so styling is preserved.
- Dev sessions are unaffected — they keep their existing `<a>` link.

- [ ] **Step 2: Run validation**

```bash
node /Users/soelinmyat/Projects/pm/scripts/validate.js --dir "$PWD/pm"
```

Expected: PASS. This is a template change — validation covers frontmatter, not HTML rendering.

- [ ] **Step 3: Manual verification**

Start the dashboard with an active groom session and verify:
1. Session WITH `.pm/sessions/groom-{slug}/` directory: banner topic is a clickable link to `/session/{slug}`.
2. Session WITHOUT companion directory: banner renders identically to today (no link, just text).

- [ ] **Step 4: Commit**

```bash
git add scripts/server.js
git commit -m "feat: conditional session link in dashboard banner (PM-062 AC1+AC2)"
```

---

## Task 2: Phase 6 Companion Directory Cleanup

**Files:**
- Modify: `skills/groom/phases/phase-6-link.md:115` (after step 7, before step 8)

Phase 6 currently deletes `.pm/groom-sessions/{slug}.md` in step 8. Per AC3, we add a new step before that to delete `.pm/sessions/groom-{slug}/` (the companion screen directory). Per AC4, the cleanup is conditional and silent. Per AC5, the state file is NOT touched by this step.

- [ ] **Step 1: Add companion cleanup step to Phase 6**

In `skills/groom/phases/phase-6-link.md`, insert a new step between the current step 7 (automated learning extraction) and step 8 (state file cleanup). Renumber the old step 8 to step 9. Add after the current step 7:

```markdown
8. **Clean up companion directory.** If the visual companion was active, delete the screen directory to prevent stale files from accumulating:

   ```bash
   COMPANION_DIR="${CLAUDE_PROJECT_DIR:-$PWD}/.pm/sessions/groom-{slug}"
   if [ -d "$COMPANION_DIR" ]; then
     rm -rf "$COMPANION_DIR"
   fi
   ```

   - Replace `{slug}` with the session's actual slug.
   - This deletes only the companion screen directory (`.pm/sessions/groom-{slug}/`), NOT the state file (`.pm/groom-sessions/{slug}.md`).
   - If the directory does not exist (companion was never activated), this step does nothing.
   - This step is silent — no user prompt, no output.
```

Then renumber the old step 8 ("Clean up") to step 9:

```markdown
9. **Clean up.** Delete `.pm/groom-sessions/{slug}.md` after the retro and extraction complete (or are skipped). Grooming for this topic is complete.
```

- [ ] **Step 2: Verify skill markdown is well-formed**

Read the modified file to confirm step numbering is sequential (1-9) and no duplicate step numbers exist.

- [ ] **Step 3: Commit**

```bash
git add skills/groom/phases/phase-6-link.md
git commit -m "feat: Phase 6 companion directory cleanup (PM-062 AC3+AC4)"
```

---

## Implementation Order

1. **Task 1** — Conditional link in dashboard banner (server.js)
2. **Task 2** — Phase 6 cleanup step (skill markdown)

Tasks are independent — they modify different files and can be implemented in either order. Task 1 is server-side rendering logic; Task 2 is skill instructions.

---

## Files Changed

| File | Change |
|------|--------|
| `scripts/server.js:2102-2110` | Replace unconditional `<a>` with conditional `<a>`/`<div>` based on companion dir existence |
| `skills/groom/phases/phase-6-link.md:115` | Insert companion dir cleanup step (new step 8), renumber old step 8 to 9 |

---

## Risks

- **`fs.existsSync` on every banner render.** One sync stat call per groom session on the home page. Negligible — typically 0-3 active sessions.
- **Companion dir deleted while session tab is open.** The user sees the last-rendered HTML (already loaded in browser). Next refresh hits the state-file fallback view. Acceptable — session is complete.
- **Race between Phase 6 cleanup and dashboard render.** Extremely narrow window. If the dir is deleted mid-render, the banner simply renders without a link. No error.
