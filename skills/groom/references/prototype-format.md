# Prototype Format

How wireframes are created, named, and organized in the PM knowledge base. Used by `pm:groom` Step 5 (Design) to generate prototypes and by Step 6 (Draft) to link them from an offline-safe preview.

For shared base styles and the starter template, see:
- `${CLAUDE_PLUGIN_ROOT}/references/templates/wireframe-base.css`
- `${CLAUDE_PLUGIN_ROOT}/references/templates/wireframe-base.html`

> **Legacy.** Wireframes created before this spec (most files in `{pm_dir}/backlog/wireframes/` predating it) may use older patterns. Keep them inspection-readable. A legacy prototype that loads unbound files must be recertified into the current single-file or tree-bound form before a new RFC/Dev handoff; do not silently rewrite it during inspection.

## Runnable in-app preview

Use this mode when consequential navigation, interaction, whole-page composition or realistic content growth needs to be experienced before product approval. Reuse the consumer app's actual components, shell and entry path in an isolated linked consumer Git worktree. A separate HTML recreation cannot establish how an incremental capability feels in that app. An established pattern with no consequential interaction ambiguity may use the inert document mode below; explain the bounded choice in the existing design requirements. A nonvisual change needs experience invariants, not an invented preview.

Keep the modes distinct: `design_context.prototype` retains its exact inert file/tree behavior. An in-app preview sets `prototype: null`, `ui_impact: true` and adds the complete `app_preview` identity. Never put active application scripts into an inert prototype to get around its validator.

Create realistic synthetic data in a separate **untracked or ignored fixture directory**, selected explicitly through `PM_PREVIEW_FIXTURES`. Do not copy private exports or wire preview code to real services. Commit the proposed UI source in the isolated worktree first. Preserve its exact incumbent base commit and list every committed changed path as reviewed starting code, including removals. Keep fixture files out of the committed source delta. Real components and executable interactions still require personal visual/product judgment; a mocked preview does not certify backend behavior.

Use the producer before capturing evidence:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/app-preview.js" prepare \
  --config .pm/preview-config.json --source-root /explicit/isolated/app-worktree \
  --repo-root /explicit/artifact-repository > .pm/preview-candidate.json
```

The config names portable paths and a logical repository ID, never a stored machine path:

```json
{
  "repository": "example-app",
  "base_commit": "EXACT_FULL_GIT_SHA",
  "reviewed_paths": ["src/work-order.js"],
  "fixture_directory": ".pm/preview-fixtures",
  "launch": {
    "executable": "npm",
    "args": ["run", "preview", "--", "--host", "127.0.0.1"],
    "cwd": ".",
    "url": "http://127.0.0.1:4311/work-orders",
    "env": { "PM_PREVIEW_FIXTURES": ".pm/preview-fixtures" }
  },
  "journeys": [{
    "id": "save-return",
    "purpose": "Enter normally, perform the accepted action, leave/return and inspect long content",
    "required_states": ["entry", "saved", "returned", "long-content"]
  }]
}
```

The producer checks the isolated clean Git source, base/head/tree, all changed source paths, bounded fixture manifest, structured launch recipe and required journeys. It returns a fresh capture UUID, start time and exact input hash. It **never executes the launch recipe**. Inspect the source and package script, then launch through the host's permitted app/runtime tools with the supplied fixture environment. The supported recipe uses `node ENTRY` or `npm|pnpm|yarn|bun run SCRIPT`, a source-relative working directory and a loopback HTTP URL; shell text is refused.

Exercise declared journeys through normal navigation, primary action, leave/return and consequential alternate/content states. Retain screenshots and/or executable state evidence under the artifact repository. Create a JSON receipt containing the exact capture ID/input hash, observation time, named observer, `backend_certified: false`, executed steps and every required state's evidence path. The completion input contains those same fields plus `receipt`, a repo-relative path to the receipt bytes:

```json
{
  "receipt": ".pm/preview-evidence/capture.json",
  "capture_id": "UUID_FROM_CANDIDATE",
  "input_sha256": "sha256:HASH_FROM_CANDIDATE",
  "recorded_at": "2026-10-07T10:00:00Z",
  "observer": "browser observation",
  "backend_certified": false,
  "journeys": [{
    "id": "save-return",
    "steps": ["Enter through app navigation", "Save", "Leave and return", "Inspect long content"],
    "states": [
      { "id": "entry", "evidence": ".pm/preview-evidence/entry.png" },
      { "id": "saved", "evidence": ".pm/preview-evidence/saved.png" },
      { "id": "returned", "evidence": ".pm/preview-evidence/returned.png" },
      { "id": "long-content", "evidence": ".pm/preview-evidence/long.png" }
    ]
  }]
}
```

Save the receipt without its `receipt` field; completion checks it against the semantic attestation and hashes all retained evidence. Do not reuse a prior capture after changing source, fixtures, launch or declared states. Missing/stale/replayed observations cannot complete a new candidate.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/app-preview.js" complete \
  --candidate .pm/preview-candidate.json --observations .pm/preview-observations.json \
  --source-root /explicit/isolated/app-worktree --repo-root /explicit/artifact-repository
```

