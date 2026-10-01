# Lossless ProductMemory adapter

`scripts/kb-sync-knowledge.js` uses an injected, already authorized transport:
`identity: {service: "https://productmemory.io", project: "cleanlog"}`,
`get(path, optionalRevision)` (404 maps to null), `put(input)`, and
`list(optionalCursor)`. The transport binds every request to that project.
It performs no credential discovery, network setup, config changes, or uploads on
module load. A caller must explicitly authorize and supply its session.

`push({manifest, transport, cache})` verifies frozen inventory and exact bytes,
preserves original source metadata/status/references, and leaves runtime local.
The returned cache is bound to service and project. Existing different remote
content requires a matching cached revision/hash; conflicting writes do not retry
against a newer revision. Every write is exported and reconciled before caching.
Partial failure can leave verified prior writes remotely; rerunning is idempotent.
There are no deletes or status normalization.

`exportHistory(transport)` includes every immutable revision and verifies all bytes,
hashes, metadata, identities, and a final complete inventory. It rejects revisions
or paths added during export. Freeze remote writers for a consistent acceptance
snapshot: the REST API does not supply a global snapshot transaction. Persist the
result privately through caller-owned tooling; no automatic live hydration occurs.

This is an archival adapter, not completed daily-workflow cutover. Imported
approval files are historical evidence and must not be hydrated into an active
workspace where old PM gates could interpret them as current authority. Machine
leases, worktrees, ownership, session state, and execution gates remain local.
Cloud-native feature approval, artifact rendering, search/browse, ownership, and
coordinated writer handoff require separate validated implementation.

Large-file transport extension: `putStream(metadata, readable)` receives at most
1 MB chunks for files above 10 MB; metadata excludes base64 and retains declared
byte size, SHA256 and CAS precondition. The transport must implement the service's
owner-scoped upload/chunk/complete protocol and abort unfinished sessions on terminal
failure. `download(path, revision)` returns an async Buffer iterable with chunks no
larger than 1 MB. Targets derive from bound service/project/path/revision, never a
server-returned arbitrary URL. Reads reject mismatched revisions, size/hash failures,
oversize chunks and metadata above 64 KB. Maximum decoded file size is 128 MB.
Portable exports retain exact base64 bytes and can allocate up to that bounded file
size; source transfer is streamed. A concrete authenticated session transport remains
a cutover gate; this module does not discover keys or configure persistent credentials.
