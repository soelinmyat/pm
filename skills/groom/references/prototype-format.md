# Prototype Format

How wireframes are created, named, and organized in the PM knowledge base. Used by `pm:groom` Step 6 (Design) to generate prototypes and by Step 7 (Draft Proposal) to embed them.

For shared base styles and the starter template, see:
- `${CLAUDE_PLUGIN_ROOT}/references/templates/wireframe-base.css`
- `${CLAUDE_PLUGIN_ROOT}/references/templates/wireframe-base.html`

> **Legacy.** Wireframes created before this spec (most files in `{pm_dir}/backlog/wireframes/` predating it) may use older patterns. Do not migrate them. Apply this spec to new wireframes only.

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
| `mockup` | Project has a Tailwind config + tokens AND the feature needs visual review before implementation | Uses the real design system; close to running app appearance |

**Auto-selection in Step 6:**
- If `tailwind.config.*` AND token files (`tokens.ts`, CSS variables, etc.) are detected → `mockup`
- Otherwise default → `wireframe`
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

State coverage is checked by the `@designer` reviewer in Step 8. Missing states are blocking unless metadata declares `"states_only": ["populated"]` with a brief justification.

---

## 5. App chrome rule

> Wireframes show only the page or component content. Do NOT include app-level navigation, sidebars, or page headers — UNLESS the feature *is* the chrome (nav restructure, sidebar redesign, header redesign).

When chrome IS the content, mark the wireframe `"includes_chrome": true` in metadata so reviewers don't flag it.

This refines the previous "no chrome" rule, which had an unstated exception when the change concerns navigation itself.

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
  "design_system_source": "tailwind-config | css-tokens | fallback | none",
  "created": "YYYY-MM-DD",
  "updated": "YYYY-MM-DD"
}
```

### Field semantics

- `slug` — matches the proposal slug (e.g., `dashboard-proposal-hero`)
- `fidelity` — selected by Step 6 per §2 rules
- `screens[].id` — kebab-case, used as `data-screen` attribute
- `screens[].states` — list of states actually rendered in the wireframe (not the states the feature could theoretically have)
- `screens[].file` — only set for multi-file wireframes; relative to the wireframe folder
- `viewport` — `responsive` only when the wireframe demonstrates layout adaptation across breakpoints
- `includes_chrome` — `true` when the wireframe legitimately shows app-level nav (per §5)
- `design_system_source`:
  - `tailwind-config` — Tailwind config detected and used (mockup tier)
  - `css-tokens` — CSS variables / token file detected (mockup tier)
  - `fallback` — design system not found; using `wireframe-base.css` primitives (wireframe tier)
  - `none` — sketch tier, no styling system

### Read by Step 7

When generating the proposal HTML, Step 7 reads the wireframe metadata to auto-populate the "Screens" caption under the hero prototype. The caption format is:

> Screens — {label1} · {label2} · {label3}

If metadata is missing, Step 7 falls back to a generic "View prototype" caption with no screens listed.

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

## 8. Embedding in the proposal

The proposal HTML embeds prototypes as a hero figure between the title block and TL;DR (when the feature has a UI prototype). Pattern:

```html
<figure class="hero-prototype">
  <div class="hero-prototype-header">
    <span class="hero-prototype-label">Prototype</span>
    <span class="hero-prototype-fig">fig. 1 — {fidelity} wireframe</span>
  </div>
  <div class="hero-prototype-frame-wrap">
    <iframe class="hero-prototype-frame"
            src="../wireframes/{slug}.html"  <!-- or {slug}/index.html -->
            title="{slug} — {N screens}"
            loading="lazy"></iframe>
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

**Iframe height** by fidelity:
- `sketch` → 560px
- `wireframe` → 720px
- `mockup` → 880px

**Fidelity-specific note** (the small paragraph below the figure):
- `sketch` → "Sketch — structural exploration. Layout and component shapes are intentional; visuals are deferred."
- `wireframe` → "Lo-fi by intent — fidelity comes during implementation when real components are wired in."
- `mockup` → "High-fidelity mockup using the project's actual design system. Visual review now reduces design back-and-forth in implementation."

**Always one iframe.** Multi-file wireframes are accessed through their `index.html`, which itself decides how to render screens (stacked, tabs, grid). The proposal renderer never enumerates screens itself.

---

## 9. Quality checklist

Before marking a wireframe done in Step 6:

- [ ] File at the correct path per §1 (single-file at `{slug}.html`, or subfolder at `{slug}/`)
- [ ] Fidelity tier set in metadata, matches the visual treatment
- [ ] `wireframe-base.css` inlined (or for mockup tier, project tokens applied)
- [ ] Every screen uses `<section class="screen">` wrapper — no inline-styled snowflakes
- [ ] State coverage per §4 (or `states_only` declared with reason)
- [ ] No app chrome (or `includes_chrome: true` declared per §5)
- [ ] Metadata complete and valid per §6 schema
- [ ] Callouts (if any) use the standard pattern per §7 — no floating text inside canvas
- [ ] Opens cleanly when previewed standalone (not just inside the proposal iframe)
