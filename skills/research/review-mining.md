# Review Mining Methodology

Reviews are the most direct signal of what a product actually delivers versus what it claims. This guide covers where to look, what to extract, and how to synthesize findings into `sentiment.md`.

---

## Where to Search

Work through sources in this order. Stop when you have 15-20 substantive reviews or have exhausted all sources.

### Tier 1: Structured Review Platforms

**G2** (`g2.com/products/{slug}/reviews`)
- Filter by: Most Recent, then Most Helpful.
- Read reviews from the last 12 months first. Older reviews reflect a past product state.
- Note the reviewer's role and company size — a 5-star from a 10-person company means something different than from a 2,000-person company.

**Capterra** (`capterra.com/reviews/...`)
- Often overlaps with G2, but attracts different buyer personas (more SMB).
- Check the "Cons" field — it is a required field and tends to be candid.
- The "Reasons for Switching" field is a churn signal goldmine.

**Trustpilot** — primarily B2C skew, but relevant for prosumer tools.

**Software Advice** — aggregates Capterra data; lower priority unless uniquely present.

### Tier 2: Community Platforms

**Reddit**
Search `site:reddit.com "{Company Name}"` and browse:
- `r/[industry]` — e.g., `r/projectmanagement`, `r/facilities`, `r/saas`
- `r/[category]` — e.g., `r/workforcemgmt`
- Direct product subreddit if it exists

Reddit is less filtered than review sites. Complaints surface faster, praise is more authentic.

**App Stores** (if mobile app exists)
- Apple App Store: search by app name, filter by 1-star and 5-star separately.
- Google Play Store: same approach.
- Mobile reviews often surface UX and reliability issues that desktop reviews miss.

**ProductHunt** (`producthunt.com/products/{slug}`)
- Read the comments on launch day — unfiltered first impressions from early adopters.
- Upvote count and comment quality signal early traction.

**Industry forums and Slack communities**
Search for the competitor name in relevant Slack community archives or forum threads. These are highly candid and often reveal internal-use cases not covered by formal reviews.

---

## What to Extract

For each review, extract:

1. **Reviewer context:** Role, company size, use duration.
2. **Praise point:** Specific, concrete. "Easy to set up" is weak; "Imported our 500 locations in under an hour" is strong.
3. **Complaint:** Specific and actionable. Note whether it is a UX complaint, a missing feature, a reliability issue, or a support issue.
4. **Comparison mention:** Any competitor named as "what we switched from" or "what we considered."
5. **Churn signal:** Explicit statements about leaving, considering leaving, or switching.

Do not paraphrase away specificity. Preserve numbers and concrete details.

---

## Theme Clustering

After collecting 15-20 data points:

1. **Group by topic.** Cluster reviews that mention the same capability, pain, or scenario. Give each cluster a short label ("Onboarding friction," "Reporting depth," "Mobile reliability").

2. **Count and weight.** Track how many reviews mention each theme. Apply recency weighting: a theme appearing in 3 reviews from the last 6 months outweighs one in 5 reviews from 2 years ago.

3. **Separate praise from complaints.** Do not conflate: "fast search" (praise) and "slow bulk actions" (complaint) may both reference performance but are different signals.

4. **Flag high-severity complaints.** Any complaint referencing data loss, security, billing disputes, or support non-response should be called out explicitly regardless of count — they reveal risk posture.

5. **Identify feature requests.** Recurring asks for absent features ("I wish it had X") signal market gaps. These are distinct from complaints about existing features.

---

## Sentiment Weighting

Apply these adjustments when assigning overall sentiment:

- **Recency:** Reviews from the last 6 months carry 2x weight versus 12-24 months ago.
- **Specificity:** Specific reviews carry more weight than vague ones.
- **Role match:** Reviews from your target ICP carry more weight than off-profile buyers.
- **Verified purchase:** On platforms that distinguish verified purchases, weight those higher.
- **Volume asymmetry:** Unhappy customers review more readily. Adjust for this: a 70% positive rate often reflects genuine satisfaction.

State the weighting method used when reporting overall sentiment in `sentiment.md`.

---

## Structuring Findings in sentiment.md

```markdown
---
type: competitor-sentiment
company: {Company Name}
slug: {slug}
profiled: YYYY-MM-DD
review_count_sampled: {N}
sources:
  - platform: G2
    url: {url}
    accessed: YYYY-MM-DD
  - platform: Capterra
    url: {url}
    accessed: YYYY-MM-DD
  - platform: Reddit
    url: {search url or subreddit}
    accessed: YYYY-MM-DD
---

# {Company Name} — Sentiment

## Overall Sentiment
Rating: {X.X}/5 on G2 ({N} reviews) | {X.X}/5 on Capterra ({N} reviews)
Sample: {N} reviews read, last 12 months weighted.
Trend: improving / stable / declining — based on {rationale}.

## Top Praise Themes

### 1. {Theme Name}
Summary of what users praise and why it matters.
> "{Representative quote, verbatim or lightly edited for length.}" — {Role}, {Company Size}, G2

### 2. {Theme Name}
...

## Top Complaint Themes

### 1. {Theme Name}
Summary of the complaint and its frequency.
> "{Representative quote.}" — {Role}, {Company Size}, Capterra

### 2. {Theme Name}
...

## High-Severity Signals
Complaints involving data integrity, security, billing, or support failure. Even if low-frequency, these reveal risk posture.

## Support Quality Signals
What reviewers say about responsiveness, onboarding quality, knowledge base.
Include any patterns: fast initial response but slow resolution; good docs but poor escalation path; etc.

## Churn Signals
Explicit mentions of switching away or evaluating alternatives. Note what triggered the switch.
"Reasons for switching" from Capterra is the primary source for this section.

## Feature Requests (recurring)
Features users consistently request that are absent or underdeveloped.
These are potential market gaps.

## Reddit / Community Signals
Themes from community discussions. Note the platform and approximate date range.
Community sentiment is often more candid and less filtered than review sites.

## Analyst Notes
Any inferences drawn from the data beyond what is directly stated. Label as "Inference:" to distinguish from sourced findings.
```

---

## Common Pitfalls

- **Sampling only 5-star and 1-star reviews.** The 3-star reviews often contain the most useful mixed signals. Read the full distribution.
- **Ignoring recency.** A product can change dramatically in 18 months. Flag when most reviews are old.
- **Treating praise as capability confirmation.** "Great reporting" in a review tells you the user is satisfied — it does not tell you what the reporting actually does. Cross-reference with `features.md`.
- **Missing comparison mentions.** When a reviewer names a competitor they switched from, that is a competitive positioning signal. Capture it explicitly.
- **Paraphrasing away specificity.** Preserve numbers, timelines, and proper nouns from quotes. "Takes too long" loses all signal; "bulk import takes 4+ hours for 200 locations" is actionable.
