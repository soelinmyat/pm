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

Product UI decides primary, empty, error, boundary, loading, success, focus, disabled, keyboard, and modal applicability for every subject. A non-applicable state carries a concrete product reason. An applicable row should carry a `reason` that says what its capture is meant to show. Capture and the checker share one reason rule: a string of at most 2,000 characters on a single line, with no control characters or Unicode line breaks such as U+2028. Capture requires a non-blank reason on every row; the checker also accepts an empty or blank reason on an older route, which means no description. A coverage reason describes only the visible state the capture is meant to show, such as "accessibility large text, sheet body scrolled to its end"; it never carries implementation rationale, fixes, prior findings, or expected verdicts. Reviewers read it as context for the intended state, not as proof that the state is correct. In route schema v2, every web product UI subject requires both a `primary` desktop row and a separate `primary` narrow row; a responsive or other narrow state cannot substitute. Add tablet when it exercises a distinct breakpoint. PM artifacts require desktop, tablet, narrow, and print.

Schema-v2 web product UI may declare `scenarios: [{id, subject_id, description}]` on the route and `scenario_id` on coverage rows. Use bounded kebab-case IDs and single-line descriptions for genuine locale, data or task variants. Each scenario belongs to one web subject and must have coverage; unknown, duplicate, unused, cross-subject and non-web declarations fail. Coverage decisions are unique by subject/state/viewport/scenario; omitted scenario retains the default decision. Existing per-subject state decisions and primary desktop/narrow requirements remain mandatory. The exact route hash and optional capture-manifest `coverage.scenario_id` bind this scope through native captures, audits and reviewer inputs. A scenario never exempts pixel or native checks: every active capture is compared against every distinct state or named variant for the same subject and viewport. Variants of the same state must also reject beacon-only changes.

A small busy-button change may use its native measured region for cross-state distance only when both captures visibly assert the same locator, both observations identify a named native button, and both measured bounds have the same vertical origin and height at a minimum 32×20 pixels, and retain either the exact left edge or exact horizontal center; an intrinsic width difference is permitted only up to that shared height, and comparison uses their measured union. The loading assertion must explicitly prove `aria-busy=true`. Both original full PNGs remain required and hash-bound; full-page captures, viewport drift and absent geometry cannot use this fallback. Both regions must pass the unchanged meaningful-image rules and their difference must pass the unchanged material-distance rules. Busy-button proof also needs at least 32 full-contrast pixel equivalents of change; weighting the decoded grid by its smallest tile area supplies a conservative lower bound and prevents minimum-sized controls from amplifying tiny beacons. Caller crop fields, state markers, blank regions and beacon-only changes cannot substitute for this proof. Fresh captures must assert the counterpart button too; do not amend old receipts. Native busy, focus and alert comparisons share a per-check cache of hash-bound derived region metrics, capped at 4,096 regions and 268,435,456 decoded pixels. Exceeding either fixed work budget rejects the package before another decode; caller inputs cannot raise these limits. The cache does not retain full decoded image closures, and every required comparison still runs.

Mobile product UI requires a primary `device` row. Every PM artifact subject also includes `artifact: {path, sha256, kind}` for the exact proposal, RFC, or report HTML.

New routes always use schema version 2. Never create a new route with schema version 1 and never downgrade a v2 route. The checker can parse schema v1 only in explicit, non-authoritative inspection mode so an existing run can be read and migrated; inspection never returns a certifying pass and cannot create, update, or recertify a gate row. To certify current work, freeze and execute a new schema-v2 route. During migration, v1 is interpreted with its original primary, empty, error, and boundary decisions plus primary desktop for web; it does not gain v2's blanket narrow requirement or trusted-capture requirements. `captures.json` retains schema version 1. A certifying `report.json` uses schema version 2 and binds `reviews.json`; report schema version 1 is inspection-only.

Every state retains native role and name-presence observations for visible asserted nodes. A named heading or StaticText also retains a SHA-256 of its trimmed native AX name, without copying that name into geometry evidence. For distinct named scenarios in the same primary state, visibly asserted role-name heading guards can prove a localized text change; in the same success state, the equivalent proof uses explicitly asserted native StaticText confirmations. Both native name hashes must match their own exact guard text and differ from each other. Their native vertical origin and height must agree, and they must preserve either the exact left edge or exact horizontal center, with each text region at least 32×8 pixels; differing intrinsic text widths use their measured union. Centered localized text can change width without changing its anchor; native guard names and the existing regional material-change and pixel-support floors still apply. The 8-pixel minimum preserves a nonzero lower bound for the existing 8×8 grid without applying a button's touch geometry to text. Both full PNGs must pass the same regional meaningful/material rules and unchanged 32 full-contrast pixel support floor. Metadata-only changes, mismatched names/roles, non-corresponding geometry, identical pixels and tiny beacons fail closed. Named text proof shares the existing bounded derived-metric cache. Historical 1.14.12 and 1.14.13 evidence remain readable only through the existing inactive/frozen predecessor policy; current active captures require the current producer.

