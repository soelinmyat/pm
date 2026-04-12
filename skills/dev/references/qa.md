# QA — Assertion-Driven Testing Gate

Report-only QA gate for the dev lifecycle. Tests the running app using DOM assertions as primary evidence and screenshots as supporting evidence. Never modifies source code.

**Core shift:** The LLM designs assertions and interprets structured results. It does NOT judge pixels in screenshots.

**Separation of concerns:** QA finds problems. The dev flow fixes them. QA re-verifies.

## Two Modes

| Mode | How invoked | Lifecycle |
|------|-------------|-----------|
| **Persistent worker** (preferred) | Dev dispatches a persistent QA worker `qa-{slug}` | Stays alive across fix-and-retest iterations when the runtime supports it. Phase 0-2 run once. Re-verify via resume message. |
| **Standalone** | User invokes `pm:qa` directly | One-shot. Full Phase 0-6 each time. |

**Persistent worker mode** is the default when called from `/dev`. The dev orchestrator dispatches this skill through the runtime adapter in `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/agent-runtime.md`. On re-verify, the orchestrator resumes the same worker — the worker skips environment setup and re-runs only the relevant assertions.

**Standalone mode** is for ad-hoc QA outside a dev session (e.g., `pm:qa --page /dashboard`). Runs the full lifecycle as a one-shot.

### Detecting mode

```
Spawned as persistent worker with feature/AC context in prompt  →  Persistent
Invoked as pm:qa skill with arguments                     →  Standalone
```

In persistent mode, all context (feature, ACs, routes, platform, tier) comes from the spawn prompt. In standalone mode, context comes from arguments and the session file.

## Telemetry (opt-in)

If analytics are enabled, read `${CLAUDE_PLUGIN_ROOT}/references/telemetry.md`.

Read `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/agent-runtime.md` for runtime-specific worker dispatch.
Read `${CLAUDE_PLUGIN_ROOT}/references/capability-gates.md` for shared capability classification.

Minimum coverage for `pm:qa`:
- run start / run end
- one step span for `environment-readiness`
- one step span for `orient`
- one step span for `charter`
- one step span for `execute`
- one step span for `score-and-report`
- one step span for each `re-verify` iteration (persistent mode)

## Tiers

| Tier | Dev Size | What | Duration |
|------|----------|------|----------|
| **Quick** | XS | Smoke — readiness gate, console errors, render check via DOM | ~1 min |
| **Focused** | S | Diff-aware — assertions for changed components + affected routes | ~2-3 min |
| **Full** | M/L/XL | Spec-driven — AC assertions + interaction testing + 3 viewports | ~5-8 min |

## Invocation

**From /dev (persistent worker — preferred):**

The dev orchestrator dispatches this as a persistent QA worker. See `implementation-flow.md` Step 5 for the spawn pattern. The worker receives all context in its prompt and stays resumable for re-verify iterations.

**Standalone:**

```
pm:qa --page /dashboard
pm:qa --feature "user onboarding flow"
pm:qa --diff
```

**Arguments:**

| Arg | Effect | Mode |
|-----|--------|------|
| `--quick` | Force Quick tier regardless of session size | Both |
| `--page <route>` | Test a specific route | Standalone |
| `--feature <desc>` | Test by feature description | Standalone |
| `--diff` | Build charter from `git diff {DEFAULT_BRANCH}...HEAD` | Standalone |
| `--mobile` | Force mobile platform (Maestro MCP) | Both |
| `--visual` | Include visual layers (L2: token/style fidelity, L5: layout judgment) | Both |

---

## Reference Files

| File | Purpose | When to Read |
|------|---------|--------------|
| `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/qa-issue-taxonomy.md` | Severity levels + 7 category definitions | Phase 4 (scoring) |
| `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/qa-dom-assertions.md` | Playwright MCP patterns for DOM assertions | Phase 2-3 (charter + execution) |
| `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/design-critique-seed-conventions.md` | Seed data conventions | Phase 0 (when seed data needed) |

**Read on-demand, not upfront.** Each reference is needed in exactly one phase.

---

## Default Branch

