# PM-053: Auto-bootstrap config on first groom/research

> **For agentic workers:** REQUIRED SUB-SKILL: Use dev:subagent-dev to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user runs /pm:groom or /pm:research as their very first command on a fresh project, silently create `.pm/config.json` with sensible defaults and proceed — no setup prompt, no error.

**Architecture:** A config bootstrap guard is inserted at the top of groom Phase 1 and research SKILL.md. Both guards use identical logic: check for `.pm/config.json`, create it with default schema if missing, create required directories, and proceed. The check-setup.sh hook remains advisory-only (unchanged). No new files are created — this is two insertions into existing skill files.

**Monorepo apps affected:** single-app
**Contract sync required:** no

**Tech Stack:** Markdown skill files (behavioral instructions for the AI agent)

---

## File Changes

| # | File | Change |
|---|------|--------|
| 1 | `skills/groom/phases/phase-1-intake.md` | Insert config bootstrap guard before step 1 |
| 2 | `skills/research/SKILL.md` | Insert config bootstrap guard before Mode Routing |
| 3 | `hooks/check-setup.sh` | No change — advisory message stays as-is |

---

## Default Config Schema

Both guards create this exact JSON when `.pm/config.json` does not exist:

```json
{
  "config_schema": 1,
  "integrations": {
    "linear": { "enabled": false },
    "seo": { "provider": "none" }
  },
  "preferences": {
    "visual_companion": true,
    "backlog_format": "markdown"
  }
}
```

No `project_name` field. The dashboard's `getProjectName()` (server.js line 1014) already handles missing `project_name` by deriving it from the directory name.

---

## Task 1: Insert config bootstrap guard into groom Phase 1

**Files:**
- Modify: `skills/groom/phases/phase-1-intake.md:1-9` (insert before existing step 1)

- [ ] **Step 1: Read the current file**

Read `skills/groom/phases/phase-1-intake.md` to confirm the current structure. The file starts with `### Phase 1: Intake` and immediately goes into the backlog-idea check.

- [ ] **Step 2: Insert the bootstrap guard**

Insert a new section between the `### Phase 1: Intake` heading and the existing `**If grooming an existing idea from backlog:**` block. The guard runs before any other Phase 1 logic:

```markdown
### Phase 1: Intake

**Config bootstrap (silent).** Before anything else in this phase:

1. If `.pm/config.json` does not exist:
   a. Create `.pm/` directory if it doesn't exist.
   b. Create `.pm/groom-sessions/` directory if it doesn't exist.
   c. Create `pm/` directory if it doesn't exist.
   d. Write `.pm/config.json` with default config:
      ```json
      {
        "config_schema": 1,
        "integrations": {
          "linear": { "enabled": false },
          "seo": { "provider": "none" }
        },
        "preferences": {
          "visual_companion": true,
          "backlog_format": "markdown"
        }
      }
      ```
   e. Do NOT print any message, warning, or prompt to run /pm:setup. Proceed silently.
2. If `.pm/config.json` exists but contains malformed JSON (parse error): warn the user ("Config file exists but has invalid JSON — proceeding with defaults.") and use the default config values in-memory for this session. Do NOT overwrite the file.
3. If `.pm/config.json` exists and is valid JSON: no-op. Do not overwrite, merge, or modify.
4. If `.pm/` directory exists but `config.json` does not (partial state): create `config.json` without touching other `.pm/` contents.

After the bootstrap, proceed with the normal intake flow below.

---

**If grooming an existing idea from backlog:** ...
```

Note: The existing step 6 ("Create `.pm/groom-sessions/` if it doesn't exist") becomes redundant for the directory creation (the guard already does it), but step 6 still handles writing the state file. The guard only creates the directory — it does not write state files. Keep step 6 as-is.

- [ ] **Step 3: Verify the edit**

Read the modified file. Confirm:
- The bootstrap guard is the first thing after `### Phase 1: Intake`
- The existing backlog-idea check and all numbered steps (1-6) are preserved
- Step 6 still says "Create `.pm/groom-sessions/` if it doesn't exist" (harmless idempotent mkdir)
- No mention of "run /pm:setup" anywhere in the guard

- [ ] **Step 4: Commit**

```bash
git add skills/groom/phases/phase-1-intake.md
git commit -m "feat(groom): auto-bootstrap .pm/config.json on first groom run (PM-053)"
```

---

## Task 2: Insert config bootstrap guard into research SKILL.md

**Files:**
- Modify: `skills/research/SKILL.md` (insert before `## Mode Routing` section, after `## Custom Instructions`)

- [ ] **Step 1: Read the current file**

Read `skills/research/SKILL.md`. The bootstrap guard should go between the `## Custom Instructions` section (ends at line ~29) and the `## Mode Routing` section (starts at line ~31).

- [ ] **Step 2: Insert the bootstrap guard**

