---
name: Intake (agent)
order: 1.1
description: Tier gate (KB freshness check), brief-exchange decision rule, slug derivation. Replaces 01-intake.md for agent tier.
applies_to: [agent]
---

### Step 01a: Intake (agent tier)

## Goal

Admit only an eligible Claude agent-tier request, resolve its bounded brief, derive the slug, and create initial agent session state.

## How

This is the agent-tier intake step. It runs in place of `01-intake.md` for sessions where `groom_tier == "agent"`. The dispatcher selects this file via `applies_to: [agent]`.

**What this step owns:**
- Tier gate (refuse if KB freshness fails)
- Runtime gate (refuse under codex)
- Brief exchange decision rule (Q1, Q2)
- Slug derivation
- Initial state file write

**What this step does NOT own:** synthesis (that's `04a-synthesis.md`), strategy interview (no longer happens — synthesizer reads strategy itself), research dispatch (no longer happens — research must already exist).

---

#### Phase A: Runtime gate

Read the current runtime from groom session context (`runtime: claude | codex`).

If runtime is `codex`, refuse:

> "Agent tier currently runs under Claude only. Codex inline-execution mode is out of scope for the alpha. Use `--tier standard` for Codex."

Stop. Do not write a session state file.

---

#### Phase B: KB freshness gate

Per `references/tier-gating.md` §"Agent tier — additional gating", agent tier requires a stricter KB than `full`. Check three signals:

| Signal | Source | Threshold | On fail |
|---|---|---|---|
| Strategy freshness | `{pm_dir}/strategy.md` `updated:` field | < 90 days | Refuse: "Strategy is N days old. Run `/pm:strategy` to refresh, or use `--tier standard` to proceed without freshness check." |
| Hot insights count | `{pm_dir}/insights/.hot.md` body — count entries without `status: resolved` or `status: expired` | ≥ 3 | Refuse: "Only N active hot insights. Agent tier needs ≥3. Run `/pm:research` to capture more, or use `--tier standard`." |
| Competitor profiles | `find {pm_dir}/evidence/competitors -name 'profile.md'` count | ≥ 2 | Refuse: "Only N competitor profiles. Agent tier needs ≥2. Run `/pm:ingest` or `/pm:research` to add competitive evidence, or use `--tier standard`." |

Write findings to session state under `kb_freshness:`:

```yaml
kb_freshness:
  strategy_age_days: int            # null if strategy.md missing
  hot_insights_active: int
  competitor_profiles: int
```

If any threshold fails: print the matching refusal directive AND `kb_freshness` snapshot. Stop.

If all three pass: continue.

---

#### Phase C: Slug derivation

Same logic as `01-intake.md`. Derive a kebab-case slug (max 4 words) from the topic. If the slug already exists in `{pm_dir}/backlog/`, use existing or ask the user to disambiguate.

---

#### Phase D: Brief exchange decision rule

The agent tier's iron law: do not interrogate the user for things the KB already answers. Default question count is **0**. Two specific triggers may produce 1 question each — never more than 2 total.

**Question 1 — KB anchor check.**

Trigger: topic slug matches no entry in any of:
- `{pm_dir}/thinking/*.md` (slug or title match)
- `{pm_dir}/backlog/*.md` (slug or title match)
- `{pm_dir}/evidence/research/index.md` (any line containing the topic terms)

If no anchor exists, the synthesizer has no KB hook to start from. Ask:

> "I couldn't find prior thinking, backlog, or research on '{topic}'. Briefly: what problem does this solve, and for whom? (One sentence.)"

Capture the answer to `brief_answers.q1` in the session state. Do not ask follow-ups.

If an anchor exists, skip Q1.

**Question 2 — JTBD ambiguity check.**

This trigger fires *after* the synthesizer dispatch (Step 04a), based on the synthesizer's `ambiguity_score` output. The intake step itself does not pre-ask Q2 — it only sets up the state field. Step 04a re-enters this step to ask Q2 if both signals fire:

- `ambiguity_score.candidate_jtbds >= 2` (synthesizer surfaced multiple plausible JTBDs)
- `ambiguity_score.no_clear_primary == true` (no single candidate has strictly more source citations than every other candidate AND a single distinct primary persona)

If both true: ask the disambiguation question Step 04a provides. If either is false: skip.

Note: Q2 re-dispatch is scoped — only `@persona-jtbd-deriver` re-fires (not the full synthesizer). See Step 04a.

**Hard cap:** never more than 2 questions in a session. Telemetry alerts on any session with `questions_asked > 2`.

---

#### Phase E: Initial state write

Write the session state file at `{source_dir}/.pm/groom-sessions/{slug}.md` with:

```yaml
topic: "{topic}"
runtime: claude
groom_tier: agent
phase: intake
started: YYYY-MM-DD
updated: YYYY-MM-DD
run_id: "{PM_RUN_ID}"
started_at: YYYY-MM-DDTHH:MM:SSZ
phase_started_at: YYYY-MM-DDTHH:MM:SSZ
completed_at: null
codebase_available: true | false
codebase_context: "{brief or 'greenfield'}"
kb_maturity: mature                   # agent tier requires mature
kb_maturity_tier: full
kb_signals:
  strategy: true
  insights: true
  competitors: true
kb_freshness:                         # already populated above
  strategy_age_days: int
  hot_insights_active: int
  competitor_profiles: int
brief_answers:
  q1: "{answer or null}"
  q2: null                            # filled by Step 04a if Q2 fires
questions_asked: 0                    # incremented per question asked
checkpoints: []                       # populated by 04a + 11
iter_counts:
  scope_review: 0
  team_review: 0
redirects:
  scope_lock: 0
  proposal_ready: 0
```

Advance phase to `synthesis` and proceed to `04a-synthesis.md`.

## Done-when

Runtime and KB freshness gates pass, no more than two decision-rule questions are resolved, and the agent-tier state is durably initialized; otherwise the request is refused with a standard-tier recovery route.

**Advance:** proceed to Step 4.1 (Synthesis).
