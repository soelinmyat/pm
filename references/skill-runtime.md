# Skill Runtime

Shared runtime contract for all PM skills. Each skill references the sections it needs — not all skills use all sections.

---

## Path Resolution

PM skill files may still mention `${CLAUDE_PLUGIN_ROOT}` because Claude Code's plugin command contract historically used that name. Treat it as a legacy alias for the PM plugin root. For runtime-neutral shell commands, prefer `${PM_PLUGIN_ROOT}` and keep `${CLAUDE_PLUGIN_ROOT}` only as a fallback alias.

Before running any shell snippet that executes a PM plugin script, ensure the plugin root is set:

```bash
PM_PLUGIN_ROOT="${PM_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-}}"
if [ -z "$PM_PLUGIN_ROOT" ]; then
  echo "Set PM_PLUGIN_ROOT to the PM plugin root. In Codex, derive it from the loaded skill path: .../skills/<skill>/SKILL.md -> .../" >&2
  exit 1
fi
export PM_PLUGIN_ROOT
export CLAUDE_PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$PM_PLUGIN_ROOT}"
```

`scripts/dispatch-issue.sh` derives the plugin root from its own path and exports both names before launching Claude or Codex subprocesses, so multi-task subprocess prompts can use either placeholder safely.

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

A skill's workflow lives in its `SKILL.md`, optionally decomposed into `steps/*.md` files (sorted by numeric prefix). Steps are an authoring and override unit, not an execution straitjacket: read them for their content — gates, state updates, domain specifics — and execute the workflow with your own judgment about pacing and transitions.

Two mechanics are load-bearing:

1. **User overrides:** if `.pm/workflows/{SKILL_NAME}/` exists, same-named files there override the plugin defaults.
2. **Persona references:** `@persona` tokens resolve from `.pm/personas/` (user overrides) then `${CLAUDE_PLUGIN_ROOT}/agents/` (defaults — the same files that register as callable `pm:<name>` agents).

---

## Completion

End every workflow by naming what was produced and where (artifact + path), and offering the single most useful next action. Hard gates that halt a workflow report what is needed to proceed.

---

## Telemetry (opt-in)

Telemetry is automatic via hooks — see `${CLAUDE_PLUGIN_ROOT}/references/telemetry.md`. Stateful workflows keep their state-file timestamp fields current; nothing else to do.

---

## Custom Instructions

Before starting work, check for user instructions:

1. If `{pm_dir}/instructions.md` exists, read it — these are shared team instructions (terminology, writing style, output format, competitors to track).
2. If `{pm_dir}/instructions.local.md` exists, read it — these are personal overrides that take precedence over shared instructions on conflict.
3. If neither file exists, proceed normally.

**Override hierarchy:** `{pm_dir}/strategy.md` wins for strategic decisions (ICP, priorities, non-goals). Instructions win for format preferences (terminology, writing style, output structure). Instructions never override skill hard gates.
