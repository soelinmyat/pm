# Groom Review Questions

Review proposal decisions through independent questions. A runtime may answer them inline or distribute them to available workers. Never encode correctness as a fixed worker count or persona list.

## Core questions (`standard`, `full`, `agent`)

1. **Problem and evidence:** Does the evidence support the stated problem, audience, urgency, and confidence? Identify contradictions or unsupported causal claims.
2. **Scope coherence:** Is this the smallest coherent outcome? Are non-goals, dependencies, and boundary cases explicit?
3. **Execution usefulness:** Are requirements and acceptance criteria observable, testable, and free of accidental implementation design?
4. **Experience completeness:** Do design requirements cover primary, failure, empty, loading, accessibility, responsive, and content states where applicable?
5. **Feasibility boundary:** Is feasibility credible from current code/product facts without pre-deciding RFC architecture?

## Additional questions (`full`, `agent`)

6. **Alternatives and reversal:** Is the recommended direction better than credible alternatives, and what evidence could reverse it?
7. **Competitive/strategy fit:** Does the scope support current strategy and accurately characterize parity, table stakes, gap-fill, or differentiation?
8. **Measurement:** Can success metrics distinguish feature failure from upstream/downstream causes?
9. **Adversarial assumption:** What plausible counterexample, misuse, permission boundary, or operational constraint would make the proposal wrong?

## Agent evidence question

10. **Citation integrity:** Are sampled citations real, current, correctly attributed, and sufficient for the decisions they support?

## Result contract

Each answer contains:

```json
{
  "question_id": "scope-coherence",
  "verdict": "pass | advisory | blocking | disputed",
  "summary": "Concise answer",
  "evidence": [{ "path": "pm/evidence/...", "locator": "F3" }],
  "confidence": "high | medium | low",
  "finding": null
}
```

A review passes only when every routed question has a current answer for the frozen proposal revision/hash, no `blocking` answer remains, and disputes are explicitly resolved. Advisory findings stay visible in the proposal and handoff.
