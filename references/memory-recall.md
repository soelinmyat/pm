# Memory Recall

Shared reference for surfacing past learnings at skill intake. Referenced by groom Phase 1 and dev intake.

---

## Selection Algorithm (relevance before recency)

Given the `entries` list from `{pm_dir}/memory.md` frontmatter and the current task/context:

1. Identify applicable lessons by user problem, domain rule, affected boundary, failure mode, and platform. Inspect the supporting detail when a lesson's applicability or evidence is unclear. An older timezone lesson for leave calculations outranks a recent unrelated CI lesson for this task.
2. Exclude lessons contradicted or superseded by stronger current evidence; label uncertain historical claims rather than treating them as product rules. Pinned entries remain discoverable but do not override current authority.
3. Select up to five most relevant entries and explain each entry's relevance. Among equally relevant entries, prefer newer evidence and varied categories/weeks. Recency and diversity are tie-breakers, not hard exclusions of applicable lessons.
4. If additional applicable lessons are essential to correctness, include or link their details rather than dropping them because of the display limit. If none applies, say no applicable past learnings were found; do not inject unrelated recent advice.

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Fewer than 5 applicable entries | Surface those entries only |
| All applicable entries from the same ISO week/category | Surface up to 5; no week/category cap excludes relevant evidence |
| Older domain lesson, newer unrelated lesson | Select the domain lesson first |
| Lesson lacks supporting detail | Treat as a hypothesis; confirm against current sources before relying on it |
| Zero entries or file missing | Show: "No past learnings yet — they'll appear here after your first completed session." |

---

## Display Format

Present selected entries as a numbered list:

```
**Past learnings:**
1. {learning} — _{category}_, {date}; applies because {task-relevant reason}
2. {learning} — _{category}_, {date}; applies because {task-relevant reason}
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
