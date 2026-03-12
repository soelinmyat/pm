---
type: research-findings
topic: "Groom Visual Companion Patterns"
created: 2026-03-22
updated: 2026-03-22
sources:
  - https://www.chatprd.ai/
  - https://www.chatprd.ai/resources/ai-agents-product-management-integrations-tools
  - https://www.productboard.com/product/spark/
  - https://www.productboard.com/blog/introducing-spark-ai-product-management-agent/
  - https://kiro.dev/
  - https://thenewstack.io/aws-kiro-testing-an-ai-ide-with-a-spec-driven-approach/
  - https://every.to/chain-of-thought/compound-engineering-how-every-codes-with-agents
  - https://every.to/guides/compound-engineering
  - https://github.com/FoundationAgents/MetaGPT
  - https://docs.deepwisdom.ai/main/en/guide/get_started/introduction.html
  - https://foundationagents.org/projects/metagpt-x/
  - https://browsersync.io/
  - https://docs.jupyter.org/en/latest/projects/architecture/content-architecture.html
  - https://jupyter-server.readthedocs.io/en/latest/developers/architecture.html
  - https://docs.expo.dev/debugging/devtools-plugins/
  - https://docs.expo.dev/debugging/tools/
  - https://playwright.dev/docs/test-ui-mode
  - https://playwright.dev/docs/trace-viewer
  - https://docs.astro.build/en/guides/dev-toolbar/
  - https://devtools.nuxt.com/
  - https://v0.app
  - https://vercel.com/blog/introducing-the-new-v0
  - https://storybook.js.org/docs/get-started/frameworks/nextjs-vite
  - https://webpack.js.org/configuration/dev-server/
  - https://evilmartians.com/chronicles/cli-ux-best-practices-3-patterns-for-improving-progress-displays
  - https://www.freecodecamp.org/news/server-sent-events-vs-websockets/
  - https://softwaremill.com/sse-vs-websockets-comparing-real-time-communication-protocols/
  - https://www.smashingmagazine.com/2018/02/sse-websockets-data-flow-http2/
  - https://code.claude.com/docs/en/overview
---

# Groom Visual Companion Patterns

## How Competitors Handle This

### ChatPRD
ChatPRD is a **browser-only** product. It operates as a web platform where PMs converse with an AI to generate PRDs, user stories, and specs. There is no CLI or terminal component. ChatPRD integrates outward via one-click export to Linear, Notion, Confluence, and Google Docs, plus an MCP integration for feeding PRDs into coding agents like Windsurf. No split terminal+browser experience exists.

### Productboard Spark
Productboard Spark (launched publicly January 2026) is an **AI-first web interface** positioned as a conversational product management agent. It is entirely browser-based with a chat-driven UI layered on top of Productboard's existing product management platform. Spark has context-native intelligence (it knows your product landscape, remembers collaborative work), but offers no terminal or CLI access. No split experience.

### Kiro (AWS)
Kiro is an **IDE-based tool**, not a terminal+browser split. It is a VS Code fork that acts as an agentic IDE with spec-driven development (requirements.md, design.md, tasks.md). Kiro also ships a CLI mode, but the visual output lives inside the IDE editor panes, not in a separate browser. The closest it gets to a "companion" is generating markdown spec files that appear as editor tabs alongside code. No browser companion pattern.

### Compound Engineering (Every.to)
Compound Engineering is a **methodology**, not a product with a visual interface. It uses Claude Code, Factory's Droid, and OpenAI Codex CLI as underlying tools. The workflow is entirely terminal/agent-based: plan, work, review, compound. All interaction happens through terminal prompts, markdown files, and git. No browser companion exists. The 80/20 split (planning+review vs. coding) is managed through text artifacts, not visual tools.

