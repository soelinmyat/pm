---
type: backlog-issue
id: "PM-074"
title: "Project auto-detection from git remote"
outcome: "Plugin automatically knows which hub project to sync with based on the git remote URL"
status: drafted
parent: "shared-context"
children: []
labels:
  - "feature"
  - "dx"
priority: medium
research_refs:
  - pm/research/shared-context/findings.md
created: 2026-03-30
updated: 2026-03-30
---

## Outcome

When a user runs `pm push` or `pm pull`, the plugin auto-detects which project to sync with by parsing the git remote URL. No manual configuration needed. The user never types a project ID.

## Acceptance Criteria

1. Parse `git remote get-url origin` to extract org/repo (e.g., `github.com/soelinmyat/pm` → slug `soelinmyat/pm`).
2. Handle all common git remote formats: HTTPS (`https://github.com/org/repo.git`), SSH (`git@github.com:org/repo.git`), with or without `.git` suffix.
3. Look up project in Postgres by slug. If found, use it.
4. If not found, prompt: "No hub project for {slug}. Create one?" On yes, create project + S3 prefix + user_projects link.
5. Cache the project association in `.pm/config.json` under a `hub` key so detection only runs once per project.
6. If no git remote exists (not a git repo), fall back to `.pm/config.json` hub settings or prompt for manual project selection.
7. Handle GitLab, Bitbucket, and self-hosted git URLs (not just GitHub).

## Technical Feasibility

**Build-on:** No existing git remote parsing in the codebase. `reconcile-merged.sh` uses git commands but doesn't parse remotes.

**Build-new:** Git remote URL parser, project lookup/creation flow, config caching.

**Risk:** URL format variety is deceptively complex (SSH with port, self-hosted domains, nested groups in GitLab). Start with GitHub HTTPS/SSH and expand.

## Research Links

- [Shared Context Research — zero-config team detection](pm/research/shared-context/findings.md)

## Notes

- Depends on PM-072 (Postgres metadata for project lookup).
- This is a competitive differentiator — no mainstream tool auto-detects team from git remote (per research).
- In v1, this extends to team detection: parse org, check GitHub org membership, auto-associate team.
