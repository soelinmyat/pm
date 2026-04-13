---
name: Mine Signals
order: 2
description: Read the available knowledge-base signal sources and extract candidate opportunity signals
---

## Goal

Mine the available knowledge base for the gaps, pains, trends, and evidence that can support real feature ideas.

## How

Read every available signal source before generating ideas. Each idea must trace back to at least one signal.

| Source | Path | What to extract |
|---|---|---|
| Strategy priorities | `{pm_dir}/strategy.md` § 6 | Top 3 priorities — ideas should advance these |
| Strategy non-goals | `{pm_dir}/strategy.md` § 7 | Filter out ideas that conflict |
| Market gaps | `{pm_dir}/evidence/competitors/index.md` § Market Gaps | Capabilities absent across competitors |
| Feature matrix | `{pm_dir}/evidence/competitors/index.md` | Cells where the product shows "No" or "Planned" |
| Competitor weaknesses | `{pm_dir}/evidence/competitors/*/profile.md` § Weaknesses | Problems competitors have that we could solve better |
| Landscape observations | `{pm_dir}/insights/business/landscape.md` § Initial Observations | Whitespace and macro trends |
| Keyword opportunities | `{pm_dir}/insights/business/landscape.md` § Keyword Landscape | Low-competition, high-intent keywords |
| Customer evidence | `{pm_dir}/evidence/research/index.md` | Internal/mixed topics with high evidence counts |
| Topic research | `{pm_dir}/evidence/research/*.md` | Open questions and implications |
| Existing backlog | `{pm_dir}/backlog/*.md` | Avoid duplicating what's already there |

For each available source, extract:
- **Gaps** — things that should exist but do not
- **Pains** — problems users or competitors have
- **Trends** — macro forces creating new demand
- **Evidence** — customer signals pointing to unmet needs

## Done-when

You have a working set of evidence-backed opportunity signals from the knowledge base and can cite the file paths they came from.
