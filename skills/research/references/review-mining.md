# Review Mining Methodology

Reviews report selected users' experiences in a particular context. They can reveal problems and outcomes, but are not a representative survey or independent proof of a product capability. This guide covers where to look, what to extract, and how to synthesize findings into `sentiment.md`.

---

## Where to Search

Start with these sources, then sample for the decision: include relevant roles, company sizes, rating ranges, dates and product versions where available. A bounded sample of 15-20 reviews may be a useful starting point, not a representativeness threshold. Stop when further sampling is unlikely to change the decision or sources are exhausted; disclose the search bounds, selection method, excluded/inaccessible sources, and remaining uncertainty.

### Tier 1: Structured Review Platforms

**G2** (`g2.com/products/{slug}/reviews`)
- Filter by: Most Recent, then Most Helpful.
- Read reviews from the last 12 months first. Older reviews reflect a past product state.
- Note the reviewer's role and company size — a 5-star from a 10-person company means something different than from a 2,000-person company.

**Capterra** (`capterra.com/reviews/...`)
- Often overlaps with G2, but attracts different buyer personas (more SMB).
- Read the "Cons" field where present; required fields and incentives can produce weak or formulaic comments, so assess specificity rather than assume candor.
- The "Reasons for Switching" field is a churn signal goldmine.

**Trustpilot** — primarily B2C skew, but relevant for prosumer tools.

**Software Advice** — aggregates Capterra data; lower priority unless uniquely present.

### Tier 2: Community Platforms

**Reddit**
Search `site:reddit.com "{Company Name}"` and browse:
- `r/[industry]` — e.g., `r/projectmanagement`, `r/facilities`, `r/saas`
- `r/[category]` — e.g., `r/workforcemgmt`
- Direct product subreddit if it exists

Reddit can surface experiences absent from review sites. Account anonymity, moderation, promotion and self-selection still affect credibility; do not presume complaints are faster or praise more authentic.

**App Stores** (if mobile app exists)
- Apple App Store: search by app name, filter by 1-star and 5-star separately.
- Google Play Store: same approach.
- Mobile reviews often surface UX and reliability issues that desktop reviews miss.

**ProductHunt** (`producthunt.com/products/{slug}`)
- Read launch-day comments as first impressions; promotion and launch incentives can shape participation.
- Record upvotes/comments as platform engagement, not customer adoption or retention.

**Industry forums and Slack communities**
Search for the competitor name in relevant Slack community archives or forum threads. These may reveal use cases absent from formal reviews; access, moderation and participant selection still limit inference.

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

After collecting a decision-relevant sample:

1. **Group by topic.** Cluster reviews that mention the same capability, pain, or scenario. Give each cluster a short label ("Onboarding friction," "Reporting depth," "Mobile reliability").

2. **Count distinct observations.** Deduplicate cross-posts, syndicated reviews and summaries from the same upstream reviewer. Report theme mentions as n/N in the sampled relevant reviews, with date and segment breakdowns. Recent observations may better describe the current version; they do not automatically outweigh older reports of an unresolved severe failure.

3. **Separate praise from complaints.** Do not conflate: "fast search" (praise) and "slow bulk actions" (complaint) may both reference performance but are different signals.

4. **Flag high-severity complaints.** Any complaint referencing data loss, security, billing disputes, or support non-response should be called out explicitly regardless of count — they warrant investigation of potential harm, not a conclusion about the vendor's overall risk posture.

5. **Identify feature requests.** Recurring asks for absent features ("I wish it had X") signal market gaps. These are distinct from complaints about existing features.

---

## Sentiment Weighting

Do not assign universal numeric weights or correct a positive percentage using an assumed unhappy-customer bias. Selection and incentives can favor positive or negative reviews, and their direction is not known without evidence.

- **Recency/version:** Separate current-version observations from older behavior; investigate whether a reported fix applies.
- **Specificity:** Preserve concrete context and outcomes without treating detail alone as proof.
- **Role match:** Explain relevance to the ICP; preserve severe off-profile incidents when they expose a shared failure.
- **Verification/incentives:** Record platform verification and any visible incentive. Neither establishes independent, representative evidence.
- **Sample limits:** Keep platform-wide ratings separate from the selected sample's theme frequencies. Do not extrapolate population prevalence, satisfaction, or trend from a convenience sample.

If weighting is useful for a particular decision, explain the rationale and show whether the conclusion changes under reasonable alternative weights. Otherwise report the unweighted observations and uncertainty. A trend requires comparable segments, versions and sampling over time; use "trend unknown" when those conditions are absent.

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
Sample: {N} distinct reviews read; {selection method, date/version/segment range, duplication treatment and source gaps}.
Trend: improving / stable / declining / unknown — based on {comparable evidence and limits}.

## Supported Praise Themes

### 1. {Theme Name}
Summary of what users praise and why it matters.
> "{Representative quote, verbatim excerpt with omissions marked; never silently edit quoted wording.}" — {Role}, {Company Size}, G2

### 2. {Theme Name}
...

## Supported Complaint Themes

### 1. {Theme Name}
Summary of the complaint and its frequency.
> "{Representative quote.}" — {Role}, {Company Size}, Capterra

### 2. {Theme Name}
...

## High-Severity Signals
Complaints involving data integrity, security, billing, or support failure. Even if low-frequency, describe potential harm, verification status, affected context and any counter-evidence.

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
State the community sample's moderation, selection and verification limits; do not presume greater candor.

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

Report only supported themes. One or zero praise or complaint themes is valid; never manufacture balance to fill a template. Treat a missing theme as not observed in this sample, not absent in the product.