Distinct named modal scenarios may prove a localized title change through an exact visibly asserted native heading. Its literal name must equal the same capture's visibly asserted native `dialog` name, and the measured title must lie wholly inside that dialog's measured bounds. Both titles retain matching vertical origin and height plus a common left edge or horizontal center, different native name hashes, the existing minimum text dimensions, meaningful regional pixels, material difference and 32 full-contrast pixels of support. Complete PNG, source, browser, network and assertion checks remain required. An unrelated heading, an unnamed or mismatched dialog, missing geometry, identical pixels or a tiny beacon cannot grant this proof. Other modal content keeps the ordinary cross-state comparison.

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

Every schema-v2 web product-UI screenshot includes `observation: {path, sha256}` for the schema-v2 `capture.json` emitted by `scripts/design-critique-capture.js`. The closed manifest binds the exact route and capture row; the subject surface; coverage state and viewport; redacted requested, expected, and final URL identities; an exact schema-v2 declarative state assertion; native visibility/hit-test observations; CSS viewport; raw accessibility, DOM, and network files; browser executable identity before/after; clean tracked source identity before/after; plugin version; invocation configuration; ordered timestamps; screenshot byte SHA-256; canonical decoded-pixel SHA-256; and deterministic visual metrics. The requested, expected, and final identities share one origin. They retain only origin, pathname, query/fragment-presence booleans, and the full-URL SHA-256—never query or fragment values. The checker rereads every binding, recomputes the invocation, native-observation, decoded-pixel, and visual-metric identities, revalidates the current browser executable for active captures plus the current clean tracked Git HEAD/tree/status for every capture, and requires the registered normalized audits to use the raw files named by this manifest.

A `role-text` locator is limited to visible `status` and `alert` live regions. Its `role:literal-text` value matches an unignored native StaticText descendant physically contained by the region; it never substitutes content for the native accessible name. Require a separate exact visible `role-name` StaticText guard for the same normalized literal text. Ambiguous regions/text, foreign ownership, hidden/covered text and inconsistent native ancestry fail closed. All named-control, source, URL, network, sample and schema checks remain required.

The state assertion's `subject_id`, `coverage_id`, and `state` exactly match the routed row. Its mandatory `state_marker` is an `id` or `test-id` whose `data-pm-state` equals that state, and every assertion carries at least one declarative guard. Error, loading, focus, keyboard, disabled, and modal states require an additional state-specific semantic guard. The marker and every explicit `visible` guard must pass ancestor visibility, effective opacity, clipping, visual-viewport intersection, and native Chromium hit-testing. Hit-testing samples five points and accepts ordinary target descendants, but rejects sibling overlay coverage and a single positioned descendant branch that covers at least 90% of the marker and wins every point. It is not a complete proof against irregular or partial occlusion between sample points.

