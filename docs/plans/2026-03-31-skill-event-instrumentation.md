# PM-093: Skill Event Instrumentation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use dev:subagent-dev to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dashboard activity feed show real lifecycle events by instrumenting pm:ship, pm:dev, and pm:groom with milestone event emissions via the SSE event bus.

**Architecture:** One shared shell script (`scripts/emit-event.sh`) wraps port discovery + fire-and-forget POST. Each SKILL.md gets explicit Bash tool call instructions at milestone points — the agent executing the skill runs `emit-event.sh` as a side effect. Events use the PM-090 schema (`type`, `source`, `timestamp`, `detail`, `source_type: "terminal"`). If no server is running, the event is silently dropped.

**Tech Stack:** Bash (emit-event.sh), SKILL.md instruction edits

---

## Upstream Context

> Injected from research at `pm/research/sse-event-bus/findings.md`.

### Key Findings
- OpenCode validates fire-and-forget event emission from CLI processes to dashboard server
- PM already has `scripts/pm-log.sh` for JSONL analytics — `emit-event.sh` follows the same argument pattern but POSTs to the dashboard instead of appending to a file
- Port discovery utility (`scripts/find-dashboard-port.sh`) built in PM-090 handles server detection and silent failure

### Design Decisions
- Non-blocking: POST runs in background (`&`) with output discarded — skill never waits
- Source field: session slug from `.pm/dev-sessions/{slug}.md` or `.pm/groom-sessions/{slug}.md` when available, else `"{skill}-$$"` (PID fallback)
- Silent drop: if `find-dashboard-port.sh` exits 1, `emit-event.sh` exits 0 immediately

---

## Current State

What **already exists** (dependencies from PM-090):

| Feature | Location |
|---------|----------|
| POST `/events` endpoint — validates `type`, `source`, `timestamp`, returns 201 | `scripts/server.js` (PM-090 Task 1) |
| GET `/events` SSE endpoint — streams events to browser | `scripts/server.js` (PM-090 Task 2) |
| `scripts/find-dashboard-port.sh` — port discovery via project dir hash | `scripts/find-dashboard-port.sh` (PM-090 Task 3) |
| `scripts/pm-log.sh` — JSONL analytics logger (pattern reference) | `scripts/pm-log.sh` |

What **needs building:**

| AC | Gap | Task |
|----|-----|------|
| AC8 | `scripts/emit-event.sh` — shared helper wrapping port discovery + POST | Task 1 |
| AC1 | pm:ship milestone events in `skills/ship/SKILL.md` | Task 2 |
| AC2 | pm:dev milestone events in `skills/dev/references/single-issue-flow.md` | Task 3 |
| AC3 | pm:groom milestone events in `skills/groom/SKILL.md` + phase files | Task 4 |

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `scripts/emit-event.sh` | Create | Shared helper: discover port, POST event, fire-and-forget |
| `skills/ship/SKILL.md` | Modify | Add Bash calls at 4 milestones: pr_created, review_done, tests_passed/failed, merged |
| `skills/dev/references/single-issue-flow.md` | Modify | Add Bash calls at 3 milestones: dev_started, tests_passed/failed, phase_started |
| `skills/groom/SKILL.md` | Modify | Add Bash call at groom_started |
| `skills/groom/phases/phase-1-intake.md` | Modify | Add Bash call: phase_started (intake) |
| `skills/groom/phases/phase-3-research.md` | Modify | Add Bash call: phase_started (research) |
| `skills/groom/phases/phase-4-scope.md` | Modify | Add Bash call: phase_started (scope) |
| `skills/groom/phases/phase-5-groom.md` | Modify | Add Bash call: phase_started (groom) |
| `skills/groom/phases/phase-6-link.md` | Modify | Add Bash call: groom_complete (with issue count) |

---

## Task 1: Create `scripts/emit-event.sh`

**Files:**
- Create: `scripts/emit-event.sh`
- Reference: `scripts/pm-log.sh` (pattern), `scripts/find-dashboard-port.sh` (dependency)

- [ ] **Step 1: Create `scripts/emit-event.sh`**

