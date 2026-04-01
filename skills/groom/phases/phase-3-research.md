### Phase 3: Research

**Emit event — phase started:**
```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/emit-event.sh" "phase_started" "${SLUG:-groom-$$}" "{\"phase\":\"research\"}"
```

<HARD-GATE>
Research is required before scoping. Do NOT skip based on feature type (infrastructure, internal tooling, developer features, etc.).
If the research yields "nothing relevant," that is a valid finding — it is different from never looking.
</HARD-GATE>

1. Check the tier in `.pm/groom-sessions/{slug}.md`:
   - **Standard tier:** Invoke `pm:research quick {topic-slug}` — fast inline answers, no full landscape or competitor deep-dive.
   - **Full tier:** Invoke `pm:research {topic-slug}` — full targeted investigation.

   Brief it on the grooming context: what problem, what user, what's already known.

2. Key questions to answer:
   - How do competitors handle this? (UI patterns, feature depth, limitations)
   - What do users expect based on reviews and community signals?
   - What does internal customer evidence in `pm/research/` say, if `$pm-ingest` has been used?
   - Is there a market signal validating this is a real problem?

3. **Verify research output.** After `pm:research` completes, confirm `pm/research/{topic-slug}/findings.md` exists and has content. If it doesn't:
   > "Research didn't produce a findings file. Re-run research?"
   Do NOT proceed to Phase 4 until `findings.md` exists. Only update `research_location` in the state file after verification.

4. **Dashboard update.** The progressive proposal at `/groom/{slug}` auto-renders the research section from `findings.md`. The section stays greyed out until the file exists — setting `research_location` alone is not enough.

5. Update state (only after findings.md is verified):

```yaml
phase: research
research_location: pm/research/{topic-slug}/
```
