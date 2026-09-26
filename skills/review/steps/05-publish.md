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

1. After all same-round decisions are recorded, run the checker with `--stage final` (or omit `--stage`). For `failed` or `blocked`, finalize `round-{N}/report.json` and `round-{N}/report.html` exactly once, preserve them for the next target binding, and stop delivery. For `passed`, write canonical `.pm/dev-sessions/{slug}/review/report.json`, using `review-check.js --write-report` without `--human-report` first. This automatically selects structured publication when eligible. If it reports `HTML presentation required`, supply the canonical `--human-report` path and render it with `review-report.js`. The canonical report keeps target/results bindings in `round-{N}/`.
2. For eligible structured publication, retain `human_report: null` and skip the HTML instructions in this item and item 3; continue at item 4. Eligibility requires a passing first round with no findings, decisions, disputes or prior report, at most five known source files, no presentation or security-sensitive paths (including rename sources), and known low/medium canonical risk when Dev-bound. Unknown or high risk fails closed to HTML. Structured publication retains all target, source, result, lens and canonical merge checks. Present a concise readable outcome in the conversation. For HTML, put outcome, round, logical coverage, blocker count, top issue, and next action in the first screenful. Render every finding with its ID, issue, impact, fix, owner, evidence refs, signals, decision/dispute state, and verification.
3. Run the artifact checker and renderer with `artifact-render-check.js --marker-prefix data-review- --presentation auto`. Persist the result at `.pm/dev-sessions/{slug}/review/renders/manifest.json`. The runner selects compact evidence only for bounded passing reports with at most two low/medium findings, no decisions/disputes, no design/security risk, and no presentation-source changes. Unknown/legacy, custom HTML, long or markup-like content, renderer/template changes, and complex reports use full evidence. Never hand-select compact to override ineligibility.
   - Compact schema 2 retains current browser DOM content-fit metrics at desktop/tablet/narrow sizes, one desktop PNG, current browser-computed marker visibility, browser/source drift checks, and exact report/target/renderer/template hashes. HTML must byte-match the current canonical generator and pass structural, accessibility, offline, and escaping checks. Print is explicitly `null`; omitted responsive/full-page screenshots are an intentional checked policy, not a waiver.
   - Full schema 1 retains desktop/tablet/narrow viewport and full-page PNGs, current DOM metrics, markers, browser identity/drift evidence, and print PDF.
   Inspect the retained capture(s), fix content defects, and regenerate current evidence before recording a pass. Full evidence remains available with `--presentation full`. Never reuse a compact receipt after its bound content or renderer/template changes.
4. Run the final checker without `--write-report`, supplying the exact target, every result, decisions if any, report, and human report. For HTML, the locally observed browser marker probe must pass; structured reports are rechecked with `--from-report --report <canonical report.json>` and require no browser.
5. Inside Dev, Dev step 08 records a passed result's review phase evidence and then writes the passed `review` and `verification` rows; return the checked outcome to it and do not write a passed row here. Failed and blocked rows are still written here as described below. For a `passed` report with a target-bound canonical Dev session outside Dev, record the review phase evidence with `node "$PM_PLUGIN_ROOT/scripts/dev-session.js" record`, then run `node "$PM_PLUGIN_ROOT/scripts/dev-session.js" gate --session <absolute session.json> --name review`. Never hand-edit the gate manifest `.pm/dev-sessions/{slug}/gates.json`. The command writes only the `review` row and derives it from the canonical report: structured evidence binds `review/report.json` with `evidence_kind: review-report-v1` and raw `report_sha256`; HTML evidence binds artifact `.pm/dev-sessions/{slug}/review/report.html` with `render_manifest: .pm/dev-sessions/{slug}/review/renders/manifest.json` and its raw `render_manifest_sha256`; `lenses` equal the report's completed coverage. Preserve all other rows; the command never touches them. It revalidates the complete evidence chain and writes nothing on failure. For `failed` or `blocked`, run it with `--status failed|blocked --reason "<concrete reason>"`, then stop delivery. For a genuinely advisory standalone Review with no target-bound Dev session, publish the checked report but do not create or update `gates.json`; state explicitly that it is non-authoritative for delivery. Ship must bootstrap and bind a session instead of taking this path.
6. Run `dev-gate-check.js --require review` for a session-bound pass. For an advisory standalone pass, re-run `review-check.js --from-report` instead. Report artifact paths, logical coverage, blockers, disputes, handoffs, fix rounds, verification, authority, and one next action.

## Done-when

- `report.json` and, when required, `report.html` are saved and bind the complete current evidence chain.
- Source review checks always pass. For HTML, structural, Chromium, accessibility, offline, and review checkers pass; the derived presentation policy passes, including responsive/full-page and print checks whenever full evidence is required for a passing outcome; the gate row hash-binds the retained render manifest.
- A session-bound gate sidecar points to current evidence and preserves other gates; an advisory standalone Review does not claim delivery authority.

Review complete. Return the checked outcome and the single next action.
