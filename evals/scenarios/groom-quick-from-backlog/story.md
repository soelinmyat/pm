---
id: groom-quick-from-backlog
title: Groom runs a quick-tier pass end to end from a backlog idea
status: ready
tier: sentinel
tags:
  - groom
---

Role: PM agent grooming a backlog idea in a fresh knowledge base.

User message: Groom the backlog idea csv-export with the quick tier. Nothing to add beyond what the backlog file says — treat that as my confirmation for intake. It is an infrastructure-style feature with no visual artifacts. I trust your judgment on all intermediate confirmations; do not wait for me, proceed through every step to completion.

Stop condition: The agent reports the groomed proposal is written to the backlog entry.

## Acceptance Criteria

- The transcript shows the groom workflow was used.
- The backlog entry is upgraded in place: proposal content drafted, status advanced past idea, and an id assigned.
- A groom session state file exists.