The helper keeps network interception active through the screenshot/observation window, closes it with a final settle and browser barrier, drains pending handlers, and fails on a late request, policy violation, overflow, or handler error. Accessibility, control, DOM-issue, and network collections fail rather than truncate. It also rejects transparent, uniform, and near-blank decoded images: opacity-weighted pixels are premultiplied before color, luminance, and spatial analysis; at least 1% of the effective visible coverage must differ from the dominant color bucket, and qualifying content must occupy multiple tiles with at least 1% non-dominant effective coverage in each. For a sparse loading image below the whole-viewport meaningful-pixel ratio, the helper may retain `visual_metrics.loading_content` with policy `native-heading-and-loading-content-v1`. The state marker must be a native AX heading with a nonempty name, and a separate visibly asserted node must have native `status` or `progressbar` semantics and a nonempty name. Both nodes are hit-tested during every stable atomic sample. Their integer, in-viewport `visual_bounds` must be distinct and nonoverlapping; the heading is at least 16×12 and the indicator at least 16×16 pixels. Each region independently meets the unchanged meaningful-pixel, spatial-tile, color and luminance thresholds. Full-viewport visible coverage, spatial-tile coverage, color, luminance and pixel stability still apply. The original full PNG and whole-viewport metrics are retained. The offline checker recomputes the regional metrics from those exact PNG bytes and native geometry and requires every existing source, assertion, network and observation binding. Caller regions, blank indicator pixels, missing semantics, tiny nodes, changed metadata and other states cannot grant this fallback. Sparse static `empty`, `primary`, and `success` captures may instead retain `visual_metrics.sparse_content` with policy `native-heading-and-caption-v1`. A visible native heading must be both the state marker and an exact `role-name` guard; a distinct exact visible `StaticText` guard supplies the caption. Both native name hashes must match their literal guards. Their integer, in-viewport, nonoverlapping bounds must each be at least 32×8 pixels. Each region independently satisfies the unchanged meaningful-pixel, tile, color and luminance floors and contains at least 32 full-contrast pixels of opacity-weighted variance support. This conservative support uses the maximum channel's weighted variance divided by 255²; repeated text retains support while tiny or translucent beacons fail. The producer retains the full PNG and unchanged whole-viewport metrics. The verifier recomputes each region from the hash-bound original PNG through the existing bounded native-region cache, checks all metadata exactly and requires an explicitly supported sparse-proof producer identity. Release 1.14.33 accepts unchanged sparse proof from 1.14.32 or 1.14.33, including frozen predecessors; pre-1.14.32 and unknown producers cannot claim it. Missing or wrong native names, caller regions, overlap, blank pixels or forged metrics cannot qualify. All full-viewport opacity, tile, color, luminance, source, audit, network and exact two-sample pixel guards still apply. Ordinary compatible 1.14.28–1.14.31 captures retain their original policy and bytes under the explicit 1.14.32 compatibility map; legacy producers cannot claim the new sparse proof. Ordinary and older captures retain the original policy. Distinct active states at one subject/viewport require material changed-tile coverage in addition to different hashes. For trusted native captures, a localized focus or content change can qualify without a minimum whole-viewport average distance; each changed tile must still meet the local color-distance threshold, and all native state, source, integrity, and network bindings remain required. For an error/empty pair that falls below coarse tile coverage, the checker can compare the same native-measured `visual_bounds` of a visibly asserted, named `alert` in both images. Both captures must retain matching viewport geometry and trusted observations; the empty assertion must not also assert a visible alert. The measured alert must occupy at least the existing 1% meaningful visible-area floor of the screenshot, preventing tiny semantic nodes from magnifying pixel beacons. Role matching uses the native producer’s trim/lowercase normalization. The bounded region must meet the unchanged native changed-tile coverage and per-tile color-distance thresholds; its average distance is not a separate requirement. Missing geometry, identical pixels, or changes outside the alert cannot grant this fallback. Resolved product P0/P1 before/after pairs with verified native observations and identical decoded viewport dimensions may also qualify through the unchanged material changed-tile coverage and per-tile color-distance floors, without a whole-viewport average distance floor. This prevents unchanged page chrome from diluting a localized fix. Inactive historical before captures may retain the explicitly supported 1.14.6 and 1.14.7 native producer identities across a runtime upgrade. Their invocation digest is checked against that bound capture-time version; all other native and normalized audit checks remain required. Active captures in the current report must use the current producer, and unsupported historical versions fail closed. Recursive validation of a hash-bound frozen predecessor permits these supported capture-time producers and report generators even when that checkpoint retains its original active flags. This internal checkpoint context is not a caller option; it never rewrites historical bytes or waives source, normalized-audit, browser, pixel, chronology, reviewer-prefix or report bindings. Both complete native bundles and normalized audits remain mandatory; missing or invalid observations, viewport mismatch, identical pixels and beacon changes cannot grant this path. Independent reviewer reconciliation must still establish that the changed pixels resolve the source finding. Captures without verified native observations retain both material average decoded-pixel-grid distance and material changed-tile coverage.

The manifest's assurance level is `workflow-attested-non-cryptographic`. These local hashes are workflow attestations, not signatures: a caller able to author every local file can fabricate a self-consistent bundle, while the checker rejects inconsistent or independently mixed evidence. The manifest proves capture-time consistency, not that a generic development server served the routed Git commit or build. Use the project's documented server command and a clean build; when stronger provenance is required, expose an app/build identifier and verify it with an additional declarative guard. Build/server identity remains the explicit provenance limitation. The helper rejects iframe documents and starts a clean browser profile, so authenticated review must use a privacy-safe seeded or single-use application route without credentials in the URL.

Each capture records a positive consecutive `round` (up to the 50-round retained-lineage resource bound) and `active`. Every active required coverage row must resolve to its own canonical file path, file-byte hash, and decoded-pixel hash; copying, re-encoding, relabeling one image, or changing only a beacon pixel cannot impersonate a second state or viewport. Keep before and after entries when a blocking finding is fixed: the historical capture becomes inactive and exactly one latest-round capture stays active for each required coverage ID. Resolved product-UI P0/P1 proof uses the same subject and coverage ID, cites both IDs in the finding, and orders an inactive earlier `before` before the active later `after`; before and after must have distinct decoded-pixel hashes and material decoded-pixel-grid distance. IDs include the round; coverage IDs stay stable. Inactive historical captures retain their recorded capture-time browser identity after an installed-browser update; they must still attest an unchanged Chromium executable before/after capture, with a valid absolute path, byte count, SHA-256, and Chromium-family version. They retain every manifest, source, producer, raw-audit, network, timestamp, screenshot, decoded-pixel, and before/after proof check. Active captures must match the configured current browser executable, including revalidation through the end of the gate check; recapture all active coverage after a browser update without rewriting historical observations. Historical acceptance verifies the frozen observation, not present-browser behavior. A mixed-version before/after comparison alone cannot attribute a visual difference to the product fix; reviewers must qualify engine-sensitive claims and recapture the relevant comparison when the browser change could explain the difference. Source freshness remains strict for every active capture. Under `scoped-diagnosis-v1`, an inactive historical capture may retain its original route/source only when the immutable predecessor report binds that exact capture row (apart from `active`), its original route, audits and reviewer bytes. The historical commit must be an ancestor of current HEAD; route subjects/coverage/ownership stay identical. Current source cannot be relabeled onto old bytes. Without a checked predecessor snapshot, all existing strict source checks remain.