```bash
#!/usr/bin/env bash
# emit-event.sh — Fire-and-forget event emission to the PM dashboard.
# Usage: emit-event.sh <type> <source> [detail_json]
# Example: emit-event.sh "pr_created" "add-auth" '{"pr_number":42,"url":"..."}'
#
# Discovers the dashboard port via find-dashboard-port.sh.
# If no server is running, exits silently (exit 0).
# POST is non-blocking — never delays the caller.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

TYPE="${1:-}"
SOURCE="${2:-}"
DETAIL="${3:-"{}"}"

if [[ -z "$TYPE" || -z "$SOURCE" ]]; then
  exit 0
fi

# Determine project root (git root or cwd)
PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)

# Discover dashboard port — silent exit if no server
PORT=$("$SCRIPT_DIR/find-dashboard-port.sh" "$PROJECT_ROOT" 2>/dev/null) || exit 0

TS=$(date +%s%3N 2>/dev/null || python3 -c 'import time; print(int(time.time()*1000))' 2>/dev/null || date +%s)

# Fire-and-forget POST — background + discard output
curl -s -o /dev/null -X POST "http://127.0.0.1:${PORT}/events" \
  -H 'Content-Type: application/json' \
  -d "{\"type\":\"${TYPE}\",\"source\":\"${SOURCE}\",\"timestamp\":${TS},\"detail\":${DETAIL},\"source_type\":\"terminal\"}" &

exit 0
```

- [ ] **Step 2: Make script executable**

```bash
chmod +x scripts/emit-event.sh
```

- [ ] **Step 3: Manual smoke test**

With dashboard running:
```bash
# Should POST and return immediately
bash scripts/emit-event.sh "test.manual" "test-source" '{"hello":"world"}'
```

Without dashboard:
```bash
# Should exit 0 silently, no error output
bash scripts/emit-event.sh "test.manual" "test-source" 2>&1
echo $?  # Expected: 0
```

- [ ] **Step 4: Commit**

```bash
git add scripts/emit-event.sh
git commit -m "feat(PM-093): add emit-event.sh — fire-and-forget event helper"
```

---

## Task 2: Instrument pm:ship (4 milestones)

**Files:**
- Modify: `skills/ship/SKILL.md`

The ship skill has 4 clear milestone points. Add a Bash tool call instruction after each one. The source is the session slug from the dev-session file (derived from the branch name).

### Milestone map

| Event type | Where in SKILL.md | After what action |
|---|---|---|
| `pr_created` | Step 5, after `gh pr create` succeeds | PR URL is available |
| `review_done` | Step 6, after code review skill completes | Review posted |
| `tests_passed` / `tests_failed` | Step 7, after CI result is determined | CI watch returns |
| `merged` | Phase 2, after merge loop completes | PR is merged |

- [ ] **Step 1: Add `pr_created` event after Step 5 PR creation**

After the "Report the PR URL" instruction in Step 5 (around the `gh pr create` block), add:

```markdown
5. **Emit event — PR created:**
   ```bash
   SLUG=$(git branch --show-current | sed 's|^feat/||;s|^fix/||;s|^chore/||')
   bash "${CLAUDE_PLUGIN_ROOT}/scripts/emit-event.sh" "pr_created" "${SLUG:-ship-$$}" "{\"pr_number\":${PR_NUMBER},\"url\":\"${PR_URL}\"}"
   ```
```

- [ ] **Step 2: Add `review_done` event after Step 6 code review**

After the code review skill invocation in Step 6, add:

```markdown
After the code review completes, emit the review event:
```bash
SLUG=$(git branch --show-current | sed 's|^feat/||;s|^fix/||;s|^chore/||')
bash "${CLAUDE_PLUGIN_ROOT}/scripts/emit-event.sh" "review_done" "${SLUG:-ship-$$}" "{\"pr_number\":${PR_NUMBER}}"
```
```

- [ ] **Step 3: Add `tests_passed` / `tests_failed` events in Step 7**

In Step 7 "Handle CI result", after the success/failure determination, add:

