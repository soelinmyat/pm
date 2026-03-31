---
type: topic-research
topic: Automated Video Demo Recording for Feature Validation
created: 2026-03-30
updated: 2026-03-30
source_origin: external
sources:
  - url: https://playwright.dev/docs/videos
    accessed: 2026-03-30
  - url: https://playwright.dev/docs/api/class-video
    accessed: 2026-03-30
  - url: https://playwright.dev/docs/trace-viewer
    accessed: 2026-03-30
  - url: https://playwright.dev/docs/api/class-tracing
    accessed: 2026-03-30
  - url: https://playwright.dev/docs/test-agents
    accessed: 2026-03-30
  - url: https://github.com/microsoft/playwright/issues/14258
    accessed: 2026-03-30
  - url: https://github.com/microsoft/playwright/issues/21852
    accessed: 2026-03-30
  - url: https://github.com/korwabs/playwright-record-mcp
    accessed: 2026-03-30
  - url: https://github.com/korwabs/playwright-trace-mcp
    accessed: 2026-03-30
  - url: https://github.com/microsoft/playwright-mcp
    accessed: 2026-03-30
  - url: https://github.com/asciinema/asciinema
    accessed: 2026-03-30
  - url: https://github.com/PierreMarchand20/asciinema_automation
    accessed: 2026-03-30
  - url: https://github.com/robmoss/asciinema-scripted
    accessed: 2026-03-30
  - url: https://github.com/charmbracelet/vhs
    accessed: 2026-03-30
  - url: https://github.com/faressoft/terminalizer
    accessed: 2026-03-30
  - url: https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files
    accessed: 2026-03-30
  - url: https://github.blog/news-insights/product-news/video-uploads-available-github/
    accessed: 2026-03-30
  - url: https://github.com/actions/upload-artifact
    accessed: 2026-03-30
  - url: https://docs.cypress.io/app/continuous-integration/github-actions
    accessed: 2026-03-30
  - url: https://github.com/cypress-io/github-action/issues/193
    accessed: 2026-03-30
  - url: https://yer.ac/blog/2026/01/23/from-acceptance-criteria-to-playwright-tests-with-mcp/
    accessed: 2026-03-30
  - url: https://medium.com/@twinklejjoshi/playwright-agents-the-future-of-intelligent-test-automation-3d2445fcb1c9
    accessed: 2026-03-30
  - url: https://dev.to/playwright/playwright-agents-planner-generator-and-healer-in-action-5ajh
    accessed: 2026-03-30
  - url: https://dev.to/robin_xuan_nl/5-minutes-of-human-ai-interaction-from-requirements-to-e2e-test-result-1o71
    accessed: 2026-03-30
  - url: https://medium.com/@shreyvats/how-we-engineered-an-ai-agent-that-writes-compiles-executes-and-ships-e2e-tests-4bb1e9f6dd6c
    accessed: 2026-03-30
  - url: https://www.arcade.software/
    accessed: 2026-03-30
  - url: https://dev.loom.com/docs/record-sdk/details/api
    accessed: 2026-03-30
  - url: https://maestro.dev/insights/appium-vs-maestro-react-native-testing-tools
    accessed: 2026-03-30
  - url: https://www.browserstack.com/docs/app-automate/maestro/debug-failed-tests/video-recording
    accessed: 2026-03-30
  - url: https://automationqahub.com/how-to-enable-screen-recording-in-appium/
    accessed: 2026-03-30
  - url: https://riccardocipolleschi.medium.com/video-record-your-uitest-4cc5b75079af
    accessed: 2026-03-30
---

# Automated Video Demo Recording for Feature Validation

## Bottom Line Up Front

Automated video demo recording for feature validation is technically feasible today by composing existing tools, but no single product does it end-to-end. The highest-leverage path for PM is: (1) use Playwright MCP to drive a browser through acceptance criteria, (2) capture video via the `playwright-record-mcp` fork or Playwright's built-in `recordVideo`, (3) upload the artifact to a GitHub PR comment. The main gap is orchestration -- stitching acceptance criteria into a runnable demo script and attaching the output. That orchestration layer is exactly what PM's ship workflow could provide.