For route schema v2, accessibility and DOM audit evidence use schema v2 and are generated only by `scripts/design-critique-audit-normalize.js`. Each normalized web object contains exactly `schema_version`, `subject_id`, `commit`, `capture_ids`, `raw: {path, sha256}`, `checks`, and `findings`. Native objects add the fields specified below. Product-UI audits cite exactly one active capture: every active capture needs one accessibility audit, and every active web capture also needs one DOM audit. The raw DOM `inner_width` must equal the decoded cited screenshot width, binding responsive measurements to the rendered evidence instead of allowing one desktop probe to cover other viewports or states. The checker bounded-reads the raw path, verifies its SHA-256, reruns normalization, and requires the complete normalized object to match. Hand-authored booleans or findings cannot pass.

The raw probe is schema v1 with exactly `schema_version`, `kind`, `subject_id`, `commit`, `capture_ids`, and `observations`. For `accessibility-tree`, observations contain bounded `landmarks` (`role`, `name`, `locator`) and `controls` (`role`, `name`, `locator`, `disabled`, `tab_index`, optional `focus_context`, `document_index`). New captures also emit bounded `dialogs` rows (`role`, `name`, `locator`, boolean `modal`, boolean `contains_focus`) derived from exposed native AX nodes and focused-node ancestry. Exactly one named modal containing focus can supply the active document context when background main is hidden; nonmodal, unfocused, unnamed, or ambiguous modal evidence cannot waive the main-landmark requirement. Multiple main landmarks, unnamed dialogs/controls, and keyboard defects still fail. Legacy raw audits without `dialogs` retain the main-landmark requirement. New trusted captures emit `focus_context` as `document` for global tab stops or standalone controls. A custom tab, radio, menu item, or listbox option is `composite` only when Chromium proves native document Tab/ShiftTab entry and applicable arrow-key navigation to that member. The probe first tries an exit/return within the live widget before focusing an outside predecessor that could dismiss a conditional popup. For a sole member already exposed by native keyboard entry, an arrow may leave focus in place: after that actual key, native focus must still resolve to that unique frozen member, directly or through its focused owner's active-descendant relationship. Multiple members still require observed arrow movement to every member; a static `tabindex="-1"` relationship or an unlinked single member is not enough. This classifies keyboard focus exposure only; option activation and functional selection remain QA-owned. See the [W3C combobox keyboard pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/), which permits an arrow at a list endpoint to leave focus unchanged. Native `select` options remain `composite` through the browser's built-in select behavior. The bounded keyboard probe runs only after the screenshot and repeated accessibility/DOM samples are frozen, then the helper rechecks network settlement and URL identity before discarding the page, so interaction mutations cannot leak into the retained visual or DOM evidence. The normalizer checks accessible names for every control but derives global `focus_order` findings only from `document` controls; legacy raw rows without `focus_context` default to `document`. For `dom-audit`, observations contain numeric `viewport` (`inner_width`, `client_width`, `scroll_width`) plus bounded `hierarchy`, `edge_alignment`, `consistency`, and `asymmetry` issue arrays; every issue has only `code`, `locator`, and `detail`. Typography hierarchy compares nodes within their nearest semantic region (such as navigation, main, dialog, section, or tabpanel), so unrelated regions do not establish each other’s type scale; same-region hierarchy defects still fail. When exactly one named native AX modal contains focus, typography checks are scoped to its DOM subtree. If the modal is absent, ambiguous, or cannot be resolved, the full-page typography scope remains. Foreground typography defects and all other visibility, hit-test, geometry, and accessibility checks still apply. Producer changes require fresh captures and raw audits rather than rewriting historical observations. The helper derives passing booleans for `overflow`, `edge_alignment`, `hierarchy`, `consistency`, and `asymmetry`; any measured issue makes its corresponding check fail. See the capture guide for the exact browser probes and CLI invocation.

Web accessibility observations may include bounded `popups` rows for native AX menus or focused listboxes whose background main is hidden. Each row has only `role: "menu"` or `"listbox"`, measured native `name`, `locator`, `contains_focus`, `background_main_hidden`, `keyboard_navigation_verified`, and unique `member_locators` for its enabled menu items or options. A proved listbox also has the closed optional `owner` observation with only native `role: "combobox"`, `name`, and the frozen trigger `locator`. Its popup name may remain empty; the collector never copies the owner's label into it. Older observations without `popups` retain their existing checks; ordinary document listboxes retain their existing composite contract.

