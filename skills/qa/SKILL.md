---
name: qa
description: "QA testing ship gate for the dev lifecycle. Generates test charters from diff/spec, tests via Playwright CLI (web) or Maestro MCP (mobile), reports findings with health score and ship verdict. Does not fix — reports only. Dev flow fixes, QA re-verifies."
---

# QA — Testing Ship Gate

Report-only QA gate for the dev lifecycle (Stage 6.5). Tests the running app, scores health, delivers a ship/no-ship verdict. Never modifies source code.

**Separation of concerns:** QA finds problems. The dev flow fixes them. QA re-verifies.

## Tiers

| Tier | Dev Size | What | Duration |
|------|----------|------|----------|
| **Quick** | XS | Smoke check — navigate affected routes, check console errors, verify render | ~1 min |
| **Focused** | S | Diff-aware — build test charter from changed files, test affected routes | ~2-3 min |
| **Full** | M/L/XL | Charter + exploratory + scripted checks + before/after screenshots at 3 viewports | ~5-8 min |

## Invocation

**From /dev (embedded):**

```
pm:qa
```

Context passed automatically from `.pm/dev-sessions/{slug}.md`: feature description, affected routes, acceptance criteria, platform.

**Standalone:**

```
pm:qa --page /dashboard
pm:qa --feature "user onboarding flow"
pm:qa --diff
```

**Arguments:**

| Arg | Effect |
|-----|--------|
| `--quick` | Force Quick tier regardless of session size |
| `--page <route>` | Test a specific route |
| `--feature <desc>` | Test by feature description |
| `--diff` | Build charter from `git diff {DEFAULT_BRANCH}...HEAD` |
| `--mobile` | Force mobile platform (Maestro MCP) |
| `--re-verify` | Re-test only previous failures, update verdict |

---

## Reference Files

| File | Purpose | When to Read |
|------|---------|--------------|
| `${CLAUDE_PLUGIN_ROOT}/skills/qa/references/issue-taxonomy.md` | Severity levels + 7 category definitions | Phase 4 (scoring) |
| `${CLAUDE_PLUGIN_ROOT}/skills/design-critique/references/capture-guide.md` | Platform detection, server lifecycle, Playwright CLI usage | Phase 3 (test execution) |
| `${CLAUDE_PLUGIN_ROOT}/skills/design-critique/references/seed-conventions.md` | Seed data conventions | Phase 3 (when seed data needed) |

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

## Phase 1: Orient

### Read session state

If `.pm/dev-sessions/{slug}.md` exists (derive slug from `git branch --show-current`, stripping `feat/`/`fix/`/`chore/` prefix):

- Extract: feature description, platform, affected routes, acceptance criteria, dev size
- If `--re-verify`: also read previous QA findings from `## QA` section

If no session file and no `--page`/`--feature` arg: ask user what to test.

### Detect platform

```
{APP_PATH}/app.config.ts or app.json exists  ->  "mobile" (Maestro MCP)
package.json contains "expo" or "react-native" ->  "mobile"
--mobile flag present                          ->  "mobile"
Otherwise                                      ->  "web" (Playwright CLI)
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
  Re-verify: {yes/no}
```

---

## Phase 2: Test Charter

Build the charter based on tier. The charter drives Phase 3 execution.

### Quick

Charter is a single line:

```
Smoke check: navigate {routes}, verify render, check console for errors.
```

No further analysis needed.

### Focused

1. Run `git diff {DEFAULT_BRANCH}...HEAD --name-only` to get changed files
2. Map changed files to routes/screens:
   - Component files -> their parent page routes
   - API endpoints -> pages that call them
   - Styles/layouts -> all pages using them
3. Build charter:

```markdown
## Test Charter (Focused)

### Affected Routes
- /route-1 — changed: ComponentA.tsx, useHook.ts
- /route-2 — changed: api/endpoint.ts (upstream)

### Checks per Route
- Navigate and verify render
- Console errors (filter noise: React DevTools, HMR)
- Interactive elements in changed components
- Data loading states (empty, populated, error)
```

### Full

1. Read acceptance criteria from session state or `--feature` description
2. Run `git diff {DEFAULT_BRANCH}...HEAD --name-only` for changed files
3. Build comprehensive charter:

```markdown
## Test Charter (Full)

### Scope
{feature description}

### Routes & Screens
- /route-1 — primary (changed directly)
- /route-2 — secondary (upstream dependency)

### Test Cases
**Happy path:**
- [ ] {case 1}
- [ ] {case 2}

**Error paths:**
- [ ] {case 1 — invalid input, network failure, etc.}

**Edge cases:**
- [ ] Empty state (no data)
- [ ] Boundary values
- [ ] Rapid interactions / double-submit

**Responsiveness (3 viewports):**
- [ ] Desktop (1440px)
- [ ] Tablet (768px)
- [ ] Mobile (375px)

**Accessibility:**
- [ ] Keyboard navigation
- [ ] Focus management
- [ ] Color contrast (visual check)
```

---

## Phase 3: Execute Tests

### Start servers

Read `${CLAUDE_PLUGIN_ROOT}/skills/design-critique/references/capture-guide.md` for the server lifecycle pattern.

1. Check if dev server is already running (probe expected port)
2. If not running: start server in background, wait for ready
3. Record PID for cleanup

<HARD-RULE>
If servers won't start after 2 attempts: verdict = Blocked. Report the error. Do not proceed.
</HARD-RULE>

### Run seed data (if needed)

For Full tier or when testing data-dependent flows, check `${CLAUDE_PLUGIN_ROOT}/skills/design-critique/references/seed-conventions.md` for seed task conventions. Run seed to populate realistic data.

### Web testing (Playwright CLI)

For each route in the charter:

1. **Navigate:** Open the route, wait for network idle
2. **Console check:** Capture console errors and warnings (filter: React DevTools, HMR, favicon 404)
3. **Visual check:** Take screenshot. For Full tier, capture at all 3 viewports.
4. **Interact:** Click interactive elements from the charter, verify state changes
5. **Links:** Check that navigation links resolve (no 404s)
6. **Performance:** Note obvious slowness (> 3s load, layout shifts)

### Mobile testing (Maestro MCP)

For each screen in the charter:

1. **Launch:** Open app, navigate to target screen
2. **Visual check:** Take screenshot
3. **Interact:** Tap interactive elements, verify transitions
4. **Gestures:** Test scroll, swipe, pull-to-refresh where relevant
5. **Orientation:** Portrait and landscape for Full tier

### Screenshot naming

```
/tmp/qa/{feature}/{NN}-{page}-{state}.png
```

Examples:
- `01-dashboard-loaded.png`
- `02-dashboard-empty-state.png`
- `03-dashboard-mobile-375.png`
- `04-settings-error-toast.png`

<HARD-RULE>
Max 15 screenshots per run. Prioritize: errors > edge cases > happy paths.
</HARD-RULE>

---

## Phase 4: Analyze & Score

Read `${CLAUDE_PLUGIN_ROOT}/skills/qa/references/issue-taxonomy.md` for full category definitions and severity criteria.

### 7 Categories

| Category | Weight | What to look for |
|----------|--------|-----------------|
| **Console** | 15% | JS errors, unhandled rejections, deprecation warnings |
| **Links** | 10% | Broken links, 404s, dead-end navigation |
| **Visual** | 10% | Layout breaks, overflow, misalignment, missing assets |
| **Functional** | 20% | Features that don't work, wrong data, broken interactions |
| **UX** | 15% | Confusing flows, missing feedback, unexpected behavior |
| **Performance** | 10% | Slow loads (> 3s), layout shifts, janky animations |
| **Accessibility** | 15% | Missing labels, keyboard traps, contrast issues, no focus indicators |

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

### Finding Format

Every finding MUST include evidence:

```markdown
### [SEVERITY] Category: Short description

**Route:** /path
**Evidence:** screenshot `/tmp/qa/{feature}/NN-page-state.png` | console output | repro steps
**Repro:** 1. Navigate to /path  2. Click X  3. Observe Y
**Expected:** Z
**Actual:** W
```

<HARD-RULE>
NEVER report a finding without evidence. No screenshot, no console output, no repro steps = not a finding.
</HARD-RULE>

---

## Phase 5: Verdict

| Verdict | Criteria | Action |
|---------|----------|--------|
| **Pass** | Health >= 80, zero Critical, zero High | Ship it. |
| **Pass with concerns** | Health >= 60, zero Critical, <= 2 High | Ship with caution. Note High issues for immediate backlog. |
| **Fail** | Health < 60, OR any Critical, OR > 2 High | Do not ship. Must fix and re-verify. |
| **Blocked** | Servers won't start, can't navigate, env broken | Cannot test. Ask user to fix environment. |

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
- **Screenshots:** /tmp/qa/{feature}/

#### Findings ({N} total: {C} critical, {H} high, {M} medium, {L} low)

{findings in severity order, each with evidence}

