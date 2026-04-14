---
name: Review
order: 7
description: Code review gate — full review for M/L/XL, code scan for XS, skip for S
---

## Review

**Multi-task skip:** If `task_count > 1` in the session state, skip this step. Per-task agents in Step 05 handled review as part of their own lifecycle. This applies regardless of individual task outcomes (merged, blocked, or failed).

## Goal

Apply the right review and QA depth for the task size so implementation does not ship without the required quality gates.

Code review is a mandatory gate before shipping. The depth scales with task size.

**Size routing:**

| Size | Review type |
|------|-------------|
| XS | Code scan — lightweight bug scan before merge. Single reviewer per `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/implementation-flow.md` |
| S | Skip code scan — simplify already covers it |
| M | `/review` (full) — invoke `pm:review`, fix all findings, commit |
| L | `/review` (full) — invoke `pm:review`, fix all findings, commit |
| XL | `/review` (full) — invoke `pm:review`, fix all findings, commit |

### Full review (M/L/XL)

Invoke `/review` on the branch. This dispatches multiple review perspectives:

- Review as @staff-engineer for architecture and maintainability
- Review as @adversarial-engineer for edge cases and failure modes
- Review as @tester for test coverage and assertions

Fix all blocking findings. Run tests after fixes. Commit.

### Code scan (XS)

Run a lightweight single-reviewer code scan per `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/implementation-flow.md`. This catches obvious bugs without the full multi-perspective review overhead.

### Design critique (UI changes only)

If the implementation includes frontend/UI changes:

| Size | Design critique |
|------|----------------|
| XS | Skip |
| S | Lite (1 round) — invoke `/design-critique` if available |
| M/L/XL | Full — invoke `/design-critique` if available |

### QA gate (UI changes only)

If the implementation includes frontend/UI changes, dispatch QA per `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/implementation-flow.md`:

| Size | QA depth |
|------|----------|
| XS | Quick |
| S | Focused |
| M/L/XL | Full |

### Verification gate (all sizes)

After all review and QA gates pass:
1. Run the full test suite as final verification
2. Verify all findings are addressed
3. Proceed to ship

### Review feedback handling

For M/L/XL, if human reviewers leave comments on the PR after creation, use `ship/references/handling-feedback.md` to process and respond to feedback.

## Done-when

The size-appropriate review path has passed, all required QA/design gates for UI work are complete, and final verification has run before handing off to ship.
