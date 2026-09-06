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

1. After all same-round decisions are recorded, run the checker with `--stage final` (or omit `--stage`). For `failed` or `blocked`, finalize `round-{N}/report.json` and `round-{N}/report.html` exactly once, preserve them for the next target binding, and stop delivery. For `passed`, write canonical `.pm/dev-sessions/{slug}/review/report.json`, then render `.pm/dev-sessions/{slug}/review/report.html` with `review-report.js`. The canonical report keeps target/results bindings in `round-{N}/`.
2. Put outcome, round, logical coverage, blocker count, top issue, and next action in the first screenful. Render every finding with its ID, issue, impact, fix, owner, evidence refs, signals, decision/dispute state, and verification.
3. Run the artifact checker and renderer with `artifact-render-check.js --marker-prefix data-review- --presentation auto`. Persist the result at `.pm/dev-sessions/{slug}/review/renders/manifest.json`. The runner selects compact evidence only for bounded passing reports with at most two low/medium findings, no decisions/disputes, no design/security risk, and no presentation-source changes. Unknown/legacy, custom HTML, long or markup-like content, renderer/template changes, and complex reports use full evidence. Never hand-select compact to override ineligibility.
   - Compact schema 2 retains current browser DOM content-fit metrics at desktop/tablet/narrow sizes, one desktop PNG, current browser-computed marker visibility, browser/source drift checks, and exact report/target/renderer/template hashes. HTML must byte-match the current canonical generator and pass structural, accessibility, offline, and escaping checks. Print is explicitly `null`; omitted responsive/full-page screenshots are an intentional checked policy, not a waiver.
   - Full schema 1 retains desktop/tablet/narrow viewport and full-page PNGs, current DOM metrics, markers, browser identity/drift evidence, and print PDF.
   Inspect the retained capture(s), fix content defects, and regenerate current evidence before recording a pass. Full evidence remains available with `--presentation full`. Never reuse a compact receipt after its bound content or renderer/template changes.
4. Run the final checker without `--write-report`, supplying the exact target, every result, decisions if any, report, and human report. The locally observed browser marker probe must pass.
5. For `passed` with a target-bound canonical Dev session, update only the `review` row in the canonical `.pm/dev-sessions/{slug}/gates.json`: current commit, project-relative artifact `.pm/dev-sessions/{slug}/review/report.html`, `evidence_kind: review-report-v1`, project-relative `render_manifest: .pm/dev-sessions/{slug}/review/renders/manifest.json`, its raw `render_manifest_sha256`, empty reason, checked timestamp, and applicable logical `lenses`. Preserve all other rows. Never create or update the legacy flat gate sidecar when the canonical session directory exists. For `failed` or `blocked`, record that status and concrete reason, then stop delivery. For a genuinely advisory standalone Review with no target-bound Dev session, publish the checked report but do not create or update `gates.json`; state explicitly that it is non-authoritative for delivery. Ship must bootstrap and bind a session instead of taking this path.
6. Run `dev-gate-check.js --require review` for a session-bound pass. For an advisory standalone pass, re-run `review-check.js --from-report` instead. Report artifact paths, logical coverage, blockers, disputes, handoffs, fix rounds, verification, authority, and one next action.

## Done-when

- `report.json` and `report.html` are saved and bind the complete current evidence chain.
- Structural, Chromium, accessibility, offline, and review checkers pass; the derived presentation policy passes, including responsive/full-page and print checks whenever full evidence is required for a passing outcome; the gate row hash-binds the retained render manifest.
- A session-bound gate sidecar points to current evidence and preserves other gates; an advisory standalone Review does not claim delivery authority.

Review complete. Return the checked outcome and the single next action.