### MetaGPT
MetaGPT is a **Python framework** that orchestrates multi-agent workflows via CLI. Its latest version, MetaGPT X (MGX, launched February 2025), introduced real-time visualization of inter-agent communication as a web dashboard. Agents can also generate Streamlit or Gradio prototypes from user flows. This is the **closest competitor pattern to a browser companion**: the CLI runs agents while a web UI shows workflow progress and agent outputs in real time. However, the visualization is focused on agent orchestration, not on presenting structured product documents phase-by-phase.

### Summary
No competitor in the AI PM space offers a deliberate terminal+browser split for grooming. The pattern is either fully browser-based (ChatPRD, Productboard Spark), fully IDE-based (Kiro), fully terminal-based (Compound Engineering), or framework-level with optional visualization (MetaGPT X). This represents a clear whitespace opportunity for PM.

---

## Browser Companion Patterns in Dev Tools

Several established developer tools use the pattern of a CLI starting a local server and opening a browser companion. These are the most relevant precedents:

### Storybook
- CLI command (`npx storybook dev`) starts a local dev server and opens a browser UI.
- Browser shows an interactive component explorer with a sidebar, canvas, and controls panel.
- Hot Module Replacement via Vite ensures real-time updates as code changes.
- The terminal handles build output, errors, and logs; the browser handles visual rendering.
- **Pattern**: CLI starts server, browser shows structured visual output, file watching triggers updates.

### Vite / webpack-dev-server
- `vite dev` or `webpack serve` starts a local server and opens the browser automatically.
- A WebSocket connection between server and browser enables Hot Module Replacement.
- The server watches files, detects changes, and pushes granular updates to the browser without full page reload.
- **Pattern**: WebSocket channel from CLI server to browser for real-time partial updates.

### Jupyter Notebook
- `jupyter notebook` starts a Tornado-based HTTP server and opens a browser.
- The browser is the primary interface; the terminal is just the server log.
- Communication uses WebSocket over ZeroMQ for kernel-browser sync.
- Architecture: browser and kernel cannot talk directly; the Jupyter server is the communication hub.
- Multiple frontends (browser, terminal) can connect to the same kernel simultaneously.
- **Pattern**: Server as communication hub, WebSocket for real-time bidirectional sync, multi-frontend support.

### Playwright
- Tests run in the terminal via `npx playwright test`.
- `--ui` flag launches a browser-based UI Mode for debugging: walk through each test step, see DOM snapshots before/during/after actions.
- `npx playwright show-report` opens an HTML report in the browser after tests complete.
- Trace Viewer provides a visual timeline of test execution with screenshots.
- **Pattern**: Terminal runs the process, browser shows rich visual report; two distinct modes (live UI vs. post-run report).

### Expo (React Native)
- `npx expo start` runs in terminal; pressing `j` opens React Native DevTools in browser.
- Pressing `shift+m` opens a list of available dev tools plugins.
- Terminal shows logs and build output; browser shows component inspector, profiler, network tab.
- **Pattern**: Terminal as control center with keyboard shortcuts to toggle browser tools.

### Astro Dev Toolbar
- `astro dev` starts a dev server; the browser shows the site with an embedded dev toolbar overlay at the bottom.
- The toolbar provides debugging tools, performance audits, and inspection directly in the browser.
- The toolbar is extensible via a Dev Toolbar API for custom plugins.
- **Pattern**: Browser companion is an overlay within the rendered output, not a separate window.

### Nuxt DevTools
- Embedded browser panel that appears during development.
- Communicates with the dev server via a dedicated WebSocket connection.
- Shows component tree, route visualization, module dependencies, and performance data.
- **Pattern**: WebSocket-based real-time sync between dev server and browser-embedded panel.

### Browsersync
- CLI command starts a Node server that wraps the application on a separate port (default 3000).
- Watches files for changes, injects CSS updates without reload, or triggers full reload for HTML changes.
- Synchronizes scrolling, clicks, and form inputs across all connected browsers/devices.
- Admin panel on port 3001 shows connected devices and configuration.
- **Pattern**: File watching with WebSocket push, multi-device sync, admin dashboard on separate port.

