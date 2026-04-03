### Phase 5: Design Exploration

Turn scope into fully formed designs through collaborative dialogue. This phase runs **after Scope Review** — the scope is locked, so design focuses on *how* to build what's been agreed, not *what* to build. Applies to UI features, new components, architectural decisions, or anything where the implementation shape isn't obvious from the scope alone.

**For UI features:** Mockups use the project's real design system (colors, typography, spacing, components) rendered as static HTML+Tailwind. This produces high-fidelity visuals identical to the running app, enabling meaningful design review during grooming — before any implementation begins.

**Skip this phase when:**
- The feature is well-understood from Phase 3 research (e.g., parity feature, clear implementation path)
- The scope is purely backend/infrastructure with no design decisions
- The user explicitly says "I know what I want, just scope it"

**Output formatting:** Follow `${CLAUDE_PLUGIN_ROOT}/references/writing.md`.

<HARD-GATE>
Do NOT proceed to Phase 5.5 (Groom / Issue Drafting) until the design is presented and the user has approved it.
For UI features: high-fidelity mockups MUST be reviewed before proceeding.
</HARD-GATE>

---

#### Product Context Discovery

Before asking generic discovery questions, load existing product context:

1. If `pm/strategy.md` exists, read it for ICP, value prop, positioning, priorities, and non-goals. Skip questions it already answers.
2. If CLAUDE.md exists, check for design principles, brand guidelines, user personas, and voice/tone.
3. If `DESIGN.md` exists, check for design system, colors, typography, aesthetic direction.

Start from whatever baseline you find. Only ask discovery questions for gaps.

---

#### Design System Discovery (UI features only)

Before generating any mockups, extract the project's design system so mockups match the real product:

1. **Tailwind config** — search for `tailwind.config.*` (js/ts/cjs/mjs). Extract:
   - Custom colors (brand palette, semantic colors)
   - Typography (font families, sizes, weights)
   - Spacing scale (if customized)
   - Border radii, shadows, breakpoints
   - Custom utilities or plugins

2. **CSS variables / design tokens** — search for token files (`tokens.ts`, `tokens.css`, `variables.css`, `theme.ts`). These often define the source-of-truth values that Tailwind config consumes.

3. **Component patterns** — scan existing UI components for recurring patterns:
   - Button variants (primary, secondary, ghost, destructive)
   - Card/panel styles
   - Form input styles
   - Navigation patterns
   - Layout conventions (max-width, sidebar width, header height)

4. **Build a design context object** — summarize what you found into a compact reference:
   ```
   DESIGN SYSTEM:
   - Colors: primary=#2563EB, secondary=#64748B, accent=#F59E0B, ...
   - Font: Inter (headings), system-ui (body)
   - Radius: rounded-lg (cards), rounded-md (buttons), rounded-sm (inputs)
   - Shadows: shadow-sm (cards), shadow-md (modals)
   - Spacing: compact (gap-2/gap-3 between elements, p-4/p-6 for containers)
   - Patterns: cards use border + shadow-sm, buttons use font-medium ...
   ```

Use this context for ALL subsequent mockups. If no design system is found, fall back to the generic wireframe classes.

---

#### Existing Page Capture (additions to existing UI only)

When the feature adds to or modifies an existing page — not a brand new page — capture the current state before generating mockups. This ensures the mockup matches the real UI exactly, not just the design tokens.

**Skip this when:** the feature is a new page/screen with no existing UI to match.

**Steps:**

1. **Find the target page** — grep the codebase for route definitions to locate the page the feature will live on. Framework examples:
   - React Router: `grep -r "path.*settings" src/routes/`
   - Next.js: `ls app/settings/` or `ls pages/settings/`
   - Rails: `grep "settings" config/routes.rb`
   - Expo Router: `ls app/(tabs)/settings/`

2. **Read the page's component code** — read the target component/view file to understand:
   - Exact Tailwind classes and structure used
   - Layout patterns (sidebar? tabs? stacked sections?)
   - Existing components referenced (imports)
   - Where the new feature would logically fit

3. **Screenshot the live page** — start the app and capture the current state:
   - Use Playwright CLI (web) or Maestro MCP (mobile) per `${CLAUDE_PLUGIN_ROOT}/skills/design-critique/references/capture-guide.md`
   - Capture at desktop width (1440px) minimum
   - If the app is already running, skip server startup
   - Save to `/tmp/groom-baseline/{feature}/` for reference

4. **Use both as mockup inputs** — the screenshot provides the visual target, the component code provides the exact implementation patterns. When generating the mockup:
   - Replicate the existing page structure in the mockup HTML
   - Add the new feature in its intended location
   - Use the same class patterns found in the component code
   - Show the full page context, not just the new element in isolation

5. **Present as before/after** — show the user both views using the visual companion's split layout:
   - **Before:** the real screenshot of the current page
   - **After:** the high-fidelity mockup with the new feature integrated

