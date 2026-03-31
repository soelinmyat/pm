---
type: topic-research
topic: "SSE Event Bus + Activity Feed Patterns"
created: 2026-03-31
updated: 2026-03-31
source_origin: external
sources:
  - url: https://deepwiki.com/sst/opencode/2.8-storage-and-migration-system
    accessed: 2026-03-31
  - url: https://cefboud.com/posts/coding-agents-internals-opencode-deepdive/
    accessed: 2026-03-31
  - url: https://github.com/anomalyco/opencode/issues/11616
    accessed: 2026-03-31
  - url: https://ui-patterns.com/patterns/ActivityStream
    accessed: 2026-03-31
  - url: https://www.aubergine.co/insights/a-guide-to-designing-chronological-activity-feeds
    accessed: 2026-03-31
  - url: https://linear.app/changelog/2025-04-16-pulse
    accessed: 2026-03-31
  - url: https://blog.logrocket.com/ux-design/toast-notifications/
    accessed: 2026-03-31
  - url: https://benrajalu.net/articles/ux-of-notification-toasts
    accessed: 2026-03-31
  - url: https://carbondesignsystem.com/patterns/notification-pattern/
    accessed: 2026-03-31
  - url: https://vercel.com/docs/notifications
    accessed: 2026-03-31
  - url: https://vercel.com/docs/projects/project-dashboard
    accessed: 2026-03-31
  - url: https://grafana.com/oss/loki/
    accessed: 2026-03-31
  - url: https://www.freecodecamp.org/news/server-sent-events-vs-websockets/
    accessed: 2026-03-31
  - url: https://softwaremill.com/sse-vs-websockets-comparing-real-time-communication-protocols/
    accessed: 2026-03-31
---

# SSE Event Bus + Activity Feed Patterns

## Summary

OpenCode is the strongest architectural precedent: it uses SSE with a centralized event bus to sync state across TUI, browser, and VS Code clients in real time. Activity feed patterns converge on actor-verb-object structure with event grouping and reverse chronological order. Toast notifications should be reserved for low-priority confirmations (3-5 seconds, auto-dismiss) — never for critical errors.

## Findings

### 1. OpenCode's SSE Event Bus — closest architectural match

OpenCode (by SST) implements exactly the pattern PM-088 needs. Its server runs on Hono/Bun and broadcasts typed events via SSE to all connected clients.

- **Event types:** `tool-call`, `tool-result`, `text-delta`, `step-finish`, `session.created`, `message.updated`
- **Two scopes:** Instance events (per-project directory) and global events
- **SSE endpoints:** `/event` for project-scoped, `/global/event` for system-wide, `/global/sync-event` for versioned sync
- **Heartbeat:** Every 10 seconds to keep proxy connections alive
- **Multi-client:** TUI, browser, and VS Code all subscribe to the same event bus. Any client sees consistent state.
- **SyncProvider:** Client-side reactive mirror of server state. Subscribes to SSE, applies events to local stores.
- **Publish flow:** Backend publishes via `Bus.publish(Event, payload)` → PubSub distributes → GlobalBus relays → SSE pushes to clients

**Key takeaway:** SSE + centralized bus + typed events + multi-client subscription is proven at production scale in a coding agent tool.

### 2. Activity Feed UX Patterns

Activity feeds follow a standard structure across developer tools (Linear Pulse, Vercel, Grafana).

- **Structure:** Actor-verb-object-context. Example: "Terminal 1 completed PR review (pm-plugin) [via pm:ship]"
- **Order:** Reverse chronological (newest first)
- **Grouping:** Aggregate similar events within a time window. Linear collapses similar consecutive events and groups older activity between comment threads.
- **Filtering:** By event type, source, or time range. Essential for feeds with high event volume.
- **Read/unread:** Visual indicators for new items. Mark individually or in bulk.
- **Icons:** Each event type gets a distinct icon for scannability.

**Linear Pulse** is the strongest UX precedent:
- Three views: "For me" (subscribed), "Popular" (company-wide), "Recent" (chronological)
- AI-powered daily/weekly digests with audio playback
- Scoped by user subscriptions, not showing everything
- Real-time event-driven updates

**For PM's use case:** The feed is simpler — events from terminal sessions in the same project. No cross-org scoping needed. One chronological list with event type filtering.

### 3. Toast Notification Best Practices

Research from LogRocket, Carbon Design System, and UX practitioners converges on clear rules.

**When to use toasts:**
- Action confirmations ("PR created", "Tests passed")
- Low-priority status updates ("Build started")
- Secondary actions ("View logs" after deploy)

**When NOT to use toasts:**
- Critical errors (use inline/persistent notifications)
- Complex information (use modals or dedicated pages)
- Any message requiring user action to resolve

**Design rules:**
- Duration: 3-5 seconds. 500ms per word + 1s buffer. Max ~10 words.
- Placement: Bottom-right (standard) or top-right
- Auto-dismiss without user action
- Subtle slide-in animation. Respect `prefers-reduced-motion`.
- Neutral styling — avoid false urgency with aggressive colors
- Queue multiple toasts without overlapping
- No interactive elements in auto-dismissing toasts (WCAG violation)

