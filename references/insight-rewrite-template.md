# Insight Rewrite Template

Body template for insight files rewritten by Step 5.5 of insight-routing. The rewrite replaces everything below the YAML frontmatter fence (`---`).

---

## Required Sections

### 1. Synthesis

2-4 paragraphs integrating ALL evidence sources listed in the insight's `sources` array. Write as an evolving narrative — not a list of summaries. Connect findings across sources, highlight patterns, and note where evidence converges or diverges.

Rules:
- Every source must be referenced at least once.
- Do not invent findings not present in the evidence.
- Write in present tense, third person.
- If sources conflict, state the conflict explicitly rather than choosing a side.

### 2. Key Findings

Numbered list. Each finding cites its source file path in parentheses.

```
1. Finding text (evidence/research/source-file.md)
2. Finding text (evidence/research/other-source.md)
3. Finding that spans multiple sources (evidence/research/a.md, evidence/research/b.md)
```

Rules:
- One finding per numbered item.
- Every finding must cite at least one source path.
- Order by significance, most important first.
- Keep each finding to 1-2 sentences.

### 3. Confidence Rationale

1-2 sentences explaining why the current confidence level is what it is. Reference the number and quality of sources.

**Omit this section entirely when confidence is `low`.** Low-confidence insights have too little evidence to justify a rationale.
