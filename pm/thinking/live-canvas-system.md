---
type: thinking
topic: "Live Canvas System"
slug: "live-canvas-system"
created: 2026-04-01
status: promoted
promoted_to: "live-canvas-system"
---

# Live Canvas System

## Problem

The dashboard is becoming an always-on operation hub (auto-launch, pulse score, activity feed). But the agent still communicates primarily through the terminal. Rich work products (scope grids, review verdicts, issue drafts, flow diagrams) are either dumped as text in the terminal or written as static HTML snapshots. There's no live workspace where the user watches the agent's work form in real-time.

## Direction

**Multi-canvas system with lifecycle management.** Each agent session (groom, dev, research, etc.) gets its own live canvas on the dashboard. The canvas updates in real-time as the agent works. Users navigate between active canvases.

### Core design principle: conversational vs ambient

- **Terminal** = conversational. Needs attention, may need a response. Decisions, questions, short status lines.
- **Dashboard canvas** = ambient. Rich work product forming in real-time. Scope tables, review verdicts, wireframes, issue cards, flow diagrams. The user's peripheral vision.
- **The agent doesn't check if the dashboard is open.** It always pushes to both surfaces. Terminal stays self-sufficient. Dashboard adds richness when visible.

### Canvas lifecycle

| State | Trigger | Dashboard behavior |
|-------|---------|-------------------|
| Created | Agent starts a skill session | Canvas appears in sidebar/tab bar |
| Active | Agent is working | Canvas updates in real-time via SSE |
| Idle | Agent waiting for input | Canvas shows last state, idle indicator |
| Completed | Session done | Canvas becomes read-only artifact |
| Archived | User dismisses or time passes | Canvas collapses into activity timeline |

### Canvas scoping

One canvas per agent session:
- Groom session → groom canvas (phases, scope, issues forming)
- Dev session → dev canvas (plan, test results, PR status)
- Research session → research canvas (findings appearing)
- Each canvas is identified by session slug

### Navigation

- Dashboard sidebar shows list of active canvases (like browser tabs)
- Click to switch. Active canvas fills the main content area.
- Completed canvases accessible from a "Recent" section
- Home page shows canvas count in stat cards

### Update mechanism (Phase 1: HTML streaming)

- Agent writes HTML fragments to `.pm/sessions/{type}-{slug}/current.html`
- Agent emits SSE event `{ type: "canvas_update", slug: "{slug}", phase: "{phase}" }`
- Dashboard watches for SSE canvas_update events and hot-reloads the iframe/content area
- This is the current groom companion pattern, generalized to all skills

### Update mechanism (Phase 2: structured components — future)

- Agent emits typed data events: `{ type: "scope_grid", data: { in_scope: [...], out_scope: [...] } }`
- Dashboard has a component library: ScopeGrid, IssueCard, FlowDiagram, ReviewVerdict, etc.
- Components render from structured data, ensuring visual consistency
- Migrate skill by skill once HTML streaming proves the interaction patterns

## Key tradeoffs

- **HTML streaming first:** faster to ship, each skill controls its own rendering, but risks visual inconsistency across canvases. Acceptable tradeoff — consistency matters less than proving the interaction model.
- **No awareness check:** agent doesn't know if dashboard is open. Simpler protocol, but means SSE events and file writes happen even when nobody's watching. Acceptable — the overhead is trivial (small JSON events + occasional HTML file writes).
- **One canvas per session:** no split-screen or multi-pane within a canvas. Keeps the model simple. A groom canvas shows one phase at a time, not all phases simultaneously.

## Open questions

- Should completed canvases auto-archive after N hours, or persist until explicitly dismissed?
- How does the canvas interact with the activity feed? Does the feed show "canvas updated" events, or is the canvas its own surface that replaces the feed's role during active work?
- When the user is in a terminal groom session and clicks an idea on the dashboard, should that trigger a groom start? (This touches the Quick Actions idea — #7 from ideation.)

## Next step

Groom this into issues. The MVP is: generalize the groom companion to a canvas system, add canvas lifecycle + sidebar navigation, emit canvas_update SSE events from all skills.
