---
type: backlog-issue
id: "PM-033"
title: "Groom Phase 5: Add INVEST Validation Gate and Dependency Mapping"
outcome: "PMs can trust that every drafted issue is independently scoped, valuable, and testable — with visible evidence for each INVEST dimension — so they spend review time on strategic judgment rather than catching structural defects"
status: done
parent: "groom-decomposition-methodology"
children: []
labels:
  - "grooming-quality"
  - "infrastructure"
priority: high
research_refs:
  - pm/competitors/index.md
created: 2026-03-20
updated: 2026-03-20
---

## Outcome

After this ships, PMs reviewing groomed issues see evidence-backed INVEST validation — not a checkbox, but a per-dimension trail showing *why* each issue passes (e.g., "Estimable because EM review confirmed auth module scope" rather than "INVEST: pass"). Structural defects that currently surface during Phase 5.5 review — missing dependencies, untestable ACs, issues too large to estimate — are caught at drafting time instead.

The Phase 5.5 PM reviewer already checks decomposition quality and missing dependencies (lines 44-51). This issue aligns the drafter's process with what the reviewer expects to see, so review time shifts from catching structural problems to strategic judgment about priorities and trade-offs.

## Acceptance Criteria

1. An INVEST validation step is added to Phase 5 after the decomposition step (added by PM-032) and before the issue drafting step. The validation applies to the decomposed issue structure, not individual issue content — it tests whether the *set of issues* is well-formed. The exact step number depends on PM-032's final renumbering; this issue inserts between "Decompose" and "Draft issues" by name, not by number.
2. Each INVEST dimension produces an evidence trail, not just pass/fail:
   - **Independent:** "Issues A and B can be implemented by different engineers without coordination" or "Issue B depends on Issue A's auth changes — flagged as explicit dependency, not an INVEST failure"
   - **Negotiable:** Verified by presence of outcome statement (not rigid implementation spec)
   - **Valuable:** Each issue delivers end-user value or is explicitly marked as an enabling prerequisite with the value it unlocks
   - **Estimable:** Grounded in EM feasibility findings ("EM confirmed auth module is ~2 days based on existing pattern in `src/middleware/auth.ts`")
   - **Small:** Issue can be completed within a sprint. If not, the decomposition step should have split further.
   - **Testable:** Every AC has a clear pass/fail condition. "Works correctly" fails. "Returns results within 2 seconds for datasets up to 100k rows" passes.
3. The INVEST "Independent" criterion explicitly handles the dependency tension: sequenced child issues are not INVEST failures — they are flagged as dependencies with the constraint documented. The instruction reads: "If two issues have a build-order dependency, document it explicitly rather than forcing artificial independence. INVEST 'Independent' means 'can be understood and scoped independently,' not 'has zero dependencies.'"
4. A dependency mapping sub-step follows INVEST validation. It produces: (a) a dependency list showing which issues must complete before others, (b) a brief sequencing rationale citing EM feasibility or technical constraints, (c) identification of issues that can be parallelized.
5. Dependency mapping is conditional: only triggers when the issue set contains 4+ issues. For 1-3 issue sets, sequencing is self-evident and the step is skipped with a note: "3 or fewer issues — sequencing is implicit."
6. The dependency mapping output feeds the `## Technical Feasibility` section of each drafted issue, enriching it with sequencing context.
7. INVEST validation is rejected if any dimension produces only pass/fail without a grounding citation to a specific prior-phase finding (research note, EM feasibility statement, or scope constraint). If a prior-phase finding is unavailable for a dimension, the citation must state which phase was absent and what was assumed instead — bare pass/fail without either evidence or an explicit absence statement is not valid. The drafter must re-evaluate that dimension before proceeding to issue drafting.
8. Total new content for this issue does not exceed 50 lines in `phase-5-groom.md` to manage context window pressure.

## User Flows

N/A — no user-facing workflow for this feature type.

## Wireframes

N/A — no user-facing workflow for this feature type.

## Competitor Context

INVEST criteria are referenced by PM Skills Marketplace's `user-stories` skill but applied as a static checklist without evidence trails. No competitor produces per-issue INVEST evidence grounded in prior research and EM feasibility. The evidence trail is PM's differentiator: it makes the validation legible and auditable, not just a rubber stamp.

Dependency mapping within a groomed issue set is not offered by any editor-native competitor. Enterprise tools (Jira, Linear) support dependency linking post-creation, but none generate dependency analysis during the grooming process itself.

## Technical Feasibility

**Feasible as scoped.** Depends on PM-032 (decomposition methodology) being implemented first — the INVEST validation tests the output of the decomposition step. The Phase 5.5 PM reviewer (lines 44-51) and EM reviewer (lines 115-126) already check for decomposition quality and dependency clarity, providing downstream validation alignment. The conditional trigger (4+ issues) keeps overhead low for simple features.

**Risk:** INVEST "Independent" vs. dependency tension is the primary implementation challenge. The AC explicitly resolves this with "can be understood independently, not has zero dependencies" — but the prompt wording must be precise to avoid the LLM flagging every sequenced issue as an INVEST failure.

**Note:** Success metric tracking (Phase 5.5 iteration counts) is deferred to Notes as a measurement task, not an implementation AC. The field `team_review.iterations` already exists in the groom state schema (`skills/groom/SKILL.md` lines 139-147) and requires no new infrastructure.

## Research Links

- Web: INVEST criteria (Agile Alliance, LogRocket)
- Plugin analysis: dev-epic (dependency ordering, layer-aware parallelism)
- Scope review: PM reviewer advisory on dependency mapping ceremony
- Scope review: EM reviewer on INVEST Independent vs. dependency tension

## Notes

- The conditional dependency mapping (4+ issues only) addresses the PM scope reviewer's concern that mandatory dependency mapping is over-ceremony for small squads.
- **Success metric (deferred):** Track Phase 5.5 review iteration count (`team_review.iterations` in groom state, defined in `skills/groom/SKILL.md` lines 139-147) as a quality proxy. Establish baseline by observing 3-5 sessions before shipping, then target reducing average iterations by ≥1 per session post-ship. This is a measurement task, not an implementation AC — extracted from the issue per EM review feedback.
- This issue should be implemented after PM-032 is complete — the INVEST validation tests decomposition output that PM-032 creates.