---

#### Flow

1. **Offer visual companion** (if topic involves visual questions) — this is its own message, not combined with other content.

   > "Some of what we're working on might be easier to explain visually. Want me to show high-fidelity mockups using your project's design system in the browser? (Token-intensive)"

   Wait for response. If declined, proceed text-only. If accepted, read the visual companion guide: `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/visual-companion.md`

2. **Ask clarifying questions** — one at a time, understand purpose/constraints/success criteria.
   - Prefer multiple choice when possible
   - Assess scope first: if the request covers multiple independent subsystems, flag it for decomposition before refining details

3. **Propose 2-3 approaches** — with trade-offs and your recommendation. Lead with the recommended option.

4. **Present design** — in sections scaled to complexity. Ask after each section whether it looks right.
   - Cover: architecture, components, data flow, error handling, testing
   - Design for isolation: smaller units with clear boundaries and interfaces
   - In existing codebases: follow existing patterns, include targeted improvements where they serve the feature
   - **For UI features:** show high-fidelity mockups using the design system context (see "High-Fidelity Mockups" below)

5. **Design review** (UI features only) — before writing the spec, review the approved mockups:
   - **Visual consistency:** Do mockups use the correct design tokens? Any color/font/spacing mismatches vs the real product?
   - **Component reuse:** Are we using existing component patterns or introducing new ones unnecessarily?
   - **Responsive considerations:** Does the layout work at the project's key breakpoints?
   - **State coverage:** Are all visual states represented (empty, loading, error, populated, edge cases)?
   - **Accessibility basics:** Sufficient contrast, clear hierarchy, readable text sizes?

   Present findings to the user. Fix mockups if needed before proceeding.

6. **Write design doc** — save to `docs/specs/YYYY-MM-DD-<topic>-design.md` and commit.
   - Follow `${CLAUDE_PLUGIN_ROOT}/references/writing.md` for prose quality
   - For UI features: include the final mockup screenshots or reference the mockup HTML files

7. **Spec review loop** — follow the review gate pattern in `${CLAUDE_PLUGIN_ROOT}/references/review-gate.md`:
   - Dispatch spec-document-reviewer (see `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/spec-document-reviewer-prompt.md`)
   - Fix and re-dispatch until approved (max 3 iterations)

8. **User reviews spec** — ask user to review the written spec before proceeding:
   > "Spec written to `<path>`. Review it and let me know of any changes before we proceed to scoping."

9. **Proceed to Phase 5.5 (Groom / Issue Drafting)** — with the design doc as the shared understanding of what's being built.

---

#### High-Fidelity Mockups

When the visual companion is active and a design system was discovered, generate mockups using the real design tokens instead of generic wireframe classes.

**Rendering approach:** Static HTML + Tailwind CDN with the project's custom theme values. This produces visuals identical to the running app without needing React, build tools, or a running server.

**Template structure for high-fidelity mockups:**
```html
<!-- Write as a full document (starts with <!DOCTYPE) so the frame template doesn't wrap it -->
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          // Paste the project's custom theme values here
          colors: { primary: '#2563EB', /* ... */ },
          fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
          // ...
        }
      }
    }
  </script>
  <!-- Import project's actual fonts if known -->
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
</head>
<body class="bg-white text-gray-900 font-sans">
  <!-- Mockup content using project's Tailwind classes -->
</body>
</html>
```

**Rules:**
- Use the project's actual Tailwind class patterns, not generic `.mock-*` classes
- Match the project's component conventions (button styles, card patterns, spacing density)
- Include realistic content — real labels, plausible data, proper copy
- Show all relevant states (empty, populated, error) as separate mockups or tabs
- Keep mockups focused — one screen/component per file, not the entire app

**When no design system is found:** Fall back to the generic visual companion wireframe classes. Note to the user: "No design system detected — showing wireframe mockups. These will be refined during implementation."

---

#### Key Principles

- **One question at a time** — don't overwhelm
- **YAGNI ruthlessly** — remove unnecessary features from designs
- **Explore alternatives** — always propose 2-3 approaches before settling
- **Incremental validation** — present design, get approval before moving on
- **High fidelity when possible** — use the real design system so design review is meaningful

#### Visual Companion

A browser-based tool for showing mockups, diagrams, and visual options during design exploration.

**Per-question decision:** Even after the user accepts, decide FOR EACH QUESTION whether to use the browser or the terminal. The test: **would the user understand this better by seeing it than reading it?**

- **Use the browser** for: mockups, wireframes, layout comparisons, architecture diagrams, side-by-side visual designs
- **Use the terminal** for: requirements questions, conceptual choices, tradeoff lists, scope decisions

A question *about* a UI topic is not automatically a visual question. "What does personality mean?" is conceptual — terminal. "Which wizard layout works better?" is visual — browser.
