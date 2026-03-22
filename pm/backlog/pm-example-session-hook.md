---
type: backlog-issue
id: PM-022
title: "Surface pm:example in SessionStart hook"
outcome: "Users who haven't configured PM see /pm:example suggested in the session start message"
status: done
parent: "public-demo-dashboard"
children: []
labels:
  - "onboarding"
priority: medium
created: 2026-03-14
updated: 2026-03-14
---

## Outcome

Users who haven't configured PM for their project see `/pm:example` suggested alongside `/pm:setup` in the SessionStart hook message, so they know they can preview PM's output before committing to setup.

## Acceptance Criteria

1. `hooks/check-setup.sh` first-run `cat <<'EOF'` block includes: "Run /pm:example to see an example of what you could do with PM."
2. The suggestion appears before the `/pm:setup` line.
3. No second `if [ ! -f ... ]` branch added — the line is appended within the existing heredoc block.

## User Flows

N/A — no user-facing workflow for this feature type.

## Wireframes

N/A — no user-facing workflow for this feature type.

## Competitor Context

No competitor provides onboarding nudges inside the terminal. PM Skills Marketplace, ChatPRD, and Productboard Spark rely on web-based onboarding flows.

## Technical Feasibility

**Verdict:** Feasible as scoped.

**Build-on:** `hooks/check-setup.sh` lines 13-20 — existing first-run block with `cat <<'EOF'` heredoc.

**Build-new:** One line added to existing heredoc.

**Risks:** Hook verbosity — block is currently 3 lines, adding a 4th is fine but further additions in future will feel noisy.

## Research Links

- No dedicated research topic.

## Notes

- Keep the message concise — one line, not a paragraph.
