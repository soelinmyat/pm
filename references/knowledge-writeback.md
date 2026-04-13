# Knowledge Writeback

Shared reference for converting downstream workflow outcomes into durable KB artifacts under `{pm_dir}/evidence/research/` and routing them into insight topics.

Use the helper script:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/knowledge-writeback.js --pm-dir "{pm_dir}"
```

Pass a JSON payload on stdin. The helper creates or updates the evidence file, upserts `evidence/research/index.md`, and appends to `evidence/research/log.md`.
It also returns deterministic `routeSuggestions` for that artifact so the workflow can confirm candidate insight links before applying them.

## Goal

When `dev`, `groom`, or a future workflow surfaces reusable product knowledge, do not leave it only in session state or `pm/memory.md`.

Instead:
1. Create or update a canonical evidence file in `pm/evidence/research/`
2. Route it into relevant insight topics via `insight-routing.md`
3. Update the research index and log so the artifact is discoverable later

This is for **durable product knowledge**, not for generic process friction.

## Use This Reference When

The workflow surfaced one or more findings that should change future thinking, grooming, research, or implementation.

Good candidates:
- a product rule or acceptance-criteria gap discovered during implementation
- a user-visible edge case or constraint surfaced by QA/review
- a scope or tradeoff decision from grooming that explains why a proposal took its current shape
- a runtime, platform, or architecture constraint with repeat product impact
- a validated or contradicted competitive / strategic claim

Do **not** use this for:
- generic process friction already captured in `pm/memory.md`
- ceremony notes with no downstream product value
- duplicate restatements of the backlog item or RFC with no new synthesis

## Artifact Rules

Use the existing research evidence schema. Do **not** invent a new evidence type.

```yaml
---
type: evidence
evidence_type: research
topic: {Human-readable topic}
created: YYYY-MM-DD
updated: YYYY-MM-DD
source_origin: internal
cited_by: []
sources: []
---
```

Notes:
- `sources: []` is valid for purely internal writebacks
- If the file already exists, preserve `created`, preserve existing `cited_by`, and update `updated`
- If you are extending an existing internal file with external research later, switch `source_origin` to `mixed`

## CLI Payload

`knowledge-writeback.js` expects JSON on stdin with:

```json
{
  "artifactPath": "evidence/research/{file}.md",
  "artifactMode": "implementation-learnings | decision-record | general",
  "topic": "Human-readable topic",
  "summary": "2-3 sentence summary",
  "findings": ["Finding 1", "Finding 2"],
  "description": "Short index description",
  "strategicRelevance": "Why this matters later",
  "implications": ["Downstream implication"],
  "openQuestions": ["Remaining uncertainty"],
  "sourceArtifacts": ["backlog/foo.md", ".pm/dev-sessions/foo.md"]
}
```

Rules:
- `artifactPath` must stay under `evidence/research/`
- `artifactMode` lets the helper bias route suggestions toward the right domains
- `findings` must contain at least one durable point
- `description` becomes the row description in `evidence/research/index.md`
- the script preserves existing `created`, `sources`, and `cited_by` on updates

## Naming

Preferred filenames:
- Dev: `{slug}-implementation-learnings.md`
- Groom: `{topic-slug}-decisions.md`

Reuse the existing file if it already exists for that slug.

## Body Template

Use this structure:

```markdown
# {Topic Name}

## Summary
2-3 sentences. What changed in our understanding?

## Findings
Numbered findings. Each item should be durable and reusable.

## Strategic Relevance
Why this matters for future product, research, grooming, or implementation work.

## Implications
What should change downstream because of this?

## Open Questions
Only what remains unresolved.
```

Rules:
- Write for a future reader who did not participate in the session
- Do not narrate the whole session
- Prefer 2-4 high-signal findings over a long dump
- Reference local source artifacts inline when useful, for example:
  - proposal: `{pm_dir}/backlog/{topic-slug}.md`
  - state file: `{pm_state_dir}/groom-sessions/{topic-slug}.md`
  - dev state: `{source_dir}/.pm/dev-sessions/{slug}.md`
  - RFC: `{pm_dir}/backlog/rfcs/{slug}.html`

## Write Flow

1. Decide whether there is durable product knowledge. If not, skip silently.
2. If there are 1-3 clear reusable findings, write the evidence artifact automatically with `knowledge-writeback.js`.
3. If the findings are ambiguous and would require guessing, ask the user to confirm or skip.
4. Run:

   ```bash
   cat <<'JSON' | node ${CLAUDE_PLUGIN_ROOT}/scripts/knowledge-writeback.js --pm-dir "{pm_dir}"
   {
     "artifactPath": "evidence/research/{file}.md",
     "artifactMode": "implementation-learnings",
     "topic": "{Topic Name}",
     "summary": "{2-3 sentence summary}",
     "findings": ["{finding 1}", "{finding 2}"],
     "description": "{short index description}",
     "strategicRelevance": "{why this matters}",
     "implications": ["{downstream implication}"],
     "openQuestions": ["{open question}"],
     "sourceArtifacts": ["{supporting artifact path}"]
   }
   JSON
   ```

5. Read the JSON result from `knowledge-writeback.js`. It now includes:

   ```json
   {
     "artifactPath": "evidence/research/{file}.md",
     "routeSuggestions": {
       "suggestions": [
         {
           "mode": "existing",
           "evidencePath": "evidence/research/{file}.md",
           "insightPath": "insights/product/{slug}.md",
           "description": "{short routing description}",
           "reason": "{why this matches}"
         }
       ],
       "suggestedNewRoute": {
         "mode": "new",
         "evidencePath": "evidence/research/{file}.md",
         "insightPath": "insights/product/{new-slug}.md",
         "domain": "product",
         "topic": "{new topic}",
         "description": "{short routing description}",
         "reason": "{why no existing insight matched}"
       }
     }
   }
   ```

6. Present those suggestions to the user and confirm which routes to keep. After that, apply the accepted routes with:

   ```bash
   cat <<'JSON' | node ${CLAUDE_PLUGIN_ROOT}/scripts/route-selection.js | node ${CLAUDE_PLUGIN_ROOT}/scripts/insight-routing.js --pm-dir "{pm_dir}"
   {
     "selection": [1, 2],
     "routeSuggestions": { ...the routeSuggestions object returned by knowledge-writeback.js... }
   }
   JSON
   ```

   `selection` can be:
   - `"all"` to accept every suggestion
   - `"skip"` to accept none
   - a comma-delimited string like `"1,3"`
   - an array like `[1, 3]`

   `route-selection.js` converts the numbered choices into the exact `routes` payload expected by `insight-routing.js`.
   The routing helper also rewrites affected existing insights into the compiled synthesis template, so do not patch the body manually afterward.
7. Do not hand-edit `{pm_dir}/evidence/research/index.md`, `{pm_dir}/evidence/research/log.md`, or the routed insight indexes/logs after the helper scripts run unless you are fixing a script failure.

## Index / Log Rules

For `{pm_dir}/evidence/research/index.md`:
- add or update one row for the file
- description should reflect the durable takeaway, not the workflow event
- status column should be `internal` for these writebacks

For `{pm_dir}/evidence/research/log.md`:
- append `create evidence/research/{file}.md` when new
- append `update evidence/research/{file}.md` when existing

## Failure Rule

If this writeback step fails after the workflow decided to perform it:
- do **not** delete the session state file
- mark the session as failed for retry (for example `retro_failed: true`)
- stop before cleanup
