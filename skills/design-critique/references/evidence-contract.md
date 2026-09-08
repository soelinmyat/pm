# Design Critique Evidence Contract

This contract defines the durable chain checked by `scripts/design-critique-check.js`. Store all files below `.pm/dev-sessions/{slug}/design-critique/`. Evidence paths are project-relative and must resolve to regular files. Absolute paths, path escapes, arbitrary symlinks, and `/tmp`-only evidence cannot pass. The capture helper is the sole exception at a directory boundary: it may publish one canonical capture directory as a tightly branded, same-parent relative pointer to an immutable managed bundle. The checker authenticates that pointer, its complete inventory, and every member before accepting a file through it.

## Route

`route.json` freezes the review before capture:

```json
{
  "schema_version": 2,
  "run_id": "dc_01...",
  "created_at": "2026-07-12T00:00:00Z",
  "mode": "product-ui",
  "source": {
    "commit": "<40-or-64-hex>",
    "base_ref": "origin/main",
    "base_commit": "<authoritative-origin-head-object-id>",
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
      "id": "account-primary-narrow",
      "subject_id": "account-detail",
      "state": "primary",
      "viewport": "narrow",
      "required": true,
      "reason": "Primary changed route at narrow width"
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

Modes are `product-ui` and `pm-artifact`. Platforms are `web`, `mobile`, and `document`; document belongs only to artifact mode. States are `primary`, `empty`, `error`, `boundary`, `loading`, `success`, `focus`, `disabled`, `keyboard`, `modal`, `responsive`, and `print`. Viewports are `desktop`, `tablet`, `narrow`, `device`, and `print`.

Product UI decides primary, empty, error, boundary, loading, success, focus, disabled, keyboard, and modal applicability for every subject. A non-applicable state carries a concrete product reason. In route schema v2, every web product UI subject requires both a `primary` desktop row and a separate `primary` narrow row; a responsive or other narrow state cannot substitute. Add tablet when it exercises a distinct breakpoint. PM artifacts require desktop, tablet, narrow, and print.

Mobile product UI requires a primary `device` row. Every PM artifact subject also includes `artifact: {path, sha256, kind}` for the exact proposal, RFC, or report HTML.

New routes always use schema version 2. Never create a new route with schema version 1 and never downgrade a v2 route. The checker can parse schema v1 only in explicit, non-authoritative inspection mode so an existing run can be read and migrated; inspection never returns a certifying pass and cannot create, update, or recertify a gate row. To certify current work, freeze and execute a new schema-v2 route. During migration, v1 is interpreted with its original primary, empty, error, and boundary decisions plus primary desktop for web; it does not gain v2's blanket narrow requirement or trusted-capture requirements. `captures.json` retains schema version 1. A certifying `report.json` uses schema version 2 and binds `reviews.json`; report schema version 1 is inspection-only.

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
      "pixel_sha256": "<canonical-decoded-RGBA-64-hex>",
      "round": 1,
      "active": true,
      "captured_at": "2026-07-12T00:01:00Z",
      "observation": {
        "path": ".pm/.../round-1/capture-account-primary-desktop-r1/capture.json",
        "sha256": "<64-hex>"
      }
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

Capture kinds are `screenshot` (valid PNG bytes with decoded dimensions equal to `width`/`height`) and `pdf` (valid non-empty PDF with decoded `pages`). Schema-v2 product UI is screenshot-only. Web dimensions must be plausible for the routed label: desktop is 1024–8192 pixels wide and at least 600 high, tablet is 601–1023 pixels wide and at least 600 high, and narrow is 320–600 pixels wide and at least 480 high. Every web viewport is at most 8192 pixels high and 16,777,216 total pixels. Mobile device captures are at least 240×400. The checker decodes the pixels, requires at least 1% opacity-weighted effective visible coverage and non-uniform visible content, and recomputes `pixel_sha256` from canonical decoded RGBA pixels. Declared dimensions and file-byte hashes cannot substitute for this decoded identity. PM artifact capture sizing remains bound to the exact canonical renderer viewports rather than these product-UI bands. Evidence kinds are `accessibility-tree`, `dom-audit`, `artifact-structural`, and `artifact-render`. Every subject requires accessibility evidence. Web UI also requires a DOM audit. Artifact mode requires structural and render manifests.

Every schema-v2 web product-UI screenshot includes `observation: {path, sha256}` for the schema-v2 `capture.json` emitted by `scripts/design-critique-capture.js`. The closed manifest binds the exact route and capture row; the subject surface; coverage state and viewport; redacted requested, expected, and final URL identities; an exact schema-v2 declarative state assertion; native visibility/hit-test observations; CSS viewport; raw accessibility, DOM, and network files; browser executable identity before/after; clean tracked source identity before/after; plugin version; invocation configuration; ordered timestamps; screenshot byte SHA-256; canonical decoded-pixel SHA-256; and deterministic visual metrics. The requested, expected, and final identities share one origin. They retain only origin, pathname, query/fragment-presence booleans, and the full-URL SHA-256—never query or fragment values. The checker rereads every binding, recomputes the invocation, native-observation, decoded-pixel, and visual-metric identities, revalidates the current browser executable plus the current clean tracked Git HEAD/tree/status, and requires the registered normalized audits to use the raw files named by this manifest.

The state assertion's `subject_id`, `coverage_id`, and `state` exactly match the routed row. Its mandatory `state_marker` is an `id` or `test-id` whose `data-pm-state` equals that state, and every assertion carries at least one declarative guard. Error, loading, focus, keyboard, disabled, and modal states require an additional state-specific semantic guard. The marker and every explicit `visible` guard must pass ancestor visibility, effective opacity, clipping, visual-viewport intersection, and native Chromium hit-testing. Hit-testing samples five points and accepts ordinary target descendants, but rejects sibling overlay coverage and a single positioned descendant branch that covers at least 90% of the marker and wins every point. It is not a complete proof against irregular or partial occlusion between sample points.

The helper keeps network interception active through the screenshot/observation window, closes it with a final settle and browser barrier, drains pending handlers, and fails on a late request, policy violation, overflow, or handler error. Accessibility, control, DOM-issue, and network collections fail rather than truncate. It also rejects transparent, uniform, and near-blank decoded images: opacity-weighted pixels are premultiplied before color, luminance, and spatial analysis; at least 1% of the effective visible coverage must differ from the dominant color bucket, and qualifying content must occupy multiple tiles with at least 1% non-dominant effective coverage in each. Distinct active states at one subject/viewport and resolved product P0/P1 before/after pairs require both material average decoded-pixel-grid distance and material changed-tile coverage in addition to different hashes.

The manifest's assurance level is `workflow-attested-non-cryptographic`. These local hashes are workflow attestations, not signatures: a caller able to author every local file can fabricate a self-consistent bundle, while the checker rejects inconsistent or independently mixed evidence. The manifest proves capture-time consistency, not that a generic development server served the routed Git commit or build. Use the project's documented server command and a clean build; when stronger provenance is required, expose an app/build identifier and verify it with an additional declarative guard. Build/server identity remains the explicit provenance limitation. The helper rejects iframe documents and starts a clean browser profile, so authenticated review must use a privacy-safe seeded or single-use application route without credentials in the URL.

Each capture records `round` (1 or 2) and `active`. Every active required coverage row must resolve to its own canonical file path, file-byte hash, and decoded-pixel hash; copying, re-encoding, relabeling one image, or changing only a beacon pixel cannot impersonate a second state or viewport. Keep before and after entries when a blocking finding is fixed: the historical capture becomes inactive and exactly one latest-round capture stays active for each required coverage ID. Resolved product-UI P0/P1 proof uses the same subject and coverage ID, cites both IDs in the finding, and orders an inactive earlier `before` before the active later `after`; before and after must have distinct decoded-pixel hashes and material decoded-pixel-grid distance. IDs include the round; coverage IDs stay stable.

For route schema v2, accessibility and DOM audit evidence use schema v2 and are generated only by `scripts/design-critique-audit-normalize.js`. Each normalized object contains exactly `schema_version`, `subject_id`, `commit`, `capture_ids`, `raw: {path, sha256}`, `checks`, and `findings`. Product-UI audits cite exactly one active capture: every active capture needs one accessibility audit, and every active web capture also needs one DOM audit. The raw DOM `inner_width` must equal the decoded cited screenshot width, binding responsive measurements to the rendered evidence instead of allowing one desktop probe to cover other viewports or states. The checker bounded-reads the raw path, verifies its SHA-256, reruns normalization, and requires the complete normalized object to match. Hand-authored booleans or findings cannot pass.

The raw probe is schema v1 with exactly `schema_version`, `kind`, `subject_id`, `commit`, `capture_ids`, and `observations`. For `accessibility-tree`, observations contain bounded `landmarks` (`role`, `name`, `locator`) and `controls` (`role`, `name`, `locator`, `disabled`, `tab_index`, optional `focus_context`, `document_index`). New trusted captures emit `focus_context` as `document` for global tab stops or standalone controls. A custom tab, radio, menu item, or listbox option is `composite` only when Chromium first reaches its owner or a member through document Tab navigation and then observes that specific member receive focus through the owner's applicable arrow-key navigation; a static `tabindex="-1"` relationship is not enough. Native `select` options remain `composite` through the browser's built-in select behavior. The bounded keyboard probe runs only after the screenshot and repeated accessibility/DOM samples are frozen, then the helper rechecks network settlement and URL identity before discarding the page, so interaction mutations cannot leak into the retained visual or DOM evidence. The normalizer checks accessible names for every control but derives global `focus_order` findings only from `document` controls; legacy raw rows without `focus_context` default to `document`. For `dom-audit`, observations contain numeric `viewport` (`inner_width`, `client_width`, `scroll_width`) plus bounded `hierarchy`, `edge_alignment`, `consistency`, and `asymmetry` issue arrays; every issue has only `code`, `locator`, and `detail`. The helper derives passing booleans for `overflow`, `edge_alignment`, `hierarchy`, `consistency`, and `asymmetry`; any measured issue makes its corresponding check fail. See the capture guide for the exact browser probes and CLI invocation.

Audit schema v1 without a raw binding is readable only as part of non-authoritative route-v1 inspection. It cannot certify current work. Never author a new schema-v1 audit or downgrade route/audit evidence to bypass normalization.

Optional assertion `before_capture` actions are part of the existing assertion
byte hash and invocation binding. Only bounded native Tab/Shift+Tab and exact
`id`/`test-id` scrolling are supported (1–20 actions, 100 Tab presses total).
Preparation is followed by fresh network settlement before the frozen samples.
It cannot write markers, execute caller code, click, or submit. A scroll action
does not establish keyboard reach; focused and visible guards remain required
for focus/keyboard states. CSS viewport offsets may be nonzero but must be
nonnegative integers within the document bounds. Native hit-tests use document
coordinates while retained hit-test points remain viewport-relative.

## Bound reviewer inputs

Before either reviewer starts, write one shared context source. Both perspectives bind the same bytes; free-text copies of the brief or principles are not allowed in a review input.

```json
{
  "schema_version": 1,
  "run_id": "dc_01...",
  "commit": "<current-commit>",
  "route": { "path": ".pm/.../route.json", "sha256": "<64-hex>" },
  "brief": {
    "page_description": "Account detail",
    "persona": "Account administrator",
    "job_to_be_done": "Understand status and take the next action."
  },
  "design_principles": ["Use the established product hierarchy."],
  "created_at": "2026-07-12T00:02:10Z"
}
```

Each round capture manifest also freezes the exact reviewed capture set:

```json
{
  "schema_version": 1,
  "run_id": "dc_01...",
  "round": 1,
  "commit": "<current-commit>",
  "route": { "path": ".pm/.../route.json", "sha256": "<64-hex>" },
  "capture_ids": ["capture-account-primary-desktop-r1"],
  "created_at": "2026-07-12T00:02:20Z"
}
```

The context source and capture manifest must exist before `execution.started_at`. Every named capture must already exist when its round manifest is created, have `capture.round <= manifest.round`, and have `captured_at <= manifest.created_at`. Round 1 covers every required route row. The final round covers every active required capture. For round 2, both the round manifest and every reviewer execution start after both round-1 receipts were recorded. Round 2 must contain at least one new round-2 capture, and each new capture must postdate both round-1 receipts. A numbered round cannot be used to rewrite the chronology of an earlier review.

## Reviews

`reviews.json` records exactly one Primary and one Fresh Eyes review per report round:

```json
{
  "schema_version": 1,
  "run_id": "dc_01...",
  "mode": "product-ui",
  "commit": "<current-commit>",
  "route": { "path": ".pm/.../route.json", "sha256": "<64-hex>" },
  "captures": { "path": ".pm/.../captures.json", "sha256": "<64-hex>" },
  "assurance": "workflow-attested-non-cryptographic",
  "rounds": [
    {
      "round": 1,
      "reviews": [
        {
          "review_id": "dc_01-r1-primary",
          "perspective": "primary",
          "input": {
            "prompt_profile": "primary-v1",
            "prompt_sha256": "<exact-shipped-instruction-bytes-sha256>",
            "context_source": { "path": ".pm/.../review-context.json", "sha256": "<64-hex>" },
            "capture_manifest": { "path": ".pm/.../review-round-1-captures.json", "sha256": "<64-hex>" },
            "acceptance_criteria": ["Primary action remains visible."],
            "capture_ids": ["capture-account-primary-desktop-r1"],
            "evidence_ids": ["evidence-account-a11y-r1"],
            "prior_finding_refs": [],
            "payload_sha256": "<canonical-input-without-this-field-sha256>"
          },
          "execution": {
            "mode": "same-runtime-isolated",
            "runtime": { "provider": "openai", "model": "gpt-5.6-sol", "reasoning": "high" },
            "context_id": "ctx-primary-r1",
            "invocation_id": "invoke-primary-r1",
            "assurance": "workflow-attested-non-cryptographic",
            "receipt": { "path": ".pm/.../receipts/dc_01-r1-primary.json", "sha256": "<64-hex>" },
            "started_at": "2026-07-12T00:02:30Z",
            "completed_at": "2026-07-12T00:02:50Z"
          },
          "result": { "summary": "...", "scores": {}, "findings": [] }
        },
        {
          "review_id": "dc_01-r1-fresh",
          "perspective": "fresh-eyes",
          "input": {
            "prompt_profile": "fresh-eyes-v1",
            "prompt_sha256": "<exact-shipped-instruction-bytes-sha256>",
            "context_source": { "path": ".pm/.../review-context.json", "sha256": "<64-hex>" },
            "capture_manifest": { "path": ".pm/.../review-round-1-captures.json", "sha256": "<64-hex>" },
            "capture_ids": ["capture-account-primary-desktop-r1"],
            "payload_sha256": "<canonical-input-without-this-field-sha256>"
          },
          "execution": {
            "mode": "delegated",
            "runtime": { "provider": "openai", "model": "gpt-5.6-sol", "reasoning": "high" },
            "context_id": "ctx-fresh-r1",
            "invocation_id": "invoke-fresh-r1",
            "assurance": "workflow-attested-non-cryptographic",
            "receipt": { "path": ".pm/.../receipts/dc_01-r1-fresh.json", "sha256": "<64-hex>" },
            "started_at": "2026-07-12T00:02:30Z",
            "completed_at": "2026-07-12T00:02:50Z"
          },
          "result": {
            "first_impression": "...",
            "answers": {
              "purpose": { "text": "...", "evidence_ids": ["capture-account-primary-desktop-r1"] },
              "visual_focus": { "text": "...", "evidence_ids": ["capture-account-primary-desktop-r1"] },
              "inconsistencies": { "text": "...", "evidence_ids": ["capture-account-primary-desktop-r1"] }
            },
            "observations": [
              {
                "capture_id": "capture-account-primary-desktop-r1",
                "coverage_id": "account-primary-desktop",
                "state": "primary",
                "viewport": "desktop",
                "observation": "The primary state at the desktop viewport places the Account heading above two summary cards, with the Save button below them."
              }
            ],
            "findings": []
          }
        }
      ]
    }
  ],
  "checked_at": "2026-07-12T00:03:00Z"
}
```

The Primary input additionally allows only `acceptance_criteria`, normalized `evidence_ids`, `prior_finding_refs`, and, when those refs are non-empty, `prior_findings_source`. Its evidence IDs exactly equal the normalized evidence bound to the captures in that round manifest; evidence from later or unreviewed captures is forbidden. A product-UI audit is eligible only when every capture it cites is in the round manifest. For a PM artifact, structural evidence remains document-wide, while accessibility and render evidence is eligible only when its complete cited capture or full-page/print file set is contained in or exactly matches the round manifest. Fresh Eyes uses the closed common allowlist shown above: it cannot receive acceptance criteria, audits, findings, round history, implementation rationale, or any other field. Its result must include one observation for every supplied capture, with the exact routed coverage ID, state, and viewport. Each observation contains at least 40 UTF-8 bytes, names a concrete interface element and a direct visual property or relationship, explicitly names its state and viewport, and remains substantively distinct after capture metadata is removed. The first impression and three answers must likewise contain concrete visual substance. Both reviewers receive the same context and round-capture bindings, while prompt, payload, context ID, invocation ID, and result identity remain distinct. A same-runtime review is valid only as a fresh isolated invocation; continuing the current conversation is not isolation.

For a verification round with prior refs, write a separate source before the Primary execution and bind it as `prior_findings_source: {path, sha256}`. Omit that input field when `prior_finding_refs` is empty. The source is closed and materializes the exact earlier normalized reviewer findings so the reviewer can compare content without adding unbound finding bodies to its input:

```json
{
  "schema_version": 1,
  "run_id": "dc_01...",
  "commit": "<current-commit>",
  "for_round": 2,
  "findings": [
    {
      "review_id": "dc_01-r1-primary",
      "finding": {
        "id": "drf-0123456789abcdef",
        "subject_id": "account-detail",
        "region": "header",
        "rule": "primary-action-hierarchy",
        "coverage_ids": ["account-primary-desktop"],
        "evidence_ids": ["capture-account-primary-desktop-r1"],
        "priority": "P1",
        "owner": "design-critique",
        "basis": "objective",
        "confidence": "high",
        "summary": "The primary action is visually subordinate.",
        "impact": "Users may miss the next required action.",
        "remediation": "Increase the action's hierarchy without obscuring status."
      }
    }
  ],
  "created_at": "2026-07-12T00:04:00Z"
}
```

Every source row's `[review_id, finding.id]` pair exactly equals one `prior_finding_refs` row, with no omissions or extras, and the complete `finding` object exactly equals the referenced earlier result. The source's run, commit, and `for_round` match the current review and its `created_at` does not follow Primary execution start. Because the binding participates in `payload_sha256`, the receipt's `input_payload_sha256` authenticates the source path and bytes.

Each receipt contains exactly `schema_version`, `assurance`, `review_id`, `perspective`, `context_id`, `invocation_id`, `input_payload_sha256`, `prompt_sha256`, `result_sha256`, `started_at`, `completed_at`, and `recorded_at`. `prompt_profile` remains in the input and is authenticated through `input_payload_sha256`; it is not a receipt field. The checker re-hashes the receipt bytes and verifies every field against the review. This is durable workflow evidence, not a signed provider receipt. Caller-authored IDs and hashes do not cryptographically prove separate model execution, so the only valid assurance label is `workflow-attested-non-cryptographic`.

Reviewer finding IDs use `drf-` plus the first 16 lowercase hex characters of SHA-256 over canonical JSON containing `[review_id, subject_id, region, rule, sorted(coverage_ids), sorted(evidence_ids)]`. Each reviewer finding has exactly `id`, `subject_id`, `region`, `rule`, `coverage_ids`, `evidence_ids`, `priority`, `owner`, `basis`, `confidence`, `summary`, `impact`, and `remediation`.

## Report

`report.json` is the schema-v2 machine outcome. Schema v1 remains readable only in explicit inspection mode and can never certify a gate.

```json
{
  "schema_version": 2,
  "run_id": "dc_01...",
  "mode": "product-ui",
  "commit": "<current-commit>",
  "route": { "path": ".pm/.../route.json", "sha256": "<64-hex>" },
  "captures": { "path": ".pm/.../captures.json", "sha256": "<64-hex>" },
  "reviews": { "path": ".pm/.../reviews.json", "sha256": "<64-hex>" },
  "review_assurance": "workflow-attested-non-cryptographic",
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
  "reconciliation": [],
  "top_issue": "No unresolved design issue.",
  "next_action": "Proceed to QA.",
  "human_report": { "path": ".pm/.../report.html" },
  "checked_at": "2026-07-12T00:03:10Z"
}
```

Artifact mode replaces `state-clarity` with `print-navigation`. Every score has an integer `value`, a concrete `rationale`, and one or more valid `evidence_ids`. Final report scores must exactly equal the final-round Primary scores.

| Score | Anchor |
|---|---|
| 1 | Fails the intended job or has severe evidence-backed defects |
| 2 | Materially weak; several important problems remain |
| 3 | Usable baseline with notable improvement opportunities |
| 4 | Strong, clear, and polished with only minor issues |
| 5 | Exceptional and internally consistent; no meaningful defect found |

### Final findings and reconciliation

A final finding uses `dc-` plus the first 16 lowercase hex characters of SHA-256 over compact JSON containing `[subject_id, region, rule, sorted(evidence_ids)]`. Priorities are P0–P3. Statuses are `open`, `resolved`, `deferred`, and `dismissed`. Owners are `design-critique`, `qa`, and `review`.

Every reviewer finding appears in exactly one reconciliation row, and every final finding is the target of exactly one row. A row has `id`, `subject_id`, `region`, `rule`, `coverage_ids`, `source_finding_refs`, `agreement`, `disposition`, `final_finding_id`, `decision_evidence_ids`, and `rationale`. Agreement is deterministic: `single-source` for one perspective, `aligned` when both perspectives agree on priority, owner, and basis, otherwise `disputed`. Final evidence equals the exact union of source and decision evidence.

Final severity may equal or exceed the most severe source finding. It must never be lowered. An escalation requires concrete rationale and at least one decision-evidence item whose bound file bytes—or decoded pixels for product UI captures—differ from every source finding's evidence; a copied file under a new ID is not new evidence. When a Design Critique-owned source remains or becomes P0/P1, it cannot be reassigned to QA or Review. A passing report requires every such source blocker to remain Design-owned and resolve with proof, even if a final row tries to dismiss, relabel, or hide it.

Resolved P0/P1 proof cites an inactive earlier before capture and an active later after capture for the same subject and coverage. Rounds and `captured_at` timestamps must both order before strictly before after, and the capture byte hashes must differ; product UI also requires different decoded-pixel hashes. Deferred findings require `defer_reason` and `defer_owner`.

## Human report

Render `report.html` from `references/templates/design-critique-report.html`. The inert PM artifact metadata binds exact `report.json`, `captures.json`, and `reviews.json` bytes. Replace all example zero hashes before validation.

The first screenful shows outcome, mode, coverage, deterministic `top_issue`, and next action. Visible markers include `data-dc-outcome`, `data-dc-coverage`, `data-dc-top-issue-sha256`, and `data-dc-next-action-sha256`. Every score, final finding, reviewer result, and reconciliation row carries its checker-defined hash marker: `data-dc-score-*`, `data-dc-finding-*`, `data-dc-review-*`, and `data-dc-reconciliation-*`. The perspectives section also carries `data-dc-review-assurance="workflow-attested-non-cryptographic"` and visibly says that the assurance is workflow-attested and non-cryptographic. The checker rejects markers hidden by computed style, hidden ancestors, collapsed containers, comments, scripts, templates, or empty content.

## Outcome mapping

| Report | Dev gate |
|---|---|
| `passed` | `passed` |
| `failed` | `failed` |
| `blocked` | `blocked` |
| `deferred` | `blocked` with human decision in the reason |

Only `passed` invokes `dev-gate-check.js --require design-critique`. Every other outcome stops Dev before QA.