Copy the complete result unchanged into `design_context.app_preview`. Pass it through the existing proposal → RFC → Dev design-context handoff. Validators recheck retained source and artifact bytes; separate source/artifact repositories require an explicitly supplied `previewSourceRoot` or keyed `previewSourceRoots` execution-context mapping. They never locate a consumer using an identity's arbitrary absolute path. Preserve pinned source commits and evidence until adoption; this identity is not a self-contained source bundle.

After product acceptance, `app-preview.js adopt --identity FILE --source-root WORKTREE --repo-root ARTIFACT_ROOT --target-root DEV_WORKTREE` verifies the identity and an exact clean isolated target at the base commit, checks the patch, then stages **only reviewed committed UI code**. Fixture bytes stay separate. RFC/Dev adopt this reviewed starting code, integrate production data deliberately, guard or remove preview fixture selection, and test real backend contracts. Departures from accepted behavior need the existing product/risk decision rules. Workflow-attested observations and structural hashes do not certify the observer's judgment, pixel quality or production integration.

---

## 1. File organization

```
{pm_dir}/backlog/wireframes/
  {slug}.html              ← single-screen, OR ≤2 screens stacked
  {slug}/
    index.html             ← tour page (always exists when subfolder used)
    {screen-name}.html     ← one file per screen, ≥3 screens
    meta.json              ← wireframe metadata (see §6)
    base.css               ← shared base styles (copy of wireframe-base.css)
```

**Decision rule:**
- **1–2 screens** → single file at `{slug}.html`. Screens delimited by `<section class="screen">` blocks. Metadata embedded in `<script type="application/json" id="wireframe-meta">`. `wireframe-base.css` is inlined into the file's `<style>` block.
- **3+ screens** → subfolder at `{slug}/`. `index.html` is the canonical entry — it links to or embeds each per-screen file. Metadata lives in standalone `meta.json`. A copy of `wireframe-base.css` lives at `base.css` in the subfolder; every HTML file links to it via `<link rel="stylesheet" href="base.css">`.

**No prefixes.** Drop `mockup-` and `prototype-` prefixes. Slug-only.

---

## 2. Fidelity tiers

Pick one tier per wireframe. Recorded in metadata.

| Tier | When to use | Visual treatment |
|---|---|---|
| `sketch` | Structural / IA changes where layout matters more than visuals; very early grooming | Grayscale, dashed borders, hand-drawn feel, generic typography |
| `wireframe` | Default for most UI features. Real text and proportions, but no project design tokens applied | System fonts, neutral palette, disciplined CSS via `wireframe-base.css` |
| `mockup` | A usable existing visual system is available and the feature benefits from visual review before implementation | Reuses the smallest required project tokens/styles; close to the running app without a CDN dependency or invented design language |

**Auto-selection in Step 5:**
- If a usable existing visual system is detected—a Tailwind theme, CSS variables/tokens/theme, or established styled component primitives—AND the feature benefits from fidelity before implementation → `mockup`
- Treat a system as usable only when the prototype can reproduce the relevant shipped pattern faithfully and offline. Reuse observed tokens and component treatment; never invent missing tokens or infer a design system from an unused config file.
- If no usable system exists, or reproducing it would be guesswork → `wireframe`
- User can override to `sketch` for early-grooming structural exploration

---

## 3. Screen wrapper

Every screen — regardless of fidelity — uses the same wrapper component:

```html
<section class="screen" data-screen="{id}" data-state="{state}">
  <header class="screen-meta">
    <span class="screen-label">{Human label}</span>
    <span class="screen-state" data-state="{state}">{state}</span>
  </header>
  <div class="screen-canvas">
    <!-- screen content -->
  </div>
</section>
```

Provided by `wireframe-base.css`. No per-file CSS resets, no heavy bordered cards, no inline `style="border: 2px solid #ccc"`. The `.screen-canvas` is the only chrome — a thin neutral border that frames the content.

**Multiple states for a single screen** (e.g., gallery populated + empty) are sibling `<section>` blocks, separated by spacing only (the CSS handles the rule).

