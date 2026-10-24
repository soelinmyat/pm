# Direct PDF document evidence

Use this contract for an actual static report PDF produced by the application,
including export-only presentation changes. Retain a real downloaded artifact
from the ordinary authenticated product flow with sanitized test data. QA owns
download behavior, authorization, data correctness, and the scenario inventory.
An unchanged screenshot of its download button cannot certify PDF presentation.

## Route and capture

Use schema-v2 `pm-artifact` mode and a `document` subject with
`artifact: {path, sha256, kind: "report", format: "pdf"}`. The subject `surface`
must equal that exact project-relative PDF path. Freeze the bytes below the
owning session, the current clean source commit, remote base and diff hash.
Each distinct document/data variant is a separate subject. Each PDF subject
requires exactly one `print` state at the `print` viewport, covering every page
at its native paper geometry. Fixed PDF pages do not acquire HTML breakpoints.
Page rasters use the effective visible CropBox and page rotation. Raster
dimensions must agree with that observed geometry at the fixed render scale;
content outside the visible crop is excluded.
HTML subjects keep their existing desktop/tablet/narrow/print requirements.

With the normal immutable route at
`.pm/dev-sessions/<slug>/design-critique/runs/<run-id>/round-R/route.json`, run:

```sh
node "$CLAUDE_PLUGIN_ROOT/scripts/design-critique-capture.js" \
  --root "$PROJECT" --route "$ROUND/route.json" \
  --subject report-variant --coverage report-variant-print \
  --capture report-variant-r1 --pdf "$PDF" \
  --out-dir "$ROUND/round-1/report-variant-r1" --json
node "$CLAUDE_PLUGIN_ROOT/scripts/design-critique-pdf-audit.js" \
  --root "$PROJECT" --capture "$ROUND/round-1/report-variant-r1/capture.json" \
  --out "$ROUND/report-variant-audit.json"
```

Use the actual round number consistently in the capture ID and both directory
components. The installed Poppler tools `pdfinfo`, `pdftotext`, `pdffonts`, and
`pdftoppm` must be executable on the trusted host PATH. Missing tools are a
blocked capability. The PDF producer accepts no browser, URL, web assertion,
viewport or network-origin options. It snapshots the input into a private local
scratch directory before invoking the tools, and never follows a command path
supplied by a capture manifest.

The helper retains the original `capture.pdf`, every `page-NNN.png`, a raw
`pdf-observation.json`, and `capture.json` in one immutable managed bundle.
It binds the original document, route, source before/after, executable bytes and
versions before/after, exact page geometry/order, extracted text, fonts, page
bytes, decoded pixels, and two stable render samples. All files must remain
available under the project root. The checker independently re-renders current
active PDF evidence using the currently resolved host tools; stale source,
changed tools, forged text, missing pages or pixel drift cannot pass.

Only static classic-xref PDF 1.0–1.7 reports supported by the parser qualify.
Encrypted documents, forms, automatic/JavaScript/launch actions, embedded files
and rich media are unsupported. PDF 2.0/object-stream inputs and incremental or
hybrid cross-reference chains remain blocked.
Fixed budgets are 32 MiB input, 50 pages, a 1,600-pixel maximum raster edge,
4 Mi pixels per page, 128 Mi aggregate pixels, 128 MiB bundle, 8 MiB raw text,
and a 90-second render deadline. Rendering warnings fail closed. Do not alter
limits or strip content to make an unsupported document appear certified.

## Audit, review and report

Copy the returned capture row into `captures.json`, add its `coverage_id`,
`kind: "pdf"`, `active: true`, and the returned manifest binding as
`observation`. Add exactly one `pdf-document` evidence row for the generated
normalized audit per active PDF capture. Never hand-author audit checks.
The checker verifies that the normalized bytes equal deterministic derivation
from the retained trusted raw observations. Browser AX and HTML structural
manifests cannot substitute for a PDF audit, and a PDF audit cannot certify web,
mobile or HTML subjects.

The normalized observations disclose page text counts/hashes, fonts and tagging.
**Text extraction and tagging observations do not verify native reading order or
spoken assistive technology.** Untagged PDFs also disclose their missing explicit
structure tags. Review accessibility honestly within these limits; record any
consequential accessibility defect rather than inventing native AX evidence.
The score remains a reviewer judgment supported by these observations.

Primary and Fresh Eyes must inspect every retained page PNG and retain their
ordinary closed inputs/results/execution receipts. Fresh Eyes gets rendered
pages and the task brief, preserving its existing independent-input boundary.
Concrete PDF observations can name submitted/report text, paragraphs, page text,
page numbers/margins, or signature images, together with actual visual detail.
All ordinary evidence, timing, provenance and reconciliation checks remain.
A resolved P0/P1 PDF finding requires material before/after page pixel changes;
a metadata-only replacement PDF is insufficient.

For every active PDF capture the visible human report must contain an element
with `data-dc-pdf-capture="<capture-id>"` and
`data-dc-pdf-observation-sha256="<raw-observation-sha256>"`. Its text must include
`N pages` for the exact count and every exact limitation from the normalized
audit. Link the original PDF and all page PNGs for inspection. Do not present
text extraction as a complete assistive-technology accessibility certification.


## Recovery across document rounds

Keep the same subject ID, title, format, kind, variant and required coverage when
correcting a PDF. Each round freezes its own exact artifact path, hash and
matching surface; changing those document bindings alone is not a new task.
Preserve the predecessor report, route, reviewer inputs/results and capture
bundle unchanged. Its retained `capture.pdf` remains the original document even
if an external input path is later replaced or removed.

Only internally verified inactive/frozen history can use those original bytes
and historical source/tool observations. Its source commit/tree/diff and every
retained page/audit binding are still checked. Current active evidence requires
the current clean source, current producer and independently resolved renderer.
Final scores cite audits for current active captures; predecessor audits stay
available for the immutable earlier reviews and finding history.
