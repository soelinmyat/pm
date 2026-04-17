---
name: Simplify
order: 6
description: Post-implementation code simplification gate — review for reuse, quality, and efficiency
---

## Simplify

<HARD-RULE>
After the user approves the RFC (via /rfc), the orchestrator proceeds into simplify without pausing. Do NOT ask "Ready to simplify?", "Proceed with simplify?", or present options. The step is automatic — invoke `pm:simplify` and continue.

Only stop for:
- Test failures after simplify fixes that can't be resolved after 3 attempts (surface to user)
- A finding that requires a design call the agents explicitly flagged as needing human judgment
</HARD-RULE>

**Multi-task skip:** If `task_count > 1` in the session state, skip this step. Per-task agents in Step 05 handled simplify as part of their own lifecycle. This applies regardless of individual task outcomes (merged, blocked, or failed).

**Kind skip (overrides size):** If session state has `kind: task` or `kind: bug`, skip this step entirely — regardless of size. Log: `Simplify: skipped-kind-{kind}`. Task/bug items are intentionally lightweight; the review gate (Step 07) still runs.

## Goal

Run the mandatory post-implementation simplification gate so the delivered code is reusable, efficient, and ready for downstream review.

Invoke `pm:simplify` after implementation completes. This is a mandatory quality gate for S+ sizes.

**Size routing:**

| Size | Action |
|------|--------|
| XS | Skip simplify entirely |
| S | Invoke `pm:simplify` — fix findings, run tests, commit |
| M | Invoke `pm:simplify` — fix findings, run tests, commit |
| L | Invoke `pm:simplify` — fix findings, run tests, commit |
| XL | Invoke `pm:simplify` — fix findings, run tests, commit |

`pm:simplify` routes to Anthropic official simplify in Claude Code and normalizes output to PM-required fields. It reviews changed code for reuse, quality, and efficiency, then fixes any issues found.

**Sequence:** Simplify MUST run before design critique and before review. The order is: implement → simplify → design critique → QA → review → ship.

After simplify completes and all findings are fixed:
1. Run the full test suite to verify nothing broke
2. Commit all simplification fixes
3. Proceed to review (or design critique if UI changes exist)

## Done-when

Simplify has either been correctly skipped for XS or completed with all required fixes committed, the tests rerun, and the task is ready for review/critique.
