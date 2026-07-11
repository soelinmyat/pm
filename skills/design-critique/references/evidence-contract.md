# Design Critique Evidence Contract

This contract defines the durable chain checked by `scripts/design-critique-check.js`. Store all files below `.pm/dev-sessions/{slug}/design-critique/`. Paths are project-relative regular files; absolute paths, symlinks, path escapes, and `/tmp`-only evidence cannot pass.

## Route

`route.json` freezes the review before capture:

```json
{
  "schema_version": 1,
  "run_id": "dc_01...",
  "created_at": "2026-07-12T00:00:00Z",
  "mode": "product-ui",
  "source": {
    "commit": "<40-or-64-hex>",
    "base_ref": "origin/main",
    "diff_sha256": "<64-hex>"
  },
  "subjects": [
    {
      "id": "account-detail",
      "title": "Account detail",
      "surface": "/accounts/:id",
      "platform": "web"
    }
  ],
  "coverage": [
    {
      "id": "account-primary-desktop",
      "subject_id": "account-detail",
      "state": "primary",
      "viewport": "desktop",
      "required": true,
      "reason": "Primary changed route"
    },
    {
      "id": "account-empty-desktop",
      "subject_id": "account-detail",
      "state": "empty",
      "viewport": "desktop",
      "required": false,
      "reason": "This detail route cannot contain an empty collection"
    }
  ]
}
```

Modes are `product-ui` and `pm-artifact`. Platforms are `web`, `mobile`, and `document`; document belongs only to artifact mode. States are `primary`, `empty`, `error`, `boundary`, `responsive`, and `print`. Viewports are `desktop`, `tablet`, `narrow`, `device`, and `print`.

Product UI decides primary, empty, error, and boundary applicability for every subject. Web primary desktop is always required. Add tablet/narrow rows when a surface reflows. PM artifacts require desktop, tablet, narrow, and print.

Mobile product UI requires a primary `device` row. Every PM artifact subject also includes `artifact: {path, sha256, kind}` for the exact proposal, RFC, or report HTML.

## Captures

`captures.json` binds the route and every evidence byte:

```json
{
  "schema_version": 1,
  "run_id": "dc_01...",
  "mode": "product-ui",
  "commit": "<current-commit>",
  "route": { "path": ".pm/.../route.json", "sha256": "<64-hex>" },
  "captures": [
    {
      "id": "capture-account-primary-desktop-r1",
      "coverage_id": "account-primary-desktop",
      "kind": "screenshot",
      "path": ".pm/.../round-1/account-primary-desktop.png",
      "sha256": "<64-hex>",
      "width": 1440,
      "height": 1000,
      "full_page": false,
      "round": 1,
      "active": true,
      "captured_at": "2026-07-12T00:01:00Z"
    }
  ],
  "evidence": [
    {
      "id": "evidence-account-a11y-r1",
      "subject_id": "account-detail",
      "kind": "accessibility-tree",
      "path": ".pm/.../round-1/account-a11y.json",
      "sha256": "<64-hex>"
    }
  ],
  "checked_at": "2026-07-12T00:02:00Z"
}
```

Capture kinds are `screenshot` (valid PNG bytes with decoded dimensions equal to `width`/`height`) and `pdf` (valid non-empty PDF with decoded `pages`). Evidence kinds are `accessibility-tree`, `dom-audit`, `artifact-structural`, and `artifact-render`. Every subject requires accessibility evidence. Web UI also requires a DOM audit. Artifact mode requires structural and render manifests.

Each capture records `round` (1 or 2) and `active`. Keep before and after entries when a blocking finding is fixed: the historical capture becomes inactive and exactly one latest-round capture stays active for each required coverage ID. Resolved P0/P1 proof uses the same subject and coverage ID, cites both IDs in the finding, and orders an inactive earlier `before` before the active later `after`. IDs include the round; coverage IDs stay stable.

Accessibility and DOM evidence are JSON objects bound to the route commit, subject, and cited capture IDs. Accessibility checks require passing `landmarks`, `names`, and `focus_order`; DOM audits require passing `overflow`, `edge_alignment`, and `hierarchy`. Both retain a `findings` array, including when empty.

## Report

`report.json` is the machine outcome:

