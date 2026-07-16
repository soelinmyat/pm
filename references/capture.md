# Capture Reference

Shared contract for the lightweight capture skills: `pm:note` (product signals), `pm:task` (chores/todos), `pm:bug` (regressions). All three capture in one pass — no grooming, no RFC — and resolve `{pm_dir}` per `skill-runtime.md`. Note also resolves `{pm_state_dir}` so sensitive originals have a private destination.

## Which capture

| Input | Skill | Writes |
|-------|-------|--------|
| Customer feedback, competitor/product observation, evidence worth remembering | `pm:note` | `{pm_dir}/evidence/notes/YYYY-MM.md` entry |
| Chore, todo, small cleanup, version bump | `pm:task` | backlog item, `kind: task` |
| Something broken, a regression, unexpected behavior | `pm:bug` | backlog item, `kind: bug` |

Route out when it doesn't fit: user-visible feature work with product decisions or unknowns → `pm:groom`; bulk file/transcript imports → `pm:ingest`; a one-off question that needs no tracking → answer inline.

## Notes — writeNote

Call `writeNote(pmDir, text, source, tags, { pmStateDir })` from `scripts/note-helpers.js`. It uses the source to choose one of two lanes under one owned evidence lock:

- `public`/`internal`, or already reviewed sensitive content: append the monthly file and bind its Evidence v2 ledger record; return `{ filePath, timestamp, evidence_id, pending_review: false }`.
- `customer-sensitive`/`restricted` with `pii_review: pending`: save the original to `{pm_state_dir}/evidence/records/{evidence_id}.json` with mode `0600`, register an unbound portable ledger record, create no monthly note, and return `{ filePath: null, privatePath, timestamp, evidence_id, pending_review: true }`.

Pass values as argv — never interpolate note text into the script body:

```bash
node -e 'const {writeNote}=require(process.env.CLAUDE_PLUGIN_ROOT+"/scripts/note-helpers.js");console.log(JSON.stringify(writeNote(process.argv[1],process.argv[2],process.argv[3],process.argv[4],{pmStateDir:process.argv[5]})))' "{pm_dir}" "<text>" "<source>" "<tags>" "{pm_state_dir}"
```

- `source` defaults to `observation`; infer from cues like "sales call:", "support thread:", "user interview:", "from a customer", or an explicit `--source`.
- Infer `tags` (comma-separated) from content: competitor name → `competitor`; speed/timeout → `performance`; API/plugin/integration → `integration`; cost/pricing → `pricing`; cancel/leave/churn → `churn`; feature request → `feature-request`. A user `--tags` value overrides inference.
- Confirm the receipt includes `Evidence-ID: ev_...`. For a pending receipt, explicitly tell the user the original is private and not yet published.

### PII review and sanitized publication

Pending customer/support/interview/sales/prospect notes are deliberately absent from `{pm_dir}/evidence/notes/` and have an empty `artifact_paths` array. Review the private original, produce text with direct identifiers and unrestricted quotes removed, obtain explicit confirmation that this rendering is safe to share, then call `publishReviewedNote`:

```bash
node -e 'const {publishReviewedNote}=require(process.env.CLAUDE_PLUGIN_ROOT+"/scripts/note-helpers.js");console.log(JSON.stringify(publishReviewedNote(process.argv[1],process.argv[2],process.argv[3],process.argv[4],{source:process.argv[5],tags:process.argv[6]})))' "{pm_dir}" "{pm_state_dir}" "<evidence_id>" "<sanitized_text>" "<sanitized_source>" "<sanitized_tags>"
```

Publication preserves the Evidence-ID, changes the current hash to the reviewed sanitized text, records the private original hash as a revision, marks `pii_review: reviewed`, and only then binds the monthly artifact. Never copy the private `source` or `tags` automatically; supply only reviewed metadata.

## Tasks and bugs — capture-backlog.js

Task and Bug share one mechanical boundary, not one policy. The helper validates bounded inputs, rejects symlinked destinations, owns a backlog-wide lock across collision checking and ID allocation, publishes with exclusive atomic creation, validates the exact published bytes, and returns a content-bound receipt. Never pre-allocate an ID, hand-compose frontmatter, or write the destination directly.

Write all user-controlled values to a private JSON request with the Write tool, then pass only paths through the shell:

```json
{
  "action": "create",
  "kind": "task",
  "title": "Bump the parser dependency",
  "outcome": "The parser uses the supported release",
  "priority": "medium",
  "labels": ["chore"],
  "body": "Optional context"
}
```

```bash
REQUEST_FILE=$(mktemp)
trap 'rm -f "$REQUEST_FILE"' EXIT
# Use the Write tool to write the JSON object to $REQUEST_FILE.
node ${CLAUDE_PLUGIN_ROOT}/scripts/capture-backlog.js \
  --pm-dir {pm_dir} --request-file "$REQUEST_FILE"
```

Omit `priority`, `labels`, and `body` to use alias defaults. Never interpolate title, outcome, labels, or body into a command string. The helper rejects unknown request fields and unsafe or oversized request files.

The helper allocates the next `PM-NNN` ID and checks slug/ID uniqueness from the same locked snapshot. It writes validated frontmatter (`type: backlog`, `status: proposed`, `created`/`updated` today), refuses to overwrite an existing `{slug}.md`, and prints `{"action","filePath","id","slug","content_sha256"}`. Defaults: `--kind task` → `priority: medium`, `labels: [chore]`; `--kind bug` → `priority: high`, `labels: [bug]`.

Bugs carry a body with three sections in order — `## Observed`, `## Expected`, `## Reproduction`. Write a stub (`_Pending — add before /pm:dev._`) under any the user skips.

**Body safety:** put multiline content in the JSON `body` field through the Write tool; never pass it through a heredoc or interpolate it into shell syntax. The helper rejects symlinked, non-regular, or oversized request files and bounds the decoded body.

## Enrichment (optional)

Capture succeeds first, then offer refinement — the saved item is never lost.
- **Notes:** ask 2–4 follow-up questions (who / severity / context / compare) and append them under the same `### timestamp` entry; do not create a new entry or modify `note_count`/`digested_through`.
- **Tasks/bugs:** keep the create receipt and use its observed hash:

  Write a new private request and invoke the same command. The request contains `action: "enrich"`, `kind`, `slug`, `expectedSha256`, and only the requested `outcome`, `priority`, `labels`, or `body` changes.

  The helper preserves identity and creation fields, checks the expected kind, rejects a stale hash instead of overwriting concurrent work, atomically replaces the file, validates the exact intended bytes, and returns a new receipt. Never enrich via direct Edit. When a Bug body changes, supply all three ordered sections; the helper restores pending stubs for any omitted section.