A named focused menu or a focused listbox with a measured named combobox owner may explain one hidden background main only when native keyboard exit, Tab reach of its uniquely linked trigger in the document or its current named modal, keyboard reopening, and arrow movement to every enabled frozen member have been proved. The collector matches remounted nodes by frozen element position and exact accessible identity, and rechecks popup ID and trigger ownership. Checkbox/radio menu items need the same traversal proof; disabled items need no keyboard traversal. The normalizer requires exactly one eligible popup, exact member/control agreement and no other enabled controls outside that scope. Missing names, ambiguous ownership, broken keyboard entry/arrows, static markup and malformed evidence remain non-passing. Listboxes require a unique explicitly controlling button with native `combobox` role, explicit `aria-haspopup="listbox"` or its implicit listbox default (an incompatible explicit value fails), exact `aria-controls`, and matching expanded state; the closed native owner must have a nonempty accessible name. Listbox Up/Down traversal excludes disabled options and proves every remaining frozen option. Popup and member accessible identities plus ownership must remain intact through the probe. A final native Escape re-exposes the combobox and verifies its name and linkage still match; an unnamed owner or standalone unnamed listbox remains non-passing. Unsupported popup owners retain failures. Popup probing never activates an item, changes the screenshot/readiness thresholds, or grants functional selection acceptance; QA owns that behavior. A closed menu trigger may omit `aria-controls` while its popup is unmounted, provided no other controller claims the frozen popup ID. Its frozen native identity, focus, collapsed state and keyboard reach still must hold; exact unique ownership is required again when reopened. A different nonempty target or ambiguous owner fails. This exception does not apply to listboxes.

Repeated native checkbox or switch buttons with entirely graphical descendants compare actual root/descendant geometry and visual properties instead of unused inherited font-size/weight. Visible text, SVG text, generated content, and text beneath nonpainting wrappers retain typography comparison. Glyph size differences, including font-driven dimensions, remain failures; this is no general consistency waiver.

Calendar date buttons inherit their consistency selection identity only from a validated uniquely dated semantic gridcell with explicit `aria-selected="true"` or `"false"`. This identity remains independent of the verified current date. Arbitrary selection data flags, invalid or duplicate dates, missing grid ownership, and `aria-selected` on ordinary buttons supply no exemption. Differences among equally selected dates or unselected peers remain findings; native navigation and all other capture checks remain required.

Current capture planning and managed bundle reads also accept the immutable `.pm/dev-sessions/<slug>/design-critique/runs/<run-id>/round-R/` route directory. Its route run ID, output round, assertion directory and capture `-rR` suffix must agree within the existing scoped recovery round budget; canonical legacy paths retain their limits. Managed member reads still require the branded sibling bundle and complete verified inventory. The canonical gate reads its report's exact route/captures bindings only inside this session's same bounded run/round, then reruns the full checker for schemas, hashes, lineage, native evidence and source identity. A selected path never substitutes for those checks.

For repeated buttons, the collector measures native Typed OM's computed `height: auto` in an isolated world before deriving consistency. Textareas additionally require a computed `field-sizing: content` value before their legitimate content-driven height variation is retained. Ordinary rows-based textareas retain used-height comparison. Fixed height, min/max constraints, glyph/root geometry and other visual properties remain checked. Unsupported Typed OM conservatively retains used-height comparison; malformed observations fail. The measured sizing identity participates in every atomic sample, and caller attributes cannot declare intrinsic sizing.

A closed `before_capture` action may request `caret-left` with an `id` or `test-id` locator. It resolves exactly one already-focused, editable native text/search input and dispatches one trusted native ArrowLeft, without assigning focus, value, style or labels. Its value, node identity/type, native role/name and editability must remain unchanged immediately and through every existing AX/DOM capture sample after settlement, rejecting delayed key-handler mutation. Focus must remain when caret-left is the last focus action; an explicitly declared later native Tab may move focus while the earlier value/identity proof remains enforced. Private field values are used only in memory and are not added to raw/log output. Unsupported kinds, ambiguous/foreign focus, disabled/readonly fields, replacements and schema extensions fail.

A final closed `focus-modality` action may resolve one `id` or `test-id` already-focused, named, noneditable `tabindex="-1"` region or heading. Native Shift establishes keyboard modality without assigning element focus or claiming Tab reach. Authored DOM text/structure/attributes, form values and accessible semantics are compared in memory immediately and at every capture sample; replacement, element focus movement, mutation or an ambiguous locator fails. Empty native CSS `::before`/`::after` decoration without children or exposed AX semantics and regenerated InlineTextBox paint-fragment IDs are excluded from content identity; generated semantic text remains bound. Only the browser RootWebArea activation flag may change; it must be focused afterward. No caller key, code, style or value is accepted. Ordinary capture, audit, pixel and QA gates remain required.

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

The web collector enforces its 1,000-character accessible-name bound on roles exported as controls, landmarks, dialogs or popups. Ordinary body `StaticText` is not exported as one of those audit rows and may be longer. Existing state-assertion limits, native observations, source/network bindings and total evidence budgets remain required.

