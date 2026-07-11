# PM HTML Foundation

Use this vocabulary across proposal, RFC, and report HTML. Workflows may choose distinct visual directions; shared names describe semantics and behavior, not one mandatory theme.

## Foundation tokens

Every artifact defines local CSS custom properties for the following semantics. Names may stay workflow-specific (`--serif` in proposals, `--font` in RFCs); the canonical names below describe the role:

- type: `--font-body`, `--font-ui`, `--font-mono` using system font stacks;
- surfaces: `--color-canvas`, `--color-surface`, `--color-inset`;
- text: `--color-text`, `--color-muted`, `--color-faint`;
- rules and focus: `--color-rule`, `--color-accent`, `--focus-ring`;
- semantic states: positive, warning, negative, and informational foreground/background pairs;
- measure: readable prose width and wide content width;
- spacing: a bounded 4/8-based scale;
- shape: small, medium, large, and pill radii.

Do not depend on a font name unless that font is embedded inside the artifact budget. Prefer platform UI, Georgia/Times, and SF Mono/Menlo/Consolas fallbacks.

## Semantic components

| Component | Required behavior |
|---|---|
| Lifecycle status | Visible text plus optional icon; never color alone |
| Decision brief | Recommendation, largest risk, and decision needed in the first screenful |
| Evidence item | Source label, provenance path, and claim kept together |
| Risk item | Risk, impact, mitigation, and owner/status when known |
| Issue card | Outcome, acceptance criteria, ownership, dependencies, and verification |
| Test block | Test level, regression surface, and exact verification command |
| Diagram | Inline SVG with accessible name, or a labeled `pre.diagram-text` fallback |
| Navigation | Labeled landmark, stable anchors, horizontal overflow on narrow screens |

## Baseline behavior

- `.skip-link` remains off-canvas until keyboard focus.
- `:focus-visible` has a high-contrast outline independent of theme colors.
- tables sit in an overflow container or reflow below the narrow breakpoint.
- code and diagram fallbacks preserve whitespace and scroll horizontally instead of widening the page.
- sticky navigation becomes static or hidden in print.
- cards, tables, and issue units avoid page breaks where practical.
- reduced-motion mode disables transitions and smooth scrolling.

Reference templates are executable examples. Copy their semantic structure, then adapt visual tokens to the artifact’s purpose.
