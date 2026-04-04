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

4. Update state:

```yaml
phase: research
research_location: pm/research/{topic-slug}/
```
