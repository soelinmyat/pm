---
type: research
topic: "Stable dashboard port assignment"
created: 2026-03-20
---

# Stable Dashboard Port Assignment — Research Findings

## How Dev Tools Handle Port Assignment

Every major dev tool uses a **fixed default port** as its primary strategy. None use random ports. The pattern is universal: pick a memorable number, own it, and let users override when needed.

| Tool | Default Port | Override | Collision Behavior |
|---|---|---|---|
| **Vite** | 5173 | `--port`, `server.port` config | Auto-increments to next available port (configurable via `strictPort: true` to error instead) |
| **Next.js** | 3000 | `-p`, `--port`, `PORT` env var | Not documented; uses `PORT` env var convention |
| **webpack-dev-server** | 8080 | `--port`, `devServer.port` config | Supports `port: 'auto'` for automatic free port discovery |
| **Storybook** | 6006 | `-p`, `--port` | Auto-increments by default; `--exact-port` flag errors instead of fallback |
| **Angular CLI** | 4200 | `--port` | Not explicitly documented |
| **Astro** | 4321 | `--port` | Not documented |
| **Parcel** | 1234 | `-p`, `--port`, `PORT` env var | Not documented |
| **Hugo** | 1313 | `-p`, `--port` | Not documented |
| **Jupyter Notebook** | 8888 | `--port` | Auto-increments to next available port |
| **Create React App** | 3000 | `PORT` env var | Interactive prompt: "Something is already running on port 3000. Would you like to run on another port?" Uses `detect-port-alt` |

**Key insight:** The industry consensus is a fixed, memorable default port. No tool hashes the project path. No tool randomizes. The default port becomes part of the tool's identity (Vite = 5173, Storybook = 6006, Next.js = 3000).

## Port Collision Handling Patterns

Three distinct strategies exist, in order of popularity:

### 1. Auto-increment (most common)
Used by: Vite, Jupyter, Storybook (default behavior)

When the preferred port is occupied, try port+1, then port+2, etc. Pros: always starts. Cons: the actual port is unpredictable when collisions happen (but this is rare in practice — most developers run one project at a time).

### 2. Interactive prompt
Used by: Create React App

Detect the conflict, tell the user, ask permission to use the next available port. Pros: no surprise port changes. Cons: requires an interactive terminal (breaks in CI/headless environments).

### 3. Strict mode / error exit
Used by: Vite (`strictPort: true`), Storybook (`--exact-port`)

If the port is taken, exit with a clear error. Pros: deterministic, forces the user to resolve the conflict. Cons: blocks startup.

**Best practice composite:** Default to auto-increment with a clear console message showing the actual port. Offer a strict mode flag for users who need deterministic behavior (CI pipelines, bookmarks, scripts).

## Deterministic Port from Project Path

### No established npm package exists for this

There is no widely-adopted npm package that hashes a project directory path to a stable port number. The concept exists in discussions but has not crystallized into a standard library.

### The algorithm is trivial to implement

The pattern for "hash project path to port" is straightforward:

1. Take the absolute project directory path (e.g., `/Users/soelinmyat/Projects/pm`)
2. Compute a hash (FNV-1a, djb2, or even Node.js built-in `crypto.createHash('md5')`)
3. Map the hash to a port in the safe range: `(hash % rangeSize) + rangeStart`
4. If that port is occupied, increment until a free one is found

This produces a port that is **stable across launches** for the same project directory, but **different between projects** (avoiding collisions when running multiple projects simultaneously).

### Relevant npm packages for port availability checking

| Package | Weekly Downloads | What It Does |
|---|---|---|
| **get-port** (sindresorhus) | Very high | Finds available port. Supports preferred port list, port ranges via `portNumbers(from, to)`, and internal locking to prevent race conditions. No hashing. |
| **detect-port** (node-modules) | Very high | Tests if a port is available; returns alternative if occupied. Used by Create React App, Gatsby, Storybook, Egg.js. |
| **portfinder** (http-party) | Moderate (897 GitHub stars) | Sequential scan from base port (default 8000) upward until a free port is found. |

