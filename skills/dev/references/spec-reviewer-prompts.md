# Spec Reviewer Prompts

Agent prompts for raw sub-issue spec review before RFC generation.

Dispatch these agents using `agent-runtime.md`. The prompts below are runtime-neutral — the dispatch mechanic (Agent, spawn_agent, or inline) depends on the current runtime.

---

## Agent 1: Senior Engineer - Architecture & Risk

**Used for:** Raw M/L/XL sub-issues only (groomed issues skip this since EM covered feasibility in groom).

**Dispatch intent:** `pm:adversarial-engineer`
**Prompt:**
```
Review this implementation plan (RFC) for architecture soundness and risk.

**RFC to review:** {RFC_FILE_PATH}
**Spec for reference:** {SPEC_FILE_PATH}

## Project Context
{PROJECT_CONTEXT}
```

---

## Agent 2: Senior Engineer - Testing & Quality

**Used for:** All sub-issues that get RFC review.

**Dispatch intent:** `pm:test-engineer`
**Prompt:**
```
Review this implementation plan (RFC) for testing strategy and coverage.

**RFC to review:** {RFC_FILE_PATH}
**Spec for reference:** {SPEC_FILE_PATH}

## Project Context
{PROJECT_CONTEXT}
```

---

## Agent 3: Staff Engineer - Complexity & Maintainability

**Used for:** All sub-issues that get RFC review.

**Dispatch intent:** `pm:staff-engineer`
**Prompt:**
```
Review this implementation plan (RFC) for complexity and long-term maintainability.

**RFC to review:** {RFC_FILE_PATH}
**Spec for reference:** {SPEC_FILE_PATH}

## Project Context
{PROJECT_CONTEXT}
```

---

## UX Spec Review Agent

**Used for:** Raw M/L/XL sub-issues that go through brainstorming (spec review before planning).

**Dispatch intent:** `pm:ux-designer`
**Prompt:**
```
Review this feature spec for UX and user flow completeness.

**Spec to review:** {SPEC_FILE_PATH}

## Project Context
{PROJECT_CONTEXT}
```

---

## Product Spec Review Agent

**Used for:** Raw M/L/XL sub-issues inside epics. Run in parallel with UX and Competitive review before planning.

**Dispatch intent:** `pm:product-manager`
**Prompt:**
```
Review this feature spec for JTBD clarity, ICP fit, prioritization, scope creep, and outcome coverage.

**Spec to review:** {SPEC_FILE_PATH}

## Project Context
{PROJECT_CONTEXT}
```

---

## Competitive Spec Review Agent

**Used for:** Raw M/L/XL sub-issues inside epics. Run in parallel with UX and Product review before planning.

**Dispatch intent:** `pm:strategist`
**Prompt:**
```
Review this feature spec for differentiation, switching motivation, competitive response, and non-goal violations.

**Spec to review:** {SPEC_FILE_PATH}

## Project Context
{PROJECT_CONTEXT}
```
