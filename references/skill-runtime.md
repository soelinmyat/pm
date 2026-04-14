# Skill Runtime

Shared runtime contract for all PM skills. Each skill references the sections it needs — not all skills use all sections.

---

## Path Resolution

If `pm_dir` is not in conversation context, check if `pm/` exists at cwd. If yes, use it (same-repo mode). If no, tell the user: 'Run pm:start first to configure paths.' Do not proceed without a valid path.

If `pm_state_dir` is not in conversation context, use `.pm` at the same location as `pm_dir`'s parent (i.e., if `pm_dir` = `{base}/pm`, then `pm_state_dir` = `{base}/.pm`). This ensures preference reads and session writes always resolve to the PM repo's `.pm/` directory.

---

## Workflow Loading

Each skill's workflow is defined by `.md` files in its `steps/` directory:

1. Read all `.md` files from `${CLAUDE_PLUGIN_ROOT}/skills/{SKILL_NAME}/steps/`.
2. If `.pm/workflows/{SKILL_NAME}/` exists, same-named files there override defaults.
3. Sort by numeric filename prefix (e.g., `01-intake.md` before `02-normalize.md`).
4. Execute each step in order. Each step contains its own instructions.

Persona references (`@persona`) in step files resolve from `.pm/personas/` (user overrides) then `${CLAUDE_PLUGIN_ROOT}/personas/` (defaults).

---

## Telemetry (opt-in)

If analytics are enabled, read `${CLAUDE_PLUGIN_ROOT}/references/telemetry.md` for the full contract.

Each skill defines its own step names for telemetry spans. The shared contract covers: enabling analytics, run-level events (start/end), step-level spans, and output file tracking.

---

## Custom Instructions

Before starting work, check for user instructions:

1. If `{pm_dir}/instructions.md` exists, read it — these are shared team instructions (terminology, writing style, output format, competitors to track).
2. If `{pm_dir}/instructions.local.md` exists, read it — these are personal overrides that take precedence over shared instructions on conflict.
3. If neither file exists, proceed normally.

**Override hierarchy:** `{pm_dir}/strategy.md` wins for strategic decisions (ICP, priorities, non-goals). Instructions win for format preferences (terminology, writing style, output structure). Instructions never override skill hard gates.

---

## Interaction Pacing

Ask ONE question at a time. Wait for the user's answer before asking the next. Do not bundle multiple questions in a single message. When you have follow-ups, ask the most important one first — the answer often makes the others unnecessary.
