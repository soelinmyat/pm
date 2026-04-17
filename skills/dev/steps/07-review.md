---
name: Review
order: 7
description: Quality gates — design critique, QA, code review, and verification before ship
---

## Review

**Multi-task skip:** If `task_count > 1` in the session state, skip this step. Per-task agents in Step 05 handled review as part of their own lifecycle. This applies regardless of individual task outcomes (merged, blocked, or failed).

## Goal

Apply the right review, QA, and design critique depth for the task size so implementation does not ship without the required quality gates.

<HARD-RULE>
After the user approves the RFC (via /rfc), the orchestrator proceeds through all quality gates in this step — design critique, QA, code review, verification — without pausing. Do NOT ask "Ready for design critique?", "Proceed to QA?", "Continue with review?", or present options between gates.

Only stop for:
- QA verdict of **Blocked** (ask user for guidance)
- Review findings that require a human design/product call
- Test failures that can't be resolved after 3 attempts
</HARD-RULE>

---

### Design critique (UI changes only)

**Conditional availability:** `/design-critique` is a skill in the dev plugin. Before invoking, verify the skill exists via the Skill tool. If not available, log "Design critique: skipped (skill not available)" in `.pm/dev-sessions/{slug}.md` and proceed to QA.

**When compulsory:** Any task that changes UI files (tsx/jsx/css in diff). Check: `git diff {DEFAULT_BRANCH}...HEAD --name-only | grep -E '\.(tsx|jsx|css)$'`

| Size | Design critique |
|------|----------------|
| XS | Skip |
| S | Lite (1 round) — invoke `/design-critique` if available |
| M/L/XL | Full — invoke `/design-critique` if available |

#### Closed-loop visual verification (S+ with UI changes)

The implementing agent owns the full visual verification cycle. Read `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/design-critique-capture-guide.md` for the detailed capture process.

1. **Create seed task**: `design:seed:{feature_slug}` rake task per `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/design-critique-seed-conventions.md`. Covers all visual states: happy path, empty, edge cases.
2. **Start servers**: Rails API + Vite (web) or Expo (mobile).
3. **Run seed**: `cd apps/api && bin/rails design:seed:{feature_slug}`
4. **Capture screenshots**: Playwright CLI (web) or Maestro MCP (mobile). Max 10. Save to `/tmp/design-review/{feature}/`. Write manifest.
5. **Capture enriched artifacts**: a11y snapshots, visual consistency audit per capture-guide.md.
6. **Visual self-check**: Review own screenshots. Fix obvious issues before invoking critique.
7. **Invoke `/design-critique`** (embedded mode): Returns prioritized findings (P0/P1/P2) with confidence tiers + verdict (Ship/Fix/Rethink).
8. **Fix findings**: Implement P0 and P1 fixes.
9. **Re-seed, re-capture, re-invoke**: If P0s were found. Max 2 rounds total.
10. **Commit**: All design critique changes committed before proceeding to QA.

#### Skip conditions
- XS tasks
- Backend-only, config-only, pure refactor (no tsx/jsx/css in diff)
- Skill not available

---

### QA gate (UI changes only)

Runs after design critique for any task that changes UI.

#### Skip conditions
- **Backend-only, config-only, docs-only:** skip
- **Dev servers can't start** (e.g. DB not running): skip, log reason in `.pm/dev-sessions/{slug}.md`

#### Size routing

| Size | QA depth |
|------|----------|
| XS | Quick |
| S | Focused |
| M/L/XL | Full |

#### Dispatch

Dispatch reviewer persona `@tester` using `agent-runtime.md`.

**QA brief:**

```text
You are the QA agent for this dev session. Follow the pm:qa skill.

**Session file:** .pm/dev-sessions/{slug}.md
**Feature:** {feature description from ticket/spec}
**Acceptance criteria:**
{acceptance criteria list}
**Affected routes:** {routes from plan or git diff}
**Platform:** {web | mobile}
**Tier:** {Quick | Focused | Full}
**DEFAULT_BRANCH:** {DEFAULT_BRANCH}

Run full QA (Phase 0-6). Report your verdict.
```

#### Gate behavior

| QA Verdict | Action |
|------------|--------|
| **Pass** | Proceed to code review |
| **Pass with concerns** | Proceed. Low/Medium issues noted in `.pm/dev-sessions/{slug}.md` for backlog. |
| **Fail** | Fix issues, then re-verify (see below). |
| **Blocked** | Stop. Log reason in `.pm/dev-sessions/{slug}.md`. Ask user for guidance. |

**Shipping does not continue after QA Fail.** Fix issues and re-verify. No silent downgrades.

