---
name: Intake
order: 1
description: Capture the idea, clarify, derive slug, detect KB maturity, write initial state
---

### Step 1: Intake

**If grooming an existing idea from backlog:** Check if `{pm_dir}/backlog/{slug}.md` exists with `status: idea`. If so, read it and pre-fill intake from its outcome, signal sources, and competitor context. Confirm with the user:
> "Grooming idea '{title}' from backlog. Here's what we know: {one-liner}. Anything to add or change before we proceed?"

Skip to step 3 after confirmation.

**If invoked from dev with Linear issue context** (dev passes title, description, labels, ID, and slug in the preceding conversation messages):

This is a Linear issue that failed the dev-readiness check. Dev has already fetched the issue and identified the gaps. No CLI flags — groom reads the Linear context from the conversation.

1. Set `linear_id` in the groom session state.
2. Pre-fill the topic from the Linear title.
3. Use the slug specified by dev (from the conversation).
4. Pre-fill existing context from the Linear description.
5. Confirm with the user:
   > "Grooming Linear issue {ID}: '{title}'. Dev flagged gaps: {gaps from dev session}.
   > Here's the current description: {first 200 chars}...
   > Anything to add before I proceed?"
6. Skip to step 3 (existing research check) after confirmation.

**If promoted from think:** Check if `{pm_dir}/thinking/{slug}.md` exists (the synthesize step sets `status: promoted` and `promoted_to` in the thinking artifact). If found, read it and pre-fill intake from its Problem, Direction, Key tradeoffs, and Open questions. Confirm with the user:
> "Picking up from your thinking on '{topic}'. Direction: {direction}. Anything to add or change before we scope it?"

When the groom session produces a backlog item, set the `thinking` field on the backlog item to the relative path of the thinking artifact (e.g., `thinking/{slug}.md`). This creates the bidirectional link between the backlog item and the thinking that originated it.

Skip to step 3 after confirmation. The thinking artifact already challenged the framing — groom doesn't need to redo that work.

**Otherwise (from scratch):**

1. Ask: "What's the idea?"
   One question. Wait for the full answer.

2. Derive 2-4 search terms from the user's answer. Search `{pm_dir}/thinking/` for related artifacts (use the search protocol in `${CLAUDE_PLUGIN_ROOT}/references/kb-search.md`, domain: `thinking`, index: `{pm_dir}/thinking/index.md`). If a match is found:
   > "Found existing thinking on '{topic}'. Use that as the starting point?"
   If yes, treat as "promoted from think" above.

3. If no thinking artifact exists, recommend think first:
   > "This idea hasn't been through `/pm:think` yet. Think challenges the framing before committing to a full proposal. Run think first, or proceed straight to grooming?"
   If the user says proceed, continue. This is a recommendation, not a gate.

4. Clarify if needed — ask ONE follow-up at a time, only if the answer didn't already cover it:
   - "Is this a user pain you've observed, or a proposed solution?" (problem vs. solution)
   - "Is this a small UX improvement or a new capability area?" (scope signal)
   - "What triggered this — a competitor move, user request, or something else?" (why now)
   Skip any question the user's initial answer already addressed.

5. **Surface past learnings** — Read `{pm_dir}/memory.md`. Select up to 5 entries using the algorithm in `${CLAUDE_PLUGIN_ROOT}/references/memory-recall.md`. Display them to the user so past context informs the grooming session. If the file is missing or has zero entries, show "No past learnings yet — they'll appear here after your first completed session." and continue.

6. **Feature inventory check.** Check if `{pm_dir}/product/features.md` exists.

   If it exists, parse frontmatter for `feature_count` and `area_count`. Read the body for the feature list. Report to user:
   > "Found feature inventory with {feature_count} features across {area_count} areas. Existing capabilities will be referenced during scope review."

   Store in groom session state:
   - `product_features_available: true`
   - `product_feature_count: {feature_count}`

   If it does not exist, skip silently. Set `product_features_available: false` in session state.

7. **Codebase scan** (if `codebase_available: true` in groom state):
   Explore the project source code for existing implementation related to this idea. Look for:
   - Existing files, modules, or components that touch this feature area
   - Partial implementations or related functionality already built
   - UI patterns, API endpoints, or data models that would be affected

   If related code exists, note it:
   > "Found existing code related to this idea:
   > - {file/path}: {what it does and how it relates}
   > This will inform scoping and technical feasibility."

   If no related code exists, note:
   > "No existing implementation found for this feature area — this is greenfield."

   This scan is lightweight — save deep analysis for the EM review in Step 5.

8. **KB maturity detection.** Check the knowledge base to determine the max available groom tier:

   | Signal | Check | Present? |
   |---|---|---|
   | Strategy | `{pm_dir}/strategy.md` exists | yes / no |
   | Insights | `{pm_dir}/insights/.hot.md` exists and has entries | yes / no |
   | Competitors | Any `{pm_dir}/evidence/competitors/*/profile.md` exists | yes / no |

   Classify maturity:
   - **Fresh** (none of the three signals) — max tier: `quick`
   - **Developing** (strategy OR insights present — either one is enough) — max tier: `standard`
   - **Mature** (strategy AND insights AND competitors) — max tier: `full`

   Report to the user:
   > "KB maturity: **{level}** (strategy: {yes/no}, insights: {yes/no}, competitors: {yes/no}).
   > Max available tier: **{tier}**."

   If the user explicitly requested a tier higher than the max:
   > "You requested `{requested}` but the KB only supports `{max}` right now.
   > Missing: {list what's absent}.
   > Options:
   > (a) Proceed with `{max}` tier
   > (b) Build the missing prerequisites first (I can help with /pm:strategy or /pm:research)"
   Wait for the user's choice.

9. Derive a topic slug from the idea (kebab-case, max 4 words).

10. Write initial state to `{pm_state_dir}/groom-sessions/{topic-slug}.md` (create `{pm_state_dir}/groom-sessions/` first if needed):

```yaml
topic: "{topic}"
runtime: claude | codex
phase: intake
groom_tier: "{effective tier after maturity cap}"
started: YYYY-MM-DD
updated: YYYY-MM-DD
run_id: "{PM_RUN_ID}"
started_at: YYYY-MM-DDTHH:MM:SSZ
phase_started_at: YYYY-MM-DDTHH:MM:SSZ
completed_at: null
codebase_available: true | false
codebase_context: "{brief summary of related existing code, or 'greenfield'}"
kb_maturity: fresh | developing | mature
kb_maturity_tier: quick | standard | full
kb_signals:
  strategy: true | false
  insights: true | false
  competitors: true | false
```