**Recommended approach:** Implement the hash-to-port function inline (5-10 lines), then use `get-port` or a simple `net.createServer().listen()` probe to verify availability before binding.

## Recommended Port Range

### IANA port classifications

| Range | Name | Notes |
|---|---|---|
| 0-1023 | Well-known / system ports | Require root/admin. Never use. |
| 1024-49151 | Registered / user ports | Where most dev tools live (3000-9000 subrange). IANA assigns these to specific services but they are usable without root. |
| 49152-65535 | Dynamic / ephemeral ports | OS uses these for outbound connections. The current PM server randomizes within this range. |

### Where dev tools actually live

Most dev tools cluster in the **1024-9999** range:
- 1234 (Parcel), 1313 (Hugo), 3000 (Next.js, CRA, Rails), 4200 (Angular), 4321 (Astro), 5173 (Vite), 6006 (Storybook), 8080 (webpack-dev-server), 8888 (Jupyter)

### Ephemeral port range is problematic

The current PM implementation uses `49152 + Math.floor(Math.random() * 16383)` — this falls squarely in the OS ephemeral port range. On modern systems:
- **Linux 2.4+**: ephemeral range is 32768-61000
- **macOS / BSD**: ephemeral range is 49152-65535
- **Windows Vista+**: ephemeral range is 49152-65535

Using the ephemeral range means the OS may have already allocated that port for an outbound TCP connection, increasing collision probability.

### Recommended range for PM dashboard

**3000-9999** — This is where all established dev tools live. It is:
- Above system ports (no root needed)
- Below the ephemeral range (no OS conflicts)
- Familiar to developers
- The "expected neighborhood" for local dev servers

A good default for PM specifically: something in the **7000-7999** range (sparsely used by major tools, memorable, safely in registered port territory). For hash-based assignment, use the range **3000-9999** (7000 ports of headroom).

## Customer/Community Evidence

### From PM's own codebase

The current implementation in `scripts/server.js:76` is:
```
const PORT = process.env.PM_PORT || (49152 + Math.floor(Math.random() * 16383));
```

This means:
1. Every launch gets a different port (bookmarks break)
2. The port falls in the OS ephemeral range (collision risk with OS-allocated outbound ports)
3. The `PM_PORT` env var override exists but requires manual setup per project

The original design doc (`.planning/2026-03-12-pm-plugin-design.md:445`) explicitly chose random high ports to "avoid conflicts if superpowers is also running." This was a reasonable v1 decision but trades away UX stability.

### No existing PM backlog items or research cover this topic

Searched `pm/research/` and `pm/backlog/` — no prior research or feature requests specifically address stable port assignment. The `dashboard-proposal-hero` backlog item mentions the dashboard URL being sharable but does not address port stability. The `public-hosted-demo-dashboard` backlog item discusses static export as a separate concern.

## Summary

1. **Every major dev tool uses a fixed default port.** Random ports are an anti-pattern for developer-facing tools. The port becomes part of the tool's identity and muscle memory.

2. **The standard collision pattern is auto-increment with messaging.** Try the preferred port, fall back to port+1, and tell the user what port was actually used. Offer a strict mode for CI/bookmark use cases.

3. **No npm package exists for "hash project path to port,"** but the algorithm is trivial (~5-10 lines). Hash the project directory path, map to a port in the 3000-9999 range, verify availability.

4. **The current PM port range (49152-65535) is the OS ephemeral range** and should be avoided. Dev tools live in 1024-9999.

5. **Recommended approach for PM:** Use a deterministic hash of the project directory to pick a stable port in the 3000-9999 range. Fall back to port+1 on collision. Display the chosen port clearly. Keep `PM_PORT` env var as an explicit override. This gives each project a stable, bookmarkable URL while handling the multi-project case gracefully.