Insert a new section between `## Custom Instructions` and `## Mode Routing`:

```markdown
---

## Config Bootstrap

**Silent bootstrap (runs before any research mode).** Before routing to a mode:

1. If `.pm/config.json` does not exist:
   a. Create `.pm/` directory if it doesn't exist.
   b. Create `pm/` directory if it doesn't exist.
   c. Create `pm/research/` directory if it doesn't exist.
   d. Write `.pm/config.json` with default config:
      ```json
      {
        "config_schema": 1,
        "integrations": {
          "linear": { "enabled": false },
          "seo": { "provider": "none" }
        },
        "preferences": {
          "visual_companion": true,
          "backlog_format": "markdown"
        }
      }
      ```
   e. Do NOT print any message, warning, or prompt to run /pm:setup. Proceed silently.
2. If `.pm/config.json` exists but contains malformed JSON (parse error): warn the user ("Config file exists but has invalid JSON — proceeding with defaults.") and use the default config values in-memory for this session. Do NOT overwrite the file.
3. If `.pm/config.json` exists and is valid JSON: no-op. Do not overwrite, merge, or modify.
4. If `.pm/` directory exists but `config.json` does not (partial state): create `config.json` without touching other `.pm/` contents.

---
```

Note the directory differences from the groom guard:
- Research creates `pm/research/` (groom does not — groom creates `.pm/groom-sessions/` instead)
- Research does NOT create `.pm/groom-sessions/` (that's groom-specific)

- [ ] **Step 3: Verify the edit**

Read the modified file. Confirm:
- The bootstrap guard appears between `## Custom Instructions` and `## Mode Routing`
- `## Mode Routing` is unchanged
- The guard creates `pm/`, `pm/research/`, and `.pm/` but NOT `.pm/groom-sessions/`
- No mention of "run /pm:setup" anywhere in the guard
- The SEO provider invocation section (further down) still reads `.pm/config.json` — which will now always exist

- [ ] **Step 4: Commit**

```bash
git add skills/research/SKILL.md
git commit -m "feat(research): auto-bootstrap .pm/config.json on first research run (PM-053)"
```

---

## Task 3: Verify AC coverage end-to-end

This is a manual verification task — no code changes.

- [ ] **Step 1: Trace AC 1 (groom bootstrap)**

Read `skills/groom/phases/phase-1-intake.md`. Confirm the guard creates `.pm/config.json` with the exact nested schema from the AC. Confirm no `project_name` field.

- [ ] **Step 2: Trace AC 2 (research bootstrap)**

Read `skills/research/SKILL.md`. Confirm the guard creates the same default config and also creates `pm/` and `pm/research/` directories.

- [ ] **Step 3: Trace AC 3 (partial state)**

Both guards have rule 4: "If `.pm/` directory exists but `config.json` does not (partial state): create `config.json` without touching other `.pm/` contents." Confirm present in both files.

- [ ] **Step 4: Trace AC 4 (existing config = no-op; malformed = warn + in-memory defaults)**

Both guards have rule 3 (valid JSON = no-op) and rule 2 (malformed JSON = warn + in-memory defaults). Confirm present in both files.

- [ ] **Step 5: Trace AC 5 (directory creation)**

Groom guard creates: `.pm/`, `.pm/groom-sessions/`, `pm/`. Research guard creates: `.pm/`, `pm/`, `pm/research/`. Confirm.

- [ ] **Step 6: Trace AC 6 (pm/ knowledge base directory)**

Both guards create `pm/` if it doesn't exist. Confirm.

- [ ] **Step 7: Trace AC 7 (no error/warning/setup prompt)**

Both guards have rule 1e: "Do NOT print any message, warning, or prompt to run /pm:setup." The `hooks/check-setup.sh` advisory message still fires at session start (that's fine — it's advisory, not an error, and it fires before any skill runs). The skill itself never blocks or warns. Confirm.

- [ ] **Step 8: Commit (no-op — verification only)**

No commit needed. This task is verification.

---

## Verification Checklist

| AC | How to verify |
|----|--------------|
| 1. Groom creates default config with nested schema, no project_name | Read groom Phase 1 guard — JSON literal matches AC schema exactly |
| 2. Research creates same default config + pm/ + pm/research/ dirs | Read research bootstrap section — JSON matches, dirs listed |
| 3. Partial state (.pm/ exists, config missing) creates file only | Both guards rule 4: explicit partial-state handling |
| 4. Existing valid config = no-op; malformed = warn + in-memory defaults | Both guards rules 2-3 |
| 5. Bootstrap creates .pm/ dir; groom also creates .pm/groom-sessions/ | Groom guard steps 1a-1b; research guard steps 1a |
| 6. pm/ knowledge base directory created if missing | Both guards create pm/ |
| 7. No error/warning/setup prompt shown | Both guards rule 1e: explicit "Do NOT print" instruction |

## Task Count: 3 tasks
