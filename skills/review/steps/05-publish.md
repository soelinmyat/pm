---
name: Publish review report
order: 5
description: Render and validate the canonical Review artifact, then record the current gate row
requires:
  - ../references/evidence-contract.md
---

## Goal

Publish machine-readable and human-readable Review evidence for current HEAD and update only the Review gate row.

## How

1. Render the deterministic HTML projection with `node "$PM_PLUGIN_ROOT/scripts/review-report.js" --root "$PWD" --report ".pm/dev-sessions/{slug}/review/report.json" --out ".pm/dev-sessions/{slug}/review/report.html"`. The renderer uses the shared template, replaces the plugin version, and binds metadata to the report, target, every result, and decisions.
2. Put outcome, round, logical coverage, blocker count, top issue, and next action in the first screenful. Render every finding with its ID, issue, impact, fix, owner, evidence refs, signals, decision/dispute state, and verification.
3. Run the artifact checker and renderer. Inspect desktop, tablet, narrow full-page captures and print PDF. Fix artifact defects before recording a pass.
4. Run the final checker without `--write-report`, supplying the exact target, every result, decisions if any, report, and human report. The real-browser marker probe must pass.
5. For `passed`, update only the `review` row in `.pm/dev-sessions/{slug}.gates.json`: current commit, artifact `review/report.html`, `evidence_kind: review-report-v1`, empty reason, checked timestamp, and applicable logical `lenses`. Preserve all other rows. For `failed` or `blocked`, record that status and concrete reason, then stop delivery.
6. Run `dev-gate-check.js --require review` for a pass. Report artifact paths, logical coverage, blockers, disputes, handoffs, fix rounds, verification, and one next action.

## Done-when

- `report.json` and `report.html` are saved and bind the complete current evidence chain.
- Structural, Chromium, accessibility, offline, print, and review checkers pass for a passing outcome.
- The gate sidecar points to current evidence and preserves other gates.

Review complete. Return the checked outcome and the single next action.
