---
type: backlog-issue
id: PM-019
title: "Gitignore and Setup Onboarding for Instructions"
outcome: "New and existing PM projects gitignore pm/*.local.md, and setup mentions custom instructions as an opt-in customization path with a commented template"
status: idea
parent: "custom-instructions"
children: []
labels:
  - "extensibility"
  - "onboarding"
priority: high
research_refs:
  - pm/research/custom-instructions/findings.md
created: 2026-03-13
updated: 2026-03-13
---

## Outcome

The setup skill ensures `pm/*.local.md` is gitignored so personal instruction files are never accidentally committed. Setup also mentions custom instructions as an opt-in customization path, with a commented template showing users what to put in the file. Users discover the feature naturally during onboarding rather than having to find it in documentation.

## Acceptance Criteria

1. `.gitignore` template in `setup/SKILL.md` includes `pm/*.local.md` pattern.
2. The project's own `.gitignore` includes `pm/*.local.md`.
3. Setup fresh-start flow mentions: "You can customize PM behavior by creating `pm/instructions.md`."
4. Setup gap-aware next steps includes instructions file as an optional item.
5. A commented template example is provided showing what to put in the file (terminology, writing style, competitors to track, output format preferences).
6. The template distinguishes shared (`pm/instructions.md`) from personal (`pm/instructions.local.md`) with a brief explanation of each.

## User Flows

N/A — no user-facing workflow for this feature type.

## Wireframes

N/A — no user-facing workflow for this feature type.

## Competitor Context

No competitor provides onboarding guidance for custom instructions. ChatPRD's "Projects" feature has no setup flow — users discover it by navigating settings. PM's setup-driven discovery is a better UX pattern for developer tools.

## Technical Feasibility

**Verdict: Feasible as scoped.**
- **Build-on:** `setup/SKILL.md` already handles gap-aware next steps (Step 7) and fresh-start flow (Step 8). The `.gitignore` template is already written by setup. Both are extensible.
- **Build-new:** One new gitignore line, one new mention in setup output, and a commented template block.
- **Risk:** Existing PM projects that were set up before this change won't get the gitignore entry automatically. Users must re-run setup or add the line manually. The setup skill could detect and suggest this.
- **Sequencing:** Should be done first or in parallel with PM-018 — the gitignore entry has an irreversible failure mode (accidental commit of personal instructions).

## Research Links

- [Custom Instructions for AI Tools](pm/research/custom-instructions/findings.md)

## Notes

- A blank instructions file is worse than no file — it trains users that instructions don't do anything. The commented template is critical for adoption.
- The `*.local.md` pattern is a new convention for the project. Setup should explain it briefly.
