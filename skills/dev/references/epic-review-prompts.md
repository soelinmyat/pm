# Epic Review Agent Prompts

Agent prompts for Stage 3 (Epic Review). Dispatch as formal plugin agents.

**These agents run as sub-agents.** Their output returns directly to the orchestrator's context. Each agent should produce its JSON verdict as its final output.

**Scaling:** If only 1-2 sub-issues have code work, combine all 3 review perspectives into a single agent prompt. Use 3 parallel agents only when 3+ sub-issues have substantial code changes.

---

## Agent 1: Cross-Cutting Architect

```
Agent({
  subagent_type: "pm:system-architect",
  prompt: `Review these implementation plans AS A SET for cross-cutting architectural concerns.

**Parent issue:** {PARENT_ISSUE_ID} - {PARENT_TITLE}
**Parent description:** {PARENT_DESCRIPTION}

**RFCs to review (read ALL before reviewing):**
{LIST_OF_RFC_FILE_PATHS}

**Sub-issue descriptions:**
{ALL_SUB_ISSUE_IDS_TITLES_AND_DESCRIPTIONS}

Output compact JSON verdict: { "verdict": "...", "blocking": [...], "advisory": [...] }
`
})
```

---

## Agent 2: Integration Tester

```
Agent({
  subagent_type: "pm:integration-engineer",
  prompt: `Review these implementation RFCs AS A SET for integration gaps and cross-sub-issue testing.

**Parent issue:** {PARENT_ISSUE_ID} - {PARENT_TITLE}
**Parent description:** {PARENT_DESCRIPTION}

**RFCs to review (read ALL before reviewing):**
{LIST_OF_RFC_FILE_PATHS}

Output compact JSON verdict: { "verdict": "...", "blocking": [...], "advisory": [...] }
`
})
```

---

## Agent 3: Scope Validator

```
Agent({
  subagent_type: "pm:product-manager",
  prompt: `Validate scope coverage for this epic's implementation plans.

**Parent issue:** {PARENT_ISSUE_ID} - {PARENT_TITLE}
**Parent description:** {PARENT_DESCRIPTION}
**Source:** {groomed | raw}

**RFCs to review (read ALL before reviewing):**
{LIST_OF_RFC_FILE_PATHS}

{IF GROOMED:}
**Groom proposal:** {GROOM_PROPOSAL_TEXT}
**Original acceptance criteria:** {ORIGINAL_ACS}
Check: outcome coverage, AC coverage, scope creep, out-of-scope respect.

{IF RAW:}
Check: gap detection, completeness — would a user consider the parent issue "done"?

Output compact JSON verdict: { "verdict": "...", "blocking": [...], "advisory": [...] }
`
})
```
