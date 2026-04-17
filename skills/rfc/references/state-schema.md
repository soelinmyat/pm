# RFC Session State Schema

State file location: `{source_dir}/.pm/rfc-sessions/{slug}.md`

**Directory creation:** If `{source_dir}/.pm/rfc-sessions/` does not exist, create it (`mkdir -p`) before the first write.

**Repo location:** RFC sessions are ephemeral, machine-local state — they always live in the **source repo's** `.pm/rfc-sessions/`, never in the PM repo. The source repo's `.pm/` is gitignored; committing session scratchpad state to the shared PM repo would leak in-progress work. The RFC **artefact** (the generated HTML document) still lives in `{pm_dir}/backlog/rfcs/` in the PM repo — only the session state is source-side. In same-repo mode, source_dir is the project root, so this resolves to `.pm/rfc-sessions/{slug}.md` there.

## Valid Stage Values

`intake`, `rfc-generation`, `rfc-review`, `approved`.

## Template

```markdown
# RFC Session State

| Field | Value |
|-------|-------|
| Run ID | {PM_RUN_ID} |
| Stage | intake |
| Size | M |
| Ticket | PROJ-456 |
| Slug | {slug} |
| RFC path | null |
| Started at | 2026-04-13T01:00:00Z |
| Stage started at | 2026-04-13T01:00:00Z |
| Completed at | null |

## Project Context
- Product: Example App — task management for teams
- Stack: Rails API + React frontend
- Test command: pnpm test
- Issue tracker: Linear (detected via MCP)
- Monorepo: no
- CLAUDE.md: present
- AGENTS.md: present
- Strategy: present

## Decisions
- Source: proposal | linear-issue
- Proposal path: {pm_dir}/backlog/{slug}.md
- Linear ID: {linear_id} | null
- Linear readiness: dev-ready | null
- Size gate: needs-rfc | skipped-xs | skipped-s
- RFC check: needs-rfc | already-approved | no-proposal

## Resume Instructions
- Stage: [current stage name]
- Next action: [single next action to take]
- Key context: [1-2 sentences a cold reader needs]
- Blockers: [any blocking issues, or "none"]
```

## Update Rules

- Write the full file (not append) at each stage transition.
- Keep `Stage started at` current at every stage transition.
- Set `Completed at` when the session finishes (RFC approved or stopped).
- Resume Instructions must be populated at every stage transition. A cold reader should be able to continue from this section alone.
- After approval, update `RFC path` to the generated RFC file location.
