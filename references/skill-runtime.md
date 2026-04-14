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
