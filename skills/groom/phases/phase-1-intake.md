### Phase 1: Intake

**If grooming an existing idea from backlog:** Check if `pm/backlog/{slug}.md` exists with `status: idea`. If so, read it and pre-fill intake from its outcome, signal sources, and competitor context. Confirm with the user:
> "Grooming idea '{title}' from backlog. Here's what we know: {one-liner}. Anything to add or change before we proceed?"

Skip to step 3 after confirmation. (Steps 3, 3.5, 4, 5, 6 run normally.)

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

3.5. **Memory injection.** Check `pm/memory.md` for past session learnings.

   If `pm/memory.md` does not exist, or exists but has no entries, or frontmatter cannot be parsed — skip this step silently. Do not print any message.

   If entries exist:
   1. Read `pm/memory.md` and parse the frontmatter.
   2. Sort the `entries` array by `date` descending (most recent first).
   3. Take the first 5 entries (or all if fewer than 5).
   4. Surface them as one-line summaries:

      > "From past sessions:
      > - {entry1.learning}
      > - {entry2.learning}
      > - {entry3.learning}
      > Want detail on any of these before we proceed?"

   5. If the user asks for detail on a specific entry:
      - Show the `detail` field (if it exists) as a fenced blockquote below the summary line.
      - If no `detail` field exists for that entry, say: "No additional detail recorded for that entry."
      - Then ask: "Ready to proceed with intake?"
   6. If the user says no detail is needed (or gives any response that isn't a detail request), proceed to step 4.

   **Token budget:** Only surface the `learning` field (one-line summaries). Never inject the `detail` field automatically. Full detail is on-demand only. Max 5 entries ~ 500 tokens.

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
