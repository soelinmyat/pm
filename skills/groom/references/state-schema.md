# Groom Session State Schema

State file location: `{source_dir}/.pm/groom-sessions/{topic-slug}.md`

**Repo location:** Groom sessions are ephemeral, machine-local scratchpad state. They live in the **source repo's** `.pm/groom-sessions/` (gitignored), never in the PM repo. Committing session state to the shared PM repo would leak in-progress work across machines and contributors. The grooming **artefact** (the proposal document) lives at `{pm_dir}/backlog/{topic-slug}.md` in the PM repo — only the session state is source-side. In same-repo mode, source_dir is the project root, so this resolves to `.pm/groom-sessions/` there.

```yaml
---
topic: "{topic name}"
runtime: claude | codex
groom_tier: quick | standard | full | agent
phase: intake | strategy-check | research | scope | scope-review | design | draft-proposal | team-review | bar-raiser | present | link | synthesis | scope-lock | proposal-ready
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

# ─── Agent-tier-only fields (additive, optional) ────────────────────────────
# Populated only when groom_tier == agent. Co-pilot tiers leave these unset.
# Resume logic tolerates missing fields. No migration required.

kb_freshness:                       # populated by Step 01a-intake-agent.md
  strategy_age_days: int            # null if file missing; refuses if > 90
  hot_insights_active: int          # count without resolved/expired status; refuses if < 3
  competitor_profiles: int          # count of evidence/competitors/*/profile.md; refuses if < 2

checkpoints:                        # populated as agent flow progresses
  - name: scope-lock | proposal-ready
    timestamp: YYYY-MM-DDTHH:MM:SSZ
    outcome: approve | redirect | abort

source_citations:                   # mirror of synthesizer output; rendered in proposal HTML audit details
  - claim_id: "{anchor}"
    file: "pm/evidence/research/{slug}.md"
    line: int                       # nullable
    finding_id: "{F-id}"            # nullable; for evidence files
    excerpt: "{verbatim quote}"     # nullable; reviewer-aid

iron_law_check:                     # populated by synthesizer; orchestrator validates fs.exists
  research_cited: true | false      # must be true or 04a halts
  research_files: ["pm/evidence/research/...md"]
  fs_exists_checked: true           # MUST be true (orchestrator-side)
  missing_paths: []                 # cited paths that failed fs.exists

questions_asked: int                # 0-2 brief-exchange + any escalation; alerts if > 2
cost_usd: float                     # cumulative session token spend
tokens_used: int
time_to_scope_lock_seconds: int
time_to_proposal_ready_seconds: int

iter_counts:                        # per-checkpoint, reset on session start only
  scope_review: int                 # cap=2 for agent (vs 3 for co-pilot)
  team_review: int                  # cap=2 for agent (vs 3 for full tier)

redirects:
  scope_lock: int                   # caps at 3; 4th escalates
  proposal_ready: int               # caps at 3; 4th escalates

citation_validity_sampled:          # filled by reviewer flagging during scope-review/team-review
  sampled: int
  valid: int
# ─── End agent-tier-only fields ─────────────────────────────────────────────

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
