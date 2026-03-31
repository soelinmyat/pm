---
type: backlog-issue
id: "PM-086"
title: "Demo storage, backlog integration, and recording config"
outcome: "Video demos are stored in a consistent location, linked to backlog issues via frontmatter, and recording is configurable as an opt-in project setting"
status: drafted
parent: "video-demo-recording"
children: []
labels:
  - "qa"
  - "developer-experience"
priority: medium
research_refs:
  - pm/research/video-demo-recording/findings.md
created: 2026-03-31
updated: 2026-03-31
---

## Outcome

After PM-085 generates a video, this issue ensures it is properly stored, linked to the right backlog issue, and that the recording feature is configurable. Product engineers can opt in at the project level (`video_demo: true`) or per-run (`--record`), and videos are automatically associated with the issue they validate.

## Acceptance Criteria

1. `.pm/demos/` directory is created automatically when the first recording is saved.
2. `.pm/demos/` is added to `.gitignore` by the recording setup (videos are local artifacts).
3. Backlog issue schema (`pm/backlog/*.md`) accepts an optional `demo:` field in frontmatter, containing the relative path to the demo video.
4. After a successful recording, the `demo:` field is automatically added to the corresponding backlog issue's frontmatter.
5. `validate.js` accepts `demo:` as a valid optional field without errors.
6. `--record` flag is documented in QA skill arguments table.
7. Project-level config `video_demo: true` in `dev/instructions.md` or `.pm/config.json` enables recording by default for all QA runs.
8. If Linear is configured and a demo exists, the video file is attached to the Linear issue when the issue is synced/created.
9. Dev session state file (`.pm/dev-sessions/{slug}.md`) includes a `## Demo` section with recording path, format, and duration after a successful recording.

## User Flows

N/A — infrastructure/plumbing, no direct user interaction flow.

## Wireframes

N/A — no user-facing workflow for this feature type.

## Competitor Context

No competitor stores automated demo recordings alongside issue metadata. This is part of PM's "knowledge base compounds over time" value prop — demos become part of the issue's permanent record.

## Technical Feasibility

- **Build-on:** Backlog issue schema already supports optional fields. `validate.js` can be extended. `.pm/` directory structure exists. Config patterns from `dev/instructions.md` and `.pm/config.json` are established. Linear integration already handles issue creation and attachments.
- **Build-new:** `.gitignore` update logic, `demo:` field handling in validate.js, config reading for `video_demo`, Linear attachment logic for video files.
- **Risk:** Low. Schema extension, config plumbing, and gitignore management are well-understood patterns in this codebase.
- **Sequencing:** Depends on PM-085 (needs a video to store). PM-087 depends on this (needs the `demo:` field to know what to play).

## Decomposition Rationale

Workflow Steps pattern: step 2 of the pipeline (generate → **store** → display). Handles the plumbing between recording and viewing.

## Research Links

- [Video Demo Recording Research](pm/research/video-demo-recording/findings.md)

## Notes

- Linear attachment is best-effort — if upload fails (file too large, API error), log the failure and continue. The local copy is always available.
