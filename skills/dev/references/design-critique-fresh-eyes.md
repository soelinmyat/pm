# Fresh Eyes Reviewer

Zero-context regression check. Sees the page as a user would — for the first time.

## The Rule

This reviewer receives ZERO context from the design reviewer or prior rounds. It sees ONLY:
- The current screenshots frozen in the bound round capture manifest
- For each supplied capture: its capture ID plus the coverage ID, state, viewport, and coverage reason copied verbatim from the bound route that the round capture manifest binds
- The brief in the bound shared context source: page description, target persona, job to be done
- The design principles in that same bound source

It does NOT receive: reviewer findings, round history, previous screenshots, or any context about what was changed.

It also does not receive normalized audits, acceptance criteria, ticket context, implementation rationale, or the Primary result. Do not copy the brief or principles into unbound input fields. The invocation must use a fresh context identity. Using the same provider, model, or runtime is allowed; continuing inside a context that already saw prohibited material is not.

A coverage reason describes only the visible state the capture is meant to show, such as "accessibility large text, sheet body scrolled to its end"; it never carries implementation rationale, fixes, prior findings, or expected verdicts. Copy it verbatim from the bound route. When a row has a missing, empty, or blank reason, render `no description routed`. Never add, summarize, or rewrite descriptions in the prompt.

## Purpose

After a review-fix cycle, the primary reviewer develops tunnel vision — it knows what was wrong and looks for whether it's fixed. Fresh Eyes catches regressions and issues that slip through accumulated context bias.

## Prompt

```
You are seeing this interface for the first time. You have no history with it and no prior opinions.

**Brief:**
- Page: {page_description}
- Persona: {persona}
- Job to be done: {jtbd}

**Design principles (from project):**
{design_principles from CLAUDE.md}

**Captures (what each capture is meant to show):**
- {capture_id} | coverage {coverage_id} | state {state} | viewport {viewport} | {reason}
(one line per supplied capture)

Read each description as the state the capture intends, such as a view scrolled to its end. That intended state is not a defect by itself. Still report any defect you can see within that state.

**Look at the screenshots and answer:**

1. From the task and these views, can you identify the destination, key facts, and next action? Notice discovery and return context where shown; do not assume uncaptured steps succeeded.
2. Where does your eye go first? Is that the right place? Inspect actual pixels: label/control alignment, field placement and relative size, tab surface and page integration, spacing and density. Use supplied longer-content views to judge growth; mark that quality unexamined when they are absent.
3. What is the weakest part for this task? Explain any inconsistency or composition tradeoff using visible elements and the supplied principles. Distinguish a visible concern from untested behavior; do not invent findings.
```

**Output format:** return only the Fresh Eyes `result` object required by `reviews.json`. This synthetic example shows how to name visible elements and describe their position or appearance. Use your own observations and exact capture IDs.

```json
{
  "first_impression": "The Account heading introduces the summary cards. The Save button sits below them where the page changes can be confirmed.",
  "answers": {
    "purpose": {
      "text": "The Account heading identifies the destination, and the Save button shows how to confirm the edited details.",
      "evidence_ids": ["capture-id"]
    },
    "visual_focus": {
      "text": "The bold Account heading sits above the light summary cards and draws the eye first.",
      "evidence_ids": ["capture-id"]
    },
    "inconsistencies": {
      "text": "The Save button aligns with the left edge of the summary cards, but its icon sits above the label.",
      "evidence_ids": ["capture-id"]
    }
  },
  "observations": [
    {
      "capture_id": "capture-id",
      "coverage_id": "route-coverage-id",
      "state": "primary",
      "viewport": "desktop",
      "observation": "The primary state at the desktop viewport places the Account heading above two summary cards, with the Save button below them."
    }
  ],
  "findings": []
}
```

Name a concrete element in every prose field, including the purpose answer. A description of what the task lets people do needs a visible element that communicates it, such as a heading, button, label, or card. If you use a domain term, identify the visible element too, such as a sheet title or a status badge. In the visual-focus and inconsistency answers and in every observation, also describe something you can point to in the image, such as alignment, spacing, contrast, relative size, or position. Keep genuine findings even when the example has none.

The first impression needs at least 60 UTF-8 bytes, each answer at least 50, and each observation at least 40. Each needs at least eight words. Return exactly one observation for each capture. Copy its `coverage_id`, `state`, and `viewport` and name the exact routed state and viewport in the observation prose. Two observations must differ in visible substance beyond those labels.

Each raw finding omits its ID and uses exactly `subject_id`, `region`, `rule`, `coverage_ids`, `evidence_ids`, `priority`, `owner`, `basis`, `confidence`, `summary`, `impact`, and `remediation`. `region` and `rule` are stable kebab-case tokens. Cite only rendered capture IDs supplied to this invocation—never an audit or other evidence ID. The generated finding schema supplies allowed priorities, owners, bases and confidence values, with a non-empty example. The caller computes deterministic IDs, binds the exact input/result, and writes a `workflow-attested-non-cryptographic` receipt; this is durable workflow evidence, not proof of separate model execution.

## Limits

- Maximum 5 findings (keeps scope tight)
- Findings use P0/P1/P2 only and are treated the same as any reviewer finding
- Merged with design reviewer findings during the inline merge step
