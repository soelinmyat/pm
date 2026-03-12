---
type: backlog-issue
id: "PM-050"
title: "Formalize groom→dev handoff with groomed issue detection"
outcome: "When dev:dev-epic processes a groomed issue, it automatically detects the grooming artifacts and skips brainstorm and spec review, reducing ceremony and enabling one-shot implementation."
status: done
parent: "pm-dev-merge"
children: []
labels:
  - "workflow"
  - "handoff"
  - "product-engineer"
priority: critical
research_refs:
  - pm/research/pm-dev-merge/findings.md
created: 2026-03-21
updated: 2026-03-21
---

## Outcome

This is the core value of the merge. A product engineer grooms an idea through pm:groom (research, strategy check, scope review, team review, bar raiser), then runs dev:dev-epic. The dev lifecycle detects that upstream PM work is complete and skips redundant ceremony — no brainstorming, no spec review. The groomed issue's ACs, research refs, and competitive context flow directly into the implementation plan. Result: fewer steps, faster shipping, one-session completion.

## Acceptance Criteria

1. Dev detects "groomed" status by reading `.pm/groom-sessions/{slug}.md` and checking: (a) `phase` is `groom` or later AND (b) `bar_raiser.verdict` equals `"ready"` or `"ready-if"` specifically. Verdicts of `"send-back"` or `"pause"` are non-null but must NOT trigger reduced ceremony — those indicate the groom pipeline did not clear review gates.
2. When groomed status detected, both `dev:dev-epic` and `dev:dev` (single-issue flow) skip brainstorming and spec review phases — go directly to writing-plans.
3. Detection is updated in both `dev-epic/SKILL.md` and `dev/SKILL.md` (line 249) to read from `.pm/groom-sessions/` directory, replacing the legacy `.pm/.groom-state.md` single-file path.
4. When multiple groom sessions exist, detection matches by issue slug or topic name against the groom session's `topic` and `issues[].slug` fields.
5. Skipped phases are logged in `.pm/dev-sessions/` state: "brainstorm: skipped (groomed), spec-review: skipped (groomed)".
6. If groomed status detection fails or is ambiguous, fall back to full ceremony (never silently skip).
7. Research context injection: the writing-plans phase reads `.pm/groom-sessions/{slug}.md`, extracts `research_location`, reads the findings file at that path, and includes it in the agent prompt under a `## Upstream Context` section containing competitor context, customer evidence, and EM feasibility notes. The writing-plans output must contain a non-empty `## Upstream Context` section when processing a groomed issue.
8. Follow-on: publish the groom-session schema as a documented handoff protocol for ecosystem interop (tracked separately, not in this issue).

## User Flows

N/A — no user-facing workflow for this feature type.

## Wireframes

N/A — no user-facing workflow for this feature type.

## Competitor Context

This is the moat. Dev's own backlog explicitly calls out: "pm → dev handoff is the moat: Groomed issues with rich ACs flowing directly into /dev-epic with reduced ceremony is unique." No competitor has this. Kiro assumes specs exist but can't detect their quality. MetaGPT generates specs but doesn't validate them. Compound Engineering always runs full ceremony regardless of upstream context.

## Technical Feasibility

Build-on: Dev's SKILL.md line 249 already has a partial "from groom?" gate that checks `.pm/.groom-state.md`. The groom session schema already records `research_location`, `issues[]`, phase completion, and `bar_raiser.verdict` — providing a deterministic groomed-status signal. Build-new: (1) Update detection path in both `dev/SKILL.md` and `dev-epic/SKILL.md` from legacy single-file to `.pm/groom-sessions/` directory, (2) implement bar_raiser.verdict check as the detection gate (replacing AC-counting heuristic), (3) handle multiple in-flight groom sessions, (4) build research context injection into writing-plans agent prompts (reads groom session → extracts research_location → reads findings → injects as `## Upstream Context`). Risk: AC #7 (research injection) is the most complex engineering work — it requires reading YAML, extracting paths, reading findings, and injecting into agent prompts. This is comparable in effort to PM-049's state migration. Dev's SKILL.md is 1,228 lines with complex conditional branching — misjudged groomed-status could skip ceremony for work that actually needs it. Fallback to full ceremony on ambiguity is the safety net.

## Research Links

- [PM-Dev Merge Research](pm/research/pm-dev-merge/findings.md)

## Notes

- This is the highest-priority child issue — it delivers the core success criteria (reduced ceremony, one-shot implementation).
- Detection uses bar_raiser.verdict (deterministic) rather than AC counting (fragile heuristic) per PM review feedback.
- Research injection (AC #7) is comparable in effort to PM-049's state migration — consider whether it should be a separate child issue if sprint planning requires finer granularity.
