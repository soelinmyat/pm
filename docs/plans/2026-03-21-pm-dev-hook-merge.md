# PM-048: Merge SessionStart Hooks

**Date:** 2026-03-21
**Parent:** PM-044 (Merge PM and Dev plugins)
**Status:** Draft

---

## Overview

Merge both plugins' SessionStart hooks into one unified hook chain. PM currently has one hook script (`check-setup.sh`); dev has two (`check-setup.sh` + `session-start`). The merged plugin needs a single `hooks.json` that runs all hook logic sequentially with combined output under 4,000 characters.

### Current State

| Plugin | hooks.json entries | Scripts | Total bytes |
|--------|-------------------|---------|-------------|
| PM | 1 SessionStart matcher → `check-setup.sh` | `check-setup.sh` (3,722 B) | 3,722 B |
| Dev | 1 SessionStart matcher → `check-setup.sh` + `session-start` | `check-setup.sh` (1,732 B), `session-start` (1,372 B) | 3,104 B |

### Problem: PM's Early Exit

PM's `check-setup.sh` exits at line 36 (`exit 0`) when `.pm/config.json` is absent. This kills the entire hook chain — dev's advisory checks and the `session-start` preload never run. The merged script must make the first-run detection advisory-only (print message, continue execution) rather than an exit gate.

### Problem: using-dev/SKILL.md Preload

Dev's `session-start` script reads `skills/using-dev/SKILL.md` (3,503 bytes) and injects it into session context via `hookSpecificOutput.additionalContext`. This preload mechanism must survive the merge and cover all 23 skills (not just dev's 14). The file itself already serves as a routing table — after PM-047 colocates skills, this file needs to be updated to include PM skills too.

---

## Decisions

### 1. Single Merged `check-setup.sh`

Combine PM's `check-setup.sh` and dev's `check-setup.sh` into one script. Rationale:
- Both do advisory checks; combining eliminates duplication (both set `PROJECT_DIR`, both check for missing files)
- A single script can enforce execution order and guarantee no early exits block downstream logic

### 2. Keep `session-start` as Separate Script

The `session-start` script has a fundamentally different purpose (JSON context injection via `hookSpecificOutput`) vs `check-setup.sh` (plain text warnings). Keep them as two scripts in the hooks array, matching dev's current pattern.

### 3. Execution Order

```
hooks.json SessionStart
  ├── 1. check-setup.sh (advisory checks + first-run + update check)
  └── 2. session-start   (using-dev SKILL.md preload)
```

Within `check-setup.sh`, execution order:
1. **Advisory checks** (CLAUDE.md, AGENTS.md, .gitignore) — never exit early, always continue
2. **First-run detection** (.pm/config.json absent → print advisory, do NOT exit)
3. **Daily update check** (git ls-remote + marketplace sync)

### 4. Update Check URL

PM's `check-setup.sh` line 71 already points to `https://github.com/soelinmyat/pm.git` — this is the correct merged repo URL. No change needed.

### 5. using-dev/SKILL.md Scope

After PM-047 colocates all 23 skills, the `using-dev/SKILL.md` routing table must be updated to include PM skills alongside dev skills. This makes the preloaded context cover the full merged plugin. The file is currently 3,503 bytes. Adding 9 PM skill rows (~50 bytes each = ~450 bytes) brings it to ~3,950 bytes — still under 4K for the file itself.

### 6. Output Budget (4,000 char limit)

Worst-case combined output:
- Advisory checks (all warnings fire): ~500 chars
- First-run message: ~200 chars
- Update available message: ~80 chars
- **check-setup.sh total worst case: ~780 chars**
- session-start JSON output: depends on using-dev SKILL.md size (~3,950 bytes after PM skill additions → ~4,200 chars escaped in JSON)

The 4,000 char AC applies to the combined **visible** hook output (what the user sees). The `session-start` output is structured JSON consumed by the platform (not displayed), so it doesn't count toward the visible budget. The `check-setup.sh` plain-text output is well within 4,000 chars even in worst case.

If the AC intends total output including JSON: the using-dev SKILL.md content will need to stay concise. Current content (3,503 B) + PM additions (~450 B) = ~3,950 B. The JSON wrapper adds ~200 B overhead. This totals ~4,150 B for session-start alone. If this exceeds the budget, the SKILL.md can be trimmed (the table format is already dense). However, session context injection is meant to be platform-consumed, not user-visible, so the 4K limit likely applies only to check-setup.sh output.

