---
name: Design
order: 6
description: Design exploration and prototype generation — skip for backend/infra
applies_to: [standard, full]
---

### Step 6: Design Exploration

Turn scope into fully formed designs through collaborative dialogue. Runs **after Scope Review** — the scope is locked, so design focuses on *how* to build what's been agreed.

For UI features, this step produces a **prototype** (sketch / wireframe / mockup) saved to `{pm_dir}/backlog/wireframes/`. The proposal surfaces it as an offline-safe hero preview card and link (per Step 7); the interactive prototype remains a separate artifact.

**Skip this step when:**
- The scope is purely backend/infrastructure with no user-facing design decisions
- The feature is a parity/table-stakes feature with a clear implementation path from research

**Do NOT skip when:** the feature has any user-facing UI, configuration UX, CLI output, or developer-facing API surface. If in doubt, run it — design is fast for simple features.

**Output formatting:** Follow `${CLAUDE_PLUGIN_ROOT}/references/writing.md`.

<HARD-GATE>
When this step runs, do NOT proceed to Draft Proposal until the design is presented and the user has approved it.
For UI features: a prototype matching the spec at `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/prototype-format.md` MUST be reviewed before proceeding.
This gate only applies when the step is not skipped per the rules above.
</HARD-GATE>

This step is structured into four sub-steps: **6a** (Discovery & approach) → **6b** (Prototype generation) → **6c** (Design review) → **6d** (Approval gate).

---

#### 6a · Discovery & approach

##### Product Context Discovery

Before asking generic discovery questions, load existing product context:

1. Read `strategy_check.context` from session state for ICP, positioning, priorities, and non-goals. Do NOT re-read `strategy.md` — Step 2 already extracted this.
2. If `CLAUDE.md` exists, check for design principles, brand guidelines, user personas, and voice/tone.
3. If `.impeccable.md` exists at the project root, read its Design Context section. This is the canonical project design context (audience, brand personality, aesthetic direction, principles).
4. If `DESIGN.md` exists, check for design system, colors, typography, aesthetic direction.

Start from whatever baseline you find. Only ask discovery questions for gaps.

##### Design System Discovery (UI features only)

Before generating any prototype, extract the project's design system so mockups can match the real product when possible:

1. **Tailwind config** — search for `tailwind.config.*` (js/ts/cjs/mjs). Extract custom colors, typography, spacing scale, radii, shadows, plugins.
2. **CSS variables / design tokens** — search for token files (`tokens.ts`, `tokens.css`, `variables.css`, `theme.ts`).
3. **Component patterns** — scan existing UI components for button variants, card/panel styles, form input styles, navigation patterns, layout conventions.
4. **Build a design context object** — summarize findings into a compact reference (colors, fonts, radii, shadows, spacing, common patterns).

The result drives **fidelity tier selection** in 6b:
- Tailwind config + tokens both present → `mockup` tier available
- Tokens only, no Tailwind config → `mockup` tier with CSS variables
- Neither → `wireframe` tier (default) — uses `wireframe-base.css` primitives
- Very early scope where layout matters more than visuals → `sketch` tier (user opt-in)

##### Existing Page Capture (additions to existing UI only)

When the feature adds to or modifies an existing page — not a brand new page — capture the current state before generating mockups.

**Skip this when:** the feature is a new page/screen with no existing UI to match.

**Steps:**

1. **Find the target page** — grep the codebase for route definitions:
   - React Router: `grep -r "path.*settings" src/routes/`
   - Next.js: `ls app/settings/` or `ls pages/settings/`
   - Rails: `grep "settings" config/routes.rb`
   - Expo Router: `ls app/(tabs)/settings/`

2. **Read the page's component code** to understand exact Tailwind classes, layout patterns, existing component imports, where the new feature would fit.

3. **Screenshot the live page** — use Playwright CLI (web) or Maestro MCP (mobile) per `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/design-critique-capture-guide.md`. Save to `/tmp/groom-baseline/{feature}/`.

4. **Use both as mockup inputs** — replicate existing structure, add the new feature in its intended location, use the same class patterns, show full page context.

5. **Present as before/after** — the real screenshot vs. the prototype with the new feature integrated.

##### Approach selection

1. **Ask clarifying questions** — one at a time. Prefer multiple choice. Assess scope first: if the request covers multiple independent subsystems, flag for decomposition.
2. **Propose 2-3 approaches** with trade-offs and your recommendation. Lead with the recommended option.
3. **Get user agreement on approach** before generating any prototype. Cheap to discuss, expensive to redo a wireframe.

---

#### 6b · Prototype generation

Read the full spec at `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/prototype-format.md` before generating.

##### Pick the fidelity tier

Per spec §2:
- `sketch` — structural / IA changes; visuals deferred. User opts in for early-grooming exploration.
- `wireframe` — default. Real text and proportions, generic CSS via `wireframe-base.css`.
- `mockup` — project has design tokens AND visual review matters before code.

