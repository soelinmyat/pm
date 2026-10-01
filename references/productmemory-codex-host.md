# ProductMemory through an authorized Codex MCP session

Shared product records, proposals, RFCs, supporting sources and human bundle
reviews stay in ProductMemory. Codex keeps working drafts and execution state in
private `.pm/` directories. Do not upload machine leases, sessions, secrets or
legacy approval audits, and do not edit an active consumer's configuration.

Use an already connected ProductMemory MCP session with an explicit HTTPS
service origin and project. Connecting that session or changing credentials
requires the user's specific authorization. This host never discovers a token,
reads shell startup files, follows a content URL or renews credentials.

## Host protocol

Run `scripts/productmemory-native-host.js` as a child of the authorized host with
an open input pipe. Supply `--source-dir <absolute-worktree> --project <slug>
--service-url <https-origin>` on every invocation. If a terminal is needed,
disable echo in that task-owned terminal before feeding tool responses; never
paste credentials into it.

Each JSON output line with `kind: "native-mcp-tool-request"` contains `id`, `name`
and `arguments`. Invoke exactly that named tool through the connected MCP
session. Feed one JSON line `{ "id": <same-id>, "result": <exact-CallToolResult> }`
back to the child. The host accepts one outstanding operation and does not retry
writes. A successful operation emits `kind: "native-host-result"`. Preserve
failure journals and the actual tool error instead of manufacturing a result.
Do not echo large source bodies to the conversation.

Large immutable reads use `get_knowledge_file_chunk`, bounded to 1 MiB per call.
The host verifies project/path/revision/position, chunk bytes and hashes, and the
complete original file hash before native validation. This requires the service
to expose that tool. Missing capability is a blocker, not permission to extract
or transmit the bearer token.

## Remote-first Groom and RFC

For an existing current remote bundle, `author-fetch --slug <slug> --record-id
<bkl_id> [--execution-path <pm/execution.json>]` downloads pinned verified bytes
into `.pm/authoring/<slug>/draft/pm/` and writes a private manifest. Fetch creates
no approval and does not overwrite a previous private draft. A partial fetch
must be reconciled before trying again.

For a new proposal, gather the remote record and its linked sources through the
same authorized tools, then author the private draft. Keep the product identity,
original evidence, prototype hashes and experience classification explicit.
Create `.pm/authoring/<slug>/manifest.json` with this closed shape:

```json
{
  "stage": "groom",
  "record_id": "bkl_EXPLICIT",
  "entries": [
    {
      "path": "pm/proposal.json",
      "role": "proposal",
      "category": "document-sidecar",
      "source_metadata": { "original_status": "grooming" }
    }
  ]
}
```

Include every supporting source that the proposal validators require. Groom
publishes product scope without an RFC. Use the established Groom evidence,
scope, design, quality and review process; private drafting does not authorize
publication. With the user's existing or explicit publication authority, run
`author-plan --slug <slug> --input .pm/authoring/<slug>/manifest.json`. It runs the
current proposal/prototype/quality validators and observes remote revisions.
Existing source metadata and category are preserved completely. Only a grooming
or proposed workflow can accept the publication.

Inspect the plan, then run `author-publish --slug <slug>`. Each file write uses
its observed revision, and the final bundle pins exact acknowledged versions and
hashes. The resulting bundle is unapproved. Present it for a named human review
in ProductMemory; archived lifecycle labels or local approvals cannot substitute
for that review. Do not automatically approve a bundle on the user's behalf.

RFC starts from the exact current named human-approved Groom bundle, which
contains product scope and supporting sources without an RFC. For an existing
execution bundle, seed its sources, run a new Groom-only publication/review
cycle, then create the next RFC; this helper does not amend old execution
authority. Preserve its
bytes, add a schema-v3 RFC with the complete design/issue/verification contract,
and add the reviewed execution/risk JSON as supporting source. Set the manifest
`stage` to `rfc` and `execution_path` to that supporting document. Use the RFC
technical review process before plan/publication. The new bundle again needs
human approval before native development. Changing the approved product scope
requires a new Groom review first.

Changed files above the service's 10 MiB inline write cap require the existing
explicit chunk upload workflow; this authoring helper fails before writes.
Unchanged larger sources can retain their observed immutable revision.

After an uncertain response, run `author-recover --slug <slug>`. Recovery performs
reads and accepts only the exact acknowledged revision/hash/metadata or exact new
unapproved bundle. It never replays an attempting write. If acknowledgement is
missing or differs, retain the intent and reconcile; do not delete the journal
and start again. Completed publications remain receipts. Use a fresh isolated worktree for a subsequent publication cycle, retain the
previous worktree and receipt, and keep the product slug unchanged. Revalidate
the new scope instead of overwriting the old intent.

## Native development

After fresh human review and owner assignment, run `initialize --slug <slug>
--record-id <bkl_id> --execution-path <pm/execution.json>` in an isolated feature
worktree. It downloads exact reviewed sources privately, runs the same proposal,
RFC, risk and work-unit validators, persists intent, and starts a remote session
with revision fencing. It needs no checked-in local `pm/` tree.

Resume with `decision --session <canonical-session-path>` and the operations
reported by the existing Dev lifecycle. Supported operations include record,
workspace, grant, gate, recertify, record-qa-candidate, anchor-qa-history, unblock,
work-unit, candidate and certify. Mutations that need structured facts take an
anchored `--input` file. Authority grants still require actual user evidence;
this adapter adds none. Review/QA gates keep their existing canonical checks and
failed-QA evidence remains recoverable.

Use `recover-initialization --slug <slug>` after an uncertain start, or
`recover-certification --session <canonical-session-path>` after an uncertain
certification. Both observe exact remote acknowledgement without replay.

A local fixture passing does not prove a connected user session, two-account
acceptance or writer cutover. Verify those separately and retain their receipts.
