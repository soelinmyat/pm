---
name: Session Start
order: 1
description: Decide whether to invoke pm:start, route directly, or stay out of the way at session start
---

## Goal

Handle session-start behavior without forcing PM ceremony onto direct questions or concrete tasks.

## How

When this skill loads at the beginning of a new session:

1. Check the user's first message.
2. **If it's a direct question or a concrete task** — answer or route directly. Do **not** invoke `pm:start` just because `.pm/config.json` exists.
3. **If it's a session-opening request** ("start PM", "open PM", "show research", "what should I do next", or similarly general session kickoff) — check whether `.pm/config.json` exists in the project root.
4. **If `.pm/config.json` exists** — invoke `pm:start` before responding (Resume/Pulse path).
5. **If `.pm/config.json` does not exist** — print: "PM not initialized. Run /pm:start to set up." Do not invoke `pm:start`.

## Done-when

Session-start handling has either invoked `pm:start`, routed directly into a concrete task, or explicitly stayed out of the way because PM is not initialized or not needed.

**Advance:** proceed to Step 2 (Route).
