# Offline knowledge-base migration inventory

`kb-migration-plan.js` prepares a local inventory before selecting a destination
storage contract. It skips known credential filenames and never calls a network service, changes the
source, creates approval decisions, or uploads project content.

```sh
node scripts/kb-migration-plan.js plan /absolute/path/to/knowledge-repo > /private/path/manifest.json
node scripts/kb-migration-plan.js validate /private/path/manifest.json
node scripts/kb-migration-plan.js verify /private/path/manifest.json
node scripts/kb-migration-plan.js verify /private/path/manifest.json /absolute/path/to/restored-repo
```

Keep manifest outputs private: they contain project paths, IDs and historical
approval attribution. The planner retains file hashes and exact source statuses;
it does not emit file bodies or silently translate statuses to destination enums.
Every regular file under `pm/` and `.pm/` receives a category, including unknown
file types. Unknown files are reported for explicit mapping, not discarded.
Runtime files remain classified as local runtime rather than remote payloads.

Symlinks (including broken links), special files, credential filenames and known
credential patterns are excluded and reported. Pattern detection is a limited
guard, not a comprehensive secret audit. Never use its output as authorization to
publish files or private runtime state. Back up symlink metadata separately if it
is needed for recovery; this tool never follows or restores symlinks.

Markdown links, frontmatter research/source/evidence paths and HTML/CSS asset
references are resolved against the inventory. Missing and machine-absolute links
are explicit warnings. JavaScript-generated links and JSON references are not
fully inspected; retain the original bytes and review their contracts before
cutover. A valid inventory does not mean the destination supports all content.

Approval records and session approvals retain original actor, date and declared
hashes as historical provenance. Hash matches only mean some inventoried file has
that digest; they do not establish the correct artifact identity, an intact
approval transition or a current human decision. Approval contract verification
is always required before representing an imported item as approved.

Verification detects changed, missing, newly added and replaced-by-symlink files.
It does not treat excluded content as preserved. For multiple worktrees, generate
one manifest per worktree and keep source identity; do not collapse competing
versions under one destination ID. Take another inventory after pausing writers
at cutover, since an offline scan is not an atomic snapshot of active workflows.

All plans report `production_ready: false` and `cutover_allowed: false` deliberately.
Destination API validation, conflict resolution, complete backup/restore,
historical approval verification and a representative migration are separate gates.

Run focused checks with:

```sh
node --test tests/kb-migration-plan.test.js tests/kb-migration-bundle.test.js tests/kb-sync-pm.test.js
node scripts/validate.js --plugin
```

## Worktree reconciliation

Use `kb-migration-reconcile.js <canonical-source-root> <manifest>...` to retain
one logical path with all distinct byte versions and source provenance. Identical
versions collapse; conflicting versions remain review-required. Canonical selection
must be supplied explicitly and never derives from timestamps, worktree recency or
branch names. Files absent from canonical source remain archive-only pending review.
No output permits production cutover. These IDs identify file paths and byte blobs;
record IDs require a separately verified destination contract and project namespace.

Source-root aliases may be supplied as the third argument to `plan`. They map an
original absolute KB link to an inventoried relative path without reading the old
location or rewriting content. Root-relative application routes, code references,
source labels and dynamic template references are separate classes. They do not
prove a target route/code dependency is available remotely.

Arbitrary root/ancestor symlinks are rejected. Standard macOS `/tmp` and `/var`
aliases are accepted only when they resolve to `/private/tmp` and `/private/var`.
Credential-looking URL references are redacted in the manifest; original file bytes
remain private backup material. Pattern recognition is incomplete, so outputs still
require review before sharing.

## Private migration bundle

Freeze source snapshots before building a bundle. This tooling is entirely offline;
it does not authorize or perform uploads. Build requires an explicit project namespace,
canonical source and manifests for every retained source:

```sh
node scripts/kb-migration-bundle.js build cleanlog /snapshot/canonical /private/bundle /private/plan-00.json /private/plan-01.json
node scripts/kb-migration-bundle.js verify /private/bundle <trusted-build-receipt-sha256>
node scripts/kb-migration-bundle.js restore /private/bundle /private/empty-restore
```

An optional `--supplements /private/supplements.json` accepts entries with `label`,
`path` and `sha256` to preserve explicit backup metadata, guidance or baseline
selection evidence. Supplements remain local-only. Symlink targets are never followed
or recreated. Each source restores separately, preserving all retained versions.

The index preserves exact source status and historical approval provenance, raw-byte
hashes and source manifests. Shared-record candidate IDs are namespaced by project
and source ID when present; collisions fail the build. These IDs still require a
verified remote mapping contract. Missing or unresolved code, route and dynamic
dependencies block active handoff. Baseline selection does not grant feature approval.

Rebuilding identical inputs is idempotent. Verification recomputes derived metadata
and checks every content object; restore checks hashes again. The adjacent checksum
detects accidental corruption, while a separately retained trusted build receipt
also detects index replacement. Checksums are not signatures. Keep all bundle files
private: raw source bytes can contain information not recognized by the scanner.
Build also reparses source files to reject altered status, identity, approval or
dependency metadata even when their byte hashes still match. If interrupted between
index and checksum creation, preserve the incomplete output and retry in a new empty
destination; the tooling refuses to overwrite unverifiable remnants.
