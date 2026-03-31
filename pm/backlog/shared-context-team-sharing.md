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

Project owners can invite teammates via a link. Invited users join the project and can push/pull the shared knowledge base. All members see the same research, strategy, and groomed issues.

## Acceptance Criteria

1. `pm invite` generates a one-time invite link (expires in 7 days).
2. Invited user runs `pm join {code}` → added to user_projects with role `member`.
3. All project members can `pm push` and `pm pull`.
4. `pm members` lists current project members.
5. Project owner can remove members: `pm remove {username}`.
6. No permission granularity — all members have equal read/write access.
7. Agent-as-merge-layer on `pm pull` when conflicts detected:
   a. Agent reads both local and remote versions of the conflicting file.
   b. For YAML frontmatter: merge field-by-field, latest timestamp wins per field.
   c. For markdown prose: preserve both users' additions, deduplicate identical content, flag ambiguous sections with `<!-- MERGE: review needed -->` markers.
   d. After merge, agent shows a summary: "Merged {path}: kept both users' changes. {N} sections flagged for review."
   e. If merge confidence is low (>30% of content conflicts), prompt user: "Significant conflicts in {path}. Show diff and let you choose?"
   f. Fallback: `pm pull --theirs` (accept remote) or `pm pull --ours` (keep local) for manual override.
8. Auto-detect team from git remote: parse `git remote get-url origin`, check GitHub org membership via API, auto-associate project with team. This extends PM-074's repo-level detection to org-level team detection.

## Technical Feasibility

**Build-on:** PM-070 (auth), PM-072 (Postgres — add invite_tokens table), PM-073 (CLI commands).

**Build-new:** Invite token generation/validation, member management endpoints, conflict detection on push (compare hashes), agent merge prompt on pull.

## Competitor Context

This is where PM's differentiation materializes. No AI coding tool shares product knowledge across a team — they only share coding context (rules files in git). When a teammate joins a PM project, their agent sessions are immediately smarter from shared research, strategy, and groomed issues. The agent-as-merge-layer for conflict resolution is a capability no competitor has — humans resolve git merge conflicts manually; PM's agents can re-derive their output against updated state.

## Notes

- This is the feature that triggers the Team pricing tier.
- All-or-nothing access for v1. Granular permissions deferred.
- Depends on PM-073 (CLI commands working for single user first).
