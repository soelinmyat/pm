---
title: "Dev worker contract"
created: 2026-07-11
updated: 2026-07-11
---

# Dev worker contract

## Purpose

Give inline, delegated, and headless implementation workers the same bounded contract. Build it with `scripts/dev-prompt.js`; do not hand-compose provider-specific variants.

## Contract

Every worker prompt has these sections exactly once:

1. Outcome.
2. Scope and exclusions.
3. Inputs and context, including only the active phase contract and its durable `design_context` when present. Set the builder's `phase` to the current phase and pass the complete approved `design_context` object separately; the builder validates and renders it without summarizing its prototype or invariants. Without a bound context, declare observed `ui_impact` as a boolean. Legacy packets without either field remain readable; new implementation callers supply the classification.
4. Acceptance criteria.
5. Applicable repository rules.
6. Authorized actions, including explicit denials.
7. Required evidence.
8. Stop conditions.
9. Result schema.

Do not include future phase instructions. The root owns phase transitions and any external action not expressly granted. A worker cannot grant itself additional authority. A worker also cannot widen its owned paths: if the fix needs a path outside them, return `blocked` naming the path, and the root decides whether to amend the RFC ownership.

## Quality checks

- Prefer paths and test commands over copied source content.
- State each instruction once.
- Keep workflow instruction under 1,200 words, excluding task artifacts.
- Reject missing outcomes, ACs, rules, evidence, stop conditions, authority, or result schema instead of inserting placeholders.
- Preserve UI-impact classification, design requirements, complete prototype identity, critical states, and applicable experience/visual invariants byte-for-byte from a supplied `design_context`; workers may not silently reinterpret or selectively copy it.
- For visible UI implementation, include relevant repository design-guidance paths and a strong comparable screen in Inputs, or explicitly explain their absence. Use `product-ui-judgment.md`'s implementation method to make task hierarchy, disclosure, metadata and action grouping concrete. The first visible slice is inspected as a whole page inside existing implementation acceptance, not certified by this packet or a new review round.
- Record UTF-8 bytes and whitespace-delimited words for comparison across models.

## Done-when

The generated prompt contains the nine sections once, reports its byte and word counts, includes the active contract, and excludes all future contracts.

**Advance:** dispatch or execute the active phase using the selected runtime profile.
