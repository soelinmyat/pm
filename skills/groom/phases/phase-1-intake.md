### Phase 1: Intake

**If grooming an existing idea from backlog:** Check if `pm/backlog/{slug}.md` exists with `status: idea`. If so, read it and pre-fill intake from its outcome, signal sources, and competitor context. Confirm with the user:
> "Grooming idea '{title}' from backlog. Here's what we know: {one-liner}. Anything to add or change before we proceed?"

Skip to step 3 after confirmation.

**Otherwise:**

1. Ask: "What's the idea?"
   One question. Wait for the full answer.

2. Clarify if needed — ask ONE follow-up at a time, only if the answer didn't already cover it:
   - "Is this a user pain you've observed, or a proposed solution?" (problem vs. solution)
   - "Is this a small UX improvement or a new capability area?" (scope signal)
   - "What triggered this — a competitor move, user request, or something else?" (why now)
   Skip any question the user's initial answer already addressed.

3. Check `pm/evidence/research/` for existing context on this topic. If relevant findings exist, note them:
   > "Found related research at {path}. I'll use it in Phase 3."

4. **Codebase scan** (if `codebase_available: true` in groom state):
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

   This scan is lightweight — save deep analysis for the EM review in Phase 4.5.

5. **KB maturity detection.** Check the knowledge base to determine the max available groom tier:

   | Signal | Check | Present? |
   |---|---|---|
   | Strategy | `pm/strategy.md` exists | yes / no |
   | Research | Any file exists in `pm/evidence/research/` (excluding index.md) | yes / no |
   | Competitors | Any `pm/insights/competitors/*/profile.md` exists | yes / no |

   Classify maturity:
   - **Fresh** (none of the three signals) — max tier: `quick`
   - **Developing** (strategy OR research present — either one is enough) — max tier: `standard`
   - **Mature** (strategy AND research AND competitors) — max tier: `full`

   Report to the user:
   > "KB maturity: **{level}** (strategy: {yes/no}, research: {yes/no}, competitors: {yes/no}).
   > Max available tier: **{tier}**."

   If the user explicitly requested a tier higher than the max:
   > "You requested `{requested}` but the KB only supports `{max}` right now.
   > Missing: {list what's absent}.
   > Options:
   > (a) Proceed with `{max}` tier
   > (b) Build the missing prerequisites first (I can help with /pm:strategy or /pm:research)"
   Wait for the user's choice.

6. Derive a topic slug from the idea (kebab-case, max 4 words).

7. Write initial state to `.pm/groom-sessions/{topic-slug}.md` (create `.pm/groom-sessions/` first if needed):

```yaml
topic: "{topic}"
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
  research: true | false
  competitors: true | false
```