---

## File Changes

### A. `hooks/hooks.json` — Rewrite

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume|clear|compact",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/check-setup.sh",
            "async": false
          },
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/session-start",
            "async": false
          }
        ]
      }
    ]
  }
}
```

This matches dev's current structure: two hooks in one matcher, both synchronous.

### B. `hooks/check-setup.sh` — Merge and Reorder

The merged script combines PM's check-setup.sh with dev's check-setup.sh. Structure:

```bash
#!/usr/bin/env bash
# Merged SessionStart hook for pm plugin.
# Execution order:
#   1. Advisory checks (CLAUDE.md, AGENTS.md, .gitignore) — never exit early
#   2. First-run detection (.pm/config.json absent → advisory only)
#   3. Daily update check (git ls-remote + marketplace sync)

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "$0")")}"

# --- Helpers ---
wait_or_kill() { ... }  # From PM's current check-setup.sh

WARNINGS=""

# --- 1. Advisory checks (from dev's check-setup.sh) ---
# CLAUDE.md check
# AGENTS.md check
# .gitignore coverage check
# (all append to WARNINGS, never exit)

# --- 2. First-run detection (from PM's check-setup.sh, modified) ---
if [ ! -f "$PROJECT_DIR/.pm/config.json" ]; then
  WARNINGS="${WARNINGS}PM plugin is not configured for this project. Run /pm:setup to bootstrap...\n"
  # NOTE: no exit 0 here — continue to update check and let session-start run
fi

# Print accumulated warnings
if [ -n "$WARNINGS" ]; then
  printf "Plugin advisory:\n${WARNINGS}"
fi

# --- 3. Update check (from PM's check-setup.sh, unchanged) ---
# stamp file, git ls-remote, marketplace sync...
```

Key changes from PM's current `check-setup.sh`:
1. **Remove `exit 0` at line 36** — first-run detection becomes advisory, appends to WARNINGS instead of printing and exiting
2. **Add dev's advisory checks before first-run** — CLAUDE.md, AGENTS.md, .gitignore checks from dev's check-setup.sh
3. **Unified warning header** — "Plugin advisory:" instead of separate "Dev plugin advisory:" and bare PM messages
4. **All scripts use `${CLAUDE_PLUGIN_ROOT}`** — dev's session-start currently uses `SCRIPT_DIR`/`PLUGIN_ROOT` detection; change to use `CLAUDE_PLUGIN_ROOT` with fallback

### C. `hooks/session-start` — Copy from Dev and Adapt

Copy dev's `hooks/session-start` with these changes:
1. Replace `SCRIPT_DIR`/`PLUGIN_ROOT` detection with `${CLAUDE_PLUGIN_ROOT}` (with fallback to dirname detection)
2. Add a guard for missing `using-dev/SKILL.md` — print visible warning instead of silent skip (AC #3)

```bash
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
SKILL_FILE="${PLUGIN_ROOT}/skills/using-dev/SKILL.md"

if [ ! -f "$SKILL_FILE" ]; then
  echo "Warning: using-dev/SKILL.md not found at ${SKILL_FILE}. Skill routing unavailable."
  exit 0
