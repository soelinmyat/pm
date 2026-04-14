# Groom Session State Schema

State file location: `{pm_state_dir}/groom-sessions/{topic-slug}.md`

**Repo location:** In separate-repo mode, `pm_state_dir` resolves to the PM repo's `.pm/` directory, so groom sessions are always stored in the PM repo — never in the source repo. This keeps product discovery artifacts co-located with the knowledge base. In same-repo mode, both groom and dev sessions live in the same `.pm/` directory (no change).

```yaml
---
topic: "{topic name}"
runtime: claude | codex
groom_tier: quick | standard | full
phase: intake | strategy-check | research | scope | scope-review | design | draft-proposal | team-review | bar-raiser | present | link
started: YYYY-MM-DD
updated: YYYY-MM-DD
run_id: "{PM_RUN_ID}"
started_at: YYYY-MM-DDTHH:MM:SSZ
phase_started_at: YYYY-MM-DDTHH:MM:SSZ
completed_at: null | YYYY-MM-DDTHH:MM:SSZ
linear_id: "{Linear ID}" | null
codebase_available: true | false
codebase_context: "{brief summary of related existing code, or 'greenfield'}"
product_features_available: true | false
product_feature_count: 0
kb_maturity: fresh | developing | mature
kb_maturity_tier: quick | standard | full
kb_signals:
  strategy: true | false
  insights: true | false
  competitors: true | false

strategy_check:
  status: passed | failed | override | skipped
  checked_against: {pm_dir}/strategy.md | null
  checked_at: YYYY-MM-DD | null  # for strategy-drift detection
  reason: "{why skipped or overridden}" | null
  conflicts:
    - "{conflicting non-goal text}"
  supporting_priority: "{priority text}" | null
  context:  # extracted once, referenced by all later phases
    icp: "{ICP summary from Section 2}"
    priorities: ["{priority 1}", "{priority 2}", "{priority 3}"]
    non_goals: ["{non-goal 1}", "{non-goal 2}"]
    positioning: "{competitive positioning summary from Section 4}" | null

research_location: {pm_dir}/evidence/research/{topic-slug}.md | null
research_note: "{1-line summary of inline finding}" | null  # quick tier only
stale_research: []  # list of {name, age_days, threshold_days, type} for research cited above threshold
retro_failed: true | false | null

scope:
  in_scope:
    - "{item}"
  out_of_scope:
    - "{item}: {reason}"
  filter_result: 10x | gap-fill | table-stakes | parity | null

scope_review:
  pm_verdict: ship-it | rethink-scope | wrong-priority | null
  competitive_verdict: strengthens | neutral | weakens | null
  em_verdict: feasible | feasible-with-caveats | needs-rearchitecting | null
  blocking_issues_fixed: 0
  iterations: 1

team_review:
  pm_verdict: ready | needs-revision | significant-gaps | null
  competitive_verdict: sharp | adequate | undifferentiated | null
  em_verdict: ready | needs-restructuring | missing-prerequisites | null
  design_verdict: complete | gaps | inconsistencies | null
  blocking_issues_fixed: 0
  iterations: 1

bar_raiser:
  verdict: ready | send-back | pause | null
  iterations: 1
  blocking_issues_fixed: 0

proposal:
  slug: "{topic-slug}"
  backlog_path: {pm_dir}/backlog/{topic-slug}.md
  linear_id: "{Linear ID}" | null
  prd_path: {pm_dir}/backlog/{topic-slug}.md | null
---
```
