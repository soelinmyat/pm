---
type: backlog-issue
id: "PM-043"
title: "Stable dashboard port via project-path hashing"
outcome: "Users can bookmark and return to the PM dashboard without reconfiguring it after each session"
status: done
parent: null
children: []
labels:
  - "infrastructure"
  - "dx"
priority: medium
research_refs:
  - pm/research/stable-dashboard-port/findings.md
created: 2026-03-20
updated: 2026-03-20
---

## Outcome

Users can bookmark the PM dashboard URL and return to it across sessions without it breaking. Each project gets a stable, deterministic port derived from its directory path. Different projects get different ports, so simultaneous use works. The `PM_PORT` env var still works as an explicit override.

## Acceptance Criteria

1. Port is derived deterministically from the absolute project directory path using a hash mapped to the 3000-9999 range.
2. If the hashed port is occupied, auto-increment (+1, +2, ...) until a free port is found. When auto-increment fires, log a message: "Port {hashed_port} occupied, using {actual_port} instead" so the user knows why their bookmarked port shifted.
3. `PM_PORT` env var overrides the hash when set (existing behavior preserved).
4. `start-server.sh` always passes `CALLER_DIR` as `PM_PROJECT_DIR` to `server.js` — both when `--project-dir` is provided (uses `PROJECT_DIR`) and when it is not (uses `CALLER_DIR`). This is required because `cd "$SCRIPT_DIR"` on line 104 moves cwd to `scripts/` before launching node.
5. Port resolution (hash + probe) happens inside `startServer()`, not at module scope. The current `const PORT = ...` on line 76 is synchronous and module-level; the async port probe requires computing the port inside `startServer()` before calling `server.listen()`.
6. Both `server.listen()` callsites (dashboard mode ~line 3342 and companion mode ~line 3418) use the async-resolved port.
7. When `PM_PROJECT_DIR` is unset (direct `node server.js` invocation outside of `start-server.sh`), fall back to `process.cwd()` at Node startup time. This fallback only applies to direct invocations — the normal `start-server.sh` launch path always sets `PM_PROJECT_DIR` per AC 4.
8. Server-started JSON continues to print the actual bound port (already works via `address.port`). The `"url"` field format is `"http://localhost:{PORT}"` (already emitted on lines 3347 and 3423, must not regress).
9. Unit tests cover `hashProjectPort(dir)` for determinism (same input → same port) and range bounds (output always in 3000-9999), and the port probe for collision fallback (occupied port → next available). Existing server tests continue to pass with no modifications to the `PM_PORT = '0'` test setup.

## User Flows

N/A — no user-facing workflow for this feature type.

## Wireframes

N/A — no user-facing workflow for this feature type.

## Competitor Context

In the dev tool world, the default port is part of a tool's identity — Vite owns 5173, Storybook owns 6006, Next.js owns 3000. Developers form muscle memory around these ports. PM's random ephemeral port breaks this expectation and is the only tool in its class that does so.

PM is also the only tool in its competitive set (vs. ChatPRD, Productboard Spark, PM Skills Marketplace) that offers a local, browser-accessible dashboard at all. Competitors are either cloud SaaS or stateless CLI plugins. The stable port matters precisely because this local dashboard is an architectural differentiator — unreliable access (random ports, broken bookmarks) undermines the feature's value.

The current port range (49152-65535) falls in the OS ephemeral range, which macOS and Windows use for outbound TCP connections. This creates collision risk beyond just other dev servers. Moving to 3000-9999 aligns with where all established dev tools live.

## Technical Feasibility

**Verdict: Feasible as scoped.**

**Build-on:**
- `scripts/server.js:1` — `crypto` module already imported, can be used for hashing
- `scripts/server.js:76` — `PM_PORT` override path already exists
- `scripts/server.js:3342-3351, 3418-3428` — Both `server.listen()` callsites already read back `address.port` and emit `"url"` field in server-started JSON
- `scripts/start-server.sh:22-59` — `--project-dir` argument already parsed; `CALLER_DIR` captured on line 19 before `cd`
- `tests/server.test.js:48-72` — Test harness exports `createDashboardServer()` and uses `PM_PORT = '0'`; note that tests call `.listen(0, ...)` directly, bypassing `startServer()` — new unit tests for hash/probe must test the exported functions independently

**Build-new:**
- `hashProjectPort(dir)` pure function in `server.js` — hash absolute path, map to 3000-9999 range, exported for unit testing
- Async port availability probe using `net` module (not currently imported in `server.js`)
- Port resolution moved inside `startServer()` — the current module-scope `const PORT` is synchronous and cannot accommodate the async probe. `startServer()` must compute the port before calling `server.listen()`
- `PM_PROJECT_DIR` env var pass-through in `start-server.sh` — always set from `CALLER_DIR` (or `PROJECT_DIR` when `--project-dir` is provided), in both foreground (line 118) and nohup (lines 128/130) `env ...` invocations
- Update `start-server.sh` line 6 comment from "random high port" to reflect deterministic behavior

**Key risks:**
- `cd "$SCRIPT_DIR"` on line 104 of `start-server.sh` changes cwd to `scripts/` before launching node. Without forwarding `PM_PROJECT_DIR`, all projects would hash to the same port. The env var pass-through is the critical prerequisite.
- `startServer()` sync-to-async promotion is the architectural crux — it affects a large function (~3430 lines in) and both listen callsites.

**Sequencing:**
1. Add `PM_PROJECT_DIR` pass-through in `start-server.sh` (always from `CALLER_DIR`)
2. Implement and export `hashProjectPort(dir)` in `server.js` with unit tests for determinism and range bounds
3. Add async port availability probe with `net` module and auto-increment, with unit test for collision fallback
4. Move port resolution inside `startServer()` and wire into both `server.listen()` callsites

## Research Links

- [Stable Dashboard Port Assignment](pm/research/stable-dashboard-port/findings.md)

## Notes

- The 3000-9999 range overlaps with popular dev tool ports (3000, 5173, 6006, 8080). The auto-increment probe handles this at runtime, but a user's "stable" port could shift if another dev server is occupying it. Acceptable tradeoff for single-user ICP.
- Hash collisions between projects are rare (~1/7000 for any two projects) and handled by auto-increment.
- **Deferred: strict mode.** Research found Vite (`strictPort`) and Storybook (`--exact-port`) offer error-on-collision as an opt-in for CI/bookmark workflows. `PM_PORT` already serves this role — setting it to a fixed value gives deterministic behavior. A dedicated `PM_STRICT_PORT` flag is unnecessary for the single-user ICP and can be added later if demand emerges.
- **Deferred: port lookup without launching.** The hash is deterministic from the project path, so a `pm port` command could show the port without starting the server. Deferred because you must launch the server to use the dashboard anyway — the port is shown at launch time.
- When `startServer()` becomes async, the `require.main === module` call site needs `.catch(err => { console.error(err); process.exit(1); })` to avoid silent unhandled rejections.
