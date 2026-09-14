---
name: Synthesize evidence
order: 3
description: Validate all results, merge exact identities, retain signals, and expose disagreements
requires:
  - ../references/evidence-contract.md
---

## Goal

Generate a mutable draft review report from current evidence without losing reviewer signals or hiding disagreements.

## How

1. Run `review-check.js --stage draft --write-report` with the target and every result path to write `round-{N}/draft-report.json`, initially omitting `--human-report`. Include `--decisions` only when an existing decision artifact belongs to this target and round. If eligible, retain `human_report: null`, skip draft HTML rendering, and recheck the draft with `--stage draft --from-report --report .../draft-report.json`; no browser is required. If the checker reports `HTML presentation required`, rerun with `--human-report .../draft-report.html`, render that bound draft with `review-report.js --report .../draft-report.json --out .../draft-report.html`, and validate it with the same draft checker arguments without `--write-report`. Other checker failures remain evidence failures; never interpret them as a presentation fallback.
2. Treat checker failures as evidence failures. Re-dispatch malformed/missing workers; regenerate the target after Git drift; never patch hashes by hand.
3. Inspect canonical findings:
   - same deterministic ID becomes one finding with every reviewer signal retained;
   - maximum confidence and highest severity lead; confidence is never averaged;
   - severity spread, fix kind, disposition, or `decision_required` becomes a visible dispute;
   - every reviewer signal remains Review-owned; proposed Design Critique/QA handoffs are not authority.
4. Use the generated `auto_fix_eligible` list as a ceiling, not a command. Do not auto-fix anything absent from it.
5. If outcome is `passed`, continue to publishing. If `failed`, continue to the fix loop. If `blocked`, resolve only through the explicit decision/capability path.

## Done-when

- The checker recomputed Git identity and accepted exact logical coverage.
- `draft-report.json` preserves result bindings, signals, disputes, blockers, handoffs, and next action without finalizing the round.
- Outcome follows machine policy; no prose override changes it.

**Advance:** proceed to Step 4 (Resolve blockers).
