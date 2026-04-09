# Review Gate Pattern

Shared pattern for all multi-reviewer quality gates. Skills reference this instead of reimplementing the dispatch-collect-fix loop.

---

## The Pattern

Every review gate follows the same loop:

```
1. Dispatch N reviewers (parallel or sequential)
2. Collect verdicts
3. If blocking issues found → fix → re-dispatch (up to max iterations)
4. If approved → proceed
5. If max iterations exceeded → surface to human
```

---

## Dispatch

### Reviewer prompt structure

Every reviewer subagent gets:

```
You are a {role}. Review this {artifact_type}.

**Artifact to review:** {path}
**Reference (if applicable):** {spec/plan/strategy path}

## What to Check
| Category | What to Look For |
|----------|------------------|
| ... | ... |

## Calibration
Only flag issues that would cause real problems in the next phase.
{artifact_type}-specific calibration rules.

## Output Format
**Verdict:** {verdict from taxonomy}
**Issues:** (if any)
- [{severity}] {specific issue with location}

**Approved** or **Issues Found**
```

### Parallel dispatch

When dispatching 2+ reviewers on the same artifact:
- Use `Agent` tool with `model: "sonnet"` for reviewers (unless domain requires opus)
- Dispatch all reviewers simultaneously
- Wait for all to complete before processing results

### Sequential dispatch

When the artifact changes between reviews (fix → re-review):
- Dispatch the original reviewer again (not a new one — use `SendMessage` if possible)
- Provide the fix context: what changed and why

---

## Collect

### Verdict taxonomy

Each review domain defines its own verdict taxonomy. Common patterns:

**Binary gate (spec/plan review):**
- `Approved` — proceed to next phase
- `Issues Found` — fix and re-review

**Multi-verdict gate (scope/team review):**
- `ship-it / ready / complete` — no blockers
- `ship-if / ready-if / complete-if` — proceed after fixing specific items
- `rethink / needs-revision / gaps` — significant problems, may need redesign
- `wrong-priority / send-back / pause` — stop, escalate to human

### Result presentation

Follow `references/writing.md` for output formatting. Collapse multi-reviewer results into:

| Reviewer | Verdict | Key note |
|----------|---------|----------|

List only blocking items as bullets. Advisory items after user acknowledges blockers.

---

## Fix Loop

### Rules

1. **Same agent fixes.** The agent that wrote the artifact fixes it (preserves context).
2. **One round of fixes at a time.** Fix all blocking issues, then re-dispatch reviewers.
3. **Max iterations:** Default 3 (configurable per gate). After max:
   - Stop the loop
   - Report: what was fixed, what remains, why it's not converging
   - Surface to human for guidance
4. **Don't fix advisory items** during the loop. Only blocking issues.
5. **Re-dispatch checks the whole artifact**, not just the fixes. Fixes can introduce new issues.

### Fix commit convention

If fixes result in code or document changes:
```bash
git add {changed files}
git commit -m "fix: address {reviewer} review — {brief description}"
```

---

## Escalation

When to stop the loop and ask the human:

| Signal | Action |
|--------|--------|
| Max iterations reached | Report status, ask for guidance |
| Reviewer and author disagree | Present both arguments, let human decide |
| Issue requires design decision | Don't guess — ask |
| Fix makes artifact worse | Stop, report the regression |

---

## Gate Inventory

Reference for where each gate is defined and what reviewer prompts it uses:

| Gate | Called by | Reviewers | Prompt locations |
|------|----------|-----------|-----------------|
| Spec review | brainstorming | 1 (spec-document-reviewer) | `skills/brainstorming/spec-document-reviewer-prompt.md` |
| Plan review | writing-plans | 1 (plan-document-reviewer) | `skills/writing-plans/plan-document-reviewer-prompt.md` |
| Scope review | groom phase 4.5 | 3 (PM, Competitive, EM) | `skills/groom/phases/phase-4.5-scope-review.md` |
| Team review | groom phase 6 | 3-4 (PM, Competitive, EM, Design) | `skills/groom/phases/phase-6-team-review.md` |
| Bar raiser | groom phase 6.5 | 1 (Product Director) | `skills/groom/phases/phase-6.5-bar-raiser.md` |
| Code review | review | 5 (code, fix, PM, design, edge-case) | `skills/review/SKILL.md` |
| Spec compliance | subagent-dev | 1 (spec-reviewer) | `skills/subagent-dev/spec-reviewer-prompt.md` |
| Code quality | subagent-dev | 1 (code-quality-reviewer) | `skills/subagent-dev/code-quality-reviewer-prompt.md` |
