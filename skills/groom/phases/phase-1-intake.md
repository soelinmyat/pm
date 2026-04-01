### Phase 1: Intake

**Emit event — phase started:**
```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/emit-event.sh" "phase_started" "${SLUG:-groom-$$}" "{\"phase\":\"intake\"}"
```

**Config bootstrap (silent).** Before anything else in this phase:

1. If `.pm/config.json` does not exist:
   a. Create `.pm/` directory if it doesn't exist.
   b. Create `.pm/groom-sessions/` directory if it doesn't exist.
   c. Create `pm/` directory if it doesn't exist.
   d. Write `.pm/config.json` with default config:
      ```json
      {
        "config_schema": 1,
        "integrations": {
          "linear": { "enabled": false },
          "seo": { "provider": "none" }
        },
        "preferences": {
          "visual_companion": true,
          "backlog_format": "markdown"
        }
      }
      ```
   e. Do NOT print any message, warning, or prompt to run /pm:setup. Proceed silently.
2. If `.pm/config.json` exists but contains malformed JSON (parse error): warn the user ("Config file exists but has invalid JSON — proceeding with defaults.") and use the default config values in-memory for this session. Do NOT overwrite the file.
3. If `.pm/config.json` exists and is valid JSON: no-op. Do not overwrite, merge, or modify.
4. If `.pm/` directory exists but `config.json` does not (partial state): create `config.json` without touching other `.pm/` contents.

After the bootstrap, proceed with the normal intake flow below.

---

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

2.5. **Tier selection.** Based on the idea captured in steps 1-2, auto-detect a tier and suggest it with a one-line reason. Present all three options so the user can confirm or override:

   > "I'd suggest **{tier}** — {one-line reason}. Quick, Standard, or Full?"

   Detection signals:
   - Bug fix, typo, config tweak, single-concern gap → **Quick**
   - Touches multiple concerns but has clear direction → **Standard**
   - New capability area, ambiguous direction, or multi-domain → **Full**
   - If `/dev` passed a `groom_tier`, use it as the default suggestion

   One question. Wait for the answer. Store the tier in the state file (step 6).

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

6. **Intake summary.** Synthesize everything captured so far into the state file. Write a one-sentence `outcome` (what changes for the user) and a short `trigger` (why now). These flow into the dashboard's hero subtitle and Problem Statement section.

   Create `.pm/groom-sessions/` if it doesn't exist. Write initial state to `.pm/groom-sessions/{slug}.md`:

```yaml
topic: "{topic}"
tier: quick | standard | full
phase: intake
started: YYYY-MM-DD
updated: YYYY-MM-DD
outcome: "{one-sentence: what changes for the user when this ships}"
trigger: "{what prompted this — user request, competitor move, pain point, etc.}"
codebase_available: true | false
codebase_context: "{brief summary of related existing code, or 'greenfield'}"
```

7. **Companion screen (silent).**

   Check `.pm/config.json` → `preferences.visual_companion`. If `false`, skip.

   Write `.pm/sessions/groom-{slug}/current.html` using the companion template (`${CLAUDE_PLUGIN_ROOT}/skills/groom/references/companion-template.md`).

   - `{TOPIC}`: the topic from step 1
   - `{PHASE_LABEL}`: "Intake"
   - `{STEPPER_HTML}`: build per the template's stepper construction rules, with `intake` as current phase
   - `{CONTENT}`:
     ```html
     <div style="display:flex;align-items:center;justify-content:center;min-height:30vh;">
       <p style="font-size:1.125rem;color:var(--text-muted);">Phase 1: Intake — in progress</p>
     </div>
     ```

   Create `.pm/sessions/groom-{slug}/` directory if it doesn't exist.
   Do not mention this step to the user.

8. **Visual companion auto-open.**

   <HARD-GATE>
   You MUST execute this step. Do not skip it. Do not proceed to Phase 2 until this step completes.
   </HARD-GATE>

   1. Read `.pm/config.json` (already loaded by the bootstrap above).
   2. Check `preferences.visual_companion`:
      - If `false`: skip silently. Proceed to Phase 2.
      - If `true`, unset, or file missing: open the dashboard (step 3 below).
   3. Start the dashboard server (idempotent — skips if already running):
      ```bash
      bash ${CLAUDE_PLUGIN_ROOT}/scripts/start-server.sh --project-dir "$PWD" --mode dashboard
      ```
      Parse the JSON output to get the `url` field.
   4. Open `{url}/groom/{slug}` in the default browser:
      ```bash
      open "{url}/groom/{slug}"  # macOS
      xdg-open "{url}/groom/{slug}"  # Linux
      ```
   5. Tell the user:
      > "Session view open in browser. It'll update as we go."

   This is a session-level decision. If visual companion is active, use the browser for all visual content throughout the session (mockups, diagrams, comparisons, wireframes). The user can disable future auto-open by setting `visual_companion: false` in `.pm/config.json`.
