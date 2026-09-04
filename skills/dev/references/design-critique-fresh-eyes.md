# Fresh Eyes Reviewer

Zero-context regression check. Sees the page as a user would — for the first time.

## The Rule

This reviewer receives ZERO context from the design reviewer or prior rounds. It sees ONLY:
- The current screenshots frozen in the bound round capture manifest
- The brief in the bound shared context source: page description, target persona, job to be done
- The design principles in that same bound source

It does NOT receive: reviewer findings, round history, previous screenshots, or any context about what was changed.

It also does not receive normalized audits, acceptance criteria, ticket context, implementation rationale, or the Primary result. Do not copy the brief or principles into unbound input fields. The invocation must use a fresh context identity. Using the same provider, model, or runtime is allowed; continuing inside a context that already saw prohibited material is not.

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

**Look at the screenshots and answer:**

1. Can you tell what this page does within 3 seconds?
2. Where does your eye go first? Is that the right place?
3. Does anything feel off, misaligned, or inconsistent?
```

**Output format:** return only the Fresh Eyes `result` object required by `reviews.json`:

```json
{
  "first_impression": "Two or three direct sentences.",
  "answers": {
    "purpose": { "text": "What the page does.", "evidence_ids": ["capture-id"] },
    "visual_focus": { "text": "Where attention goes first.", "evidence_ids": ["capture-id"] },
    "inconsistencies": { "text": "What feels off, or that none was found.", "evidence_ids": ["capture-id"] }
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

Return exactly one observation row for every supplied capture, including every routed state and viewport. `coverage_id`, `state`, and `viewport` must match that capture's route row. Write at least 40 UTF-8 bytes of direct visual observation, explicitly name the routed state and viewport, and name a concrete interface element plus an observed visual property or relationship. Metadata-filled templates and observations that differ only by capture, coverage, state, or viewport labels are invalid. The first impression and all three answers must also name concrete interface elements; visual-focus and inconsistency answers describe a visual property or relationship. Each finding uses exactly `id`, `subject_id`, `region`, `rule`, `coverage_ids`, `evidence_ids`, `priority`, `owner`, `basis`, `confidence`, `summary`, `impact`, and `remediation`. `region` and `rule` are stable kebab-case tokens. Cite only rendered capture IDs supplied to this invocation—never an audit or other evidence ID. The caller computes deterministic IDs, binds the exact input/result, and writes a `workflow-attested-non-cryptographic` receipt; this is durable workflow evidence, not proof of separate model execution.

## Limits

- Maximum 5 findings (keeps scope tight)
- Findings use P0/P1/P2 only and are treated the same as any reviewer finding
- Merged with design reviewer findings during the inline merge step
