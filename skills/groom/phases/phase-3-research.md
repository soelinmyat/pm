### Phase 3: Research

<!-- Tier routing: keep in sync with SKILL.md "Research by tier" -->

Read the current `groom_tier` from the session state. Route accordingly:

---

#### Quick tier: inline assessment

Perform a lightweight inline research pass. Do NOT invoke `pm:research`.

1. Check `pm/evidence/research/` for existing research that covers this topic.
2. Write a 2-3 sentence competitive assessment inline in the groom output:
   - How do competitors handle this? (or "no prior art found")
   - Is this table stakes, differentiator, or net-new?
   - Any user signals from evidence files?
3. If the topic turns out to be more complex than expected, say:
   "This looks like it needs deeper research. Consider upgrading to standard tier."

4. Update state:

```yaml
phase: research
research_location: null  # inline assessment, no separate file
research_note: "{1-line summary of inline finding}"
```

---

#### Standard / Full tier

**Note digest pre-step:** Before proceeding to research, read and follow `${CLAUDE_PLUGIN_ROOT}/skills/note/digest.md`. This synthesizes any un-digested quick-capture notes from the last 30 days into research themes, so the research phase has the latest internal signals. If no un-digested notes exist, the pre-step completes silently.

<HARD-GATE>
Research is required before scoping. Do NOT skip based on feature type (infrastructure, internal tooling, developer features, etc.).
If the research yields "nothing relevant," that is a valid finding — it is different from never looking.
</HARD-GATE>

1. Invoke `pm:research {topic-slug}` for targeted investigation.
   Brief it on the grooming context: what problem, what user, what's already known.

2. Key questions to answer:
   - How do competitors handle this? (UI patterns, feature depth, limitations)
   - What do users expect based on reviews and community signals?
   - What does internal customer evidence in `pm/evidence/research/` say, if `$pm-ingest` has been used?
   - Is there a market signal validating this is a real problem?

3. Wait for research to complete. Do not proceed to Phase 4 until findings are written.

4. Update state:

```yaml
phase: research
research_location: pm/evidence/research/{topic-slug}.md
```
