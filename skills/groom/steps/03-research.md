---
name: Research
order: 3
description: Invoke pm:research for competitive and market intelligence, or inline assessment for quick tier
applies_to: [quick, standard, full]
---

### Step 3: Research

<!-- Tier routing: keep in sync with SKILL.md "Research by tier" -->

Read the current `groom_tier` from the session state. Route accordingly:

---

#### Quick tier: inline assessment

Perform a lightweight inline research pass. Do NOT invoke `pm:research`.

1. Check `{pm_dir}/evidence/research/` for existing research that covers this topic.
2. Write a 2-3 sentence competitive assessment inline in the groom output:
   - How do competitors handle this? (or "no prior art found")
   - Is this table stakes, differentiator, or net-new?
   - Any user signals from evidence files?
3. If the topic turns out to be more complex than expected, say:
   "This looks like it needs deeper research. Consider upgrading to standard tier."

4. **Research freshness check.** If existing research files were found in step 1, check their age using the same freshness check described in the Standard / Full tier section below (step 4). Apply the same date priority chain, thresholds, warning format, and `stale_research` state field. If no existing research was found, set `stale_research: []`.

5. Update state:

```yaml
phase: research
research_location: null  # inline assessment, no separate file
research_note: "{1-line summary of inline finding}"
```

---

#### Standard / Full tier

**Note digest pre-step:** Before proceeding to research, read and follow `${CLAUDE_PLUGIN_ROOT}/skills/note/digest.md`. This synthesizes any un-digested quick-capture notes from the last 30 days into research themes, so the research step has the latest internal signals. If no un-digested notes exist, the pre-step completes silently.

<HARD-GATE>
Research is required before scoping. Do NOT skip based on feature type (infrastructure, internal tooling, developer features, etc.).
If the research yields "nothing relevant," that is a valid finding — it is different from never looking.
</HARD-GATE>

1. Invoke `pm:research {topic-slug}` for targeted investigation.
   Brief it on the grooming context: what problem, what user, what's already known.

2. Key questions to answer:
   - How do competitors handle this? (UI patterns, feature depth, limitations)
   - What do users expect based on reviews and community signals?
   - What does internal customer evidence in `{pm_dir}/evidence/research/` say, if `$pm-ingest` has been used?
   - Is there a market signal validating this is a real problem?

3. Wait for research to complete. Do not proceed to Step 4 until findings are written.

4. **Research freshness check.** After research completes, check the age of all cited research files. This is annotation-only — groom always proceeds regardless of staleness.

   For each cited research file (the file at `research_location` plus any other files in `{pm_dir}/evidence/research/` or `{pm_dir}/evidence/competitors/` referenced by the research output):

   a. Read the file's YAML frontmatter. Determine the file's age using the `pm:refresh` date priority chain — use the **most recent** date found:
      1. `refreshed:`
      2. `updated:`
      3. `profiled:`
      4. `created:`

      If none of these date fields exist, treat the file as stale.

   b. Determine the file type and threshold:
      - Competitor profiles (`*/profile.md`): **60 days**
      - Competitor sentiment (`*/sentiment.md`): **60 days**
      - Landscape (`landscape.md`): **90 days**
      - Competitor features (`*/features.md`): **90 days**
      - Competitor API (`*/api.md`): **90 days**
      - Topic research (`{pm_dir}/evidence/research/*.md`): **90 days**

   c. If age exceeds threshold (or no date fields found), print:
      > "Research '{name}' is {N} days old (threshold: {T} days for {type}). Consider running `pm:refresh` after this session. Proceeding with stale data flagged."

   d. Collect all stale entries into the `stale_research` state field:
      ```yaml
      stale_research:
        - name: "{filename}"
          age_days: {N}
          threshold_days: {T}
          type: "{topic | profile | sentiment | landscape | features | api}"
      ```

   If all cited research is within threshold, set `stale_research: []` and show no warning.

5. Update state:

```yaml
phase: research
research_location: {pm_dir}/evidence/research/{topic-slug}.md
```
