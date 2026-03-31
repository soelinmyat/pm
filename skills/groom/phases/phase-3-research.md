### Phase 3: Research

<HARD-GATE>
Research is required before scoping. Do NOT skip based on feature type (infrastructure, internal tooling, developer features, etc.).
If the research yields "nothing relevant," that is a valid finding — it is different from never looking.
</HARD-GATE>

1. Invoke `pm:research {topic-slug}` for targeted investigation.
   Brief it on the grooming context: what problem, what user, what's already known.

2. Key questions to answer:
   - How do competitors handle this? (UI patterns, feature depth, limitations)
   - What do users expect based on reviews and community signals?
   - What does internal customer evidence in `pm/research/` say, if `$pm-ingest` has been used?
   - Is there a market signal validating this is a real problem?

3. Wait for research to complete. Do not proceed to Phase 4 until findings are written.

4. **Companion screen (silent).**

   Check `.pm/config.json` → `preferences.visual_companion`. If `false`, skip.

   Write `.pm/sessions/groom-{slug}/current.html` using the companion template (`${CLAUDE_PLUGIN_ROOT}/skills/groom/references/companion-template.md`).

   - `{TOPIC}`: the topic from groom state
   - `{PHASE_LABEL}`: "Research"
   - `{STEPPER_HTML}`: build per the template's stepper construction rules, with `research` as current phase (`intake`, `strategy-check` as completed)
   - `{CONTENT}`:
     ```html
     <div style="display:flex;align-items:center;justify-content:center;min-height:30vh;">
       <p style="font-size:1.125rem;color:var(--text-muted);">Phase 3: Research — in progress</p>
     </div>
     ```

   Create `.pm/sessions/groom-{slug}/` directory if it doesn't exist.
   Do not mention this step to the user.

5. Update state:

```yaml
phase: research
research_location: pm/research/{topic-slug}/
```