---

## 4. State coverage

For any wireframe with dynamic content, the file MUST include separate screen blocks for the applicable states:

- `populated` — required, always
- `empty` — required if the feature has a "no data yet" path (gallery, list, search)
- `loading` — required if async (fetches data, runs a process)
- `error` — required if user-actionable (form submission, network call)

Static or one-shot UI (e.g., a settings layout that only ever shows configuration) can declare `populated`-only.

State coverage is checked by the `@designer` reviewer in Step 7. Missing states are blocking unless metadata declares `"states_only": ["populated"]` with a brief justification.

---

## 5. App chrome rule

Wireframes normally focus on page or component content. Include the existing navigation, page header, tabs or breadcrumb context when it is needed to judge how the feature is discovered, where the user is, or how they return. A normal feature can need this context even when it does not redesign the app chrome. Show the relevant surrounding frame faithfully; do not invent a new shell or reproduce unrelated navigation.

Mark `"includes_chrome": true` in the existing metadata whenever chrome is shown, whether it is the feature or necessary journey context. Explain that purpose in the proposal's design rationale. Content-only views remain useful for states and controls, but cannot by themselves establish discovery, orientation or return quality.

---

## 6. Metadata

Every wireframe carries metadata. **Single-file**: embedded as `<script type="application/json" id="wireframe-meta">` in `<head>`. **Multi-file**: standalone `meta.json` in the wireframe subfolder.

### Schema

```json
{
  "slug": "string",
  "fidelity": "sketch | wireframe | mockup",
  "screens": [
    {
      "id": "string (kebab-case)",
      "label": "string (human-readable)",
      "file": "string (only for multi-file: relative path to screen HTML)",
      "states": ["populated", "empty", "loading", "error"]
    }
  ],
  "viewport": "desktop | mobile | responsive",
  "includes_chrome": true | false,
  "design_system_source": "tailwind-config | css-tokens | component-primitives | fallback | none",
  "created": "YYYY-MM-DD",
  "updated": "YYYY-MM-DD"
}
```

### Field semantics

- `slug` — matches the proposal slug (e.g., `dashboard-proposal-hero`)
- `fidelity` — selected by Step 5 per §2 rules
- `screens[].id` — kebab-case, used as `data-screen` attribute
- `screens[].states` — list of states actually rendered in the wireframe (not the states the feature could theoretically have)
- `screens[].file` — only set for multi-file wireframes; relative to the wireframe folder
- `viewport` — `responsive` only when the wireframe demonstrates layout adaptation across breakpoints
- `includes_chrome` — `true` when the wireframe legitimately shows app-level nav (per §5)
- `design_system_source`:
  - `tailwind-config` — Tailwind config detected and used (mockup tier)
  - `css-tokens` — CSS variables, token file, or theme source detected and used (mockup tier)
  - `component-primitives` — existing styled components are the usable visual source when no separate token file exists (mockup tier)
  - `fallback` — design system not found; using `wireframe-base.css` primitives (wireframe tier)
  - `none` — sketch tier, no styling system

### Read by Step 6

When generating the proposal HTML, Step 6 reads the wireframe metadata to auto-populate the "Screens" caption under the hero prototype. The caption format is:

> Screens — {label1} · {label2} · {label3}

If metadata is missing, Step 6 falls back to a generic "View prototype" caption with no screens listed.

---

## 7. Annotations (callouts)

Sketch and wireframe tiers MAY include numbered callouts. Mockup tier MUST NOT — the design speaks for itself.

### Pattern

```html
<div class="screen-canvas">
  <button class="wf-button">Save</button>
  <span class="callout" data-num="1" style="top: 1rem; right: 1rem;"></span>
</div>
<ol class="callout-notes">
  <li>Persists draft to localStorage every 5 seconds while typing</li>
</ol>
```

The `<ol class="callout-notes">` sits outside the canvas, below it. CSS auto-numbers the list to match the `data-num` attribute on each callout.

### Rules

- Numbered circles only (no shapes, no colors per item, no arrows)
- Notes go in the ordered list below the canvas — NEVER as floating text inside the canvas
- Max 6 callouts per screen — more is a sign the screen needs splitting or the design is unclear
- Position callouts via inline `style` (`top` / `left` / `right` / `bottom`) — they are absolutely positioned within `.screen-canvas`

---

## 8. Referencing from the proposal

Prototype certification supports at most 128 files and 512 total directory entries. Empty directories count toward the entry limit. The conservative markup scanner rejects namespace-prefixed XML elements and any HTML `template` encountered after SVG or MathML content; put static HTML templates before foreign content or remove them. These restrictions avoid relying on browser namespace recovery to establish a complete dependency inventory.

