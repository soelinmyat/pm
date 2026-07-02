---
name: Capture
order: 2
description: Produce visual artifacts for every affected UI state before critique
---

## Goal

Create a durable visual artifact set that lets the critique inspect the actual rendered UI rather than the source diff alone.

## How

Read and follow `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/design-critique-capture-guide.md` and `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/design-critique-seed-conventions.md`.

For the affected surface from Step 1:

1. Start the needed app servers using the project commands from AGENTS.md or the dev session's `## Project Context`.
2. Seed or navigate to representative data states: happy path, empty/loading, validation/error, long content, narrow viewport, and any state named in the RFC acceptance criteria.
3. Capture screenshots with Playwright, Maestro, browser tooling, or the project's existing screenshot workflow. Save artifacts under `/tmp/design-review/{slug}/` or `.pm/dev-sessions/{slug}.design-critique/`.
4. Save a manifest, preferably `/tmp/design-review/{slug}/manifest.json`, with route/screen, viewport/device, artifact path, commit SHA, and timestamp for each capture.
5. If the UI cannot be rendered, do not pass the gate. Record `blocked` with the environment reason in the Markdown state file and gate sidecar.

Do a visual self-check before moving on. Fix obvious broken states, re-run relevant tests, and recapture before critique.

If blocked, return the blocked outcome to the caller. Otherwise continue to critique.