---

## 1. Playwright Video Recording

### How It Works

Playwright records video at the **browser context** level. You pass a `recordVideo` option when creating a context:

```javascript
const context = await browser.newContext({
  recordVideo: { dir: 'videos/', size: { width: 1280, height: 720 } }
});
```

Each page opened in that context gets a `.webm` file (VP8 codec). The video is finalized and saved when the context is closed. You can retrieve the path via `page.video().path()` or save to a specific location with `page.video().saveAs(path)`.

### Configuration

- **Format**: WebM only (VP8/VP9 codec). No native MP4 output.
- **Size**: Defaults to viewport scaled down to fit 800x800. Custom dimensions supported.
- **Quality**: Not directly configurable -- determined by viewport size and codec defaults.
- **File size**: Depends on duration and resolution. A 30-second 800x800 test run is typically 1-3 MB.
- **Config-level options**: `'on'`, `'off'`, `'retain-on-failure'`, `'on-first-retry'`.

### Start/Stop Limitation (Critical)

**You cannot start or stop recording mid-session.** Recording begins when the context is created and ends when the context closes. There are three open feature requests on GitHub (issues #14258, #21852, #32424) asking for on-demand start/stop, but none have been implemented. The only workaround is to create a new browser context per recording segment, which requires re-establishing state (cookies, auth, etc.).

This is the single biggest limitation for demo recording. A "show feature X" demo would ideally record only the relevant interaction, not the entire session from browser launch. Workaround: use short-lived contexts scoped to a single demo scenario.

### Playwright Trace Viewer (Alternative)

Trace Viewer is more powerful than video for debugging: it captures DOM snapshots at every step, network requests, console logs, and a synchronized filmstrip. However, traces are developer tools, not demo-ready artifacts. They require the Playwright Trace Viewer app to open and are not embeddable as video. Not suitable for PR demo attachments, but useful for deep validation.

### Playwright MCP + Video Recording

Three MCP server implementations exist:

1. **Microsoft's official `@playwright/mcp`** -- No built-in video recording. Focused on accessibility-tree-driven browser control. A feature request (issue #695) to add video recording is open but unresolved.

2. **`playwright-record-mcp` (korwabs)** -- Fork of the official MCP that adds `--record`, `--record-path`, and `--record-format` (mp4 or webm) flags. This is the most promising tool for our use case: an AI agent can drive a browser via MCP tools while video is simultaneously captured.

3. **`playwright-trace-mcp` (korwabs)** -- Adds trace viewer and video recording to the MCP server. Useful for post-hoc debugging but heavier than pure video.

**Verdict**: `playwright-record-mcp` is the best fit for PM's ship workflow. An agent can navigate a deployed feature via MCP tools (click, fill, navigate), and the session is automatically recorded as MP4/WebM. The recording is saved on disk and can then be uploaded to a PR.

---

## 2. Terminal Recording Tools

For CLI features and terminal-based workflows, three tools stand out:

### asciinema

- **How it works**: Runs inside a terminal, captures input/output as lightweight `.cast` files (asciicast format -- essentially JSON with timestamps). Not pixel-based video.
- **Output**: `.cast` files, playable via `asciinema-player` (web component) or on asciinema.org. Can be converted to GIF/MP4/SVG with third-party tools (`agg`, `svg-term`).
- **Automation**: Two companion projects enable scripted recordings:
  - `asciinema-automation`: Write commands in a text file, control expected output and timing.
  - `asciinema-scripted`: Predefined terminal input with controlled typing speed.
- **Agent-drivable**: Yes. An agent can launch `asciinema rec` with a command to execute: `asciinema rec demo.cast -c "npm run test"`. The recording stops when the command exits.
- **Limitation**: Output is terminal-only (no GUI). The `.cast` format is not a standard video file -- it needs conversion or a custom player for PR embedding.

### VHS (Charmbracelet)

- **How it works**: Declarative `.tape` files define terminal interactions. VHS interprets the tape, runs commands in a virtual terminal, and renders output.
- **Output**: GIF, MP4, WebM, or directory of PNG frames. Multiple outputs per tape.
- **Tape file example**:
  ```
  Output demo.gif
  Set FontSize 14
  Set Width 1200
  Set Height 600
  Type "npm run ship"
  Enter
  Sleep 3s
  ```
- **Agent-drivable**: Highly suitable. An AI agent can generate a `.tape` file from acceptance criteria and run `vhs demo.tape`. No interactive input needed.
- **Dependencies**: Requires `ttyd` and `ffmpeg`.
- **Best for**: Polished, reproducible CLI demo GIFs. The declarative format maps well to structured acceptance criteria.

### Terminalizer

- **How it works**: Node.js CLI that records terminal sessions to YAML, then renders to GIF/MP4/WebM.
- **Automation**: Can pipe commands via stdin: `echo -e "ls\ncd docs\nexit" | terminalizer record session`.
- **Output**: GIF (primary), MP4, WebM, HTML5.
- **Agent-drivable**: Yes, via stdin piping or pre-scripted YAML editing.
- **Status**: Less actively maintained than VHS. Last significant update less recent.

### Recommendation

**VHS is the best fit for PM.** Its tape file format is declarative, reproducible, and maps cleanly to acceptance criteria. An agent can generate a tape file from a ticket's AC, run it, and produce a GIF or MP4. For terminal-based features, this is the path.

---

## 3. Existing Tools That Auto-Generate Demos

### CI/CD Video Recording

- **Cypress**: Records video of every test run by default. Videos are stored in `cypress/videos/`. In GitHub Actions, these are uploaded as artifacts via `actions/upload-artifact`. Cypress Cloud provides a bot that comments on PRs with test results and links to recordings.
- **Playwright in CI**: Video recording can be enabled in CI via config. Videos uploaded as artifacts. No built-in PR comment bot for video.
- **BrowserStack / Sauce Labs / LambdaTest**: Cloud testing platforms that record video of every test session. Videos are accessible via dashboard but not auto-attached to PRs.
- **No CI tool auto-records feature demos.** All existing video recording in CI is for test failure debugging, not feature validation demos.

### Visual Regression Tools

Visual regression tools (Percy, Applitools, Argos, BackstopJS) focus exclusively on screenshot comparison, not video. Playwright traces provide filmstrip-style recordings, but these are debugging tools, not demo artifacts. No visual regression tool produces shareable video demos.

### Demo Platforms

- **Arcade**: Creates interactive product demos. Has an API for programmatic demo creation. Captures interactive screenshots (not real browser sessions). Supports GIF/video export. Enterprise HTML capture feature grabs live interactive elements. Most relevant third-party tool, but designed for marketing, not dev validation.
- **Loom**: Has a Record SDK for embedding recording capability in third-party apps. No API for automated/headless recording -- requires a human to initiate screen recording. Not suitable for automated pipelines.
- **Reprise**: Enterprise demo platform for sales teams. No public automation API. Manual creation workflow.

### AI Coding Tools

No AI coding assistant (GitHub Copilot, Cursor, Claude Code, Windsurf, etc.) currently auto-generates video demos of implemented features. This is a greenfield opportunity. Replit offers live sharing links for demos, but that is interactive, not recorded video.

**Key insight**: The gap is not in recording technology (that exists). The gap is in orchestration: no tool connects "here are the acceptance criteria" to "here is a video proving the feature works." PM's ship workflow could be the first to close this loop.

---

## 4. PR Video Attachment Patterns

### GitHub Native Video Support

- **Supported formats**: `.mp4` and `.mov` in issues, PRs, discussions, and comments.
- **File size limits**:
  - Free plan: 10 MB for videos
  - Paid plan (Team/Enterprise): 100 MB for videos
  - Images/GIFs: 10 MB on all plans
  - Browser upload limit: 25 MB regardless of plan
- **Embedding**: Drag-and-drop into comment box. GitHub auto-embeds for inline playback.
- **Programmatic upload**: Not directly supported via `gh` CLI. The `gh-image` CLI extension replicates the browser upload flow for images. For video, you would need to use the GitHub API's asset upload endpoint or a workaround.

### GitHub Actions Artifacts

- Single artifact: up to 5 GB
- Per-job limit: 500 artifacts
- Repository storage: 2 GB default (shared across all artifacts)
- Artifacts can be linked from PR comments but are not inline-embeddable as video.

### Current Team Patterns

1. **Manual**: Developer records a screen recording (Loom, QuickTime, OBS) and drags it into the PR description. Most common pattern today.
2. **Cypress Cloud bot**: Auto-comments on PRs with test results and links to recorded videos on Cypress Cloud dashboard.
3. **CI artifact + comment**: GitHub Action uploads video as artifact, then a subsequent step uses the GitHub API to post a PR comment linking to the artifact.
4. **GIF in PR description**: Developers create short GIFs showing the change and embed them in the PR description. Widely used for UI changes.

### Best Practices for Video Evidence in Code Review

- Keep videos under 30 seconds for attention span
- GIF for simple UI changes (auto-plays, no click needed)
- MP4 for complex flows (better quality, smaller file size than GIF)
- Include before/after when possible
- Add captions or annotations for context
- Link to full test run artifacts for detailed inspection

### Recommended Approach for PM

Upload short MP4 (under 10 MB to work on free plans) to PR comment via GitHub API. For longer demos, upload as artifact and link. GIF is better for quick visual proof but worse for quality and file size.

---

## 5. Acceptance Criteria as Test Scripts

### Current State of the Art

This is the area with the most active innovation in 2025-2026.

### Playwright Agents (v1.56, October 2025)

Playwright shipped three built-in AI agents:

1. **Planner**: Explores an app and produces a test plan. Behaves like an automated QA engineer doing exploratory testing, documenting findings systematically.
2. **Generator**: Takes the Planner's test plan and produces executable Playwright test scripts. Interacts with the live app to verify selectors and assertions.
3. **Healer**: When tests fail, replays failing steps, inspects current UI, suggests patches, and reruns until green or until guardrails stop the loop.

These can be chained: Planner explores, Generator writes tests, Healer maintains them. All accept natural language input.

### Playwright MCP + Acceptance Criteria

A notable blog post by yer.ac (January 2026) demonstrated using Playwright MCP with VS Code Copilot to:
1. Take plain-text acceptance criteria
2. Parse them with an LLM
3. Use Playwright MCP tools to explore the UI
4. Output a validated, runnable TypeScript Playwright test

The key insight: acceptance criteria stay in plain English (owned by QA/PM), and the LLM + MCP handles translation to executable tests. The output is not "AI-written tests" but executable checks that preserve independent validation.

### AI Test Generation Tools

- **ZeroStep**: Adds AI-powered steps to Playwright tests. Write `ai("click the login button")` and it uses AI to find and interact with the element.
- **Autonoma (getautonoma.com)**: AI-native E2E testing platform. Generates tests from natural language without code.
- **Qodo (formerly CodiumAI)**: Generates test cases from code context, including edge cases and boundary conditions.
- **SPECMATE (academic)**: Research tool that auto-generates test cases from acceptance criteria using NLP. Published in IEEE.

### Jira Ticket to Automated Test

A Medium post (2026) by Sreekesh Okky demonstrated a pipeline: Jira ticket acceptance criteria -> MCP + Copilot -> Playwright tests, generated and validated in minutes. This maps directly to PM's groom output (which already produces structured acceptance criteria).

### Feasibility Assessment for PM

**High feasibility.** PM's groom command already produces structured acceptance criteria. The pipeline would be:

1. `pm groom` produces acceptance criteria in structured format
2. Ship workflow extracts AC from the ticket
3. LLM generates a Playwright test script (or VHS tape file for CLI features)
4. Script runs against deployed/local feature
5. Video is captured during execution
6. Video is attached to PR

The hardest part is step 3 (reliable test generation from AC). Playwright Agents (Planner + Generator) handle this natively as of v1.56. For PM, wrapping the Generator with the structured AC from groom output is the integration point.

---

## 6. Mobile App Recording

### Maestro

- **Video recording**: Enabled by default in Maestro Cloud. Video logs are automatically captured during test execution.
- **Local recording**: Maestro CLI supports recording via device screen capture.
- **YAML-based flows**: Declarative test definitions, similar to VHS tape files. AI assistant (MaestroGPT) can generate commands.
- **Agent-drivable**: Yes. YAML flows can be generated programmatically. `maestro test flow.yaml` runs the test and captures video.
- **Output**: Video files from device screen recording.

### Appium

- **Built-in recording**: `startRecordingScreen()` and `stopRecordingScreen()` methods. Programmatic start/stop (unlike Playwright).
- **Android**: Uses `screenrecord` under the hood. Configurable time limit and video size.
- **iOS**: Requires `ffmpeg` for recording. Platform-specific options via `IOSStartScreenRecordingOptions`.
- **Output**: MP4 video, base64-encoded by default (can be saved to file).
- **Agent-drivable**: Yes. Recording can be started/stopped programmatically within test scripts.

### XCUITest (iOS Native)

- **Built-in recording**: `XCUIScreenRecordingActivity` API allows programmatic start/stop from test code.
- **Xcode integration**: Xcode's test runner can record UI interactions. Results stored in `.xcresult` bundles.
- **Output**: Video stored within xcresult, extractable as MP4.
- **Agent-drivable**: Only within the context of XCTest execution. Cannot be triggered externally without building a test target.

### Espresso (Android Native)

- **No built-in video recording.** Espresso is a UI testing framework, not a recording tool.
- **Workaround**: Use Android's `screenrecord` ADB command alongside Espresso test execution. Cloud platforms (BrowserStack, Firebase Test Lab) add video recording on top of Espresso.
- **Agent-drivable**: ADB screenrecord can be scripted, but it is separate from the test framework.

### Recommendation for PM

Mobile demo recording is feasible but adds significant complexity. Maestro is the easiest path (YAML flows + built-in video). Appium has the most flexible programmatic API. For PM's initial scope, focus on web (Playwright) and CLI (VHS) recording. Mobile can be a later extension.

---

## Gap Analysis

| Capability | Available Today | Gap for PM |
|---|---|---|
| Browser video recording | Playwright `recordVideo`, `playwright-record-mcp` | No start/stop mid-session; WebM only (need MP4 conversion) |
| Terminal recording | VHS tape files, asciinema-scripted | Need to generate tape files from AC |
| MCP-driven browser control + recording | `playwright-record-mcp` | Community fork, not official; stability unknown |
| AC to test script | Playwright Agents, LLM + MCP | Works for web UI; needs prompt engineering for reliability |
| Video upload to PR | GitHub API, `actions/upload-artifact` | No official `gh` CLI support for video upload to comments |
| Orchestration (AC -> script -> record -> upload) | **Nothing** | This is the gap PM fills |
| Mobile recording | Maestro, Appium | High complexity; defer to later phase |

## Recommended Architecture for PM

```
pm groom (structured AC)
        |
        v
pm ship (after merge)
        |
        v
  Extract AC from ticket
        |
        v
  +---------+----------+
  | Web UI? | Terminal? |
  +---------+----------+
  |                    |
  v                    v
Playwright MCP      VHS tape
+ recordVideo       generation
  |                    |
  v                    v
  .webm/.mp4         .gif/.mp4
  |                    |
  +--------+-----------+
           |
           v
  Upload to PR comment
  (GitHub API)
```

### Phase 1 (MVP)
- Web features: Use `playwright-record-mcp` to drive browser and record. Agent navigates the feature based on AC. Output MP4/WebM.
- CLI features: Generate VHS `.tape` file from AC. Run `vhs` to produce GIF. Simpler, more reliable.
- Upload: Use GitHub API to attach video/GIF to PR comment.

### Phase 2
- Add Playwright Agents (Planner + Generator) for more autonomous test generation from AC.
- Convert WebM to MP4 via ffmpeg for broader compatibility.
- Add before/after comparison (record baseline, then record after feature).

### Phase 3
- Mobile support via Maestro YAML flows.
- Trace viewer integration for deep validation on failure.
- Analytics on demo recording success rates to improve AC quality.
