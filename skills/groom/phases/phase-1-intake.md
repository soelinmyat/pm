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

3. Check `pm/research/` for existing context on this topic. If relevant findings exist, note them:
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

5. Derive a topic slug from the idea (kebab-case, max 4 words).

6. Create `.pm/groom-sessions/` if it doesn't exist. Write initial state to `.pm/groom-sessions/{slug}.md`:

```yaml
topic: "{topic}"
phase: intake
started: YYYY-MM-DD
updated: YYYY-MM-DD
codebase_available: true | false
codebase_context: "{brief summary of related existing code, or 'greenfield'}"
```