### Native iOS accessibility observations

Maestro iOS hierarchies do not expose browser landmarks or DOM tab indices. For mobile product UI only, retain a raw `accessibility-tree` with `schema_version: 2`, the same subject/commit/capture identity fields, and exactly these observations:

```json
{
  "platform": "maestro-ios",
  "viewport": { "width": 402, "height": 874, "scale": 3 },
  "controls": [{ "by": "id", "value": "actions-filter-action_type" }],
  "hierarchy": { "attributes": {}, "children": [] }
}
```

The hierarchy placeholder above is not passing evidence: replace it with the complete, unmodified JSON hierarchy returned by Maestro alongside that screenshot. Retain the original CLI output too; remove only its non-JSON console prefix when wrapping it. Never synthesize labels, bounds, states, roles or focus indices. Declare the same ordered `native_controls` selectors on the route coverage row **before capture**. Use exact `id` or `label` selectors for every changed interactive control in that state, including picker options. Empty scope is rejected unless the explicit noninteractive contract below applies; duplicate scope is always rejected. Reviewers must challenge omitted controls; the normalizer cannot infer interactivity from Maestro's role-free tree.

For actual repeated list controls, a selector may add `occurrence: 0` (or another integer through 99). This is a zero-based index into the complete hierarchy's matching nodes in preorder; it does not invent an identifier or filter hidden, clipped, or offscreen nodes. The default selector still requires exactly one match. Occurrences require at least two actual matches and an in-range index. Duplicate occurrences and overlapping default/occurrence selectors are rejected. Predeclare the exact occurrences before capture and include all changed visible controls for that state; capture separate scroll states as needed. Source-bound Primary review checks scope completeness, and the selected node must independently pass names, enabled state, and 44-point geometry checks.

For a changed state that contains **no changed interactive controls**, coverage may declare `native_controls: []` only with `native_scope: {kind: "noninteractive-change", reason: "..."}`. The concrete reason must explain the changed noninteractive content and why existing controls are outside the change, using 40–2000 characters. Raw observations carry the identical `native_scope`; normalization preserves it, and the checker requires exact route/raw/audit agreement. A scope with nonempty controls, an unknown kind, a missing reason, or another platform is invalid. This produces **only** `native_screen`: no name, touch-target, interaction, focus, or traversal certificate is emitted. The complete unmodified hierarchy and screenshot are still required and viewport-bound. Never add an unrelated passing control or classify changed interactive controls as noninteractive. Source-bound Primary review must inspect the changed code and rendered state to verify this declaration before accepting the evidence.

For interactive scope, the normalizer validates bounded hierarchy structure and state flags, matching logical screen bounds, unique declared-control presence, accessible names, and at least 44×44-point enabled touch targets fully inside the viewport. It emits `platform`, `controls`, explicit `limitations`, and `native_screen`, `names`, `touch_targets` checks. It does **not** emit passing web landmark or focus-order checks. Missing, ambiguous, unnamed, undersized or viewport-clipped controls produce findings. The checker requires the declared scope to match and logical dimensions multiplied by scale to equal the cited screenshot's decoded dimensions, including retained round-1 audits on inactive captures. Coverage that declares `native_controls` or `native_scope` requires a native audit; a web-shaped audit cannot satisfy it. Native audits cannot satisfy web or document evidence.

This is scoped geometry/name evidence, not full accessibility certification or a trusted browser capture. VoiceOver traversal, semantic roles, occlusion/ancestor clipping, focus behavior and screenshot/hierarchy simultaneity remain separately observed reviewer responsibilities. Preserve navigation logs and screenshots from the same stable app state. A horizontal control strip may need distinct before/after-scroll coverage with each changed control fully visible and interaction verified; do not silently omit a clipped control just to pass. Unsupported native platforms remain blocked rather than receiving fabricated browser fields.

### Sparse empty/loading comparisons

A trusted web empty/loading pair may prove a localized state difference inside its native measured content bounds. The loading capture explicitly asserts a visible named `status` or `progressbar`; the empty capture explicitly asserts a visible native heading whose exact name hash matches its guard and is not shared with a visible heading or StaticText guard in the loading capture. An empty assertion that also asserts a visible loading region cannot grant this fallback. The indicator is at least 16×16 pixels and the heading at least 32×8; both captures have the same measured viewport and neither is full-page. The checker verifies meaningful pixels independently inside the loading indicator in the loading image and the heading in the empty image. It compares only those actual element regions, excluding the gap between them, and requires the unchanged changed-tile and 32 full-contrast pixel support floors within at least one region without double-counting overlap. All metrics come from the original PNG bytes. Caller regions, identical pixels, beacons, unrelated changes and missing native proof remain rejected. Existing bounded region-cache limits still apply. The checker-only 1.14.29 update explicitly retains the unchanged 1.14.28 native producer and observation contract; it does not rewrite capture-time evidence.

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