#### Re-verify

When QA returns **Fail**, fix the issues, run tests, then re-run QA:

```text
Fixed the following issues:
1. {finding-id}: {what was fixed}
2. {finding-id}: {what was fixed}

Re-verify these specific findings. Also smoke-check adjacent routes for regressions.
Do NOT re-run Phase 0 when the environment is still ready. Jump to Phase 3 re-verify.
```

#### Handling issues found

- **Critical/High:** Fix immediately, re-verify.
- **Medium in core flow:** Fix before proceeding.
- **Medium in edge flows:** Note in state file, create backlog items after merge.
- **Low:** Note in state file, do not fix this session.

#### State file update

After QA completes (final verdict), update `.pm/dev-sessions/{slug}.md`:
```
## QA
- QA verdict: Pass | Pass with concerns | Fail | Blocked
- Ship recommendation: Ship | Ship with caution | Do not ship | Blocked
- Issues found: none | Critical: N, High: N, Medium: N, Low: N
- Issues fixed: [list]
- Issues deferred: [list]
- Iterations: N
```

---

### Code review

#### Kind override: force pm:review for task/bug

If session state has `kind: task` or `kind: bug`, run the **full `pm:review`** path below regardless of size. Do NOT fall to the XS code-scan path or the S skip path — task/bug items forfeit the simplify gate (Step 06 skipped them), so review is the single code-quality gate and must always run. Log: `Review gate: forced-kind-{kind}`.

For `kind: proposal` (or absent/null via `resolveKind`), the normal size-based routing below applies.

#### Full review (M/L/XL — HARD GATE)

<HARD-GATE>
BEFORE pushing or creating a PR, you MUST invoke `pm:review` on the branch.
This runs up to 3 review agents (conditionally skipping Design when upstream gate passed). This gate is NOT optional. Do NOT skip it.
If you are about to push and `.pm/dev-sessions/{slug}.md` does not show `Review gate: passed`,
STOP and run the review first.
</HARD-GATE>

**Auto-fix all high-confidence findings.** `pm:review` runs up to 3 agents and tiers output by confidence (see `${CLAUDE_PLUGIN_ROOT}/skills/review/SKILL.md`):
1. **Code Reviewer** — genuine bugs in the diff. Runtime-uniform dispatch via `agent-runtime.md`.
2. **Design Reviewer** — design system compliance. **Conditionally skipped** when `.pm/dev-sessions/{slug}.md` shows Design Critique completed and no contract drift detected.
3. **Input Edge-Case Reviewer** — untested edge cases and adversarial inputs.

High-confidence findings (80+) are auto-fixed and committed. Worth-checking findings (50–79) are surfaced for human judgment. Noisy findings (<50) are listed last for visibility only.

**Checklist (all must be true before PR):**
- [ ] `pm:review` invoked on the branch
- [ ] All high-confidence findings auto-fixed
- [ ] Worth-checking findings resolved or explicitly deferred with a reason
- [ ] Tests still pass after fixes
- [ ] Verification gate passed (see below)
- [ ] `.pm/dev-sessions/{slug}.md` updated with `Review gate: passed (commit <sha>)`

#### Code scan (XS — HARD GATE)

<HARD-GATE>
BEFORE merging XS tasks, you MUST run a lightweight code scan.
This catches bugs that tests alone miss: silent no-ops, swallowed errors, race conditions, missing error feedback.
S tasks skip this — `pm:simplify` (which runs for S+) already covers the same ground.
</HARD-GATE>

Dispatch reviewer persona `@staff-engineer` using `agent-runtime.md`. If delegation is unavailable, run the same brief inline.

```text
Scan for genuine bugs in this diff. Max 5 findings.

**Diff:** {git diff {DEFAULT_BRANCH}...HEAD}
**Changed files:** {list}

## Project Context
{PROJECT_CONTEXT}
```

**If findings exist:** fix them, run tests, commit fixes.

#### S size — skip code review

S tasks skip both code scan and full review. The simplify gate (Step 06) is the only code review gate for S.

---

### Verification gate (mandatory for ALL sizes before merge)

Run the full test suite fresh. Read the output. Confirm 0 failures. Do not rely on recalled test results from earlier in the session. Evidence before claims, always. No "should pass" or "looks correct" — run it, read it, then merge.

---

### Review feedback handling

For M/L/XL, if human reviewers leave comments on the PR after creation, use `ship/references/handling-feedback.md` to process and respond to feedback.

## Done-when

The size-appropriate review path has passed, all required QA/design gates for UI work are complete, and final verification has run before handing off to ship.

**Advance:** proceed to Step 8 (Ship).
