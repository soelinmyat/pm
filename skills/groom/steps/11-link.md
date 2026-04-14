---
name: Link
order: 11
description: Create proposal entry in backlog, Linear integration, retro extraction, durable decision writeback, cleanup
applies_to: [quick, standard, full]
---

### Step 11: Link

1. **Enrich backlog entry metadata.** The proposal file already exists at `{pm_dir}/backlog/{topic-slug}.md` (written in Draft Proposal / Present). Do NOT rewrite it. Only add linking metadata:
   - **Thinking discovery:** Check if `{pm_dir}/thinking/{topic-slug}.md` exists. If found, set `thinking: thinking/{topic-slug}.md` in the backlog frontmatter. If not found, set `thinking: null`.
   - **ID rule:** If `linear_id` is available, set `id` to the Linear identifier. Otherwise use the local `PM-{NNN}` sequence (scan `{pm_dir}/backlog/*.md` for highest `id`, increment by 1).
   - Set `linear_id` in frontmatter if known from session state.

2. **Linear integration:**

   **If `linear_id` is set in the groom session state** (issue already exists in Linear):
   - Do NOT create a new Linear issue.
   - Fetch the current issue description via `get_issue` (to get the latest version).
   - Write a comment to the existing issue via `save_comment` with the groom output:
     ```
     ## Groom Output (auto-generated)

     **Scope:** {in-scope items}
     **Out of scope:** {out-of-scope items}
     **Feasibility:** {verdict}
     **Research:** {1-line summary}
     **Proposal:** See local file at {pm_dir}/backlog/{topic-slug}.md
     ```
   - Update the issue description via `save_issue`: append below a separator. **Idempotency rule:** If the description already contains `## Enriched Scope (auto-groom)`, replace content from that heading up to (but not including) the next `## ` heading or end of description, whichever comes first. This preserves any human-added sections below the enriched block.
     ```
     {existing description, up to but not including any prior enrichment}

     ---
     ## Enriched Scope (auto-groom)
     **In scope:** {in-scope items}
     **Out of scope:** {out-of-scope items}
     **10x filter:** {filter_result}
     ```
   - Set `linear_id` in the backlog entry frontmatter to `linear_id`.
   - Say: "Groom output written back to Linear issue {ID}. Scope enriched."

   **If `linear_id` is NOT set** (new proposal):
   - If Linear is configured (`{pm_state_dir}/config.json` has `linear: true` or Linear MCP is available):
     - **Ask the user before creating a Linear issue:**

       > "Linear is configured. Create a Linear issue for this proposal? (y/n)"

       Wait for the user's answer.
       - **If yes:**
         - **Sanitize local file links before sending to Linear.** Linear's markdown renderer treats relative links as relative to the Linear issue URL. Before constructing the description:
           - Convert `[text]({pm_dir}/...)` → `text (\`{pm_dir}/...\`)` — plain text with path in backticks
           - Leave absolute URLs (starting with `http://` or `https://`) unchanged
         - Create a single parent issue in Linear. Capture the Linear ID.
         - **Update the local backlog entry's `id` to match the Linear identifier.** The Linear ID is the single source of truth when a tracker is available — do not maintain a separate local PM-{NNN} sequence.
         - Do NOT create child issues — issue splitting happens later during RFC generation in `pm:dev`.
         - Say: "Proposal linked in Linear. ID: {ID}."
       - **If no:**
         - Use the local `PM-{NNN}` sequence for the `id` field (scan `{pm_dir}/backlog/*.md` for highest `id`, increment by 1).
         - Say: "Skipping Linear. Local ID assigned."

3. **Validate written artifacts.** Run:
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/validate.js --dir "${CLAUDE_PROJECT_DIR:-$PWD}/pm"
   ```
   If validation fails, fix the frontmatter errors before proceeding. Do not surface the validation step to the user — just fix silently and move on.

4. Update state:

```yaml
proposal:
  slug: "{topic-slug}"
  backlog_path: {pm_dir}/backlog/{topic-slug}.md
  proposal_html_path: {pm_dir}/backlog/proposals/{topic-slug}.html
  prd_path: null
  linear_id: "{Linear ID}" | null
