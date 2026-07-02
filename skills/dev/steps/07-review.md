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

### Gate manifest (mandatory)

Before running this step, ensure `.pm/dev-sessions/{slug}.gates.json` exists:

```json
{
  "schema_version": 1,
  "gates": []
}
```

After every gate below, update that sidecar using the schema in `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/state-schema.md`. The checker is the enforcement point:

```bash
PM_PLUGIN_ROOT="${PM_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:?Set PM_PLUGIN_ROOT to the PM plugin root}}"
node "$PM_PLUGIN_ROOT/scripts/dev-gate-check.js" \
  --manifest .pm/dev-sessions/{slug}.gates.json \
  --commit "$(git rev-parse HEAD)" \
  --base origin/{DEFAULT_BRANCH}
```

If a gate is skipped, the row status is `skipped`, the `commit` is current HEAD, and `reason` is specific. Missing or stale gate rows block push/ship.

### Design critique (UI changes only)

**When compulsory:** Any task that changes UI files or user-visible interaction (`tsx`, `jsx`, `css`, `scss`, static HTML such as `public/index.html`, server-rendered templates such as `templates/base.html`, mobile screens, design-system files, UI config such as `tailwind.config.*`, design-token/theme data such as `tokens/*.json`, page/layout files, copy that affects interface flow). Check the diff and the RFC scope, not just file extensions.

This is PM-native. **Invoke `pm:design-critique` — the skill invocation itself is the gate evidence; performing a critique inline without invoking it does not satisfy the gate** — and do not depend on an external `/design-critique` skill being discoverable. Only when the runtime has no Skill tool at all (e.g. Codex without delegation) read and execute `${CLAUDE_PLUGIN_ROOT}/skills/design-critique/SKILL.md` inline.

| Size | Design critique |
|------|----------------|
| XS | Lite if visual/user-visible UI impact; otherwise explicit `skipped` reason |
| S | Lite (1 round) — invoke `pm:design-critique` |
| M/L/XL | Full — invoke `pm:design-critique` |

#### Closed-loop visual verification (UI changes)

The implementing agent owns the full visual verification cycle. Read `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/design-critique-capture-guide.md` for the detailed capture process.

1. **Create seed task**: `design:seed:{feature_slug}` rake task per `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/design-critique-seed-conventions.md`. Covers all visual states: happy path, empty, edge cases.
2. **Start servers**: Rails API + Vite (web) or Expo (mobile).
3. **Run seed**: `cd apps/api && bin/rails design:seed:{feature_slug}`
4. **Capture screenshots**: Playwright CLI (web) or Maestro MCP (mobile). Max 10. Save to `/tmp/design-review/{feature}/`. Write manifest.
5. **Capture enriched artifacts**: a11y snapshots, visual consistency audit per capture-guide.md.
6. **Visual self-check**: Review own screenshots. Fix obvious issues before invoking critique.
7. **Invoke `pm:design-critique`** (embedded mode if necessary): Returns prioritized findings (P0/P1/P2/P3) with confidence tiers + verdict (Ship/Fix/Rethink).
8. **Fix findings**: Implement P0 and P1 fixes.
9. **Re-seed, re-capture, re-invoke**: If P0s were found. Max 2 rounds total.
10. **Commit**: All design critique changes committed before proceeding to QA.
11. **Record gate**: Update `.pm/dev-sessions/{slug}.gates.json` with `design-critique: passed (commit <sha>)` and the artifact/report path. Run the checker with `--require design-critique`.

#### Skip conditions
- Backend-only, docs-only, non-UI config-only, generated-only, or pure refactor with no user-visible UI impact
- XS changes with no visual or interaction impact, recorded as `skipped` with a reason

Invalid skip reason:
- Skill not available. PM owns `pm:design-critique`; run it inline if needed.

---

### QA gate (UI changes only)

Runs after design critique for any task that changes UI.

#### Skip conditions
- **No UI/user-visible impact** (backend-only, non-UI config-only, docs-only, generated-only, or pure refactor): skip and record `qa: skipped` with a concrete no-UI-impact reason.
- **Dev servers can't start, auth is unavailable, seed data cannot be loaded, or required DB/services are down:** do **not** skip. Record `qa: blocked` with the reason, stop, and ask the user for guidance. A broken QA environment is not a passing ship gate.

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
You are the QA agent for this dev session. Read and follow
${CLAUDE_PLUGIN_ROOT}/skills/dev/references/qa.md.