The proposal HTML is an inert, self-contained artifact. It never frames or executes a prototype. Instead, show a metadata-derived preview card between the title block and TL;DR and link to the standalone prototype:

The canonical proposal JSON also records the prototype in `design_context.prototype`, or explicit `null` when no prototype was approved. Generate the value after final refinement with `node ${CLAUDE_PLUGIN_ROOT}/scripts/prototype-identity.js --repo-root {artifact_repo_root} --path {project-relative-entry-path} --json`.

- Single-file identity is `{ "path", "sha256" }` and binds that complete artifact. It must be self-contained: inline CSS and media, keep navigation fragment-local, and do not load a local or remote stylesheet, script, frame, or media resource. If the prototype needs supporting files, use the `index.html` bundle form instead.
- Multi-file identity adds `manifest: { schema_version: 1, files: [{ path, sha256 }], tree_sha256 }`. Paths are relative to the prototype directory and sorted. The bounded manifest covers the entire directory tree, including `index.html`, `meta.json`, `base.css`, every screen HTML file, and supporting assets. Every active HTML, SVG, and CSS resource reference must be local, normalized, resolve inside that directory, and name a manifest entry. Remote/root-absolute resources, missing targets, active scripts, inline event handlers, `srcdoc`, `srcset`, refresh/base directives, and unsupported active `.htm`/`.xhtml` files are rejected because their rendered dependencies cannot be completely certified.

Groom recomputes the binding both when recording human approval and when creating its approval audit; RFC and Dev recheck it during downstream intake and resume. A changed, added, removed, missing, symlinked, oversized, or out-of-bounds file blocks the transition. A legacy multi-file binding that hashes only `index.html` remains inspection-readable but must be recertified in Groom before a current RFC/Dev handoff.

```html
<figure class="hero-prototype">
  <div class="hero-prototype-header">
    <span class="hero-prototype-label">Prototype</span>
    <span class="hero-prototype-fig">fig. 1 — {fidelity} wireframe</span>
  </div>
  <div class="hero-prototype-frame-wrap hero-prototype-preview"
       role="img" aria-label="{fidelity} prototype: {screen names}">
    Prototype preview is stored as a separate local artifact ({N} screens).
  </div>
  <figcaption class="hero-prototype-footer">
    <span class="hero-prototype-screens">
      <span class="hero-prototype-screens-label">Screens</span>
      {auto-populated from metadata: label1 · label2 · label3}
    </span>
    <a class="hero-prototype-link"
       href="../wireframes/{slug}.html"
       target="_blank" rel="noopener">Open full prototype</a>
  </figcaption>
  <p class="hero-prototype-note">{fidelity-specific note}</p>
</figure>
```

**Source path:**
- Single-file: `../wireframes/{slug}.html`
- Multi-file: `../wireframes/{slug}/index.html`

**Fidelity-specific note** (the small paragraph below the figure):
- `sketch` → "Sketch — structural exploration. Layout and component shapes are intentional; visuals are deferred."
- `wireframe` → "Lo-fi by intent — fidelity comes during implementation when real components are wired in."
- `mockup` → "High-fidelity mockup using the project's actual design system. Visual review now reduces design back-and-forth in implementation."

**Always one inert preview.** Multi-file wireframes are accessed through their `index.html`, which decides how to render screens. The proposal renderer may list screen names from metadata but never copies, frames, or executes prototype markup.

---

## 9. Quality checklist

Before marking a wireframe done in Step 5:

- [ ] File at the correct path per §1 (single-file at `{slug}.html`, or subfolder at `{slug}/`)
- [ ] Fidelity tier set in metadata, matches the visual treatment
- [ ] `wireframe-base.css` inlined (or for mockup tier, project tokens applied)
- [ ] Every screen uses `<section class="screen">` wrapper — no inline-styled snowflakes
- [ ] State coverage per §4 (or `states_only` declared with reason)
- [ ] No app chrome (or `includes_chrome: true` declared per §5)
- [ ] Metadata complete and valid per §6 schema
- [ ] Callouts (if any) use the standard pattern per §7 — no floating text inside canvas
- [ ] Opens cleanly when previewed standalone from the proposal link
- [ ] Canonical proposal `design_context.prototype` matches the current single-file bytes or complete multi-file tree, or is explicitly `null` when no prototype was approved
- [ ] Every multi-file HTML/SVG/CSS dependency is local, resolves inside the bundle, and appears in the manifest; no unsupported active markup or executable dependency remains
