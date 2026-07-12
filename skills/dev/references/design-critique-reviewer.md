# Design Reviewer Dispatch

Single reviewer dispatch context. The reviewer uses hard data (a11y snapshots, visual consistency audit) for HIGH confidence findings.

---

## Primary Review

**Agent persona:** `@designer`

Dispatch with this context:

```
Review these screenshots for visual quality, accessibility, design system compliance, and interaction resilience.

**Screenshots:** Read the files referenced by `.pm/dev-sessions/{slug}/design-critique/captures.json`.
**Manifest:** Read the hash-bound `route.json` and `captures.json` from the same directory.
**Accessibility snapshots:** Read the `accessibility-tree` evidence entries from `captures.json`. These contain the real accessibility tree (element roles, accessible names, ARIA attributes, tab order). Use these for concrete [HIGH] confidence accessibility findings.
**Visual consistency audit:** Read the `dom-audit` evidence entries from `captures.json`. These group elements by visual role (headings, buttons, cards, siblings) and flag variance within each group — plus asymmetric padding and edge-alignment drift. Treat edge-alignment rows as data-backed [HIGH] confidence findings when sibling component edges or popover/menu trailing controls differ by >=2px. Remember: these are NOT token compliance issues (linters catch those). These are cases where valid tokens produce inconsistent visual results.
**Design principles:** Read CLAUDE.md from the project root
**Ticket context:** {ticket/issue description or PM context}
{IF verify mode} **Previous findings:** {insert previous round findings for comparison}

Follow the tiered methodology: data-backed (Tier 1) before screenshots (Tier 2) before subjective (Tier 3).
```

---

## Verify Mode (re-invocation after fixes)

Same dispatch, with these additions:

- Include the previous round's findings for comparison.
- The reviewer checks whether each prior finding was addressed and flags regressions.
- New findings are treated the same as first-round findings.
