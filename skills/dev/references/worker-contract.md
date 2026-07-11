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
3. Inputs and context, including only the active phase contract.
4. Acceptance criteria.
5. Applicable repository rules.
6. Authorized actions, including explicit denials.
7. Required evidence.
8. Stop conditions.
9. Result schema.

Do not include future phase instructions. The root owns phase transitions and any external action not expressly granted. A worker cannot grant itself additional authority.

## Quality checks

- Prefer paths and test commands over copied source content.
- State each instruction once.
- Keep workflow instruction under 1,200 words, excluding task artifacts.
- Reject missing outcomes, ACs, rules, evidence, stop conditions, authority, or result schema instead of inserting placeholders.
- Record UTF-8 bytes and whitespace-delimited words for comparison across models.

## Done-when

The generated prompt contains the nine sections once, reports its byte and word counts, includes the active contract, and excludes all future contracts.

**Advance:** dispatch or execute the active phase using the selected runtime profile.