**Session file:** .pm/dev-sessions/{slug}.md
**Feature:** {feature description from ticket/spec}
**Acceptance criteria:**
{acceptance criteria list}
**Affected routes:** {routes from plan or git diff}
**Platform:** {web | mobile}
**Tier:** {Quick | Focused | Full}
**DEFAULT_BRANCH:** {DEFAULT_BRANCH}

Run full QA (Phase 0-6). Report your verdict.
Verdict must be one of: Pass | Pass with concerns | Fail | Blocked.
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

Also update `.pm/dev-sessions/{slug}.gates.json`:
- `qa` status `passed` for Pass or Pass with concerns
- `qa` status `blocked` for Blocked
- no `passed` row for Fail until issues are fixed and QA re-verifies
- no `skipped` row for environment, server, DB, auth, or seed failures; those are `blocked`
- `artifact` points to the QA report or state section
- `commit` is `git rev-parse HEAD`

---

### Code review

#### Kind override: force pm:review for task/bug

If session state has `kind: task` or `kind: bug`, run the **full `pm:review`** path below regardless of size. Do NOT fall to the XS code-scan path or the S skip path — task/bug items skip grooming and the RFC, so the full review fan-out is their single quality gate and must always run. Log: `Review gate: forced-kind-{kind}`.

For `kind: proposal` (or absent/null via `resolveKind`), the normal size-based routing below applies.

#### Full review (M/L/XL — HARD GATE)

<HARD-GATE>
BEFORE pushing or creating a PR, you MUST invoke `pm:review` on the branch.
This runs the 6-lens review fan-out (conditionally skipping the Design lens when the upstream gate passed). This gate is NOT optional. Do NOT skip it.
If you are about to push and `.pm/dev-sessions/{slug}.md` does not show `Review gate: passed (commit <sha>)` for the current HEAD, or `.pm/dev-sessions/{slug}.gates.json` does not have a current `review` row,
STOP and run the review first.
</HARD-GATE>

**Auto-fix all high-confidence findings.** `pm:review` runs a parallel 6-lens fan-out and tiers output by confidence (see `${CLAUDE_PLUGIN_ROOT}/skills/review/SKILL.md`):
1. **Bugs** — genuine bugs in the diff. Runtime-uniform dispatch via `agent-runtime.md`.
2. **Design system** — compliance. **Conditionally skipped** when `.pm/dev-sessions/{slug}.md` shows Design Critique completed and no contract drift detected.
3. **Input edge cases** — untested edge cases and adversarial inputs.
4. **Reuse / quality / efficiency** — the simplification lenses (absorbed from the former simplify gate): missed reuse of existing code, quality issues, unnecessary work.

High-confidence findings (80+) are auto-fixed and committed. Worth-checking findings (50–79) are surfaced for human judgment. Noisy findings (<50) are listed last for visibility only.

**Checklist (all must be true before PR):**
- [ ] `pm:review` invoked on the branch
- [ ] All high-confidence findings auto-fixed
- [ ] Worth-checking findings resolved or explicitly deferred with a reason
- [ ] Tests still pass after fixes
- [ ] Verification gate passed (see below)
- [ ] `.pm/dev-sessions/{slug}.md` updated with `Review gate: passed (commit <sha>)`
- [ ] `.pm/dev-sessions/{slug}.gates.json` updated with `review: passed` for the same commit, including the `lenses` array (the checker requires `reuse`, `quality`, `efficiency` on M/L/XL manifests)
- [ ] `PM_PLUGIN_ROOT="${PM_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:?Set PM_PLUGIN_ROOT to the PM plugin root}}"; node "$PM_PLUGIN_ROOT/scripts/dev-gate-check.js" --manifest .pm/dev-sessions/{slug}.gates.json --commit "$(git rev-parse HEAD)" --require review` passes

#### Code scan (XS/S — HARD GATE)

<HARD-GATE>
BEFORE pushing XS or S tasks, you MUST run a lightweight code scan.
This catches bugs that tests alone miss: silent no-ops, swallowed errors, race conditions, missing error feedback.
</HARD-GATE>

Dispatch reviewer persona `@staff-engineer` using `agent-runtime.md`. If delegation is unavailable, run the same brief inline.

