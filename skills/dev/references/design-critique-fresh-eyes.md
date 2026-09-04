# Fresh Eyes Reviewer

Zero-context regression check. Sees the page as a user would — for the first time.

## The Rule

This reviewer receives ZERO context from the design reviewer or prior rounds. It sees ONLY:
- Current screenshots
- A brief: page description, target persona, job to be done
- The project's CLAUDE.md design principles

It does NOT receive: reviewer findings, round history, previous screenshots, or any context about what was changed.

It also does not receive normalized audits, acceptance criteria, ticket context, implementation rationale, or the Primary result. The invocation must use a fresh context identity. Using the same provider, model, or runtime is allowed; continuing inside a context that already saw prohibited material is not.

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
  "findings": []
}
```

Each finding uses exactly `id`, `subject_id`, `region`, `rule`, `coverage_ids`, `evidence_ids`, `priority`, `owner`, `basis`, `confidence`, `summary`, `impact`, and `remediation`. `region` and `rule` are stable kebab-case tokens. Cite only rendered capture IDs supplied to this invocation—never an audit or other evidence ID. The caller computes deterministic IDs and binds the exact input and result into `reviews.json`.

## Limits

- Maximum 5 findings (keeps scope tight)
- Findings use P0/P1/P2 only and are treated the same as any reviewer finding
- Merged with design reviewer findings during the inline merge step
