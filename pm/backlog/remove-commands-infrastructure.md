---
type: backlog-issue
id: "PM-058"
title: "Delete command files, preserve inline logic, update manifests"
outcome: "Developers and AI contributors working with PM encounter no dead command references in manifests or directory structure — the codebase matches the skill-only reality that was already true in practice"
status: done
parent: "remove-commands"
children: []
labels:
  - "architecture"
priority: medium
research_refs:
  - pm/research/remove-commands/findings.md
created: 2026-03-21
updated: 2026-03-21
---

## Outcome

Developers and AI contributors working with PM encounter no dead command references in manifests or directory structure. The two commands with inline logic (`sync.md` rsync workflow, `view.md` direct script invocation) are preserved as skills. The using-pm routing table is verified to cover all previously command-accessible workflows, including the `merge` workflow which requires a distinct entry from `merge-watch`.

## Acceptance Criteria

1. All 17 files in `commands/` are deleted and the directory itself is removed
2. `sync.md` inline logic (rsync workflow) is moved to a new `skills/sync/SKILL.md`
3. `view.md` inline logic verified: `skills/view/SKILL.md` launches the dashboard server and returns the same URL as `commands/view.md`. Specifically: `--mode dashboard` is passed through, the `--dir` argument resolves to `<project-root>/pm`, and the server is accessible at the returned localhost URL. If the view skill's `start-server.sh` wrapper diverges from the command's direct `server.js` invocation, the skill is updated to match the user-visible behavior
4. `.claude-plugin/plugin.json` has no `"commands"` key
5. `.cursor-plugin/plugin.json` has no `"commands"` key
6. `using-pm` skill routing table includes explicit entries for `sync`, `merge`, and `view`. The `merge` entry is distinct from `merge-watch`: its description states "manual merge without polling loop — merge a PR, delete remote branch, clean up local branch and worktree" so the AI selects `dev:merge-watch` and follows the `# /merge` section (not the polling loop). No "section flag" tool parameter exists — the distinction is conveyed via the description text in the routing table
7. All 23 skills remain invokable via the Skill tool after command removal
8. `using-pm` trigger descriptions, as they appear in the loaded session context, include at least one natural-language trigger phrase per workflow that would match a reasonable user request (e.g., "research competitors" triggers pm:research, "groom this feature" triggers pm:groom). Verified by listing all trigger phrases against a canonical request mapping for each of the 17 previously command-accessible workflows
9. Smoke test (owned by parent PM-057 AC5): confirmed passing after ACs 1-8 are complete — fresh session, 5 core workflows activate via natural language
10. Version bump applied to all 4 manifests (`.claude-plugin/plugin.json`, `.cursor-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `gemini-extension.json`) as the final commit before PR, with matching git tag

## User Flows

N/A — no user-facing workflow for this feature type.

## Wireframes

N/A — no user-facing workflow for this feature type.

## Competitor Context

Superpowers kept deprecated command stubs pointing to skills. PM takes a cleaner approach — full removal. This is possible because the SessionStart hook already preloads using-pm, making commands truly redundant rather than a fallback.

## Technical Feasibility

**Build-on:**
- `hooks/session-start` — already preloads using-pm at startup
- `skills/using-pm/SKILL.md` — already has full routing table
- 15 of 17 commands are one-line wrappers delegating to skills — zero logic to preserve
- `.codex/INSTALL.md` — Codex install path already bypasses commands entirely
- Pre-commit hook at `.githooks/pre-commit` validates version consistency across all 4 manifests

**Build-new:**
- `skills/sync/SKILL.md` — move inline rsync logic from `commands/sync.md`
- Verify `skills/view/SKILL.md` script invocation matches `commands/view.md` behavior (different script paths and arg schemas observed)
- Add `sync`, `merge`, and `view` entries to using-pm routing table
- `merge` entry design decision: add a distinct `merge` row to `using-pm` routing table with description that conveys "manual merge without polling" intent, so the AI selects `dev:merge-watch` and follows the `# /merge` section naturally (no section-flag tool parameter exists)

**Risks:**
- `view.md` invokes `node ${CLAUDE_PLUGIN_ROOT}/scripts/server.js` directly while view skill calls `scripts/start-server.sh` with `--project-dir` — verify these produce identical behavior before deletion
- `merge` command behavior (manual merge) is meaningfully different from `merge-watch` (continuous polling) — the using-pm entry must distinguish these
- Pre-commit hook (`.githooks/pre-commit`) enforces version consistency across all 4 manifests — version bump required as final commit

**Sequencing:**
1. Create `skills/sync/SKILL.md` with sync logic
2. Verify view skill is a functional drop-in for `commands/view.md`
3. Add `sync`, `merge`, and `view` entries to using-pm routing table
4. Delete all 17 command files and `commands/` directory
5. Remove `"commands"` key from both plugin.json files
6. Version bump all 4 manifests + git tag as final commit

## Research Links

- [Plugin invocation patterns](pm/research/remove-commands/findings.md)

## Notes

- Decomposition pattern: Workflow Steps — infrastructure changes before documentation
- This issue is independent of the docs update (PM-059) and can be implemented first
- Codex install gap: `.codex/INSTALL.md` symlink list must be updated to include the new `sync` skill and remove `commands/` reference (covered by PM-059 AC7)
- Follow-on: skill files that internally surface `/pm:*` syntax should be updated in a separate issue after this ships