```markdown
After determining the CI result, emit the appropriate event:
```bash
SLUG=$(git branch --show-current | sed 's|^feat/||;s|^fix/||;s|^chore/||')
if [ "$CI_RESULT" = "success" ]; then
  bash "${CLAUDE_PLUGIN_ROOT}/scripts/emit-event.sh" "tests_passed" "${SLUG:-ship-$$}" "{\"pr_number\":${PR_NUMBER}}"
else
  bash "${CLAUDE_PLUGIN_ROOT}/scripts/emit-event.sh" "tests_failed" "${SLUG:-ship-$$}" "{\"pr_number\":${PR_NUMBER},\"conclusion\":\"${CI_CONCLUSION}\"}"
fi
```
```

- [ ] **Step 4: Add `merged` event at end of Phase 2**

In the "Final Report" section at the end of Phase 2, add before the report:

```markdown
Before printing the final report, emit the merged event:
```bash
SLUG=$(git branch --show-current | sed 's|^feat/||;s|^fix/||;s|^chore/||')
bash "${CLAUDE_PLUGIN_ROOT}/scripts/emit-event.sh" "merged" "${SLUG:-ship-$$}" "{\"pr_number\":${PR_NUMBER},\"target\":\"${DEFAULT_BRANCH}\"}"
```
```

- [ ] **Step 5: Commit**

```bash
git add skills/ship/SKILL.md
git commit -m "feat(PM-093): instrument pm:ship with 4 milestone events"
```

---

## Task 3: Instrument pm:dev (3 milestones)

**Files:**
- Modify: `skills/dev/references/single-issue-flow.md`

The dev skill milestones correspond to stage transitions in the single-issue flow. The source is the dev-session slug.

### Milestone map

| Event type | Where in single-issue-flow.md | After what action |
|---|---|---|
| `dev_started` | Stage 1 (Intake), after state file creation (step 8) | Session slug and size are known |
| `phase_started` | Stage transitions (Stages 2, 3, 4, 5, 5.5, 6, 7) | Each stage start |
| `tests_passed` / `tests_failed` | Stage 5 (Implement), after test suite runs | Test results known |

- [ ] **Step 1: Add `dev_started` event at end of Stage 1 Intake**

After step 8 (state file creation) in Stage 1, add:

```markdown
9. **Emit event — dev started:**
   ```bash
   bash "${CLAUDE_PLUGIN_ROOT}/scripts/emit-event.sh" "dev_started" "${SLUG:-dev-$$}" "{\"title\":\"${TASK_TITLE}\",\"size\":\"${SIZE}\"}"
   ```
```

- [ ] **Step 2: Add `phase_started` events at key stage transitions**

At the beginning of Stage 5 (Implement), Stage 7 (Finish), add:

```markdown
**Emit event — phase started:**
```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/emit-event.sh" "phase_started" "${SLUG:-dev-$$}" "{\"phase\":\"implement\"}"
```
```

```markdown
**Emit event — phase started:**
```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/emit-event.sh" "phase_started" "${SLUG:-dev-$$}" "{\"phase\":\"finish\"}"
```
```

- [ ] **Step 3: Add `tests_passed` / `tests_failed` events**

In the verification gate section of Stage 7 (the mandatory test run before merge), after the test result:

```markdown
After the verification test run, emit the result:
```bash
if [ $TEST_EXIT_CODE -eq 0 ]; then
  bash "${CLAUDE_PLUGIN_ROOT}/scripts/emit-event.sh" "tests_passed" "${SLUG:-dev-$$}" "{\"phase\":\"verification\"}"
else
  bash "${CLAUDE_PLUGIN_ROOT}/scripts/emit-event.sh" "tests_failed" "${SLUG:-dev-$$}" "{\"phase\":\"verification\"}"
fi
```
```

- [ ] **Step 4: Commit**

```bash
git add skills/dev/references/single-issue-flow.md
git commit -m "feat(PM-093): instrument pm:dev with dev_started, phase_started, tests events"
```

---

## Task 4: Instrument pm:groom (3 milestones)

**Files:**
- Modify: `skills/groom/SKILL.md`
- Modify: `skills/groom/phases/phase-1-intake.md`
- Modify: `skills/groom/phases/phase-3-research.md`
- Modify: `skills/groom/phases/phase-4-scope.md`
- Modify: `skills/groom/phases/phase-5-groom.md`
- Modify: `skills/groom/phases/phase-6-link.md`

The groom skill milestones track the grooming lifecycle: session start, phase transitions, and completion with issue count. The source is the groom-session slug.

### Milestone map

| Event type | Where | After what action |
|---|---|---|
| `groom_started` | `SKILL.md`, after tier classification resolves | Topic and tier are known |
| `phase_started` | Each phase file, at the top of the phase | Phase name is known |
| `groom_complete` | `phase-6-link.md`, after issues are created | Issue count is known |

- [ ] **Step 1: Add `groom_started` event in SKILL.md**

After the tier classification section (after the tier is stored in the state file), add:

```markdown
After storing the tier, emit the groom started event:
```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/emit-event.sh" "groom_started" "${SLUG:-groom-$$}" "{\"topic\":\"${TOPIC}\",\"tier\":\"${TIER}\"}"
```
```

- [ ] **Step 2: Add `phase_started` events to phase files**

At the top of each phase file, after the phase heading, add the appropriate emit instruction. For `phase-1-intake.md`:

```markdown
**Emit event — phase started:**
```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/emit-event.sh" "phase_started" "${SLUG:-groom-$$}" "{\"phase\":\"intake\"}"
```
```

For `phase-3-research.md`:

```markdown
**Emit event — phase started:**
```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/emit-event.sh" "phase_started" "${SLUG:-groom-$$}" "{\"phase\":\"research\"}"
```
```

For `phase-4-scope.md`:

```markdown
**Emit event — phase started:**
```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/emit-event.sh" "phase_started" "${SLUG:-groom-$$}" "{\"phase\":\"scope\"}"
```
```

For `phase-5-groom.md`:

```markdown
**Emit event — phase started:**
```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/emit-event.sh" "phase_started" "${SLUG:-groom-$$}" "{\"phase\":\"groom\"}"
```
```

- [ ] **Step 3: Add `groom_complete` event in phase-6-link.md**

After the issues are created (step 3 in Phase 6, after writing to backlog or Linear) and before the state update (step 6), add:

```markdown
5.5. **Emit event — groom complete:**
```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/emit-event.sh" "groom_complete" "${SLUG:-groom-$$}" "{\"issue_count\":${ISSUE_COUNT},\"topic\":\"${TOPIC}\"}"
```
```

- [ ] **Step 4: Commit**

```bash
git add skills/groom/SKILL.md skills/groom/phases/phase-1-intake.md skills/groom/phases/phase-3-research.md skills/groom/phases/phase-4-scope.md skills/groom/phases/phase-5-groom.md skills/groom/phases/phase-6-link.md
git commit -m "feat(PM-093): instrument pm:groom with groom_started, phase_started, groom_complete events"
```

---

## Event Catalog

All events emitted after this plan is implemented:

| Event type | Skill | Detail fields | When |
|---|---|---|---|
| `pr_created` | ship | `pr_number`, `url` | After PR creation |
| `review_done` | ship | `pr_number` | After code review posted |
| `tests_passed` | ship | `pr_number` | After CI passes |
| `tests_failed` | ship | `pr_number`, `conclusion` | After CI fails |
| `merged` | ship | `pr_number`, `target` | After PR merges |
| `dev_started` | dev | `title`, `size` | After intake completes |
| `phase_started` | dev | `phase` | At implement, finish stage starts |
| `tests_passed` | dev | `phase` | After verification tests pass |
| `tests_failed` | dev | `phase` | After verification tests fail |
| `groom_started` | groom | `topic`, `tier` | After tier classification |
| `phase_started` | groom | `phase` | At each phase entry |
| `groom_complete` | groom | `issue_count`, `topic` | After issues created in Phase 6 |

All events share the schema: `{ type, source, timestamp, detail, source_type: "terminal" }`.
