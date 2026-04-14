---
name: Route
order: 2
description: Route the user into the right PM lane, or allow direct answers when a workflow is unnecessary
---

## Goal

Choose the right PM workflow when one is genuinely helpful, while preserving direct-answer behavior when it is not.

## How

Use the `Entry Points`, `Sub-Skills`, `Utilities`, and `Instruction Priority` sections in this SKILL to decide whether the user should enter a PM lane.

Routing rules:
- If there is a clear skill match for the request, invoke that skill.
- If the user is asking a direct question or wants a quick answer, answer directly instead of forcing a skill flow.
- If the user gives explicit instructions that override the default PM flow, follow those instructions.
- If a concrete PM workflow is already active, do not bounce the user back through `using-pm`.

## Done-when

The user has been routed into the right PM skill, or explicitly left in a direct-answer path without unnecessary PM ceremony.

When routing to a skill, say: "Running `/pm:{skill-name}`." When answering directly, complete the answer and ask: "What would you like to do next?"
