# Note Digest Pre-Step

Run this before research intake (groom Phase 3 standard/full, or pm:research). Synthesizes un-digested notes from the last 30 days into research themes.

## Flow

1. **Scan for note files.** Glob `pm/evidence/notes/*.md`. If the directory does not exist or contains no files, skip silently — no user interaction needed.

2. **Filter to recent months.** Parse each file's frontmatter. Keep only files where `month` is within 30 days of today. For example, if today is 2026-04-15, keep 2026-04 and 2026-03 but not 2026-02.

3. **Collect un-digested entries.** For each matching file:
   - Parse note entries (split on `### ` headings).
   - Read the `digested_through` frontmatter value.
   - If `digested_through` is `null`, all entries are un-digested.
   - If `digested_through` is a timestamp, only entries with timestamps **after** that value are un-digested.
   - Collect all un-digested entries across all matching files.

4. **Check threshold.** If fewer than 1 un-digested entry found, skip silently. Proceed to the next phase.

5. **Cluster by topic.** Group the un-digested entries by topic/pain point:
   - Use note content, tags, and source type as clustering signals.
   - Similar pain points, competitor mentions, or feature areas group together.
   - Aim for 2-5 clusters depending on note volume.

6. **Write or update research themes.** For each cluster:
   - If 2+ entries in the cluster, create or update a theme file in `pm/evidence/research/`.
   - If only 1 entry in the cluster, flag it in your output but do not create a theme file (single-signal threshold).
   - Theme files use the existing research schema:
     ```yaml
     type: evidence
     evidence_type: research
     source_origin: internal
     created: {today}
     sources: []
     cited_by: []
     ```
   - **Mixed-origin write contract:** If a theme file already exists with `source_origin: external`, set it to `mixed` (never overwrite to `internal`). If it already says `internal` or `mixed`, leave as-is.
   - Append the note content as supporting evidence in the theme file body.

7. **Update digested_through.** For each processed monthly log file, set `digested_through` in the frontmatter to the timestamp of the newest note processed from that file.

8. **Update indexes.** If any new or modified theme files were created:
   - Update `pm/evidence/research/index.md` to include new themes.
   - Update `pm/evidence/research/log.md` with create/update entries.
   - Update `pm/evidence/index.md` if it exists and tracks research topics.

9. **Report.** Briefly note what was digested:
   > "Digested {N} notes into {M} research themes: {theme-list}"
   
   Or if nothing to digest, skip silently.
