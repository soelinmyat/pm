---
name: Intake
order: 2
description: Load project memory, discover project context, classify size, create state file
---

## Intake

1. **Load learnings** — Read `{pm_dir}/memory.md`. Select up to 5 entries using the algorithm in `references/memory-recall.md`. Display them to the user so past context informs the dev session. If the file is missing or has zero entries, show "No past learnings yet — they'll appear here after your first completed session." and continue.
2. **Discover project context** — Read CLAUDE.md + AGENTS.md. Detect issue tracker from MCP tools.
3. **Resolve task context:**

   **Local backlog resolution (runs first).** If `$ARGUMENTS` is a slug (e.g., `inspection-checklist-navigation`) or an issue ID (e.g., `PM-036`, `CLE-123`):
   1. Check `{pm_dir}/backlog/{slug}.md` — if found, read frontmatter and use as task context.
   2. If the argument looks like an issue identifier, scan `{pm_dir}/backlog/*.md` frontmatter for a matching `id:` or `linear_id:` field. If found, use that file's slug and content as task context.
   3. Only if no local backlog match: fall through to MCP lookup.

   **MCP lookup.** If `$ARGUMENTS` looks like an issue ID and was NOT resolved from local backlog, fetch via MCP. If MCP returns nothing, proceed with the argument as the topic. If only conversation context is available, use that.

   **Linear readiness assessment.** If the MCP fetch returned a Linear issue, assess dev-readiness. Read the issue title, description, labels, and status. Check three criteria — be generous, look for testable statements anywhere, not just under "AC:" headers:

   - **AC exist:** Testable acceptance criteria (specific, verifiable — not just a vague description)
   - **Scope is clear:** What's in scope vs. out of scope is distinguishable
   - **Size is inferrable:** Enough detail to classify as XS/S/M/L/XL

   Route based on readiness:

   | Readiness | Action |
   |-----------|--------|
   | dev-ready (all 3 pass) | Store Linear context in session state. Proceed normally. |
   | needs-groom | Store `linear_readiness: needs-groom` and `gaps` (e.g., `[missing-ac, vague-scope]`). Step 5 routes. |
   | fetch failed | Ask user to paste the issue description. Proceed with pasted text. |

   Store `linear_id`, `linear_readiness`, `linear_title`, `linear_description`, and `linear_labels` in the session state. For needs-groom, also store `size` and `gaps`.
4. **Fetch sub-issues** — After fetching the issue, also check for sub-issues via `list_issues({ parentId })`. If sub-issues exist, store them in session state under `## Sub-Issues`. They become context for RFC generation. If no sub-issues, proceed normally.
5. **Linear issue readiness routing** — If `linear_id` is set in the session state (set by SKILL.md routing):

   If `linear_readiness` is `dev-ready`:
   - Use `linear_title` as the task title and `linear_description` as task context.
   - Skip proposal existence check in groom-readiness — the Linear issue IS the product context.
   - Proceed to size classification (Step 6) using the Linear description.

   If `linear_readiness` is `needs-groom` AND size is M/L/XL (size was classified during SKILL.md routing):
   - Announce: "Linear issue {linear_id} needs grooming. Gaps: {gaps}. Invoking pm:groom."
   - Invoke `pm:groom` within the same conversation. Pass the Linear context as conversation text: title, description, labels, ID, and the slug to use. Groom picks up this context from the preceding messages — no CLI flags needed.
   - Tell groom: "Use slug: {slug}. This is a Linear issue that needs enrichment. Linear ID: {ID}. Title: {title}. Description: {description}."
   - After groom completes, re-read `{pm_dir}/backlog/{slug}.md`. If the file does not exist or `status` is not `proposed`, `planned`, or `in-progress`:
     - Log: `Groom did not produce a valid proposal. Falling back to conversational scoping.`
     - Set `groom_attempted: true` in the session state.
     - Handle inline — confirm scope + ACs with the user conversationally (same as XS/S path). Do not re-invoke groom.
   - If the file exists with `status: proposed` and `rfc: null`: groom-readiness Step 1 routes to RFC generation.

   If `linear_readiness` is `needs-groom` AND size is XS/S:
   - Handle inline: confirm scope + ACs with the user conversationally (same as existing XS/S ungroomed path in groom-readiness Step 2). Do not invoke groom.
   - Store `linear_id` in session state for ship write-back.

6. **Classify size:**

| Size | Signal | Example |
|------|--------|---------|
| **XS** | One-line fix, typo, config tweak | Fix a typo in a label, bump a dep version |
| **S** | Single concern, clear scope, no design decisions needed | Add a column, remove a field, fix a bug in one component |
| **M** | Cross-layer or multi-concern, needs design thought | New API endpoint + frontend feature, remove a concept that touches many files |
| **L** | New domain/module, cross-cutting refactor | New domain module, redesign auth flow |
| **XL** | Multi-domain, multi-sprint, architectural overhaul | New billing system, full app rewrite |

   **Multi-task:** If sub-issues exist, classify each sub-issue individually. Present a table. The parent size is the largest sub-issue size.

7. **Confirm size with user** before proceeding.
8. **Issue tracking (M/L/XL only):**
   - From ticket: set status "In Progress"
   - From conversation: create issue in current cycle/sprint
9. **Create state file.** Derive the slug from the task (becomes the branch name slug after workspace setup, e.g., `fix-typo`). Create the state file at `{source_dir}/.pm/dev-sessions/{slug}.md` (run `mkdir -p {source_dir}/.pm/dev-sessions` first). In separate-repo mode, `source_dir` is the source repo root — dev sessions always live in the source repo, never in the PM repo. In same-repo mode, `source_dir` == cwd, so the path is `.pm/dev-sessions/{slug}.md` as before. Populate with initial state: stage, size, task context, project context from discovery, plus `run_id`, `started_at`, `stage_started_at`, and `completed_at: null`. If sub-issues exist, include a `## Sub-Issues` table. This is the single source of truth for the session.

## Stage Routing by Size

|  | XS | S | M | L | XL |
|---|---|---|---|---|---|
| Issue tracking | — | — | Yes | Yes | Yes |
| Worktree | Stage 2 | Stage 2 | Stage 2 | Stage 2 | Stage 2 |
| RFC check | groom-readiness (skip RFC) | groom-readiness (skip RFC) | groom-readiness | groom-readiness | groom-readiness |
| RFC generation | — | — | RFC generation (fresh agent writes RFC) | RFC generation | RFC generation |
| RFC review | — | — | RFC review (3+ reviewers) | RFC review | RFC review |
| Implement | TDD | TDD | Implementation (fresh agent, inside-out TDD) | Implementation | Implementation |
| Simplify | — | `pm:simplify` | `pm:simplify` | `pm:simplify` | `pm:simplify` |
| Design critique | — | If UI (lite, 1 round) | If UI (full) | If UI (full) | If UI (full) |
| QA | If UI (Quick) | If UI (Focused) | If UI (Full) | If UI (Full) | If UI (Full) |
| Code scan | Code scan | — | `/review` (full) | `/review` (full) | `/review` (full) |
| Verification | Verification gate | Verification gate | Verification gate | Verification gate | Verification gate |
| Finish | PR → merge-loop | PR → merge-loop | PR → merge-loop | PR → merge-loop | PR → merge-loop |
| Review feedback | — | — | `ship/references/handling-feedback.md` | handling-feedback | handling-feedback |
| Retro | Yes | Yes | Yes | Yes | Yes |

## Done-when

- Task context resolved (from backlog, MCP, or conversation)
- Size classified and confirmed by user
- State file created at `{source_dir}/.pm/dev-sessions/{slug}.md` with initial state