fi
```

The rest of the script (JSON escape, hookSpecificOutput output) stays the same.

### D. `skills/using-dev/SKILL.md` — Add PM Skills

After PM-047 colocates all 23 skills, update the routing table to include PM skills:

```markdown
| User wants PM setup / config | `pm:setup` | First-time project configuration |
| Research a topic or competitor | `pm:research` | Landscape mapping, competitor deep-dives |
| Product strategy work | `pm:strategy` | Positioning, strategic bets, GTM |
| Generate feature ideas | `pm:ideate` | Idea generation from strategy + research |
| Groom backlog issues | `pm:groom` | Convert strategy into sprint-ready issues |
| Ad-hoc deep research question | `pm:dig` | Focused research on a specific question |
| Import customer evidence | `pm:ingest` | Import files, transcripts, feedback |
| Audit research freshness | `pm:refresh` | Check for staleness, patch without losing content |
| Browse accumulated artifacts | `pm:view` | Search and navigate research/strategy |
```

Also update the file title from "Using Dev Skills" to "Using Plugin Skills" and adjust the intro text.

---

## Verification

### AC #1: Single hooks.json with one SessionStart matcher

```bash
cat hooks/hooks.json | python3 -c "
import json, sys
d = json.load(sys.stdin)
matchers = d['hooks']['SessionStart']
assert len(matchers) == 1, f'Expected 1 matcher, got {len(matchers)}'
hooks = matchers[0]['hooks']
assert len(hooks) == 2, f'Expected 2 hooks, got {len(hooks)}'
print(f'OK: 1 matcher, {len(hooks)} hooks')
"
```

### AC #2: Execution order and no early exit

```bash
# Verify no unconditional exit before update check section
grep -n 'exit 0' hooks/check-setup.sh
# Expected: only in update check section (after line ~60), not in first-run block
```

### AC #3: using-dev/SKILL.md covers all 23 skills

```bash
# Count skill references in using-dev/SKILL.md
skill_count=$(grep -c '|.*`.*:.*`.*|' skills/using-dev/SKILL.md)
echo "Skill references: $skill_count"
# Expected: 23 (or close — some internal skills may be grouped)
```

### AC #4: Combined output ≤ 4,000 characters

```bash
# Simulate worst-case check-setup.sh output
CLAUDE_PROJECT_DIR=/tmp/empty-project CLAUDE_PLUGIN_ROOT="$(pwd)" \
  bash hooks/check-setup.sh 2>/dev/null | wc -c
# Expected: well under 4,000
```

### AC #5: Update check points to merged repo URL

```bash
grep 'github.com/soelinmyat/pm' hooks/check-setup.sh
# Expected: https://github.com/soelinmyat/pm.git
```

### AC #6: All scripts use `${CLAUDE_PLUGIN_ROOT}`

```bash
# check-setup.sh uses CLAUDE_PLUGIN_ROOT
grep 'CLAUDE_PLUGIN_ROOT' hooks/check-setup.sh
# session-start uses CLAUDE_PLUGIN_ROOT
grep 'CLAUDE_PLUGIN_ROOT' hooks/session-start
# No raw SCRIPT_DIR detection without CLAUDE_PLUGIN_ROOT fallback
```

### AC #7: Preloading verification

```bash
# Simulate session-start and verify JSON output
CLAUDE_PLUGIN_ROOT="$(pwd)" bash hooks/session-start | python3 -c "
import json, sys
d = json.load(sys.stdin)
ctx = d.get('hookSpecificOutput', {}).get('additionalContext', '')
assert 'using-dev' in ctx or 'Using Plugin' in ctx, 'Preload content missing'
assert len(ctx) > 100, f'Content too short: {len(ctx)} chars'
print(f'OK: preloaded {len(ctx)} chars of context')
"
```

---

## Dependencies

- **PM-047 (Colocate skills)** must complete first — `session-start` reads `skills/using-dev/SKILL.md` which needs to exist in PM's tree
- **PM-046 (Manifest unification)** — Cursor's plugin.json points to `./hooks/hooks.json`, so the hook file must be correct before the manifest is finalized

## Tasks

1. Rewrite `hooks/hooks.json` to include both `check-setup.sh` and `session-start` in a single SessionStart matcher
2. Merge dev's advisory checks (CLAUDE.md, AGENTS.md, .gitignore) into `hooks/check-setup.sh` — insert before first-run detection
3. Remove PM's early exit at line 36 — make first-run detection advisory-only (append to WARNINGS, continue execution)
4. Update header/label from "Dev plugin advisory:" to unified "Plugin advisory:"
5. Copy dev's `hooks/session-start` to `hooks/session-start`, replace `SCRIPT_DIR`/`PLUGIN_ROOT` with `${CLAUDE_PLUGIN_ROOT}`, add missing-file warning
6. Update `skills/using-dev/SKILL.md` to cover all 23 skills (add 9 PM skill rows, update title)
7. Verify combined check-setup.sh output stays under 4,000 chars in worst case
8. Verify update check URL points to `https://github.com/soelinmyat/pm.git`
9. Run `session-start` and verify JSON preload output contains using-dev content
10. Run `node scripts/validate.js --dir pm` for regression check
