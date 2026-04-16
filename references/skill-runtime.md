# Skill Runtime

Shared runtime contract for all PM skills. Each skill references the sections it needs — not all skills use all sections.

---

## Path Resolution

If `pm_dir` is not in conversation context, run:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/resolve-pm-dir.js
```

The helper prints the resolved content directory to stdout. Pass `--json` to get both `pm_dir` and `pm_state_dir` in one call:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/resolve-pm-dir.js --json
# → {"pmDir":"...","pmStateDir":"..."}
```

It handles:

1. **Separate-repo mode — nested layout** — reads `.pm/config.json` at cwd, follows `pm_repo.path` to the PM repo, and returns `{pm-repo-root}/pm` when that subdir exists.
2. **Separate-repo mode — flat layout** — if the PM repo root has KB content markers at its root (`backlog/`, `evidence/`, `memory.md`, `insights/`, `thinking/`, or `strategy.md`) and no `pm/` subdir, the PM repo root itself is the content dir.
3. **Worktree walk** — if cwd is inside a git worktree whose main repo lives elsewhere, it reads the **main repo's** `.pm/config.json`. This matters because `.pm/` is gitignored, so worktrees never carry the config themselves.
4. **Same-repo fallback** — returns `{cwd}/pm` when no separate-repo config is found.

If the helper exits non-zero (e.g. an unsupported `pm_repo.type`), surface the error and tell the user: 'Run `/pm:setup separate-repo` to configure paths.' Do not proceed without a valid path.

If `pm_state_dir` is not in conversation context, locate `.pm/` relative to `pm_dir`: prefer `{pm_dir}/.pm/` if it exists (flat layout), otherwise use `.pm` at `pm_dir`'s parent (nested layout — if `pm_dir` = `{base}/pm`, then `pm_state_dir` = `{base}/.pm`). The `--json` invocation above returns the correct path directly.

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

---

## Step Transitions

Every step must guide the agent forward after completion. Without explicit advancement, the agent stalls and the user must manually prompt "continue."

**Final step** = the step with the highest `order:` value in a skill's `steps/` directory.

### Mid-step advancement

Every non-final step's Done-when section must end with an explicit advancement directive using the `**Advance:**` prefix:

```
## Done-when
- {exit criteria}
- {exit criteria}

**Advance:** proceed to Step {N} ({step-name}).
```

For steps with conditional paths (tier-dependent skips, user choices), each path must name its destination:

```
**Advance:** if quick tier, proceed to Step 4 (Scope). If standard/full, proceed to Step 3 (Research).
```

### Final-step completion

The last step of every skill must:

1. **Summarize** what was accomplished (1-2 sentences naming the artifact and its path)
2. **Offer the next action** using one of these patterns:

**Single clear next step:**
```
Say: "{Skill} complete for '{topic}'. {Artifact} saved to `{path}`.
Next: run `/pm:{skill} {slug}` to {what it does}."
```

**Branching paths (ask one question):**
```
Ask: "Want to {next workflow}?"
- **Yes** → invoke pm:{skill}, update state
- **No** → "Done. {Artifact} saved for later."
```

**No clear next step:**
```
Say: "{Skill} complete. {Summary of what was done}.
What would you like to do next?"
```

### Canonical examples

These skills already follow the pattern — use them as templates:
- `groom/steps/11-link.md` — summary + exact next command
- `rfc/steps/03-rfc-review.md` — binary choice with branching
- `think/steps/06-synthesize.md` — promotion offer with state change