The context source and capture manifest must exist before `execution.started_at`. Every named capture must already exist when its round manifest is created, have `capture.round <= manifest.round`, and have `captured_at <= manifest.created_at`. Round 1 covers every required route row. The final round covers every active required capture. For every round after 1, both the round manifest and every reviewer execution start after both preceding-round receipts were recorded. Each later round contains at least one new capture which postdates those receipts; a source change requires recapturing every active state/viewport at current HEAD. A numbered round cannot be used to rewrite the chronology of an earlier review.

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
            "prompt_profile": "fresh-eyes-v2",
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

The Primary input additionally allows only `acceptance_criteria`, normalized `evidence_ids`, `prior_finding_refs`, and, when those refs are non-empty, `prior_findings_source`. Its evidence IDs exactly equal the normalized evidence bound to the captures in that round manifest; evidence from later or unreviewed captures is forbidden. A product-UI audit is eligible only when every capture it cites is in the round manifest. For a PM artifact, structural evidence remains document-wide, while accessibility and render evidence is eligible only when its complete cited capture or full-page/print file set is contained in or exactly matches the round manifest. Fresh Eyes uses the closed common allowlist shown above: it cannot receive acceptance criteria, audits, findings, round history, implementation rationale, or any other field. Its prompt lists each supplied capture with its capture ID and the coverage ID, state, viewport, and `reason` copied verbatim from the bound route that the round capture manifest binds; this is bound input, not an added field, and a missing, empty, or blank reason renders as `no description routed`. Its result must include one observation for every supplied capture, with the exact routed coverage ID, state, and viewport. Each observation contains at least 40 UTF-8 bytes, names a concrete interface element and a direct visual property or relationship, explicitly names its state and viewport, and remains substantively distinct after capture metadata is removed. The first impression and three answers must likewise contain concrete visual substance. Both reviewers receive the same context and round-capture bindings, while prompt, payload, context ID, invocation ID, and result identity remain distinct. A same-runtime review is valid only as a fresh isolated invocation; continuing the current conversation is not isolation.

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

Localized primary- and empty-state variants may prove a text difference through a native
heading or StaticText caption. Both captures must visibly assert the exact
native names, retain matching role and anchored measured geometry, and show a
material difference in that semantic region. This does not replace source,
viewport, distinct-image, native-observation or other state checks. Focus and
keyboard variants retain their heading and native focus requirements; a caption
cannot substitute for that proof. The checker-only 1.14.39 update also permits
this proof for empty-state locale variants and explicitly retains the unchanged
1.14.37/1.14.38 native observation, audit and report contracts. It changes no
quality threshold or pixel-support floor.

Distinct error scenarios may use the same native StaticText comparison only
when each exact caption is paired with its own visible `role-text` alert guard.
The native alert bounds must wholly contain that caption's measured bounds.
Both whitespace-normalized caption literals must differ; raw native names still
require exact hash verification. Keep the existing anchored geometry, meaningful
pixels, material regional difference and 32 full-contrast pixels of support. Unbound or
outside-alert text, identical captions, styling alone and pixel beacons cannot
establish an error-state difference. Native producer and observation schemas are
unchanged; release 1.14.30 explicitly retains the 1.14.28/1.14.29 contracts.

For a native loading-button comparison, both captures must explicitly assert the
same visibly named button, and loading must assert `aria-busy="true"`. Native bounds with a common left edge or center, unchanged vertical origin and
height, and the existing width-growth cap constrain the compared region. A localized spinner may qualify
through the unchanged changed-tile ratio and per-tile color-distance floors
without a separate average-distance floor across the button. Both regions still
require meaningful content and at least 32 full-contrast pixels of support.
Identical images, tiny beacons, missing native guards, moved bounds and changes
outside the button cannot supply this proof. Other regional comparisons retain
their existing rules. The checker-only 1.14.26 update explicitly supports the
unchanged 1.14.23–1.14.25 native observation and report contracts.

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

Artifact mode replaces `state-clarity` with `print-navigation`. Every score has an integer `value`, a concrete `rationale`, and one or more valid `evidence_ids`. Final report scores must exactly equal the final-round Primary scores. Scores describe observed craft and remain evidence-backed diagnostics; they are not an independent passing threshold. Derive the outcome from required evidence and consequential findings. A score rationale describing a failed core task, inaccessible primary action or unusable composition requires the corresponding blocking finding, not a cosmetic label. Minor preferences remain visible P2/P3 concerns with a reason and owner; do not split cumulative core-journey failure into minor rows.

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

### Loading captures with outstanding reads

For a routed `loading` state, the web capture helper permits outstanding GET/HEAD
Fetch, XHR or Image requests after document load and a quiet network interval. The same
request set must remain pending throughout capture and keyboard probing. Its
request sequence IDs are retained as `pending_at_capture` in the hash-bound
network ledger and capture manifest. The checker permits these references only
for loading rows and verifies that each points to an observed read-only data
request. Other states still require network idle; unfinished documents, scripts,
stylesheets, fonts, writes, unknown requests, and open sockets do not qualify.