### Claude Code Desktop (Anthropic)
- Terminal-based Claude Code with a Preview feature (February 2026).
- Users see their running app in a preview pane; clicking on UI elements lets Claude know which element to modify.
- Claude Canvas uses tmux to split the terminal into panes for displaying interactive content.
- **Pattern**: Integrated preview pane bridging terminal agent and browser rendering.

### v0 by Vercel
- Chat-based AI interface that generates React/Next.js code with a live preview.
- Every prompt generates code in a sandbox runtime with real-time rendering.
- Diff view for reviewing code changes inline.
- Git panel for creating branches and PRs directly.
- **Pattern**: Conversational AI with side-by-side code and live preview in browser.

---

## Real-Time Sync Patterns

Three primary approaches exist for terminal-to-browser synchronization:

### WebSocket
- **Bidirectional**, full-duplex communication over a single TCP connection.
- Used by: Vite HMR, webpack-dev-server, Jupyter, Nuxt DevTools, Browsersync.
- Strengths: Low latency, supports both push and pull, well-supported in browsers.
- Weaknesses: More complex server setup, requires upgrade handshake, may be blocked by some proxies/firewalls.
- Best for: Scenarios where the browser might send data back (user clicks, navigation, form input).

### Server-Sent Events (SSE)
- **Unidirectional** (server to client only), runs over standard HTTP.
- Strengths: Simpler implementation, automatic reconnection built into the EventSource API, works through HTTP/2 multiplexing, passes through most proxies and firewalls without configuration, lower overhead than WebSocket.
- Weaknesses: One-way only; client cannot send data on the same connection. Text-based (no binary). Limited to ~6 concurrent connections per domain in HTTP/1.1 (not an issue with HTTP/2).
- Best for: A grooming companion where the CLI pushes phase updates to the browser and the browser is read-only. This is the ideal fit for PM's use case.

### File Watching (+ HTTP Polling or Reload)
- CLI writes output to a file (HTML, JSON, markdown); browser watches via polling or a lightweight WebSocket/SSE notifier.
- Used by: Playwright HTML reports (write file, then open), static site generators.
- Strengths: Simplest implementation, no persistent connection needed, artifacts are saved on disk for later viewing.
- Weaknesses: Higher latency (polling interval), not true real-time, requires file I/O.
- Best for: Post-phase reports or when offline viewing of grooming output is valuable.

### Recommended Approach for PM
**SSE as the primary channel, with file-based fallback.** The grooming companion is fundamentally one-way: the CLI produces structured output for each phase and pushes it to the browser. The browser does not need to send data back to the CLI (the terminal handles all conversation). SSE provides:
- Automatic reconnection if the browser tab is backgrounded or the connection drops.
- Simple implementation (a few lines of Node.js/Express).
- Works through corporate firewalls.
- The CLI can simultaneously write phase output as HTML files to disk, providing offline access and a shareable artifact.

---

## User Expectations

### What developers expect from multi-phase CLI processes

**Progress visibility is non-negotiable.** Research from Evil Martians identifies three CLI progress patterns:
1. **Spinners** -- for quick operations where no granular progress data is available. Minimum viable feedback.
2. **X of Y counters** -- show completed items vs. total (e.g., "Phase 2 of 5: User Stories"). Lets users detect stalled processes and estimate remaining time.
3. **Progress bars** -- visual gauge with percentage. Often overkill in CLI, but appropriate for long parallel operations.

**Phase-based processes need a checklist model.** Users expect to see:
- Which phase they are in (current state).
- Which phases are complete (with checkmarks or past-tense labels).
- Which phases remain (greyed out or labeled as upcoming).
- A hybrid steps-remaining + checklist format works best for multi-phase workflows.

**Transition from gerund to past tense matters.** "Generating user stories..." should become "User stories generated" with a checkmark. This is a small detail that significantly affects perceived responsiveness.

**Silent output destroys trust.** Any pause longer than 1 second without visual feedback causes users to wonder if the process has stalled. Even an animated spinner prevents this anxiety.

