---
name: Dispatch reviewers
order: 2
description: Run the target-planned read-only wave and collect schema-valid independent results
requires:
  - ../references/evidence-contract.md
  - ../references/reviewer-briefs.md
  - ../../dev/references/agent-runtime.md
---

## Goal

Produce exactly one hash-bound JSON result for every physical reviewer in `target.json`, with a verdict for every assigned logical lens.

## How

1. Read the target, reviewer briefs, personas, project instructions, AGENTS/CLAUDE conventions, acceptance criteria, and exact diff. Do not give reviewers prior findings or the intended answer.
2. Dispatch all planned physical reviewers in one read-only parallel wave when native subagents are available. This is the scoped review exception in `agent-runtime.md`. With one physical reviewer or no safe subagent capability, run assigned lenses sequentially without mixing their verdict sections.
3. Give each reviewer only its assigned lenses, exact target binding, runtime/profile identity, changed files, diff, acceptance criteria, and the shared JSON schema. A multi-lens reviewer must return an isolated verdict for each lens.
4. Require evidence locators that the checker can resolve. Source/test/contract/design-token evidence uses `path:line[-line]`; trace/benchmark uses `artifact:path#locator`; upstream gate evidence uses a project-relative artifact path.
5. Save exactly one file per allocation row at `.pm/dev-sessions/{slug}/review/runs/{RUN_ID}/round-{N}/results/{worker-id}.json`, deriving `{RUN_ID}` and `{N}` from the target. Do not repair malformed reviewer JSON by inventing content; re-dispatch that worker once with the validation error.
6. Reviewers are read-only. They do not edit, commit, push, update gates, or decide product/design questions.

## Done-when

- Every planned worker produced one result bound to the exact target, source identity, runtime, and assigned lens list.
- Each assigned lens has exactly one `clean` or `findings` verdict whose outcome agrees with emitted findings.
- Every finding has deterministic identity, concrete evidence, ownership, fix kind, and verification.

**Advance:** proceed to Step 3 (Synthesize evidence).