**Carbon Design System taxonomy** (IBM):
- **Toast:** System-generated, slides in/out, auto-dismisses. For messages not tied to a specific UI section.
- **Inline:** Persists until dismissed. For contextual messages tied to a specific area.
- **Actionable:** Contains buttons/links. Gets focus. More disruptive.
- **Banner:** Page-level persistent message. For system-wide status.

**For PM's use case:** Toast for event confirmations (PR created, tests passed). Inline for persistent status (build in progress). No need for actionable or banner types initially.

### 4. Multi-Source Event Aggregation

Grafana Loki provides the strongest pattern for multi-source aggregation.

- **Label-based indexing:** Events tagged with source labels, available within milliseconds
- **Pattern detection:** Groups similar events automatically in real time
- **Multi-source:** Accepts events from any source via HTTP API push
- **Push model:** Agents scrape/generate events, push to central server via HTTP POST

**Vercel Dashboard:**
- Real-time notification feed via WebSockets
- Multiple notification channels (dashboard, email, push)
- AI-powered anomaly investigation on alert triggers

**For PM's use case:** Terminal sessions POST events to the dashboard server. The server stores them, pushes to the browser via SSE. Label each event with terminal session ID for filtering.

### 5. SSE vs WebSocket — recommendation confirmed

Prior research (pm/research/groom-visual-companion/) already recommended SSE. New findings reinforce this.

- **SSE wins for PM's use case:** Unidirectional (server → browser), automatic reconnection, works through corporate firewalls, simpler than WebSocket
- **OpenCode validates SSE at scale:** Production coding agent using SSE for all real-time sync
- **WebSocket only needed if:** Browser needs to send data back on the same connection. PM's activity feed is read-only in the browser — terminal handles all interaction.
- **PM already has WebSocket:** server.js uses WebSocket for reload broadcast. SSE would coexist, not replace.

### 6. SEO Demand Signal

Zero search volume for all tested keywords: "sse event bus", "server sent events dashboard", "real-time activity feed developer tools", "multi-terminal dashboard", "cli activity feed", "developer dashboard notifications". This is infrastructure, not a user-facing feature users search for.

## Strategic Relevance

Supports priority #1 (groom-to-dev handoff quality): a live activity feed shows groomed issue progress across terminals in real time.

Supports priority #2 (depth of product context): event aggregation from all sessions enriches the dashboard as the central project view.

No non-goal conflicts. This is internal workflow infrastructure, not analytics, enterprise PM, or a standalone platform.

## Implications

- **Build on OpenCode's pattern.** SSE event bus with typed events, POST endpoint for terminal-to-server push, SSE endpoint for server-to-browser push. PM already has the server infrastructure (server.js).
- **Activity feed is a list, not a dashboard.** Reverse chronological, with event type icons and terminal session labels. Keep it simple — no filtering UI in v1, just the feed.
- **Toast for celebrations, not for everything.** Reserve toasts for milestone events (PR created, tests passed, review done). Don't toast every tool call or phase transition.
- **Port discovery is a shell utility.** Skills need to find the running dashboard server port. The stable port hashing (hashProjectPort) already exists — expose it as a lightweight lookup function.
- **No new dependencies.** SSE is native HTTP. Node's `http` module handles it. PM already has the server.

## Open Questions

1. **Event retention:** How long should events persist? In-memory only (lost on server restart) or written to disk (`.pm/events.jsonl`)?
2. **Event schema:** What fields? Minimum: `type`, `source` (terminal session ID), `timestamp`, `detail`. Should it match OpenCode's typed event pattern?
3. **Feed pagination:** If events accumulate, should the feed paginate or auto-truncate to last N events?
4. **Cross-project events:** Should the event bus be scoped to one project (current behavior) or aggregate across projects?

## Source References

- https://deepwiki.com/sst/opencode/2.8-storage-and-migration-system — accessed 2026-03-31
- https://cefboud.com/posts/coding-agents-internals-opencode-deepdive/ — accessed 2026-03-31
- https://linear.app/changelog/2025-04-16-pulse — accessed 2026-03-31
- https://blog.logrocket.com/ux-design/toast-notifications/ — accessed 2026-03-31
- https://carbondesignsystem.com/patterns/notification-pattern/ — accessed 2026-03-31
- https://ui-patterns.com/patterns/ActivityStream — accessed 2026-03-31
- https://www.aubergine.co/insights/a-guide-to-designing-chronological-activity-feeds — accessed 2026-03-31
- https://vercel.com/docs/notifications — accessed 2026-03-31
- https://grafana.com/oss/loki/ — accessed 2026-03-31
- https://www.freecodecamp.org/news/server-sent-events-vs-websockets/ — accessed 2026-03-31
- https://softwaremill.com/sse-vs-websockets-comparing-real-time-communication-protocols/ — accessed 2026-03-31
