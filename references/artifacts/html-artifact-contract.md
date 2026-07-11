# PM HTML Artifact Contract

Use this contract for durable human-facing PM HTML: proposals, RFCs, and reports. Content schemas remain owned by their workflows; this file owns shared document mechanics.

Read `references/artifacts/html-foundation.md` for shared tokens, components, diagram fallbacks, and responsive/print behavior.

## Required metadata

Include exactly one inert JSON block in `<head>`:

```html
<script id="pm-artifact" type="application/json">
{
  "schema_version": 1,
  "id": "proposal:multi-language-support",
  "kind": "proposal",
  "slug": "multi-language-support",
  "lifecycle": "draft",
  "title": "Multi-language support",
  "generated_at": "2026-07-12T03:00:00Z",
  "generator": { "name": "pm:groom", "version": "1.13.11" },
  "source": { "path": "pm/backlog/multi-language-support.md", "sha256": null },
  "evidence": []
}
</script>
```

Validate it against `references/artifacts/html-artifact.schema.json`. Lifecycle is `draft`, `reviewed`, `approved`, or `superseded`. Workflow-specific lifecycle markers may coexist, but must not contradict this block. RFCs render the same value once as visible text in `[data-pm-lifecycle]` so approval can update a narrowly verifiable marker.

## Iron rules

1. **Self-contained:** no network fonts, scripts, styles, images, frames, or CSS URLs. Inline required CSS and diagrams. Render diagrams to inline SVG; if rendering is unavailable, include an accessible text fallback.
2. **Inert by default:** no executable scripts and no inline event handlers. JSON metadata scripts are allowed. Progressive enhancement requires a future contract version.
3. **Accessible structure:** declare language, charset, viewport, unique title and H1, a keyboard-visible skip link, one main landmark, labeled navigation, unique IDs, and valid internal anchors.
4. **Not color-only:** lifecycle text must remain visible without color. Images and inline SVGs require accessible names or explicit presentation semantics.
5. **Responsive and printable:** include a narrow-screen rule, `prefers-reduced-motion`, and print rules that remove sticky/chrome behavior, expose link destinations when useful, avoid clipped overflow, and preserve readable contrast.
6. **Bounded:** default maximum is 1.5 MiB per HTML artifact. Embedded raster assets need an explicit workflow exception and must remain within the total budget.
7. **Traceable:** emit a manifest from `scripts/artifact-check.js --manifest ...`; consumers trust the exact HTML SHA-256, not the path alone.

## Authoring sequence

1. Render workflow content with stable section anchors.
2. Insert the metadata block and lifecycle text.
3. Inline local presentation assets; do not copy CDN tags from old artifacts.
4. Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/artifact-check.js --html <path> --kind <kind> --manifest <path>`.
5. For release/reference QA, run `node ${CLAUDE_PLUGIN_ROOT}/scripts/artifact-render-check.js --html <path> --out-dir <private-output-dir> --manifest <path>`. It captures viewport and full-document images at desktop, tablet, and Chrome-CLI-supported narrow widths, rejects horizontal overflow or hidden landmarks, and verifies a non-empty print PDF. Pass `--browser` or set `PM_ARTIFACT_BROWSER` when Chromium is not discoverable.
6. Treat a non-zero result as blocking before review, approval, or handoff.

Reference templates use `--template`, which permits documented placeholder hashes and example identity values but keeps safety, accessibility, navigation, offline, responsive, print, and budget checks strict.