**Accuracy over speed illusion.** Fake progress bars that fill up without reflecting real progress are worse than a simple spinner. Users notice and lose trust quickly.

**For a browser companion specifically**, users expect:
- The browser page updates automatically without manual refresh.
- Each completed phase appears incrementally (not all at once at the end).
- The current phase is visually distinguished from completed and upcoming phases.
- The browser view is richer than the terminal (formatted text, tables, diagrams) -- otherwise there is no reason to look at it.
- The terminal remains the primary control surface; the browser is a passive display.

---

## Implications for PM

### The Opportunity
No AI PM competitor offers a terminal+browser split for grooming sessions. This gives PM a unique positioning: "the only grooming tool that gives you a formatted, phase-by-phase web view alongside your terminal conversation." The closest precedent in the AI space is MetaGPT X's workflow visualization, but that targets agent orchestration, not product grooming output.

### Recommended Architecture

```
Terminal (PM CLI)                    Browser (localhost:PORT)
+-----------------------+           +---------------------------+
| Groom conversation    |           | Phase-by-phase output     |
| Phase prompts/answers |  --SSE--> | Formatted HTML/CSS        |
| Progress indicators   |           | Auto-updating via SSE     |
| [ctrl+c to exit]      |           | Checkmarks on completed   |
+-----------------------+           +---------------------------+
        |                                      ^
        |          +------------------+        |
        +--------> | Local HTTP Server| -------+
                   | (Express/Fastify)|
                   | SSE endpoint     |
                   | Static file serve|
                   +------------------+
```

### Design Principles (drawn from research)
1. **Opt-in, not default.** Follow Playwright's model: a `--ui` or `--browser` flag. Without the flag, grooming works entirely in the terminal as it does today. Never force users into a browser dependency.
2. **SSE for live updates, file for persistence.** Push each phase to the browser via SSE as it completes. Simultaneously write the HTML to disk so users can revisit grooming output later or share it.
3. **Terminal stays primary.** The browser is a passive display. All conversation, input, and control happens in the terminal. This follows Expo's model: terminal is the control center, browser is the view layer.
4. **Phase-by-phase incremental display.** Each grooming phase (problem statement, user stories, scope, etc.) appears in the browser as it completes. Use the checklist/stepper pattern: completed phases get checkmarks, the current phase is highlighted, upcoming phases are greyed out.
5. **Richer than terminal output.** The browser must add value beyond what the terminal shows. Formatted tables, section anchors, collapsible details, downloadable artifacts, and a polished layout justify the second screen.
6. **Auto-open browser on start.** Follow Storybook/Vite convention: when `--browser` flag is used, automatically open the default browser to `localhost:PORT`. Provide the URL in terminal output for manual access.
7. **Graceful degradation.** If the browser is closed or never opened, the grooming session continues unaffected in the terminal. The SSE server is lightweight and has no impact on the CLI process.
8. **Single port, no configuration.** Pick an available port automatically (like Vite does). Show the URL in terminal. Do not require users to configure ports.

### Implementation Complexity
- **Low complexity.** A minimal Express/Fastify server with an SSE endpoint and a static HTML page is roughly 100-150 lines of code. The hardest part is the HTML/CSS template for rendering grooming phases attractively.
- **No new dependencies required** if PM already uses Node.js. A small utility or the `open` npm package handles browser launch.
- **Progressive enhancement.** Start with a simple single-page view that shows phases as they complete. Later iterations can add interactivity (collapsible sections, export buttons, theme switching).

### Risks
- **Port conflicts.** Mitigate by scanning for available ports (use `detect-port` or similar).
- **Browser tab fatigue.** Developers already have many tabs open. Mitigate by making the companion genuinely useful, not just a mirror of terminal output.
- **Maintenance burden.** The HTML template needs to look good. If it is ugly or broken, it hurts rather than helps. Invest in a clean, minimal design from the start.
- **Security.** The local server should bind to `127.0.0.1` only, never `0.0.0.0`. No sensitive data should be exposed beyond what is already in the terminal session.
