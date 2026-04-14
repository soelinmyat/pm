# Memory Recall

Shared reference for surfacing past learnings at skill intake. Referenced by groom Phase 1 and dev intake.

---

## Selection Algorithm (recency-with-diversity)

Given the `entries` list from `{pm_dir}/memory.md` frontmatter:

1. **Sort** all entries by `date` descending (most recent first)
2. **Initialize** an empty `selected` list and a `week_counts` map (ISO week string to count)
3. **First pass — select with week cap:**
   - Iterate sorted entries in order
   - Compute the entry's ISO week as `{ISO year}-W{ISO week number}` (e.g. `2026-W15`)
   - If `week_counts[week]` >= 2, **skip** this entry (hard cap: max 2 per ISO week)
   - Otherwise, add to `selected` and increment `week_counts[week]`
   - Stop when `selected` has 5 entries or candidates are exhausted
4. **Second pass — category diversity reorder:**
   - Group the selected entries by `category`
   - Build the final list by round-robin across categories (pick one from each category in turn, cycling until all are placed)
   - Within each category, preserve the original recency order

Result: up to 5 entries, recent-biased, with at most 2 from any single ISO week, and categories interleaved.

---

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Fewer than 5 entries total | Surface all available entries |
| All entries from the same ISO week | Surface exactly 2 (week cap is hard) |
| All entries from the same category | Surface up to 5 (category diversity is a preference, not a hard cap) |
| Zero entries or file missing | Show: "No past learnings yet — they'll appear here after your first completed session." |

---

## Display Format

Present selected entries as a numbered list:

```
**Past learnings:**
1. {learning} — _{category}_, {date}
2. {learning} — _{category}_, {date}
...

Say "expand N" for detail on any entry.
```

---

## Expand Behavior

When the user says "expand N":

- If the entry has a `detail` field: show the detail text
- If the entry has no `detail` field: show "No additional detail recorded."

---

## Analytics (optional)

If analytics is enabled (`.pm/analytics/` directory exists), log each expansion event:

```yaml
event: memory_expand
entry_date: {date of the expanded entry}
category: {category of the expanded entry}
session_slug: {current session slug}
timestamp: {ISO 8601 timestamp}
```

Append to the appropriate analytics JSONL file in `.pm/analytics/`.
