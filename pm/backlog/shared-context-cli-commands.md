---
type: backlog-issue
id: "PM-073"
title: "CLI commands: pm login, pm push, pm pull, pm status"
outcome: "Users can sync their local pm/ knowledge base to and from the cloud hub via explicit commands"
status: drafted
parent: "shared-context"
children: []
labels:
  - "feature"
  - "cli"
priority: high
research_refs:
  - pm/research/shared-context/findings.md
created: 2026-03-30
updated: 2026-03-30
---

## Outcome

Four new CLI commands let users authenticate and sync their knowledge base. `pm login` authenticates via GitHub. `pm push` uploads local changes. `pm pull` downloads remote changes. `pm status` shows sync state.

## Acceptance Criteria

1. `pm login` — initiates GitHub OAuth device flow. Displays user code + URL. Polls until approved. Stores JWT in system keychain. Prints "Logged in as {github_username}."
2. `pm push` — compares local `pm/` files against remote file index. Uploads changed/new files. Deletes remote files not present locally. Prints summary: "Pushed N files (M new, K updated, J deleted)."
3. `pm pull` — downloads remote files to local `pm/`. For v0 (single user): overwrites local with remote. If local has uncommitted changes, prompts "Local changes will be overwritten. Continue?" before proceeding. Agent-merge on conflict deferred to PM-075 (team sharing).
4. `pm status` — shows sync state: files only local, files only remote, files modified on both sides. No network mutation.
5. All commands read project from auto-detection (PM-074) or `.pm/config.json` hub settings.
6. All commands fail gracefully without auth: "Not logged in. Run `pm login` first."
7. All commands work offline with clear error: "Hub unreachable. Working locally."
8. Commands implemented as plugin skills (invoked via `pm:login`, `pm:push`, `pm:pull`, `pm:status`) or as shell scripts in `scripts/`.

## Technical Feasibility

**Build-on:** Existing `commands/merge.md` pattern for CLI commands. `.pm/config.json` for project settings. `hooks/analytics-log.sh` pattern for activity logging.

**Build-new:** HTTP client for hub API calls. File diffing logic (hash comparison). Merge-on-pull logic (agent reads both versions, produces merged output). Keychain read/write for token storage.

**Risk:** Agent-as-merge-layer on pull is the hardest part. For v0 (single user), conflicts are rare — same person on two machines. Simple last-write-wins or prompt-on-conflict is sufficient. Intelligent agent merge is a v1 enhancement.

## Research Links

- [Shared Context Research](pm/research/shared-context/findings.md)

## Notes

- Depends on PM-070 (API + auth), PM-071 (S3 backend), PM-072 (Postgres metadata).
- v0 simplification: single user, so push/pull are effectively full-sync. No conflict resolution needed.
- Consider `pm push --dry-run` and `pm pull --dry-run` for safety.
