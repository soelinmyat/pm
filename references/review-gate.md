# Review Gate Pattern — the review() primitive

Shared pattern for all multi-reviewer quality gates. A step that IS a review gate declares parameters and runs this loop — it does not reimplement dispatch-collect-fix mechanics. (Groom steps 5 and 8 are the reference implementations of this shape.)

---

## The primitive

A review gate is fully described by its parameters:

| Parameter | Meaning |
|-----------|---------|
| Artifact | What is being reviewed (a file, a state block, a diff) |
| Reviewers | Persona list, each with an angle; conditional members state their condition |
| Briefs | Where the reviewer prompts live (a prompt library file — never duplicated inline in the step) |
| Dispatch | One parallel wave via `skills/dev/references/agent-runtime.md`; inline-sequential fallback when delegation is unavailable |
| Independence | `none` (default) · `fresh-eyes` (reviewer must not read other findings — dispatch it in the same wave so they don't exist yet) · `anti-collusion` (headless agent tier: verbatim prepend from the brief library) |
| Iteration cap | Max fix loops before escalation (default 3; headless agent tiers use 2) |
| Verdicts | Per-reviewer enums, owned by the gate (do not homogenize vocabularies across gates) |
| Blocking fix | What "fix" means for this artifact |
| Escalation | What happens at the cap or on a stop-verdict |

Every gate runs the same loop:

```
1. Dispatch ALL reviewers in one parallel wave
2. Collect verdicts; merge + deduplicate team findings (independent reviewers stay separate signals)
3. Split blocking vs advisory
4. Blocking → fix the artifact → re-dispatch the WHOLE wave (fixes can introduce new problems)
5. Repeat up to the iteration cap
6. Cap reached or stop-verdict → escalate to the human
```

Shared gate rules (every review gate, verbatim intent):
- All declared reviews are required. Do NOT skip based on feature type, perceived quality, or time pressure. If a reviewer's angle doesn't apply, the reviewer will say so — that is different from never asking.
- Read `skills/dev/references/agent-runtime.md` before dispatching. If delegation is unavailable, run the same briefs inline before merging findings.
- Advisory items are surfaced later, never fixed inside the loop.

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
| Plan review | rfc (review step) | 1 (plan-document-reviewer) | `skills/dev/references/plan-reviewer.md` |
| Scope review | groom step 05 | 3 (PM, Competitive, EM) | `skills/groom/references/team-reviewers.md` § Scope Review |
| Team review + bar raiser | groom step 08 (one concurrent wave) | 4-5 (PM, Competitive, EM, Design cond., Product Director fresh-eyes) | `skills/groom/references/team-reviewers.md` |
| Code review | review | 6 lenses (bugs, design, input edge-case, reuse, quality, efficiency) | `skills/review/SKILL.md` |
| Spec compliance | subagent-dev | 1 (spec-reviewer) | `skills/dev/references/subagent-spec-reviewer.md` |
| Code quality | subagent-dev | 1 (code-quality-reviewer) | `skills/dev/references/code-quality-reviewer.md` |
