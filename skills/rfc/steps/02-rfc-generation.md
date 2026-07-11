---
name: RFC Generation
order: 2
description: Generate and validate a layered RFC plus its machine-readable sidecar
phase: generation
requires:
  - ../references/writing-rfcs.md
  - ../references/generation-contract.md
  - ../../dev/references/splitting-patterns.md
  - ../../dev/test-layers.md
  - ../../../references/templates/rfc-template.md
result_schema: rfc-phase-result-v1
---

## Goal

Produce one validated, commit-linked RFC HTML/JSON artifact pair whose execution contract is ready for independent technical review.

## How

1. Read the canonical session and only the input paths saved during intake. Follow `writing-rfcs.md` and `generation-contract.md`; the former owns document quality and stable artifact rules, while the latter owns execution packet and result requirements.
2. Map relevant code before choosing architecture. Cite exact files and commands. Do not invent product decisions missing from the proposal; preserve them as explicit open questions.
3. Decompose work into independently testable issues with dependencies, owned files, AC traces, and Test hooks. Use raw sub-issue design/spec review only when existing proposal detail is insufficient; do not spawn one worker per trivial issue.
4. Build the current-phase packet with `scripts/rfc-prompt.js`. Runtime/model configuration comes from `references/model-profiles.json`, not prompt coaching. Run inline for a cohesive RFC; delegate one bounded writer only when isolation materially helps.
5. Enforce the **Layered artifact requirements** and **Stable HTML contract** and generate the HTML: Decision Brief, Execution Contract, Appendix, architecture/decisions/risks, complete Test Strategy, issue cards, resolved questions, and change log. Preserve `id="execution-contract"` and all other stable anchors/classes.
6. Generate the schema-v2 JSON sidecar from the same facts. Compute its SHA-256 and bind it to the HTML with `data-sidecar-hash`.
7. Run `scripts/rfc-sidecar-check.js` with sidecar, HTML, and slug. Cross-check HTML issue-card count against sidecar `issues.length`. Fix at most two bounded validation failures; otherwise record a blocker with validator output.
8. Root verifies the artifact repository and commits HTML/JSON together. The writer cannot update proposal lifecycle, approve the RFC, create tracker issues, or start implementation.
9. Record a generation result containing the exact artifact identity (`html_path`, `json_path`, `sidecar_hash`, `repo_root`, `commit`) and passing `artifact` evidence.
10. When `PM_LOOP_WORKER=1`, write only beneath `PM_LOOP_RESULT_DIR`; skip normal PM/backlog writes and return the bounded document through `PM_LOOP_RESULT_FILE` after review.

## Done-when

- The HTML and sidecar exist, agree, and pass schema/hash/slug/count validation.
- Decision Brief and Execution Contract satisfy their budgets and required content.
- Every issue has size, dependencies, ACs, files, test hooks, and verification commands.
- The artifact pair is committed together and its identity is recorded by the runner.

**Advance:** proceed to Step 03 (RFC Review).