```

5. **Retro extraction — extract learnings before cleanup.**

   This step runs after artifact validation and before state file deletion. If extraction fails at any point, do NOT delete the state file. Instead, write `retro_failed: true` to the state file and say:
   > "Retro extraction failed; session state preserved for retry."
   Then stop — do not proceed to deletion.

   **5a. Scan for extractable events.** Read the groom session state (`{pm_state_dir}/groom-sessions/{topic-slug}.md`) and check for these events. **Generalization rule:** the `learning` field must be generalizable to future sessions — write an actionable pattern, not a description of what happened. Session-specific details belong in `detail`, not `learning`.

   | Event | Condition | Category | Learning guidance |
   |-------|-----------|----------|-------------------|
   | Scope review send-back | `scope_review.pm_verdict` = `rethink-scope` or `wrong-priority` | `scope` | Read the scope review feedback to identify why scope was rejected. Write a generalizable lesson: what scoping practice or validation step would prevent this type of send-back? |
   | Bar raiser send-back | `bar_raiser.verdict` = `send-back` | `quality` | Read the bar raiser feedback to identify the quality gap. Write a generalizable lesson: what quality check or standard should be applied earlier in grooming? |
   | Team review blocking fixes | `team_review.blocking_issues_fixed` > 0 | `review` | Read the blocking issues to identify the common pattern. Write a generalizable lesson: what should be verified or structured differently before team review? |
   | Strategy check failure | `strategy_check.status` = `failed` | `process` | Read the strategy check results to identify the misalignment. Write a generalizable lesson: what strategy validation should happen earlier in the grooming flow? |

   **5b. No events — skip silently.** If none of the conditions above match, log internally "no learnings detected this session" and skip to step 6 (state file deletion). Do NOT prompt the user.

   **5c. Events found — present auto-extracted learnings.** For each matched event, follow the learning guidance in the table above: read the relevant session state, identify the root cause or pattern, and write a **generalizable, actionable** one-liner that any future grooming session could benefit from. Put session-specific details into the `detail` field, not the `learning` field. Present the list to the user:

   > "Retro: {N} learning(s) extracted from this groom session:
   > 1. [{category}] {learning text}
   > ...
   > Options: (a) Accept as-is (b) Add your own learnings too (c) Accept auto-extracted only"

   Wait for the user's answer.
   - **(a) or (c):** Proceed with auto-extracted entries only.
   - **(b):** Collect additional learnings from the user. Each user-provided learning needs `category` (offer the valid set: `scope`, `research`, `review`, `process`, `quality`) and a one-liner. Nudge the user toward generalizable phrasing if their learning is session-specific (e.g., "what's the broader lesson here?"). Append them to the auto-extracted list.

   This is a hard gate — at minimum the auto-extracted learnings must be written before state file deletion.

   **5d. Deduplicate.** Read `{pm_dir}/memory.md`. For each entry to write, check existing entries: if any existing entry matches on `source` + `date` + first 50 characters of `learning`, skip that entry (already written, likely from a prior retro attempt on the same session).

   **5e. Concurrent write guard.** Immediately before appending, re-read `{pm_dir}/memory.md` to get the latest state. Append new (non-duplicate) entries to the `entries` list from the freshly-read version, not from any earlier read.

   **5f. Write entries.** Each entry uses this format inside the `entries` list:

   ```yaml
   - date: {today, YYYY-MM-DD}
     source: "{topic-slug}"
     category: "{mapped category}"
     learning: "{generalizable, actionable one-liner — no session-specific details}"
     detail: "{session-specific context: what happened, counts, specifics involved}"
   ```

   Write the updated `{pm_dir}/memory.md` preserving the existing frontmatter structure (`type: project-memory`).

   **5g. Post-write cap check.** After writing, count total entries in `{pm_dir}/memory.md`. If count exceeds 50, follow the algorithm in `${CLAUDE_PLUGIN_ROOT}/references/memory-cap.md`:
   - Move oldest non-pinned entries to `{pm_dir}/memory-archive.md` until count <= 50
   - If all entries are pinned, warn the user

   **5h. Validate.** Run:
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/validate.js --dir "{pm_dir}"
   ```
   If validation fails, fix the entries and re-validate before proceeding.

   **5i. durable decision writeback.** After `memory.md` is updated, decide whether this groom session produced reusable product knowledge that should live in the KB as durable evidence.

   Scan the groom session state and final proposal for 1-3 high-signal decisions such as:
   - why this scope was chosen over a nearby alternative
   - what tradeoff or send-back materially changed the proposal
   - which strategy constraint or research finding most shaped the final scope
   - what future grooming or implementation work should remember about this decision

   Do **not** create a writeback artifact for generic ceremony/process learnings already captured in `memory.md`.

   If there are no durable product decisions beyond what the proposal already states implicitly, skip silently.

   If there are 1-3 clear durable decisions, create or update:

   ```text
   {pm_dir}/evidence/research/{topic-slug}-decisions.md
   ```

   Read and follow `${CLAUDE_PLUGIN_ROOT}/references/knowledge-writeback.md`.

   Write the artifact with:

   ```bash
   cat <<'JSON' | node ${CLAUDE_PLUGIN_ROOT}/scripts/knowledge-writeback.js --pm-dir "{pm_dir}"
   {
     "artifactPath": "evidence/research/{topic-slug}-decisions.md",
     "artifactMode": "decision-record",
     "topic": "{topic} — Groom Decisions",
     "summary": "{2-3 sentence summary of the decision and why it matters}",
     "findings": ["{durable decision 1}", "{durable decision 2}"],
     "description": "Durable decision record from grooming",
     "strategicRelevance": "{why future grooming / implementation should remember this}",
     "implications": ["{downstream implication}"],
     "openQuestions": ["{remaining open question}"],
     "sourceArtifacts": [
       "backlog/{topic-slug}.md",
       ".pm/groom-sessions/{topic-slug}.md"
     ]
   }
   JSON
   ```

   That writeback flow must route accepted findings through `${CLAUDE_PLUGIN_ROOT}/references/insight-routing.md` after the evidence file is written.
   Read the `routeSuggestions` returned by `knowledge-writeback.js`, confirm which numbered routes to keep, then pipe them through `${CLAUDE_PLUGIN_ROOT}/scripts/route-selection.js` into `${CLAUDE_PLUGIN_ROOT}/scripts/insight-routing.js` instead of hand-editing citations, indexes, `.hot.md`, or the affected insight bodies.

   Pass into that flow:
   - artifact mode: `decision-record`
   - artifact path: `{pm_dir}/evidence/research/{topic-slug}-decisions.md`
   - topic name: `{topic} — Groom Decisions`
   - source artifacts:
     - `{pm_dir}/backlog/{topic-slug}.md`
     - `{pm_state_dir}/groom-sessions/{topic-slug}.md`
     - any `research_refs` already linked from the proposal frontmatter
   - the key findings you extracted from the session

   If the decisions are ambiguous and you cannot summarize them without guessing, ask the user to confirm or skip. Otherwise do the writeback automatically.

   If this writeback fails after you decided it should happen, do NOT delete the state file. Write `retro_failed: true` to the state file and stop.

6. **Delete state file.**

Delete `{pm_state_dir}/groom-sessions/{topic-slug}.md` after successful retro extraction (or silent skip) and link. Grooming is complete.

Say:
> "Grooming complete for '{topic}'.
> Proposal: `{pm_dir}/backlog/{topic-slug}.md`
> HTML: `{pm_dir}/backlog/proposals/{topic-slug}.html`
> Next: run `pm:rfc {topic-slug}` to generate the technical RFC, then `pm:dev {topic-slug}` to implement."
