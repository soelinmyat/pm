---
type: backlog-issue
id: "PM-090"
title: "SSE Event Bus Core — POST, Store, SSE, Port Discovery"
outcome: "Any process on the machine can push an event to the dashboard server and any browser tab can receive it in real-time — the event pipeline works end-to-end"
status: approved
parent: "sse-event-bus"
children: []
labels:
  - "infrastructure"
priority: high
research_refs:
  - pm/research/sse-event-bus/findings.md
created: 2026-03-31
updated: 2026-03-31
---

## Outcome

A terminal session (or any local process) can POST a JSON event to the dashboard server, and a browser tab connected via SSE receives it instantly. The event pipeline is validated end-to-end with curl — no UI needed yet.

## Acceptance Criteria

1. `POST /events` accepts a JSON body with fields: `type` (string, required), `source` (string, required), `timestamp` (number, required), `detail` (object, optional), `source_type` (string, optional, default "terminal").
2. `POST /events` returns 201 on success, 400 on missing required fields, 405 if not POST.
3. Events are stored in an in-memory ring buffer capped at 200 events. Oldest events are evicted when the buffer is full.
4. `GET /events` returns `Content-Type: text/event-stream` with `Cache-Control: no-cache` and `Connection: keep-alive`.
5. Each SSE message uses the format `id: {incrementing-id}\ndata: {json}\n\n`.
6. A heartbeat comment (`: keepalive\n\n`) is sent every 15 seconds to prevent proxy/browser timeout.
7. On reconnect, if the client sends `Last-Event-ID`, the server replays missed events from the ring buffer.
8. SSE connections are tracked in the existing `allConnections` set and properly destroyed on `server.close()`.
9. A port discovery script (`scripts/find-dashboard-port.sh`), given a project directory, outputs the port where the dashboard server is listening and returns exit code 0. If no server is running on that port, it outputs nothing to stdout and returns exit code 1.
10. The port is derived from the project directory path using the same hashing algorithm as `scripts/start-server.sh` lines 119-123 (not hardcoded or discovered via port scanning). The script reuses the existing shell hash logic from `start-server.sh`.

## User Flows

N/A — infrastructure endpoint, validated via curl.

## Wireframes

N/A — no user-facing UI in this issue.

## Competitor Context

OpenCode (SST) validates this exact pattern at production scale: SSE event bus with typed events, POST ingestion, multi-client subscription. OpenCode uses two event scopes (instance + global) for multi-project sync — PM deliberately uses single-scope (per-project) because PM scopes to one project directory. This is a design choice, not a limitation. PM adapts the architecture for product lifecycle events rather than coding agent state sync. The port discovery utility has no competitor parallel — no profiled tool can discover a running dashboard server from a terminal session.

## Technical Feasibility

**Build-on:**
- `scripts/server.js` line 3760-3765: dashboard HTTP handler currently returns 405 for non-GET. Expand method check for POST.
- `scripts/server.js` line 1294: `routeDashboard` already handles 15+ routes. Add `GET /events` as one more.
- `scripts/server.js` line 3753: `broadcastDashboard` pattern (iterate Set, write to each) applies to SSE broadcast.
- `scripts/server.js` line 3842-3855: `server.close` override needs SSE connection cleanup.
- `scripts/start-server.sh` line 119-123: port hashing logic duplicated in shell for `find-dashboard-port.sh`.

**Build-new:** POST handler with body parsing, in-memory ring buffer (capped array), SSE response handler with connection tracking, heartbeat timer, event ID tracking + replay, port discovery shell script.

**Risks:** SSE connections held open must be tracked in `allConnections` or `server.close()` will hang. Two real-time channels (WebSocket + SSE) to the same browser — WebSocket reload kills SSE, which auto-reconnects via EventSource.

**Sequencing:** First issue — everything else depends on this.

## Scope Note

Covers in-scope items: SSE endpoint, POST endpoint, event schema, port discovery utility.

## Decomposition Rationale

Workflow Steps pattern: this is the first pipeline stage (ingest + store + stream). Validated independently with curl before any UI is built.

## Research Links

- [SSE Event Bus + Activity Feed Patterns](pm/research/sse-event-bus/findings.md)

## Notes

- No authentication on POST — any local process can inject events. Acceptable for localhost-only server.
- In-memory only — events lost on server restart. Disk persistence deferred to follow-on.
