---
name: Tool Check
order: 1
description: Verify gh CLI and source repo access before starting work
---

<!-- Merged: Stage 0.5 (Tool Check) + Stage 0.7 (Source Repo Access Check) from dev-flow.md -->

## Tool Check

All sizes use the PR flow. Verify `gh` early so the user can install it before PR creation time:

```bash
command -v gh >/dev/null 2>&1 || echo "WARN: GitHub CLI (gh) not found. PR creation will fail. Install: https://cli.github.com"
```

If missing, warn the user before starting work.

---

## Source Repo Access Check

**Runs AFTER resume detection and AFTER the `pm_dir` / `pm_state_dir` fallback checks.**

Dev requires a source code repository to operate — it creates branches, worktrees, and runs tests. This step ensures a source repo is accessible before proceeding.

1. **If `source_dir` is in conversation context** (set by `pm:start`), use it. Proceed.
2. **If `source_dir` is NOT in conversation context**, check if cwd contains source code indicators:

   ```bash
   # Source code indicators — presence of any one means cwd is a source repo
   ls package.json Cargo.toml go.mod pyproject.toml Gemfile pom.xml \
      build.gradle settings.gradle CMakeLists.txt Makefile mix.exs \
      *.sln *.csproj composer.json 2>/dev/null | head -1
   ```

   - **If any indicator is found:** cwd is a source repo. Set `source_dir` to cwd (same-repo mode). Proceed.
   - **If NO indicator is found:** Block with this message and stop:

     > Dev requires a source repo. Run pm:setup to configure, or invoke pm:dev from the source repo.

     Do NOT proceed to the next step. The user must either configure `source_repo` in `.pm/config.json` (via `pm:setup separate-repo`) or invoke `pm:dev` from within the source repo.

**Dev session files** (`.pm/dev-sessions/`) are always created in the source repo, not the PM repo. When `source_dir` differs from the PM repo root, use `{source_dir}/.pm/dev-sessions/` for all session file operations. In same-repo mode, this is the same location as `{pm_state_dir}/dev-sessions/`.

## Done-when

- `gh` is available (or user warned and acknowledged)
- `source_dir` is set and points to a directory with source code indicators