Read `{DEFAULT_BRANCH}` from `.pm/dev-sessions/{slug}.md` if available. Otherwise detect:

```bash
DEFAULT_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
[ -z "$DEFAULT_BRANCH" ] && DEFAULT_BRANCH=$(git remote show origin 2>/dev/null | grep 'HEAD branch' | awk '{print $NF}')
[ -z "$DEFAULT_BRANCH" ] && DEFAULT_BRANCH="main"  # fallback only
```

All git commands below use `{DEFAULT_BRANCH}` — never hardcode `main`.

---

## Phase 0: Environment Readiness Gate

Before any testing, verify the agent can actually reach and interact with the app. Every failed QA run that dies on server startup or auth is wasted time.

### 0a. Design System Discovery (only with `--visual`)

**Skip this step unless `--visual` is set.** Design token discovery is only needed for Layer 2 (Visual Fidelity) assertions, which don't run by default.

Search the project for design tokens. This lookup table drives Layer 2 assertions. The source files ARE the design system — they can't drift from themselves.

**Search order** (collect from all found, don't stop at first hit):

1. `tailwind.config.*` — read `theme` and `theme.extend` for fontSize, spacing, colors, borderRadius. This is the most common and most structured source.
2. CSS variables files — glob for `tokens.css`, `variables.css`, `theme.css`, or any file defining `:root { --* }` custom properties
3. Component library constants — grep for `FONT_SIZES`, `SPACING`, `COLORS` exports in shared/ui packages
4. `DESIGN.md` at project root — look for token tables (font sizes, spacing, colors)

**Extract into a token lookup:**

```
DESIGN_TOKENS = {
  fontSize: { heading-lg: "24px", heading-md: "18px", body: "14px", sm: "12px" },
  spacing: { xs: "4px", sm: "8px", md: "16px", lg: "24px", xl: "32px" },
  colors: { primary: "#2563eb", text: "#111827", muted: "#6b7280" },
  borderRadius: { sm: "4px", md: "8px", lg: "12px" }
}
```

**Storybook as bonus check:** If `.storybook/` exists, note it for Layer 2. Storybook is NOT a source of truth (it can drift), but comparing Storybook vs app renders of the same component is a useful second-order finding. Storybook drift means either the app or Storybook is wrong — report the difference, let the dev decide which to fix.

**If no design system found:** note it in the readiness report. Layer 2 falls back to cross-page consistency checks — compare the same component (header, sidebar, card) across multiple routes and flag differences.

### 0b. Start servers

Read the project's CLAUDE.md, README, or dev setup scripts for the specific commands. The skill defines the **sequence**, not the stack-specific commands.

1. **Check if already running** — probe expected ports before starting anything
2. **Start what's needed:**
   - Web: API server + dev server (detect from package.json, Gemfile, etc.)
   - Mobile: API server + simulator (boot one if none running) + build/install app
3. **Health check** — wait up to 30s for each server to respond
4. **Record PIDs** for cleanup

<HARD-RULE>
If servers won't start after 2 attempts: verdict = Blocked. Report the specific error. Do not proceed.
</HARD-RULE>

### 0c. Auth verification

1. `browser_navigate` to the login page
2. `browser_type` email + password (check CLAUDE.md or seed conventions for credentials)
3. `browser_click` submit
4. `browser_navigate` to an authenticated route — verify it loads (not redirected to login)

If login fails:
- Check for different auth patterns (OAuth redirect, magic link, SSO)
- Check if seed user exists (run seed task if not)
- If still fails: verdict = **Blocked** with specific auth error

### 0d. Seed data verification

For Focused/Full tiers or data-dependent flows:

1. Run seed task if project has one (check `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/design-critique-seed-conventions.md`)
2. Verify data exists on page:

```
browser_evaluate: "document.querySelectorAll('table tbody tr').length"
→ If 0 and data expected: seed failed, report and retry once
```

### 0e. Route reachability

For each route in the test charter:

```
browser_navigate to route
browser_evaluate: "document.title"  → verify not error page
```

If any route returns 500/404: note it as a finding, skip that route in testing.

### Print readiness

```
QA Readiness
  Design tokens: ✓ tailwind.config.ts (18 tokens extracted)
  Storybook: ✓ .storybook/ found (will compare app vs stories)
  Server: ✓ localhost:5173 (Vite) + localhost:3000 (Rails)
  Auth: ✓ logged in as test@example.com
  Seed: ✓ 12 records loaded
  Routes: ✓ 4/4 reachable
```

<HARD-RULE>
If server or auth fails: Blocked. If seed or routes partially fail: note findings but continue testing reachable routes.
</HARD-RULE>

---

## Phase 1: Orient

### Read context

**Persistent agent mode:** All context (feature, ACs, routes, platform, tier) was provided in the spawn prompt. Read `.pm/dev-sessions/{slug}.md` only for supplementary context (e.g., key files, design decisions). Skip to "Print orientation."

**Standalone mode:** If `.pm/dev-sessions/{slug}.md` exists (derive slug from `git branch --show-current`, stripping `feat/`/`fix/`/`chore/` prefix):

- Extract: feature description, platform, affected routes, **acceptance criteria**, dev size

If no session file and no `--page`/`--feature` arg: ask user what to test.

### Detect platform

```
{APP_PATH}/app.config.ts or app.json exists  ->  "mobile" (Maestro MCP)
package.json contains "expo" or "react-native" ->  "mobile"
--mobile flag present                          ->  "mobile"
Otherwise                                      ->  "web" (Playwright MCP)
```

### Detect tier

```
--quick flag          ->  Quick
Dev session size XS   ->  Quick
Dev session size S    ->  Focused
Dev session size M+   ->  Full
--diff flag (no size) ->  Focused
--page flag (no size) ->  Quick
--feature (no size)   ->  Focused
```

### Print orientation

```
QA Orient
  Feature: {feature}
  Platform: {web/mobile}
  Tier: {Quick/Focused/Full}
  Routes: {list}
  Acceptance Criteria: {count} ACs found
  Re-verify: {yes/no}
```

---

## Phase 2: Spec-Driven Test Charter

Build the charter based on tier. The charter drives Phase 3 execution.

Read `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/qa-dom-assertions.md` for Playwright MCP patterns.

### Quick

Charter is a smoke check with DOM verification:

```markdown
## Test Charter (Quick)

### Smoke Checks
- Navigate {routes}, verify render via DOM (not just screenshot)
- browser_console_messages → filter noise, flag errors
- browser_evaluate → verify key elements exist and have content
```

### Focused

1. Run `git diff {DEFAULT_BRANCH}...HEAD --name-only` to get changed files
2. Map changed files to routes/screens
3. For each affected route, generate **DOM assertions** from the diff:

```markdown
## Test Charter (Focused)

### Affected Routes
- /route-1 — changed: ComponentA.tsx, useHook.ts
- /route-2 — changed: api/endpoint.ts (upstream)

### Assertions per Route

**Route: /route-1**
- DOM: `.component-a` exists and is visible
- DOM: `.component-a` has expected text content
- Console: no new errors after navigation
- Interaction: changed interactive elements respond correctly

**Route: /route-2**
- Data: API-driven content renders with correct values
- DOM: loading → loaded state transition works
```

### Full

1. Read **acceptance criteria** from session state
2. Run `git diff {DEFAULT_BRANCH}...HEAD --name-only` for changed files
3. For **each AC**, generate three assertion types:

```markdown
## Test Charter (Full)

### Scope
{feature description}

### Acceptance Criteria Assertions

**AC 1: "Users can sort the table by clicking column headers"**
- DOM assertion: click Name header → first row text changes to alphabetical first
- DOM assertion: click Name header again → first row text changes to alphabetical last
- Data integrity: all rows still present after sort (count unchanged)
- Interaction: sort indicator icon appears on active column

**AC 2: "Card titles use the heading-md design token"**
- CSS assertion: `.card-title` font-size = 18px
- CSS assertion: `.card-title` font-weight = 600
- CSS assertion: `.card-title` line-height = 24px
- Consistency: all `.card-title` elements have same computed styles

**AC 3: "Empty state shows when no data exists"**
- Data: navigate with empty dataset → `.empty-state` element exists
- DOM: empty state has illustration + message + CTA
- Interaction: CTA button navigates to correct route

### Additional Checks

**Responsiveness (3 viewports):**
- [ ] Desktop (1440px) — full layout assertions
- [ ] Tablet (768px) — responsive breakpoint assertions
- [ ] Mobile (375px) — mobile layout assertions

**Accessibility:**
- [ ] browser_snapshot → verify ARIA tree completeness
- [ ] Keyboard navigation through interactive elements
- [ ] Focus management after interactions
```

<HARD-RULE>
For Full tier: every acceptance criterion MUST have at least one DOM assertion. If the AC is purely visual (e.g., "looks good"), convert it to a measurable assertion (e.g., "uses correct design tokens").
</HARD-RULE>

---

## Phase 3: Layer Execution

For each route in the charter, execute the applicable layers. Each layer uses the right tool for the job.

### Layer selection

QA is **functional by default** — Layers 1, 3, and 4. Visual layers (2 and 5) are opt-in via `--visual`.

```
Default (no --visual flag):
  Run: Layer 1 (Structural) + Layer 3 (Data) + Layer 4 (Interaction)
  Skip: Layer 2 (Visual Fidelity) + Layer 5 (Visual Judgment)

With --visual flag:
  Run: All 5 layers
```

**Rationale:** QA's unique value is functional correctness — does the data render right, do interactions work, do state transitions happen. Visual concerns (design tokens, layout composition, style consistency) are the domain of design critique, which runs as a separate stage. When visual QA is needed without design critique (e.g., standalone invocation), pass `--visual`.

Log the decision:
```
Layers: functional (L1+L3+L4) | full (L1-L5, --visual)
```

### Layer 1: Structural (deterministic)

Verify the page structure is correct.

```
browser_snapshot                    → ARIA tree, element hierarchy
browser_console_messages            → JS errors, warnings
browser_evaluate: "
  fetch(window.location.href, {method: 'HEAD'})
    .then(r => r.status)
"                                   → HTTP status
```

**What to flag:**
- Missing ARIA labels on interactive elements
- Console errors (filter noise: React DevTools, HMR, favicon 404)
- Failed network requests (4xx, 5xx)
- Missing expected elements in ARIA tree

### Layer 2: Visual Fidelity via DOM (deterministic)

Measure CSS values instead of judging screenshots. This is where font size differences, spacing issues, and color mismatches get caught.

**If design tokens were found in Phase 0a:** compare computed styles against the token lookup.

```
browser_evaluate: "
  const el = document.querySelector('.card-title');
  const cs = getComputedStyle(el);
  JSON.stringify({
    fontSize: cs.fontSize,
    fontWeight: cs.fontWeight,
    lineHeight: cs.lineHeight,
    color: cs.color,
    marginBottom: cs.marginBottom
  })
"
→ {"fontSize":"14px","fontWeight":"400","lineHeight":"20px",...}
→ Token lookup says heading-md = 18px/600
→ FAIL: .card-title fontSize 14px (expected 18px), fontWeight 400 (expected 600)
```

**If no design tokens (fallback):** compare the same component type across routes.

```
# Collect heading styles from /dashboard
browser_navigate: /dashboard
browser_evaluate: "...collect all h2 styles..."

# Collect heading styles from /settings
browser_navigate: /settings
browser_evaluate: "...collect all h2 styles..."

# Compare: if /dashboard h2 is 18px but /settings h2 is 14px → inconsistency
```

**What to check:**
- Font sizes, weights, line heights on headings, body, labels
- Spacing (margin, padding) on cards, sections, form elements
- Colors on text, backgrounds, borders
- Element dimensions (width, height) for key components
- Z-index for overlapping elements

**Storybook comparison (bonus, if .storybook/ found in Phase 0a):**

```
# Start Storybook if not running
npx storybook dev --port 6006 --no-open

# Render reference component
browser_navigate: http://localhost:6006/iframe.html?id=components-card--default
browser_evaluate: "...extract .card-title computed styles..."
→ Storybook reference: fontSize=18px, fontWeight=600

# Compare against app
browser_navigate: http://localhost:5173/dashboard
browser_evaluate: "...extract .card-title computed styles..."
→ App actual: fontSize=18px, fontWeight=400

# Drift detected → report both values, don't decide which is right
```

**What to flag:**
- Any CSS value that doesn't match design system source tokens (if tokens found)
- Storybook vs app drift on same component (if Storybook found)
- Inconsistent values across similar elements or across pages (always)

<HARD-RULE>
NEVER report a visual finding based solely on a screenshot when it can be verified via DOM. Use `browser_evaluate` to measure, then attach the screenshot as supporting evidence.
</HARD-RULE>

### Layer 3: Data Correctness (spec-driven)

Verify the actual rendered data matches what the acceptance criteria specify.

```
browser_evaluate: "
  Array.from(document.querySelectorAll('.user-row .name'))
    .map(el => el.textContent.trim())
"
→ ["Alice", "Bob", "Charlie"]
→ Verify: correct count, correct order, correct values
```

**What to check:**
- Element counts (correct number of rows, cards, items)
- Text content (correct labels, values, messages)
- Sort orders (dates descending, names alphabetical)
- Computed values (totals, percentages, status indicators)
- Empty states (correct content when no data)
- Error states (correct message when operation fails)

**What to flag:**
- Wrong data (shows all users instead of just active)
- Wrong order (sorted ascending instead of descending)
- Wrong count (shows 3 items when 5 expected)
- Missing content (empty where text expected)

### Layer 4: Interaction (behavior-driven)

Perform actions and verify state changes via DOM, not just "it didn't crash."

```
# Before action
browser_evaluate: "document.querySelector('.modal')?.style.display"
→ "none" or null

# Perform action
browser_click: "Delete" button

# After action
browser_evaluate: "document.querySelector('.confirm-dialog')?.textContent"
→ "Are you sure you want to delete this item?"

# Verify DOM changed correctly
browser_evaluate: "document.querySelector('.confirm-dialog .cancel-btn') !== null"
→ true (cancel button exists)
```

**What to test:**
- Form submissions: fill → submit → verify success/error state
- Modals/dialogs: trigger → verify content → dismiss → verify closed
- Navigation: click link → verify URL and page content changed
- State toggles: click → verify element class/attribute changed
- Data mutations: perform action → verify UI reflects the change

**What to flag:**
- Action succeeds but UI doesn't update
- Action succeeds but wrong state displayed
- Action triggers console errors
- Double-submit not prevented
- No loading indicator during async operations

### Layer 5: Visual Judgment (LLM-assisted — for layout ONLY)

This is the **only** layer where screenshots drive findings. Use for things that can't be measured in pixels — layout composition, visual hierarchy, overall appearance.

```
browser_screenshot                  → current state
browser_resize: {width: 768}
browser_screenshot                  → tablet viewport
browser_resize: {width: 375}
browser_screenshot                  → mobile viewport
```

**What to judge (LLM looks at screenshots):**
- Overall layout composition and visual balance
- Content hierarchy and readability
- Responsive layout shifts (does it look right at each breakpoint?)
- Obvious visual regressions (missing images, broken icons)
- Visual states that can't be DOM-queried (gradient rendering, shadow appearance)

**What NOT to judge from screenshots:**
- Font sizes → use Layer 2
- Colors → use Layer 2
- Spacing → use Layer 2
- Data correctness → use Layer 3
- Element presence → use Layer 1

### Screenshot naming

```
/tmp/qa/{feature}/{NN}-{page}-{state}.png
```

Examples:
- `01-dashboard-loaded.png`
- `02-dashboard-empty-state.png`
- `03-dashboard-tablet-768.png`
- `04-settings-after-submit.png`

<HARD-RULE>
Max 15 screenshots per run. Screenshots are evidence, not the primary testing mechanism.
</HARD-RULE>

---

## Phase 4: Analyze & Score

Read `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/qa-issue-taxonomy.md` for full category definitions and severity criteria.

### 7 Categories

| Category | Weight | Primary testing layer |
|----------|--------|-----------------------|
| **Console** | 15% | Layer 1 (Structural) |
| **Links** | 10% | Layer 1 (Structural) |
| **Visual** | 10% | Layer 2 (DOM) + Layer 5 (Screenshots) |
| **Functional** | 20% | Layer 3 (Data) + Layer 4 (Interaction) |
| **UX** | 15% | Layer 4 (Interaction) + Layer 5 (Screenshots) |
| **Performance** | 10% | Layer 1 (Console/Network timing) |
| **Accessibility** | 15% | Layer 1 (ARIA tree) + Layer 2 (contrast via DOM) |

### Severity Levels

| Severity | Definition | Deduction per finding |
|----------|------------|----------------------|
| **Critical** | Crash, data loss, security hole, complete feature failure | -25 |
| **High** | Broken user flow, wrong data displayed, key feature degraded | -15 |
| **Medium** | Degraded UX, confusing behavior, non-blocking issues | -8 |
| **Low** | Cosmetic issues, minor polish, nice-to-have improvements | -3 |

### Health Score Computation

```
Start at 100.
For each category:
  category_score = max(0, 100 - sum(deductions for findings in category))
  weighted_score = category_score * category_weight

health_score = sum(all weighted_scores)
```

Round to nearest integer. Clamp to 0-100.

<HARD-RULE>
NEVER skip the health score. Even with zero findings, compute and report: 100/100.
</HARD-RULE>

### Evidence Types

Every finding has an evidence type that determines its confidence:

| Type | Source | Confidence | Example |
|------|--------|------------|---------|
| **ASSERTION** | `browser_evaluate` result | Highest | `font-size: 14px (expected 18px)` |
| **STRUCTURAL** | `browser_snapshot` ARIA tree | High | `button missing aria-label` |
| **CONSOLE** | `browser_console_messages` | High | `Uncaught TypeError: Cannot read 'map' of undefined` |
| **VISUAL** | Screenshot + LLM judgment | Medium | `Layout shifts at 768px viewport` |

### Finding Format

Every finding MUST include evidence:

```markdown
### [SEVERITY] Category: Short description

**Route:** /path
**Evidence type:** ASSERTION | STRUCTURAL | CONSOLE | VISUAL
**Evidence:** `browser_evaluate('.card-title', 'fontSize')` → "14px" (expected: "18px")
**Screenshot:** `/tmp/qa/{feature}/NN-page-state.png` (supporting)
**Expected:** 18px per heading-md token
**Actual:** 14px
```

<HARD-RULE>
NEVER report a finding without evidence. Prefer ASSERTION/STRUCTURAL/CONSOLE evidence over VISUAL. If a finding can only be evidenced by a screenshot, mark confidence as Medium.
</HARD-RULE>

---

## Phase 5: Verdict

| Verdict | Criteria | Action |
|---------|----------|--------|
| **Pass** | Health >= 80, zero Critical, zero High | Ship it. |
| **Pass with concerns** | Health >= 60, zero Critical, <= 2 High | Ship with caution. Note High issues for immediate backlog. |
| **Fail** | Health < 60, OR any Critical, OR > 2 High | Do not ship. Must fix and re-verify. |
| **Blocked** | Servers won't start, can't authenticate, env broken | Cannot test. Fix environment first. |

```
Verdict: {PASS / PASS WITH CONCERNS / FAIL / BLOCKED}
```

---

## Phase 6: Report

### Embedded mode (dev session exists)

Append structured report to `.pm/dev-sessions/{slug}.md` under `## QA`:

```markdown
## QA

### Run 1 — {date}
- **Verdict:** {Pass/Pass with concerns/Fail/Blocked}
- **Health:** {score}/100
- **Tier:** {Quick/Focused/Full}
- **Platform:** {web/mobile}
- **Assertions run:** {count passed}/{count total}
- **Screenshots:** /tmp/qa/{feature}/

#### Findings ({N} total: {C} critical, {H} high, {M} medium, {L} low)

{findings in severity order, each with evidence type + evidence}

#### Category Breakdown
| Category | Score | Findings | Evidence Types |
|----------|-------|----------|----------------|
| Console | {score} | {count} | {CONSOLE} |
| Links | {score} | {count} | {STRUCTURAL} |
| Visual | {score} | {count} | {ASSERTION, VISUAL} |
| Functional | {score} | {count} | {ASSERTION} |
| UX | {score} | {count} | {VISUAL} |
| Performance | {score} | {count} | {CONSOLE} |
| Accessibility | {score} | {count} | {STRUCTURAL} |
```

### Standalone mode (no dev session)

Write full report to `/tmp/qa/{feature}/report.md`.

### Print summary to user

Always print, regardless of mode:

```
QA Complete
  Verdict: {verdict}
  Health: {score}/100
  Assertions: {passed}/{total} passed
  Issues: {C} critical, {H} high, {M} medium, {L} low
  Top issues:
    1. [SEV] {short description} — {route} ({evidence type})
    2. [SEV] {short description} — {route} ({evidence type})
    3. [SEV] {short description} — {route} ({evidence type})
  Screenshots: /tmp/qa/{feature}/
```

---

## Re-verification (Persistent Worker Mode)

In persistent worker mode, re-verify is triggered by a **resume message from the dev orchestrator**, not a `--re-verify` flag. The worker already has servers running, auth session active, design tokens discovered, test charter built, and previous findings in context.

### What the orchestrator sends

Use the runtime adapter from `agent-runtime.md` to resume the same QA worker with a message like:

```text
Fixed the following issues:
1. {finding-id}: {what was fixed}
2. {finding-id}: {what was fixed}

Re-verify these specific findings. Also smoke-check adjacent routes for regressions.
Do NOT re-run Phase 0 (environment is still ready). Jump to Phase 3 re-verify.
```

### Re-verify flow (persistent worker)

1. Parse the fix list from the message
2. Match each fix to a previous finding (already in worker context — no state file re-parse needed)
3. Filter to Critical and High findings (skip Medium/Low unless the message explicitly requests them)
4. **Re-run the exact assertions** from those findings (not just re-screenshot)
5. For each finding: mark as **Fixed** or **Still present** with updated evidence
6. Smoke-check adjacent routes for regressions (navigate, check console, verify key elements)
7. Recompute health score with updated findings
8. Update verdict
9. Write results to `.pm/dev-sessions/{slug}.md` and return verdict to orchestrator

**What the worker skips on re-verify:**
- Phase 0 (servers already running, auth active, tokens discovered)
- Phase 1 (already oriented)
- Phase 2 (charter already built)
- Layers 2+5 (only run if `--visual` was set on initial spawn)

### Re-verify flow (standalone mode)

For standalone invocations, re-verify works the old way:

1. Read previous findings from `.pm/dev-sessions/{slug}.md` `## QA` section
2. Re-run Phase 0 (environment readiness — cold start needed)
3. Filter to Critical and High, re-run assertions, update verdict

### Report format (re-verify, both modes)

Append to existing `## QA` section. Do NOT overwrite previous runs.

```markdown
### Run 2 (Re-verify) — {date}
- **Previous verdict:** {Fail}
- **Updated verdict:** {Pass/Pass with concerns/Fail}
- **Previous health:** {score}/100
- **Updated health:** {score}/100
- **Mode:** persistent-agent | standalone

#### Fixed
- [HIGH] Font size mismatch on .card-title — FIXED (now 18px, was 14px)
- [CRITICAL] Sort order reversed — FIXED (verified descending)

#### Still Present
- [HIGH] {description} — NOT FIXED (browser_evaluate still returns {wrong value})

#### New Issues
- {any regressions found during smoke-check}
```

---

## Server Lifecycle

### Persistent agent mode

The agent owns its servers for its entire lifetime. Servers start in Phase 0 and stay running across all re-verify iterations. Cleanup happens only when the agent receives a final "done" message or is terminated.

```
Phase 0: start servers, record PIDs/ports
Re-verify 1..N: servers still running (verify with health check, restart if crashed)
Final verdict (Pass/Pass with concerns): kill servers, report done
```

**Server health check on re-verify:** Before re-running assertions, verify servers are still responding. If a server crashed (e.g., dev fix caused a build error), restart it once. If restart fails, report Blocked.

```bash
# Health check
curl -sf http://localhost:3000/health > /dev/null 2>&1 || echo "API down"
curl -sf http://localhost:5173 > /dev/null 2>&1 || echo "Vite down"
```

### Standalone mode

Same as before — start servers at Phase 0, kill on completion:

```bash
# Cleanup by port (more reliable than PID)
lsof -ti :3000 | xargs kill 2>/dev/null || true   # API
lsof -ti :5173 | xargs kill 2>/dev/null || true   # Vite
lsof -ti :8081 | xargs kill 2>/dev/null || true   # Metro
```

<HARD-RULE>
ALWAYS kill servers you started when QA is fully done (final passing verdict in persistent mode, or completion in standalone mode). In persistent mode, do NOT kill servers between re-verify iterations.
</HARD-RULE>

---

## State File Integration

QA reads from and writes to `.pm/dev-sessions/{slug}.md`.

**Reads:**
- Feature description, platform, affected routes, **acceptance criteria** (Phase 1 — standalone only; persistent agent gets these from spawn prompt)
- Dev session size for tier detection (Phase 1)
- Design critique status for layer selection (Phase 3)

**Writes:**
- `## QA` section with verdict, health score, assertion results, findings (Phase 6)
- Re-verify results appended to same section (both modes)

If `.pm/dev-sessions/` does not exist, create it (`mkdir -p .pm/dev-sessions`) before writing.

Legacy path: also check `.dev-state-{slug}.md` at repo root. Read from legacy if found, write to new path.

---

## Limits

| Limit | Value | On exceed |
|-------|-------|-----------|
| Screenshots per run | 15 | Screenshots are evidence, prioritize by severity |
| Assertions per route | 20 | Focus on AC-driven assertions first |
| Server start attempts | 2 | Verdict = Blocked |
| Routes per Quick run | 3 | Focus on most affected |
| Routes per Focused run | 8 | Prioritize by diff coverage |
| Routes per Full run | 15 | Cover all charter routes |
| Re-verify scope | Previous Critical + High only | Skip Medium/Low unless asked |
| Re-verify iterations (persistent) | 3 | After 3 Fail cycles, return Blocked |
| Context saturation | ~3 iterations of verbose DOM results | Orchestrator respawns fresh QA worker with state file context and previous findings |
| Agent death (API overload, 529, timeout) | No response from worker | Orchestrator respawns fresh QA worker with state file context. Include previous findings so the new worker skips already-verified assertions |

---

## Critical Rules

1. <NEVER>Modify source code. QA is read-only + browser interaction only.</NEVER>
2. <NEVER>Skip the health score. Even zero-finding runs report 100/100.</NEVER>
3. <NEVER>Report findings without evidence. Assertion result, ARIA tree finding, console output, or screenshot required.</NEVER>
4. <NEVER>Leave servers running after QA is fully done. In persistent mode, kill on final verdict. In standalone, kill on completion.</NEVER>
5. <NEVER>Report a visual finding from a screenshot when it can be measured via DOM. Use `browser_evaluate` first.</NEVER>
6. <NEVER>Re-run Phase 0 on re-verify in persistent mode. The environment is already ready.</NEVER>
7. <NEVER>Run Layers 2+5 unless `--visual` is explicitly passed. QA is functional by default.</NEVER>
8. <MUST>For Full tier: every acceptance criterion must have at least one DOM assertion.</MUST>
9. <MUST>For Full tier: test at minimum 3 viewports (1440px, 768px, 375px).</MUST>
10. <MUST>For re-verify: re-run the exact assertions from previous findings, don't just re-screenshot.</MUST>
11. <MUST>For re-verify: append to existing QA section, never overwrite previous runs.</MUST>
12. <MUST>Print the summary to orchestrator/user on every run, regardless of mode.</MUST>
13. <MUST>Verify server health before re-running assertions in persistent mode.</MUST>