```text
Scan this diff for genuine bugs AND simplification wins. Max 5 findings
of each. Bugs: silent no-ops, swallowed errors, races, missing error
feedback. Simplification: existing project code that could replace new
code, dead paths, redundant work — only flag when you can name the
specific existing code or the specific unnecessary work.

**Diff:** {git diff {DEFAULT_BRANCH}...HEAD}
**Changed files:** {list}

## Project Context
{PROJECT_CONTEXT}
```

**If findings exist:** fix them, run tests, commit fixes.

After the scan passes, update `.pm/dev-sessions/{slug}.md`:

```
## Review
- Review gate: passed (commit <sha>)
- Review path: code-scan
- Findings fixed: {N}
- Findings deferred: {N with reasons, or none}
```

Then update `.pm/dev-sessions/{slug}.gates.json` with `review: passed`, `artifact` pointing to the scan report or state section, and `commit` set to current HEAD. Run the checker with `--require review`.

---

### Verification gate (mandatory for ALL sizes before merge)

Run the full test suite fresh. Read the output. Confirm 0 failures. Do not rely on recalled test results from earlier in the session. Evidence before claims, always. No "should pass" or "looks correct" — run it, read it, then merge.

After verification passes, update `.pm/dev-sessions/{slug}.md` and `.pm/dev-sessions/{slug}.gates.json` with `verification: passed`, the command output artifact or state section path, and the current commit SHA.

### Final gate recertification (mandatory before full checker)

After verification and after the last possible mutating commit, recertify every required gate against current HEAD before running the default checker. This is not a blind timestamp refresh; it is the rule that keeps early evidence rows useful without letting later commits bypass gates.

For each required gate row in `.pm/dev-sessions/{slug}.gates.json`:

1. If the row is `failed` or `blocked`, stop and resolve that gate first.
2. If `commit` already equals `git rev-parse HEAD`, leave it unchanged.
3. If later commits changed the gate's relevant surface, rerun the gate instead of recertifying:
   - `design-critique`: rerun `pm:design-critique` when UI, static HTML, server-rendered template, design-system, design-token/theme data, copy-flow, responsive, or user-visible interaction files changed after the design evidence commit.
   - `qa`: rerun QA when UI/user-visible files changed after the QA evidence commit. If the environment cannot run, record `qa: blocked`; do not skip.
   - `review`: rerun `pm:review` or the XS/S code scan when any reviewable source/runtime file changed after the review evidence commit.
4. If the gate evidence still applies to current HEAD, preserve `commit`, `artifact`, `status`, and `reason`, then write `verified_commit: "$(git rev-parse HEAD)"` and `verified_at: "<ISO timestamp>"`.
5. For `tdd`, the final verification command may recertify the row when tests still cover the changed behavior; otherwise add or update the missing test first, rerun it, and update the gate.

Append a short state note:

```markdown
## Gate Recertification
- Final HEAD: <sha>
- Recertified: tdd, design-critique, qa, review
- Rerun gates: <none | list>
```

Before handing off to ship, run the shared checker:

```bash
PM_PLUGIN_ROOT="${PM_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:?Set PM_PLUGIN_ROOT to the PM plugin root}}"
node "$PM_PLUGIN_ROOT/scripts/dev-gate-check.js" \
  --manifest .pm/dev-sessions/{slug}.gates.json \
  --commit "$(git rev-parse HEAD)" \
  --base origin/{DEFAULT_BRANCH}
```

If the checker reports a missing or stale gate, run the gate or record a valid skip reason before proceeding. Do not hand off to ship with a failed checker.

---

### Review feedback handling

For M/L/XL, if human reviewers leave comments on the PR after creation, use `ship/references/handling-feedback.md` to process and respond to feedback.

**Gate evidence required before leaving this step** — each item is an observable action, not a judgment call:

- [ ] Review ran: `pm:review` invoked (M+) or the inline code scan executed (XS/S), findings addressed.
- [ ] UI impact → `pm:design-critique` was **invoked as a skill** (the invocation is the gate evidence); no UI impact → `design-critique` recorded as skipped with a concrete reason.
- [ ] UI impact → QA ran (or recorded skipped/blocked per the rules above).
- [ ] Verification: full test suite ran fresh at HEAD, output read.
- [ ] `scripts/dev-gate-check.js` passes for HEAD.

Then hand off to Ship (Step 8).
