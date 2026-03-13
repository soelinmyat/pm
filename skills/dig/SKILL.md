---
name: pm-dig
description: "Use for quick inline product research during other work. Lightweight alternative to pm:groom. No state, no issues. Frame question, check strategy, research, recommend. Triggers on 'quick question about,' 'should we,' 'how do competitors handle.'"
---

# pm:dig

## Purpose

Quick inline research for mid-work decisions. No ceremony, no state files, no issues — just frame the question, check existing knowledge, research gaps, and recommend. Use when you need a fast answer that does not warrant a full `$pm-groom` cycle.

---

## When to Use

- **Quick strategy questions:** "Should we prioritize this segment?"
- **Competitive intelligence:** "How do competitors handle this?"
- **Decision validation:** "Is this aligned with our positioning?"
- **Feature viability checks:** "Do users ask for this?"

Not for: big feature grooming (use `$pm-groom`), full market analysis (use `$pm-research`), or strategy rewrites (use `$pm-strategy`).
If the user has raw support exports, interview notes, or other local evidence files, use `$pm-ingest` first instead of trying to parse them inline during `$pm-dig`.

---


## Custom Instructions

Before starting work, check for user instructions:

1. If `pm/instructions.md` exists, read it — these are shared team instructions (terminology, writing style, output format, competitors to track).
2. If `pm/instructions.local.md` exists, read it — these are personal overrides that take precedence over shared instructions on conflict.
3. If neither file exists, proceed normally.

**Override hierarchy:** `pm/strategy.md` wins for strategic decisions (ICP, priorities, non-goals). Instructions win for format preferences (terminology, writing style, output structure). Instructions never override skill hard gates.

---

## Flow

### 1. Frame the Question

Ask the user to clarify:
- What is the decision being made?
- Why does it matter right now?
- What would change the answer?

Example: "I'm deciding whether to add bulk actions. Why? The customer asked for it. What would change my answer? If competitors don't have it or if our users don't ask for it often."

### 2. Check Strategy Alignment

If `pm/strategy.md` exists, quickly read it. Ask:
- Does this align with ICP and value prop?
- Does it support or conflict with current priorities?
- Any explicit non-goals it might touch?

Note conflicts explicitly.

### 3. Check Existing Knowledge

Scan:
- `pm/strategy.md` (positioning, ICP, priorities, non-goals)
- `pm/research/` (related topic research)
- Internal customer evidence from `$pm-ingest` also lands in `pm/research/` with `source_origin: internal` or `mixed`
- `pm/competitors/` (competitor capabilities, market gaps)

Do NOT duplicate what you already know. If the answer is in existing docs, cite it and skip research.

### 4. Research Gaps

If the question is not already answered:
- **Search demand check:** If ahrefs-mcp is configured in `.pm/config.json`, use `keywords-explorer-overview` with the topic as keyword to check volume, difficulty, and CPC. A quick data point that grounds the recommendation in actual demand (or lack of it). Skip if provider is `"none"`.
- **Competitor research:** Check `pm/competitors/index.md` or profile specific competitors on features.
- **Market research:** Quick web search for user behavior, adoption patterns, or industry norms.
- **User patterns:** If research exists in `pm/research/`, check for user need signals.
- **Raw evidence handoff:** If the user points to local files that have not been ingested yet, stop and recommend `$pm-ingest <path>` instead of doing ad hoc file parsing here.

Keep it focused. One search round, then synthesize.

### 5. Save Discoveries

If the research yields a finding worth keeping (new competitor capability, market signal, user need pattern), save it to the appropriate file:
- New competitor data -> `pm/competitors/{slug}/findings.md`
- Topic research -> `pm/research/{topic-slug}/findings.md`
- Update `pm/research/index.md` with a one-line summary and the correct origin marker

If the finding is trivial or already documented, skip file creation.

### 6. Recommend

Present the recommendation in this format:

```
## Decision
{The choice being made}

## Recommendation
{Your recommendation: YES, NO, MAYBE, or DEFER}

## Reasoning
- {Key finding 1}
- {Key finding 2}
- {Alignment with strategy / positioning}

## Alternatives
- {If applicable: other options considered and why not chosen}

## Risk / Tradeoff
- {If applicable: what could go wrong, or what we lose by not doing this}
```

Keep it tight. 3-5 bullets max.

---

## Rules

1. **No state file.** Do not create `.dig-state` or track sessions. Each dig is self-contained.
2. **No issues.** Do not create Linear issues. If the user needs tracking, suggest `$pm-groom` or manual issue creation.
3. **Save significant discoveries.** Only write to `pm/` if the finding adds new knowledge, not if it confirms existing docs.
4. **Cite sources.** When you make a claim, provide the source file or URL.
5. **Suggest escalation.** If the dig reveals a bigger question (e.g., "we need to rethink our ICP"), recommend `$pm-strategy` or `$pm-groom` instead.

---

## Knowledge Base Paths

Quick reference for where to check and save:
- **Strategy alignment:** `pm/strategy.md`
- **Competitor data:** `pm/competitors/` (index, profiles, matrix, market gaps)
- **Topic research:** `pm/research/` (index, individual topic folders)
- **Landscape:** `pm/landscape.md` (market overview, key players, segments)

---

## Examples

### Example 1: Feature Prioritization

User: "Should we build bulk timesheet editing?"

Flow:
1. Check `pm/strategy.md` → ICP is ops managers, priority is time-to-insight.
2. Check `pm/competitors/matrix.md` → 3/5 competitors have it; 2 don't.
3. Quick web search → users mention bulk actions 2-3x on forums.
4. Recommend: **YES.** Aligns with ICP workflow, majority of competitors have it, users ask for it.

### Example 2: Segment Expansion

User: "Is the restaurant vertical worth exploring?"

Flow:
1. Check `pm/landscape.md` → restaurants are a segment, but secondary.
2. Check `pm/strategy.md` → ICP is facility ops, non-goal is vertical-specific features.
3. Research: quick search on restaurant ops needs → different workflows, higher customization demand.
4. Recommend: **MAYBE.** Out of ICP, would require custom features (conflicts with non-goals). Would need a separate product line to pursue. Defer to strategy review.

---

## Escalation Triggers

If the dig reveals any of these, suggest the appropriate next step:

- **Strategic misalignment that needs discussion:** `$pm-strategy` (update interview)
- **Big feature decision with many unknowns:** `$pm-groom` (full grooming cycle)
- **New competitive threat or market shift:** `$pm-research competitors` (re-profile, update matrix)
- **Systemic user need not yet captured:** `$pm-research {topic}` (deep dive)
