# Staleness Thresholds

## Default Thresholds

| Data Type | File Pattern | Threshold |
|---|---|---|
| SEO | `*/seo.md` | 30 days |
| Profiles | `*/profile.md` | 60 days |
| Sentiment | `*/sentiment.md` | 60 days |
| Landscape | `landscape.md` | 90 days |
| Features | `*/features.md` | 90 days |
| API | `*/api.md` | 90 days |
| Topic research | `{pm_dir}/evidence/research/*.md` | 90 days |

## Override Schema

Defaults are hardcoded. Override in `{pm_state_dir}/config.json` under `refresh.thresholds`:

```json
{
  "refresh": {
    "thresholds": { "seo": 30, "profile": 60, "sentiment": 60, "landscape": 90, "features": 90, "api": 90, "topic": 90 }
  }
}
```

If `{pm_state_dir}/config.json` does not exist, use hardcoded defaults and treat SEO provider as `"none"`.

## Frontmatter Date Handling

### Read priority

When determining file age, read the most recent date from this priority order:
1. `refreshed:` (set by this skill on previous runs)
2. `updated:` (set by research/ingest skills on updates)
3. `profiled:` (set by research skill on initial creation — competitor files)
4. `created:` (set by research skill on initial creation — landscape, topic files)

Use the **most recent** date found across these keys.

### Write rule

After patching a file:
- Add or update `refreshed: YYYY-MM-DD` in frontmatter.
- **Never modify** the original `profiled:` or `created:` date.
- If `updated:` exists, leave it as-is.

If the file has no recognizable date key, treat it as stale.

## Section Detection Rules

| File Type | Detection Strategy | Expected Sections |
|---|---|---|
| seo.md | Fixed h2 headings | Traffic Overview, Top Organic Keywords, Top Pages by Traffic, Backlink Profile, Traffic by Country, Organic Competitors, Content Strategy Signals |
| profile.md | Fixed h2 headings | Overview, Positioning, Pricing, Strengths, Weaknesses, Notable Signals |
| api.md | Fixed h2 headings | API Availability, Auth Model, Core Entity Model, Endpoint Coverage, Webhooks, Rate Limits, SDKs and Integrations, Architectural Signals |
| sentiment.md | Fixed h2 headings | Overall Sentiment, Top Praise Themes, Top Complaint Themes, High-Severity Signals, Support Quality Signals, Churn Signals, Feature Requests (recurring), Reddit / Community Signals, Analyst Notes |
| features.md | **Age only** | Domain sections vary per competitor. Only check fixed sections: Recent Changelog Highlights, Capability Gaps |
| landscape.md | Fixed h2 headings | Market Overview, Key Players, Keyword Landscape, Market Segments, Initial Observations |
| topic research `.md` | Fixed h2 headings | Summary, Findings, Representative Quotes (conditional — only if internal evidence exists), Strategic Relevance, Implications, Open Questions, Source References |

## Ahrefs Tool-to-Section Mapping

For SEO, map Ahrefs tools to expected sections:

| Ahrefs Tool | Expected Section |
|---|---|
| site-explorer-metrics | Traffic Overview |
| site-explorer-organic-keywords | Top Organic Keywords |
| site-explorer-top-pages | Top Pages by Traffic |
| site-explorer-metrics-by-country | Traffic by Country |
| site-explorer-backlinks-stats | Backlink Profile |
| site-explorer-organic-competitors | Organic Competitors |
