# Visual Reference

Standard for how skills invoke browser-based UI. The dashboard is the single hub for all visual content. Skills never open raw HTML files — they route through the dashboard.

---

## The Rule

**Never `open file.html`. Always use the dashboard.**

```
# Wrong — raw file open, no navigation, no context
open pm/backlog/proposals/{slug}.html

# Right — dashboard shows the artifact with full navigation
1. Ensure dashboard is running
2. Open http://localhost:{port}/proposals/{slug}
```

---

## Starting the Dashboard

Before opening any visual artifact, ensure the dashboard server is running.

```bash
# Start the dashboard (idempotent — skips if already running)
bash ${CLAUDE_PLUGIN_ROOT}/scripts/start-server.sh --project-dir "$PWD" --mode dashboard
```

Parse the returned JSON for the `url` and `port`. If the server is already running, the script returns the existing URL.

**Store the dashboard URL** in the session state file (`.pm/dev-sessions/{slug}.md` or `.pm/groom-sessions/{slug}.md`) so subsequent visual steps don't need to re-discover it.

---

## Dashboard Routes

All visual artifacts are viewable through dashboard routes. Skills open the appropriate route, not the raw file.

### Knowledge Base

| Route | Content | Used by |
|-------|---------|---------|
| `/kb?tab=research` | Landscape overview, positioning map, stats | research (landscape mode) |
| `/kb?tab=competitors` | Competitor profiles, feature matrix | research (competitor mode) |
| `/kb?tab=strategy` | Strategy document | strategy |
| `/kb?tab=topics` | Research topics and findings | research (topic mode) |

### Strategy

| Route | Content | Used by |
|-------|---------|---------|
| `/strategy-deck` | Strategy slide deck | strategy (deck generation) |

### Backlog & Proposals

| Route | Content | Used by |
|-------|---------|---------|
| `/proposals` | All proposals with verdict/status cards | groom (browsing) |
| `/proposals/{slug}` | Proposal detail — tabs: PRD, RFC, Issues | groom phase 7, dev |
| `/proposals/{slug}/rfc` | Direct link to RFC rendering | dev |
| `/backlog` | All proposals (parent items) with status progression | ideate, groom |
| `/backlog/wireframes/{slug}` | Wireframe preview | groom phase 5 |

### Sessions (planned — requires server changes)

| Route | Content | Used by |
|-------|---------|---------|
| `/session/{slug}` | Active session hub — links to all artifacts for the current discussion | groom, dev, brainstorming |
| `/companion/{session}` | Real-time mockup viewer for brainstorming | brainstorming (visual companion) |

---

## When to Show UI

Not every step needs the browser. The test: **does the user need to see a visual layout to make a decision?**

**Open the dashboard for:**
- Proposals (phase 7) — the terminal can't render a multi-section HTML PRD
- Wireframes — spatial layout needs visual rendering
- Strategy deck — slide-based content
- Positioning maps — bubble charts
- Research overview — when the user asks to review accumulated knowledge
- Brainstorming mockups — when comparing visual designs

**Stay in the terminal for:**
- Verdicts and review results — summary table is enough
- Strategy interview — text Q&A
- Scope definitions — bullet lists
- Research findings — markdown is fine
- Quick mode answers — short recommendations

**Don't ask permission to open the dashboard.** If the step produces visual output, open it. The user can ignore the browser tab if they don't need it.

---

## Standard Invocation Pattern

Every skill that shows visual content should follow this pattern:

```
1. Generate the artifact (write HTML/md to the correct path)
2. Ensure dashboard is running:
   bash ${CLAUDE_PLUGIN_ROOT}/scripts/start-server.sh --project-dir "$PWD" --mode dashboard
3. Open the dashboard route:
   open http://localhost:{port}/{route}
4. Tell the user:
   > "{Artifact name} ready — opening in dashboard."
   > File: `{path}`
```

**Example — groom proposal:**
```
1. Write pm/backlog/proposals/{slug}.html (PRD) + pm/backlog/{slug}.md (proposal entry)
2. Ensure dashboard running
3. open http://localhost:{port}/proposals/{slug}
4. > "Proposal for '{topic}' ready — opening in dashboard."
```

**Example — strategy deck:**
```
1. Write pm/strategy-deck.html
2. Ensure dashboard running
3. open http://localhost:{port}/strategy-deck
4. > "Strategy deck ready — opening in dashboard."
```

**Example — wireframe:**
```
1. Write pm/backlog/wireframes/{slug}.html
2. Ensure dashboard running
3. open http://localhost:{port}/backlog/wireframes/{slug}
4. > "Wireframe ready — opening in dashboard."
```

---

## Session Awareness (follow-up work)

The dashboard home (`/`) should show the active session with links to all its artifacts. This requires server changes:

1. **Active session detection:** Read `.pm/groom-sessions/*.md` and `.pm/dev-sessions/*.md`, find the most recently updated, display it as "Active Session" on the home page.
2. **Session hub route (`/session/{slug}`):** A dedicated page showing everything related to the current discussion — research findings, scope, wireframes, review verdicts, proposal.
3. **Companion integration:** Absorb the brainstorming companion mode into the dashboard as `/companion/{session}`. Same file-watching behavior, but accessible from the dashboard navigation.
4. **Dashboard link from terminal:** When skills print a dashboard URL, include the session-specific route when a session is active.

These server changes are tracked separately from this reference. Skills should follow the standard invocation pattern now — the routes will resolve correctly once the server is updated.

---

## Brainstorming Visual Companion

The companion is a special case — it serves real-time mockups during a conversation, not static artifacts.

**Current:** Runs as a separate server mode (`--mode companion`) with its own session directory and file-watching behavior. See `skills/brainstorming/visual-companion.md` for the detailed guide.

**Target:** The companion becomes a dashboard route (`/companion/{session}`). The dashboard watches the session directory for new HTML files and serves them with the frame template. Skills write mockup HTML fragments; the dashboard wraps and serves them.

**Until the server is updated:** Continue using the companion mode as documented. The migration to dashboard-integrated companion is part of the session awareness work above.
