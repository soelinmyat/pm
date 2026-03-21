---
description: "Multi-issue orchestrator: fetch parent issue, plan each sub-issue sequentially, run epic-level review, then autonomously implement/PR/merge all sub-issues one-shot"
argument-hint: "[parent-issue-id]"
---

Read the skill file at ${CLAUDE_PLUGIN_ROOT}/skills/dev-epic/SKILL.md and follow it exactly. The user's message after /dev-epic is the parent issue ID argument.


ARGUMENTS: $ARGUMENTS
