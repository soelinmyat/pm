# Wave 1 — Shared Artifact Foundation

**Status:** Complete  
**Consumers:** `pm:groom`, `pm:rfc`, later HTML reports and artifact critique

## Outcome

PM HTML outputs share one executable contract for identity, provenance, lifecycle, safety, accessibility, navigation, responsive behavior, print behavior, offline portability, and size budgets. Proposal and RFC content remain distinct; their common document mechanics stop drifting.

## Delivery slices

1. **Contract and validator** — publish metadata schema, authoring guidance, deterministic HTML checks, and a hash-bound manifest.
2. **Reference migration** — remove network dependencies, add shared metadata/skip navigation/print behavior, and preserve proposal/RFC parser hooks.
3. **Workflow adoption** — make Groom and RFC run the validator before presentation, approval, or handoff.
4. **Rendered QA** — add viewport, print, accessibility, and offline fixtures that later power artifact critique.

## Non-goals

- Do not force proposal and RFC artifacts into the same visual style.
- Do not add a runtime framework or client-side application shell.
- Do not make model judgment authoritative for deterministic artifact properties.
- Do not redesign product UI critique in this slice; artifact critique is Wave 3.

## Exit criteria

- Proposal and RFC references pass the shared validator in template mode.
- Generated artifacts are self-contained and usable without a network.
- Artifact identity and provenance are machine-readable and schema-valid.
- Duplicate anchors, broken internal links, active scripts, unsafe handlers, missing accessibility primitives, missing print/responsive rules, and budget overruns fail closed.
- Groom and RFC instructions name the same validator and contract instead of restating policy.

## Completion evidence

- Shared contract, metadata schema, semantic foundation, deterministic scanner, render harness, and hash-bound manifests are implemented.
- Proposal and RFC references contain no network dependencies or active scripts and pass template-mode validation.
- RFC generation/approval runtime invokes the shared checker and keeps workflow, artifact, and visible lifecycle markers synchronized.
- Real Chrome matrices pass at 1440px, 768px, and the Chrome-CLI-supported 500px narrow viewport; full-document captures stay below the 16,000px render budget.
- Print verification produced valid 8-page proposal and 10-page RFC PDFs.
- Six-lens `pm:review` completed clean after remediation.
- Full repository suite: 1,503 tests, 1,502 passed, 0 failed, 1 intentional skip.
