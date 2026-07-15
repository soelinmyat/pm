---
name: Capture
order: 1
description: Resolve one bounded chore and publish it through the shared atomic capture service
---

## Goal

Create one validated `kind: task` backlog item with a concrete title and outcome.

## How

1. Read and follow `${CLAUDE_PLUGIN_ROOT}/references/capture.md`, including path resolution and input bounds.
2. Extract a short action title. If none exists, ask one focused question for it.
3. Write a one-sentence outcome describing what becomes true. Use a clear supplied outcome; otherwise infer it only when the title is already testable. Ask once if inference would change scope.
4. Route to Bug when the user describes broken behavior. Route to Groom when the outcome is unknown, requires product choices, or spans multiple coupled concerns.
5. Resolve `{pm_dir}`. Following `references/capture.md`, use the Write tool to create a private JSON request containing `action: "create"`, `kind: "task"`, the title, and outcome. Omit priority and labels unless the user supplied them so the service owns Task defaults (`medium`, `[chore]`). Invoke `capture-backlog.js --pm-dir {pm_dir} --request-file {path}` and guarantee request-file cleanup even when the helper fails. Never interpolate user text into shell syntax or hand-compose the destination/frontmatter.
6. Parse the JSON receipt. Retain `slug` and `content_sha256` for optional enrichment. Confirm only after the receipt exists and the published file passes the project validator.

Confirmation:

> `Captured: {filePath} ({id}, kind=task). Run /pm:dev {slug} when ready.`

## Done-when

The exclusive-create receipt identifies one validated Task artifact, the confirmation names its ID and path, and the user has either requested enrichment or received the Dev next action.

**Advance:** proceed to Step 2 (Enrich) only when refinement is requested; otherwise summarize the capture and stop.
