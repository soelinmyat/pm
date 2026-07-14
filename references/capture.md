# Capture Reference

Shared contract for the lightweight capture skills: `pm:note` (product signals), `pm:task` (chores/todos), `pm:bug` (regressions). All three write in one pass — no grooming, no RFC — and resolve `{pm_dir}` per `skill-runtime.md`.

## Which capture

| Input | Skill | Writes |
|-------|-------|--------|
| Customer feedback, competitor/product observation, evidence worth remembering | `pm:note` | `{pm_dir}/evidence/notes/YYYY-MM.md` entry |
| Chore, todo, small cleanup, version bump | `pm:task` | backlog item, `kind: task` |
| Something broken, a regression, unexpected behavior | `pm:bug` | backlog item, `kind: bug` |

Route out when it doesn't fit: user-visible feature work with product decisions or unknowns → `pm:groom`; bulk file/transcript imports → `pm:ingest`; a one-off question that needs no tracking → answer inline.

## Notes — writeNote

Call `writeNote(pmDir, text, source, tags)` from `scripts/note-helpers.js`. It creates/appends the monthly file and its Evidence v2 ledger record under one owned lock, uses atomic file replacement, and returns `{ filePath, timestamp, evidence_id }`. Pass values as argv — never interpolate note text into the script body:

```bash
node -e 'const {writeNote}=require(process.env.CLAUDE_PLUGIN_ROOT+"/scripts/note-helpers.js");console.log(JSON.stringify(writeNote(process.argv[1],process.argv[2],process.argv[3],process.argv[4])))' "{pm_dir}" "<text>" "<source>" "<tags>"
```

- `source` defaults to `observation`; infer from cues like "sales call:", "support thread:", "user interview:", "from a customer", or an explicit `--source`.
- Infer `tags` (comma-separated) from content: competitor name → `competitor`; speed/timeout → `performance`; API/plugin/integration → `integration`; cost/pricing → `pricing`; cancel/leave/churn → `churn`; feature request → `feature-request`. A user `--tags` value overrides inference.
- Confirm the saved entry includes `Evidence-ID: ev_...`; customer/support/interview/sales/prospect sources remain `pii_review: pending` in the ledger until reviewed.

## Tasks and bugs — capture-backlog.js

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/capture-backlog.js \
  --pm-dir {pm_dir} --kind task|bug --title "<title>" \
  [--outcome "<one sentence>"] [--priority medium] [--labels a,b] [--body-file <path>]
```

The helper allocates the next `PM-NNN` id (scanning `{pm_dir}/backlog/*.md`), slugifies the title, and writes validated frontmatter (`type: backlog`, `status: proposed`, `created`/`updated` today). It refuses to overwrite an existing `{slug}.md`, and prints `{"filePath","id","slug"}`. Defaults: `--kind task` → `priority: medium`, `labels: [chore]`; `--kind bug` → `labels: [bug]` (pass `--priority high` — bugs are urgent by default, downgrade in enrich).

Bugs carry a body with three sections in order — `## Observed`, `## Expected`, `## Reproduction`. Write a stub (`_Pending — add before /pm:dev._`) under any the user skips.

**Body safety:** never pass a bug body through a heredoc — a user's reproduction text can contain a line matching the sentinel and terminate it early. Create the file with the Write tool (`BODY_FILE=$(mktemp)`), pass `--body-file "$BODY_FILE"`, then `rm -f "$BODY_FILE"`.

## Enrichment (optional)

Capture succeeds first, then offer refinement — the saved item is never lost.
- **Notes:** ask 2–4 follow-up questions (who / severity / context / compare) and append them under the same `### timestamp` entry; do not create a new entry or modify `note_count`/`digested_through`.
- **Tasks/bugs:** adjust `priority`/`labels` (and fill a pending `## Reproduction`) via Edit, and bump `updated`.
