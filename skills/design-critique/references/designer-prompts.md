# Designer Agent Prompts

Three parallel designer agents, each with a distinct focus. All agents review the same screenshots but evaluate different dimensions.

## Consolidated Scoring

### Grade Definitions
- **A:** Intentional, polished, delightful. Every detail serves a purpose.
- **B:** Solid, professional. Minor opportunities for improvement.
- **C:** Functional but generic. Works but doesn't impress.
- **D:** Noticeable problems. Users will struggle or lose trust.
- **F:** Actively hurting UX. Blocks users or damages credibility.

### Grade Computation
Each category starts at A. High-impact findings deduct 1 letter. Medium-impact deduct 0.5 letter.

### Design Score (weighted average)
| Category | Weight | Owner |
|----------|--------|-------|
| Visual Hierarchy | 15% | Designer A |
| Typography | 15% | Designer C |
| Spacing & Layout | 15% | Designer C |
| Color | 10% | Designer C |
| Interaction States | 10% | Designer B |
| Responsive | 10% | Designer B |
| Content & Microcopy | 10% | Designer A |
| Motion | 5% | Designer C |
| Performance | 5% | Designer B |
| AI Slop | 5% | Designer A |

### AI Slop Score (standalone)
Graded separately by Designer A. Pass/Fail based on 10 anti-patterns.

### Confidence Tiers
Every finding MUST be tagged:
- `[HIGH]` -- Provable via code grep (wrong token, missing aria-label, font-size < 16px, hardcoded color)
- `[MEDIUM]` -- Heuristic aggregation (inconsistent spacing pattern, missing hover states across multiple elements)
- `[LOW]` -- Visual judgment (hierarchy feels unclear, emotional tone seems off)

---

## Designer A: UX Quality + Content

**Agent:** `subagent_type: "pm:design-director"`

Dispatch with this context:

```
Review these screenshots for UX quality and content.

**Screenshots:** Read all images from /tmp/design-review/{feature}/
**Manifest:** Read /tmp/design-review/{feature}/manifest.md
**Design principles:** Read CLAUDE.md from the project root
{IF PM brief available} **PM brief:** {insert PM brief}
{IF verify mode} **Previous findings:** {insert previous round findings for comparison}

Use the consolidated scoring section from designer-prompts.md for grade definitions and confidence tiers.
```

---

## Designer B: Resilience + Accessibility

**Agent:** `subagent_type: "pm:qa-lead"`

Dispatch with this context:

```
Review these screenshots for resilience and accessibility.

**Screenshots:** Read all images from /tmp/design-review/{feature}/
**Manifest:** Read /tmp/design-review/{feature}/manifest.md
**Accessibility snapshots:** Read all a11y-snapshot-*.md files from /tmp/design-review/{feature}/. These contain the real accessibility tree (element roles, accessible names, ARIA attributes, tab order). Use these for concrete [HIGH] confidence findings instead of guessing from screenshots.
**Design principles:** Read CLAUDE.md from the project root
{IF PM brief available} **PM brief:** {insert PM brief}
{IF verify mode} **Previous findings:** {insert previous round findings for comparison}

Use the consolidated scoring section from designer-prompts.md for grade definitions and confidence tiers.

IMPORTANT: With accessibility snapshots available, your WCAG findings should be [HIGH] confidence (provable from the tree data), not [LOW] visual guesses. Missing aria-labels, broken heading hierarchy, missing landmarks, elements without accessible names -- these are all visible in the snapshot.
```

---

## Designer C: Design System + Visual Polish

**Agent:** `subagent_type: "pm:design-system-lead"`

Dispatch with this context:

```
Review these screenshots for design system compliance and visual polish.

**Screenshots:** Read all images from /tmp/design-review/{feature}/
**Manifest:** Read /tmp/design-review/{feature}/manifest.md
**DOM measurement audit:** Read all dom-audit-*.md files from /tmp/design-review/{feature}/. These contain actual computed styles (font-size, padding, gap, color, border-radius, shadow) measured from the DOM and compared against the project's design tokens. Use these for [HIGH] confidence token compliance findings.
**Pattern inventory:** Read /tmp/design-review/{feature}/pattern-inventory.md if it exists. This lists repeated component patterns (drawers, modals, cards, etc.) with their computed styles side by side. Flag inconsistencies as pattern fragmentation.
**Design principles:** Read CLAUDE.md from the project root
{IF PM brief available} **PM brief:** {insert PM brief}
{IF verify mode} **Previous findings:** {insert previous round findings for comparison}

Use the consolidated scoring section from designer-prompts.md for grade definitions and confidence tiers.

IMPORTANT: With DOM measurement data available, your token compliance findings MUST be [HIGH] confidence backed by actual measurements. "font-size is 14px but token --text-base is 16px" is provable. Do not guess from screenshots when measurement data is available. Also read the source component files for the page under review to check for hardcoded values and component reuse.
```
