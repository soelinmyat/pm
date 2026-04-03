---
type: backlog-issue
id: "PM-075"
title: "Team sharing + invite flow"
outcome: "A second user can join a project and access the shared knowledge base"
status: drafted
parent: "shared-context"
children: []
labels:
  - "feature"
  - "team"
priority: medium
research_refs:
  - pm/research/shared-context/findings.md
created: 2026-03-30
updated: 2026-03-30
---

## Outcome

Project owners can invite teammates via a link. Invited users join the project and access the shared knowledge base through the same MCP tools. All members read/write the same knowledge base — every teammate's AI terminal is smarter from day one.

## Acceptance Criteria

1. `pm invite` skill generates a one-time invite link (expires in 7 days).
2. Invited user runs `pm join {code}` → added to user_projects with role `member`.
3. All project members' MCP servers connect to the same workspace via the API.
4. `pm members` skill lists current project members.
5. Project owner can remove members: `pm remove {username}`.
6. No permission granularity — all members have equal read/write access.
7. Conflict resolution via diff-based edits:
   a. MCP `edit` tool sends a diff + ETag from the last read.
   b. API rejects if ETag is stale (file changed since last read) — returns 409 + both versions.
   c. Terminal's AI reads both versions, merges intelligently, resubmits.
   d. Two edits to different sections of the same file = no conflict (granular diff).
   e. No local merge logic needed — all conflict handling is API-side detection + terminal-side resolution.
8. Auto-detect team from git remote: parse `git remote get-url origin`, check GitHub org membership via API, auto-associate project with team. Extends PM-074's repo-level detection to org-level team detection.

## Technical Feasibility

**Build-on:** PM-070 (auth + API with ETag conflict detection), PM-072 (Postgres — add invite_tokens table), PM-073 (MCP server).

**Build-new:** Invite token generation/validation, member management endpoints, team detection from GitHub org.

## Competitor Context

This is where PM's differentiation materializes. No AI coding tool shares product knowledge across a team — they only share coding context (rules files in git). When a teammate joins a PM project, their MCP server connects to the same workspace and their AI terminal is immediately smarter from shared research, strategy, and groomed issues. The agent-as-merge-layer for conflict resolution is a capability no competitor has.

## Notes

- This is the feature that triggers the Team pricing tier.
- All-or-nothing access for v1. Granular permissions deferred.
- Depends on PM-073 (MCP server working for single user first).
- Conflict resolution is simpler than the old push/pull model — diff-based edits + ETag detection at the API, AI merge at the terminal.
