# RFC Reviewer Prompts

Agent prompts for individual plan review (Stage 2). Dispatch as formal plugin agents.

---

## Agent 1: Senior Engineer - Architecture & Risk

**Used for:** Raw M/L/XL sub-issues only (groomed issues skip this since EM covered feasibility in groom).

```
Agent({
  subagent_type: "pm:adversarial-engineer",
  prompt: `Review this implementation plan (RFC) for architecture soundness and risk.

**Plan to review:** {PLAN_FILE_PATH}
**Spec for reference:** {SPEC_FILE_PATH}

## Project Context
{PROJECT_CONTEXT}
`
})
```

---

## Agent 2: Senior Engineer - Testing & Quality

**Used for:** All sub-issues that get RFC review.

```
Agent({
  subagent_type: "pm:test-engineer",
  prompt: `Review this implementation plan (RFC) for testing strategy and coverage.

**Plan to review:** {PLAN_FILE_PATH}
**Spec for reference:** {SPEC_FILE_PATH}

## Project Context
{PROJECT_CONTEXT}
`
})
```

---

## Agent 3: Staff Engineer - Complexity & Maintainability

**Used for:** All sub-issues that get RFC review.

```
Agent({
  subagent_type: "pm:staff-engineer",
  prompt: `Review this implementation plan (RFC) for complexity and long-term maintainability.

**Plan to review:** {PLAN_FILE_PATH}
**Spec for reference:** {SPEC_FILE_PATH}

## Project Context
{PROJECT_CONTEXT}
`
})
```

---

## UX Spec Review Agent

**Used for:** Raw M/L/XL sub-issues that go through brainstorming (spec review before planning).

```
Agent({
  subagent_type: "pm:ux-designer",
  prompt: `Review this feature spec for UX and user flow completeness.

**Spec to review:** {SPEC_FILE_PATH}

## Project Context
{PROJECT_CONTEXT}
`
})
```
