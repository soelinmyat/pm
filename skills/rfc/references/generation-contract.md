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

- `data-schema-version="2"` and `data-sidecar-hash`;
- `id="brief"`, `id="execution-contract"`, `id="appendix"`, and `id="test-strategy"`;
- `.issue-detail`, `.issue-detail-num`, `.issue-detail-title`, `.issue-detail-size`;
- `.test-strategy`, `.test-strategy-block`, and `.hooks-badge`.

The paired JSON sidecar remains schema version 2 with identity, issues, and the five test-strategy fields. `scripts/rfc-sidecar-check.js` is the executable schema/hash/slug gate.

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