Confirm tier with user:
> "Based on the design system found, I'll generate a `{tier}` prototype. Sound right? (Alternatives: `{other tiers}`.)"

##### Pick the file shape

Per spec §1:
- 1–2 screens → single file at `{pm_dir}/backlog/wireframes/{slug}.html`
- 3+ screens → subfolder at `{pm_dir}/backlog/wireframes/{slug}/` with `index.html` + per-screen files + `meta.json`

##### Determine state coverage

Per spec §4. For each screen, list which states must render:
- `populated` — always
- `empty` — required for any list, gallery, search, or "no data yet" path
- `loading` — required if async
- `error` — required if user-actionable

If any state legitimately doesn't apply, plan to record `"states_only": ["populated"]` in metadata with reason.

##### Generate the file(s)

1. Read `${CLAUDE_PLUGIN_ROOT}/references/templates/wireframe-base.html` (the starter template).
2. Read `${CLAUDE_PLUGIN_ROOT}/references/templates/wireframe-base.css` (the base CSS to inline).
3. Replace `{{TOKEN}}` placeholders:
   - `{{SLUG}}` — proposal slug
   - `{{FIDELITY}}` — selected tier
   - `{{WIREFRAME_BASE_CSS}}` — full contents of wireframe-base.css
   - `{{DATE}}` — today (YYYY-MM-DD)
   - `{{DESIGN_SYSTEM_SOURCE}}` — `tailwind-config | css-tokens | fallback | none`
4. For `mockup` tier: uncomment the `BEGIN:MOCKUP_HEAD ... END:MOCKUP_HEAD` block and fill in `{{PROJECT_THEME_TOKENS}}` and `{{PROJECT_FONTS}}`.
5. Add one `<section class="screen">` per (screen × state) combination. Use `.wf-*` primitives (defined in wireframe-base.css) for `wireframe` tier; project Tailwind classes for `mockup` tier.
6. Build the wireframe-meta JSON per spec §6 schema. Include all screens with their `states` arrays.
7. Write to the path determined above.

**Chrome rule (spec §5):** Show only page/component content. Include app-level nav ONLY when the feature *is* the chrome. When chrome is included, set `"includes_chrome": true` in metadata.

**Callouts (spec §7):** Allowed in `sketch` and `wireframe` tiers only. Numbered circles + ordered list of notes below the canvas. Never floating text inside the canvas. Never in `mockup` tier.

---

#### 6c · Design review

Run quality checks before showing the prototype to the user. The `@designer` reviewer in Step 8 will re-check at proposal-quality time, but catching issues here saves a round-trip.

**Visual consistency** — for `mockup` tier: do mockups use the correct design tokens? Any color/font/spacing mismatches vs the real product?

**Component reuse** — are existing component patterns being used, or are new ones being introduced unnecessarily?

**State coverage** — does the file render every state declared per §4? Are any required states missing?

**Metadata completeness** — does the wireframe-meta JSON validate against the §6 schema? Does `screens[].states` accurately reflect what's rendered?

**Spec compliance checklist** — run through `prototype-format.md` §9 quality checklist:
- [ ] File at the correct path
- [ ] Fidelity tier matches visual treatment
- [ ] `wireframe-base.css` inlined (or project tokens applied for mockup)
- [ ] Every screen uses `.screen` wrapper — no inline-style snowflakes
- [ ] State coverage met (or `states_only` declared with reason)
- [ ] No app chrome (or `includes_chrome: true` declared)
- [ ] Metadata complete and valid
- [ ] Callouts use the standard pattern (if used)
- [ ] Opens cleanly when previewed standalone

Fix issues silently before showing to user. The user reviews the *result*, not the diagnostic process.

---

#### 6d · Approval gate

Present the final design (prototype + flow) and ask:

> "Design looks ready. Approve to proceed to proposal drafting?"

Wait for explicit approval. Design outputs (the prototype file, the user flow) become part of the proposal — they are not written to a separate spec file.

If user requests changes:
- Visual / content tweaks → revise the wireframe and re-show
- Approach change (different layout, different component model) → return to 6a, propose alternatives, regenerate

---

#### Key Principles

- **One question at a time** — don't overwhelm
- **YAGNI ruthlessly** — remove unnecessary features from designs
- **Explore alternatives** — always propose 2-3 approaches before settling on one
- **Incremental validation** — present design, get approval before moving on
- **High fidelity when possible** — use the real design system so design review is meaningful

#### When to Open the Browser

Only open the browser when there's a specific artifact to show — not as a persistent companion.

- **Open for:** prototype files, architecture diagrams, side-by-side layout comparisons, flowcharts
- **Stay in terminal for:** requirements questions, conceptual choices, tradeoff lists, scope decisions

A question *about* a UI topic is not automatically a visual question. "What does personality mean?" is conceptual — terminal. "Which wizard layout works better?" — write the prototype HTML, then `open` it.
