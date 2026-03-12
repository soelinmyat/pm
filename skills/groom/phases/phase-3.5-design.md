### Phase 3.5: Design Exploration (optional)

Turn ideas into fully formed designs through collaborative dialogue. This phase runs when the feature needs design work — UI features, new components, architectural decisions, or anything where "what are we building?" isn't obvious from the scope alone.

**Skip this phase when:**
- The feature is well-understood from Phase 3 research (e.g., parity feature, clear implementation path)
- The scope is purely backend/infrastructure with no design decisions
- The user explicitly says "I know what I want, just scope it"

**Output formatting:** Follow `${CLAUDE_PLUGIN_ROOT}/references/writing.md`.

<HARD-GATE>
Do NOT proceed to Phase 4 (Scope) until the design is presented and the user has approved it.
</HARD-GATE>

---

#### Product Context Discovery

Before asking generic discovery questions, load existing product context:

1. If `pm/strategy.md` exists, read it for ICP, value prop, positioning, priorities, and non-goals. Skip questions it already answers.
2. If CLAUDE.md exists, check for design principles, brand guidelines, user personas, and voice/tone.
3. If `DESIGN.md` exists, check for design system, colors, typography, aesthetic direction.

Start from whatever baseline you find. Only ask discovery questions for gaps.

---

#### Flow

1. **Offer visual companion** (if topic involves visual questions) — this is its own message, not combined with other content.

   > "Some of what we're working on might be easier to explain visually. Want me to show mockups and diagrams in your browser? (Token-intensive)"

   Wait for response. If declined, proceed text-only. If accepted, read the visual companion guide: `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/visual-companion.md`

2. **Ask clarifying questions** — one at a time, understand purpose/constraints/success criteria.
   - Prefer multiple choice when possible
   - Assess scope first: if the request covers multiple independent subsystems, flag it for decomposition before refining details

3. **Propose 2-3 approaches** — with trade-offs and your recommendation. Lead with the recommended option.

4. **Present design** — in sections scaled to complexity. Ask after each section whether it looks right.
   - Cover: architecture, components, data flow, error handling, testing
   - Design for isolation: smaller units with clear boundaries and interfaces
   - In existing codebases: follow existing patterns, include targeted improvements where they serve the feature

5. **Write design doc** — save to `docs/specs/YYYY-MM-DD-<topic>-design.md` and commit.
   - Follow `${CLAUDE_PLUGIN_ROOT}/references/writing.md` for prose quality

6. **Spec review loop** — follow the review gate pattern in `${CLAUDE_PLUGIN_ROOT}/references/review-gate.md`:
   - Dispatch spec-document-reviewer (see `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/spec-document-reviewer-prompt.md`)
   - Fix and re-dispatch until approved (max 3 iterations)

7. **User reviews spec** — ask user to review the written spec before proceeding:
   > "Spec written to `<path>`. Review it and let me know of any changes before we proceed to scoping."

8. **Proceed to Phase 4 (Scope)** — with the design doc as the shared understanding of what's being built.

---

#### Key Principles

- **One question at a time** — don't overwhelm
- **YAGNI ruthlessly** — remove unnecessary features from designs
- **Explore alternatives** — always propose 2-3 approaches before settling
- **Incremental validation** — present design, get approval before moving on

#### Visual Companion

A browser-based tool for showing mockups, diagrams, and visual options during design exploration.

**Per-question decision:** Even after the user accepts, decide FOR EACH QUESTION whether to use the browser or the terminal. The test: **would the user understand this better by seeing it than reading it?**

- **Use the browser** for: mockups, wireframes, layout comparisons, architecture diagrams, side-by-side visual designs
- **Use the terminal** for: requirements questions, conceptual choices, tradeoff lists, scope decisions

A question *about* a UI topic is not automatically a visual question. "What does personality mean?" is conceptual — terminal. "Which wizard layout works better?" is visual — browser.
