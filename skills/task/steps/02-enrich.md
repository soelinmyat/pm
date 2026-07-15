---
name: Enrich
order: 2
description: Apply optional priority, label, outcome, or body refinement without a stale overwrite
---

## Goal

Refine the just-captured Task through the same validated transaction boundary, or preserve it unchanged when refinement is declined.

## How

Run only when the user requests refinement. Ask at most two focused questions for missing priority, labels, outcome, or short context. Keep this lightweight; scope discovery routes to Groom.

Following `references/capture.md`, write a private JSON request with `action: "enrich"`, `kind: "task"`, the receipt `slug` and `expectedSha256`, plus only requested changes. Invoke the helper with `--request-file`, guarantee cleanup on success or failure, and never interpolate user text into shell syntax. Do not use Edit on the backlog Markdown.

If the helper reports that the item changed since capture, stop and read the current item before offering a new refinement; never retry with a guessed hash. If the user declines, do not rewrite the file.

## Done-when

The requested refinement has a new validated receipt, or the original capture remains unchanged because the user declined or a stale-write conflict was surfaced.

Offer one next action: run `/pm:dev {slug}` to implement it or `/pm:list` to view the backlog.
