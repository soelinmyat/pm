# RFC Generation Contract

## Goal

Give an RFC writer the minimum complete contract for generating one artifact pair without granting review, approval, tracker, loop, or implementation authority.

## Execution packet

Build the packet with `scripts/rfc-prompt.js`. It contains exactly:

- objective and confirmed acceptance criteria;
- active phase (`generation`);
- source/artifact repository paths and branch;
- proposal or dev-ready Linear input path/data;
- relevant codebase findings and project instructions;
- HTML/sidecar artifact contract;
- explicit constraints and non-goals;
- local authority (`external_effects: false`);
- required artifact-validation evidence;
- `rfc-phase-result-v1` result contract.

Do not include review, approval, Linear, loop, or implementation procedures. Do not repeat model/provider coaching.

## Artifact contract

Follow `writing-rfcs.md` as the canonical document and sidecar contract. Preserve:

- `data-schema-version="3"`, exactly one `script#rfc-lifecycle` JSON marker, and `data-sidecar-hash`;
- `id="brief"`, `id="execution-contract"`, `id="appendix"`, and `id="test-strategy"`;
- `.issue-detail`, `.issue-detail-num`, `.issue-detail-title`, `.issue-detail-size`;
- `.test-strategy`, `.test-strategy-block`, and `.hooks-badge`.

The paired JSON sidecar uses schema version 3 for identity, the intake-bound closed `design_context`, executable issue work units (`depends_on`, `owns`, acceptance criteria, approach, verification commands, and test hooks), and the five test-strategy fields. Schema v2 remains readable as a legacy, non-executable compatibility shape; it must be recertified through intake before generation, approval, or Dev handoff. `scripts/rfc-sidecar-check.js --current-handoff` is the executable schema/context/hash/slug gate.

## Human reader

Apply the readable-artifact rules in `references/writing.md` and the presentation section of `references/templates/rfc-template.md`. Follow the reference's nested navigation and H2/H3 hierarchy. Keep full contract and parser content in the HTML even inside native disclosures. Material risks and pending decisions remain visible in the brief; supporting rationale belongs once in technical detail. Never use a prose budget to omit execution fields or test strategy.

## Worker result

Return one strict phase-result envelope. A passed generation result includes:

```json
{
  "artifact": {
    "html_path": "/absolute/path/rfc.html",
    "json_path": "/absolute/path/rfc.json",
    "html_hash": "sha256:...",
    "sidecar_hash": "sha256:...",
    "repo_root": "/absolute/path/to/artifact/repo",
    "commit": "..."
  },
  "evidence": [
    {
      "kind": "artifact",
      "command": "node scripts/rfc-sidecar-check.js ...",
      "exit_code": 0,
      "artifact": "/absolute/path/rfc.html"
    }
  ]
}
```

The root verifies and records the result. Workers do not claim approval or perform downstream effects.
