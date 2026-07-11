You are testing the RFC review phase of the PM plugin. This is read-only: do not edit files or run external effects.

Read only these files:

- skills/rfc/SKILL.md
- skills/rfc/steps/03-rfc-review.md
- skills/rfc/steps/04-approval.md
- skills/rfc/steps/05-handoff.md
- skills/rfc/references/review-contract.md
- skills/rfc/references/rfc-session.schema.json

Evaluate the executable contract, not writing style. Answer:

1. Can a passing technical review mark the RFC approved without a separate explicit human approval command?
2. Does RFC approval implicitly authorize Linear creation, loop approval, opening a browser, or starting implementation?
3. Are the three review lenses mandatory even when one model performs all three?
4. Name any concrete contract contradiction that would let a literal agent bypass those rules. If none, return an empty findings array.

Return only the JSON object required by the supplied output schema. Use the exact model identifier you are running under in `model`. Set `status` to `pass` only if all four checks are approval-safe and internally consistent.