The visible loading semantic guard, allowed origins, target isolation, native
DOM/accessibility samples, identical screenshots, and protocol barriers remain
mandatory. Requests completing or starting during atomic capture invalidate the
capture. Use a genuine delayed test endpoint; do not replace the response or
manufacture loading markup to satisfy the gate.

## Scoped recovery after two unresolved rounds

New `reviews.json` documents add `recovery_policy: "scoped-diagnosis-v1"`. Preserve
all earlier round rows and their prompt/input/result/receipt bytes exactly. Each
later row may bind `previous_report: {path, sha256}` to the immutable immediately
prior non-passing report; this checkpoint is required for source advancement
and after round two. Freeze the predecessor's route/captures/reviews/report/HTML
at their original paths before source changes. The checker validates its complete
frozen chain and exact reviewer prefix. Historical inactive captures and audits
use the source in that checkpoint; active captures, current route/report and the
final reviewer pair still bind current HEAD. Changed source requires new captures
for every active coverage row, not a new label on old observations.

After round two, the next row also requires a closed `recovery` object with
`classification`, `observed`, `cause` (or testable hypothesis), `change`,
`next_check`, `evidence_ids`, and `scope_assessment`. Evidence IDs cite captures,
findings or reviewer IDs retained in the immediately prior report. Text fields
contain 1–4096 UTF-8 bytes. Classifications are `product-defect`,
`harness-environment`, `stale-evidence`, `external-dependency`, `product-decision`,
and `scope-risk-change`. Scope is `within-approved-scope` or `decision-required`;
the last three classifications and a postponed predecessor choice require the
latter and a blocked outcome. Any present diagnosis is checked, even before the
threshold. A repeated normalized `change` and `next_check` is rejected. This
structure supports grounded model judgment; it does not certify that a stated
cause is true or create new permission.

Validate each historical diagnosis against its immutable historical report,
including that report's outcome. A dependency-blocked round does not force a
later report to remain blocked after actual restoration and fresh current
captures/reviews. Product decisions, scope/risk changes, and other explicit
`decision-required` scope assessments remain unresolved within that lineage;
omission, an in-scope claim, or relabeling them as a restorable dependency cannot
substitute for trusted product direction. Preserve the original report and rows
through restoration or a separately approved product decision.

An authenticated nonpassing predecessor may retain native audit checks whose
original boolean value is false, cross-state visual-distance quality failures,
and identical encoded or decoded images at independently bound capture paths.
This records its failure; it does not convert the earlier evidence to a pass.
Historical evidence must match the exact entry in
that predecessor's bound capture manifest and retain its raw-probe hashes,
deterministic normalization, native observation bindings and reviewer history.
Only recursive frozen validation applies this rule; a caller flag or a blocked
label cannot exempt current evidence. Current captures and active audits still
require every quality check to pass, including after recovery. Historical hash,
decoded-pixel identity, canonical capture paths, provenance, state and review
checks are never exempted. Release 1.14.33 keeps the unchanged native contracts
from 1.14.28 through 1.14.32 explicitly compatible; this never accepts failed
current audits, unknown producers, or an invalid historical binding.

Continue authorized scoped repair with a fresh Primary/Fresh Eyes pair and
strict capture/manifest/receipt chronology. Preserve the aggregate 2,000-capture,
JSON/file/cache budgets and 50-round resource ceiling; report an actual resource
or platform limitation as blocked, never request product reapproval because a
counter alone advanced. A non-passing report is still non-passing. Current
source/coverage, before/after pixels, independently bound reviews and every
existing reconciliation check determine passing eligibility. Legacy reports
without recovery metadata remain readable and retain their original checks.

Centered, unblurred inset focus shadows with positive spread may supply native focus-indicator bands. The producer includes measured border widths, caps inward depth at 16 pixels and excludes the control center. Offset, blurred, excessive or unmeasured inset geometry fails closed. Native Tab, changed focus styling and material pixel differences on at least two bands remain mandatory; unchanged decorative shadows and caller attributes do not supply regions. Historical 1.14.22 evidence remains readable only through the existing inactive/frozen predecessor policy; active captures require the current producer or an explicitly compatible native evidence version.

The recorder-only 1.14.24 release explicitly accepts 1.14.23 capture producers and Design Critique report generators because their native capture, audits, pixel thresholds and report renderer are unchanged. This exact pair does not establish compatibility for other releases. Every source, browser identity, manifest, raw audit, pixel, state, reviewer, predecessor and report binding is revalidated normally; version compatibility never converts failing evidence into a pass.

Unsupported and fully transparent inset components do not contribute focus regions; independently supported outline and outer-shadow bands remain available. Focus fallback requires material changes on at least two native bands and at least 32 full-contrast pixel equivalents across qualifying disjoint bands. This reuses the existing absolute support floor while retaining distance, changed-tile, native provenance and resource thresholds; thin bands account for occupied grid cells. No-ring edge beacons do not qualify.
