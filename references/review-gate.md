# Review Gate Pattern — the review() primitive

Shared pattern for all multi-reviewer quality gates. A step that IS a review gate declares parameters and runs this loop — it does not reimplement dispatch-collect-fix mechanics. (The live reference implementations are Groom step 07 — question coverage per `skills/groom/references/review-questions.md` — and RFC step 03 — lens coverage per `skills/rfc/references/review-contract.md`.)

---

## The primitive

A review gate is fully described by its parameters:

| Parameter | Meaning |
|-----------|---------|
| Artifact | What is being reviewed (a file, a state block, a diff) |
| Reviewers | Persona list, each with an angle; conditional members state their condition |
| Briefs | Where the reviewer prompts live (a prompt library file — never duplicated inline in the step) |
| Dispatch | One parallel wave via `skills/dev/references/agent-runtime.md`. These are short-lived read-only reviewers, so **Codex uses parallel `spawn_agent` for the wave by default** (the scoped read-only exception to default-off delegation); sequential only when `spawn_agent` is genuinely unavailable |
| Independence | `none` (default) · `fresh-eyes` (reviewer must not read other findings — dispatch it in the same wave so they don't exist yet) · `anti-collusion` (headless agent tier: verbatim prepend from the brief library) |
| Iteration cap | Max fix loops before escalation (default 3; headless agent tiers use 2) |
| Verdicts | Per-reviewer enums, owned by the gate (do not homogenize vocabularies across gates). The step's parameter table is the canonical listing; state YAML persists slugified forms; briefs quote the display forms. |
| Blocking fix | What "fix" means for this artifact |
| Escalation | What happens at the cap or on a stop-verdict |

**Verdict ownership.** The dispatching gate owns the verdict enum — its step parameter table (the `Verdicts` row) is the canonical listing. Agent base files (`agents/*.md`) must NOT declare a competing verdict enum in their Output Format; they defer to the taxonomy their dispatch brief supplies, and briefs quote the gate's display forms. A reviewer dispatched without a gate taxonomy defaults to `Approved | Issues Found`. This keeps one role from emitting different vocabularies at different entry points.

Every gate runs the same loop:

```
1. Dispatch ALL reviewers in one parallel wave
2. Collect verdicts; merge + deduplicate team findings (context-separated reviewer signals stay distinct)
3. Split blocking vs advisory
4. Blocking → fix the artifact → re-dispatch every AFFECTED reviewer: any reviewer whose findings the fix addressed, plus any whose reviewed surface the fix touched (Groom reruns every affected question; RFC re-runs every affected lens). A fix that changes shared or structural surface affects everyone — re-dispatch the full wave. `fresh-eyes` reviewers always get a fresh agent; `Independence: none` reviewers may be re-engaged with fix context (see Sequential dispatch). Each affected re-check covers that reviewer's whole angle against the current artifact, not just the fixed lines.
5. Repeat up to the iteration cap
6. Cap reached or stop-verdict → escalate to the human
```

Shared gate rules (every review gate, verbatim intent):
- All declared reviews are required. Do NOT skip based on feature type, perceived quality, or time pressure. If a reviewer's angle doesn't apply, the reviewer will say so — that is different from never asking. (Steps quote this rule verbatim inside their HARD-GATE for prompt salience — edit here first, then propagate.)
- Read `skills/dev/references/agent-runtime.md` before dispatching — it owns the persona registry and the inline fallback when delegation is unavailable.
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

### Sequential dispatch (re-dispatch waves, `Independence: none` reviewers only)

When the artifact changes between iterations (fix → re-check):
- Re-engage the original reviewer with the fix context (what changed and why) — `SendMessage` if possible
- `fresh-eyes` reviewers are never re-engaged this way; they always get a fresh dispatch so prior context can't leak

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

**Same agent fixes.** The agent that wrote the artifact fixes it (preserves context). One wave of fixes at a time. Everything else about the loop — caps, advisory handling, whole-artifact re-checks — is defined once in The primitive above.

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
| Iteration cap reached (see The primitive) | Report what was fixed, what remains, why it's not converging; ask for guidance |
| Reviewer and author disagree | Present both arguments, let human decide |
| Issue requires design decision | Don't guess — ask |
| Fix makes artifact worse | Stop, report the regression |

---

## Gate Inventory

Reference for where each gate is defined and what reviewer prompts it uses:

| Gate | Called by | Reviewers | Prompt locations |
|------|----------|-----------|-----------------|
| Proposal review | groom step 07 | Tier-required questions answered inline or by workers | `skills/groom/references/review-questions.md` |
| RFC review | rfc step 03 | 3 mandatory lenses (architecture-risk, test-strategy, maintainability) + justified cross-cutting lenses | `skills/rfc/references/review-contract.md`, `skills/rfc/references/cross-cutting-reviewers.md` |
| Code review | review | 6 logical lenses adaptively assigned to available reviewers | `skills/review/references/reviewer-briefs.md` |
| Post-pass delta review | review (delta supplement) | 1 scoped reviewer over the bounded delta diff | `skills/review/references/delta-supplement.md` |
| Per-unit spec/quality review (optional, non-authoritative) | subagent-dev | 1 each when useful; never replaces `pm:review` | `skills/dev/references/subagent-spec-reviewer.md`, `skills/dev/references/code-quality-reviewer.md` |

Legacy: `skills/groom/references/team-reviewers.md` (scope/team/bar-raiser briefs) and `skills/dev/references/plan-reviewer.md` predate the question- and lens-based gates above and are not routed by any current step.