#### Category Breakdown
| Category | Score | Findings |
|----------|-------|----------|
| Console | {score} | {count} |
| Links | {score} | {count} |
| Visual | {score} | {count} |
| Functional | {score} | {count} |
| UX | {score} | {count} |
| Performance | {score} | {count} |
| Accessibility | {score} | {count} |
```

### Standalone mode (no dev session)

Write full report to `/tmp/qa/{feature}/report.md`.

### Print summary to user

Always print, regardless of mode:

```
QA Complete
  Verdict: {verdict}
  Health: {score}/100
  Issues: {C} critical, {H} high, {M} medium, {L} low
  Top issues:
    1. [SEV] {short description} — {route}
    2. [SEV] {short description} — {route}
    3. [SEV] {short description} — {route}
  Screenshots: /tmp/qa/{feature}/
```

---

## Re-verification Mode (`--re-verify`)

Triggered after the dev flow fixes issues from a previous QA run.

### Flow

1. Read previous findings from `.pm/dev-sessions/{slug}.md` `## QA` section
2. Filter to Critical and High findings (skip Medium/Low unless explicitly requested)
3. Re-test ONLY the affected routes and specific interactions from those findings
4. For each previous finding: mark as **Fixed** or **Still present**
5. Re-check for regressions introduced by fixes (quick smoke of adjacent routes)
6. Recompute health score with updated findings
7. Update verdict:
   - All Critical/High fixed -> upgrade verdict (Fail -> Pass or Pass with concerns)
   - Some remain -> keep Fail, list remaining

### Report format (re-verify)

Append to existing `## QA` section. Do NOT overwrite previous runs.

```markdown
### Run 2 (Re-verify) — {date}
- **Previous verdict:** {Fail}
- **Updated verdict:** {Pass/Pass with concerns/Fail}
- **Previous health:** {score}/100
- **Updated health:** {score}/100

#### Fixed
- [HIGH] {description} — FIXED (verified at /route)
- [CRITICAL] {description} — FIXED (verified at /route)

#### Still Present
- [HIGH] {description} — NOT FIXED (evidence: screenshot)

#### New Issues
- {any regressions found}
```

---

## Server Lifecycle

Reuse the server lifecycle pattern from `${CLAUDE_PLUGIN_ROOT}/skills/design-critique/references/capture-guide.md`.

```
Start: detect framework, run dev server, wait for port ready
Track: store PID
Cleanup: kill PID when QA completes (pass or fail)
```

<HARD-RULE>
ALWAYS kill servers you started, even on early exit or Blocked verdict. Check with `lsof -ti:{port}` and kill if your PID.
</HARD-RULE>

---

## State File Integration

QA reads from and writes to `.pm/dev-sessions/{slug}.md`.

**Reads:**
- Feature description, platform, affected routes, acceptance criteria (Phase 1)
- Dev session size for tier detection (Phase 1)
- Previous QA findings for re-verify (Phase 1, `--re-verify`)

**Writes:**
- `## QA` section with verdict, health score, findings (Phase 6)
- Re-verify results appended to same section (Re-verify mode)

If `.pm/dev-sessions/` does not exist, create it (`mkdir -p .pm/dev-sessions`) before writing.

Legacy path: also check `.dev-state-{slug}.md` at repo root. Read from legacy if found, write to new path.

---

## Limits

| Limit | Value | On exceed |
|-------|-------|-----------|
| Screenshots per run | 15 | Prioritize by severity |
| Server start attempts | 2 | Verdict = Blocked |
| Routes per Quick run | 3 | Focus on most affected |
| Routes per Focused run | 8 | Prioritize by diff coverage |
| Routes per Full run | 15 | Cover all charter routes |
| Re-verify scope | Previous Critical + High only | Skip Medium/Low unless asked |

---

## Critical Rules

1. <NEVER>Modify source code. QA is read-only + browser interaction only.</NEVER>
2. <NEVER>Skip the health score. Even zero-finding runs report 100/100.</NEVER>
3. <NEVER>Report findings without evidence. Screenshot path, console output, or repro steps required.</NEVER>
4. <NEVER>Leave servers running. Kill all servers started by QA on completion.</NEVER>
5. <MUST>For Full tier: test at minimum 3 viewports (1440px, 768px, 375px).</MUST>
6. <MUST>For re-verify: append to existing QA section, never overwrite previous runs.</MUST>
7. <MUST>Print the summary to user on every run, regardless of mode.</MUST>
8. <MUST>Include the route and evidence for every finding.</MUST>
