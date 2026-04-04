---
type: backlog-issue
id: PM-012
title: "Pencil MCP Integration"
outcome: "PMs can optionally generate high-fidelity UI mockups in .pen files as part of grooming, when Pencil MCP is available"
status: idea
parent: null
children: []
labels:
  - "ideate"
  - "integration"
  - "output-quality"
priority: low
evidence_strength: moderate
scope_signal: small
strategic_fit: "Priority 2: Quality of groomed output"
competitor_gap: unique
dependencies:
  - "prd-grade-output"
created: 2026-03-13
updated: 2026-03-13
---

## Outcome

When Pencil MCP is configured, the groom skill can generate high-fidelity UI mockups in .pen files alongside the PRD-grade backlog document. The in-built wireframes provide the baseline; Pencil provides the upgrade for teams that want polished visual specs.

## Signal Sources

- `pm/competitors/matrix.md`: No competitor generates visual design artifacts as part of grooming.
- Pencil MCP is already connected in the current environment — tools are available.

## Competitor Context

No competitor in the PM tool space integrates with a design tool during grooming. This would be a unique capability.

## Dependencies

Requires "PRD-grade groomed output" (#5) first — the in-built wireframe system establishes the visual artifact pattern. Pencil integration extends it to high-fidelity.

## Open Questions

- Detection: auto-detect Pencil MCP availability, or require explicit config in `.pm/config.json`?
- Output: .pen file per backlog item, or one .pen file with multiple frames?
- Fallback: if Pencil MCP is unavailable, silently fall back to in-built wireframes — no error.