```json
{
  "schema_version": 1,
  "run_id": "dc_01...",
  "mode": "product-ui",
  "commit": "<current-commit>",
  "route": { "path": ".pm/.../route.json", "sha256": "<64-hex>" },
  "captures": { "path": ".pm/.../captures.json", "sha256": "<64-hex>" },
  "outcome": "passed",
  "rounds": 1,
  "coverage": { "required": 4, "captured": 4, "percent": 100 },
  "scores": {
    "hierarchy": { "value": 4, "rationale": "The primary action and title establish a clear first scan.", "evidence_ids": ["capture-account-primary-desktop-r1"] },
    "density": { "value": 4, "rationale": "Information groups remain readable without excessive whitespace.", "evidence_ids": ["capture-account-primary-desktop-r1"] },
    "consistency": { "value": 4, "rationale": "Repeated regions use the same component treatment.", "evidence_ids": ["evidence-account-dom-r1"] },
    "accessibility": { "value": 4, "rationale": "Named landmarks and focus order pass the audit.", "evidence_ids": ["evidence-account-a11y-r1"] },
    "responsive": { "value": 4, "rationale": "Applicable viewports preserve hierarchy without overflow.", "evidence_ids": ["capture-account-primary-desktop-r1"] },
    "state-clarity": { "value": 4, "rationale": "Applicable states communicate status and recovery clearly.", "evidence_ids": ["capture-account-primary-desktop-r1"] }
  },
  "findings": [],
  "next_action": "Proceed to QA.",
  "human_report": { "path": ".pm/.../report.html" },
  "checked_at": "2026-07-12T00:03:00Z"
}
```

Artifact mode replaces `state-clarity` with `print-navigation`. Every score has an integer `value`, a concrete `rationale`, and one or more valid `evidence_ids`:

| Score | Anchor |
|---|---|
| 1 | Fails the intended job or has severe evidence-backed defects |
| 2 | Materially weak; several important problems remain |
| 3 | Usable baseline with notable improvement opportunities |
| 4 | Strong, clear, and polished with only minor issues |
| 5 | Exceptional and internally consistent; no meaningful defect found |

### Findings

Each finding contains:

```json
{
  "id": "dc-<16-hex>",
  "subject_id": "account-detail",
  "region": "header-actions",
  "rule": "primary-action-hierarchy",
  "evidence_ids": ["capture-account-primary-desktop-r1"],
  "priority": "P1",
  "status": "resolved",
  "owner": "design-critique",
  "summary": "The primary action is visually subordinate to metadata.",
  "remediation": "Move the action into the title row and use the primary button treatment.",
  "before_capture_id": "capture-account-primary-desktop-r1",
  "after_capture_id": "capture-account-primary-desktop-r2"
}
```

The deterministic identity is `dc-` plus the first 16 lowercase hex characters of SHA-256 over compact JSON containing `[subject_id, region, rule, sorted(evidence_ids)]`. Priorities are P0–P3. Statuses are `open`, `resolved`, `deferred`, and `dismissed`. Owners are `design-critique`, `qa`, and `review`.

Resolved P0/P1 needs distinct before/after capture hashes. Deferred findings need `defer_reason` and `defer_owner`. A report with open/deferred P0/P1 cannot pass.

## Human report

Render `report.html` from `references/templates/design-critique-report.html`. The inert PM artifact metadata uses kind `report`, lifecycle `reviewed`, `source.path` equal to `report.json`, `source.sha256` equal to `sha256:<report-json-hash>`, and an evidence row binding `captures.json` the same way. Replace all example zero hashes before validation.

The first screenful shows outcome, subject mode, coverage, largest remaining issue, and next action. Mark the visible outcome with `data-dc-outcome="{outcome}"`, coverage with `data-dc-coverage="{percent}"`, and the next action with `data-dc-next-action-sha256="{raw-sha256-of-next-action}"`; their visible text must agree. Every score card carries `data-dc-score-key` and `data-dc-score-value` and visibly includes its rationale. Every rendered finding carries `data-dc-finding-id`, `data-dc-finding-priority`, `data-dc-finding-status`, and `data-dc-finding-sha256`, where the digest binds the normalized finding projection defined by the checker. Its visible content includes summary, remediation, owner, and evidence IDs. Markers in comments, scripts, templates, hidden elements, or empty elements are ignored. Include before/after proof, ownership handoffs, method, and print-friendly navigation.

## Outcome mapping

| Report | Dev gate |
|---|---|
| `passed` | `passed` |
| `failed` | `failed` |
| `blocked` | `blocked` |
| `deferred` | `blocked` with human decision in the reason |

Only `passed` invokes `dev-gate-check.js --require design-critique`. Every other outcome stops Dev before QA.
