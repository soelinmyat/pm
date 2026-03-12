---
type: competitor-sentiment
company: PM Skills Marketplace
slug: pm-skills-marketplace
profiled: 2026-03-13
review_count_sampled: 15
notes: >
  PM Skills Marketplace is a 12-day-old open-source GitHub project with no presence on traditional
  review platforms (G2, Capterra, Trustpilot). Sentiment data is sourced from GitHub issues,
  discussions, social media reactions, third-party blog coverage, and community proposals.
sources:
  - platform: GitHub Issues
    url: https://github.com/phuryn/pm-skills/issues
    accessed: 2026-03-13
  - platform: GitHub Discussions
    url: https://github.com/phuryn/pm-skills/discussions
    accessed: 2026-03-13
  - platform: GitHub PRs
    url: https://github.com/phuryn/pm-skills/pulls
    accessed: 2026-03-13
  - platform: X/Twitter
    url: https://x.com/PawelHuryn/status/2029697412701282511
    accessed: 2026-03-13
  - platform: Substack Notes
    url: https://substack.com/@huryn/note/c-223649381
    accessed: 2026-03-13
  - platform: VibeSparking AI (third-party review)
    url: https://www.vibesparking.com/en/blog/ai/claude-code/2026-03-05-pm-skills-marketplace-ai-operating-system-for-product-decisions/
    accessed: 2026-03-13
  - platform: LinkedIn (community post)
    url: https://www.linkedin.com/posts/ronyang_i-built-a-library-of-product-manager-skills-activity-7424859346188001282-jBqG
    accessed: 2026-03-13
---

# PM Skills Marketplace -- Sentiment

## Overall Sentiment

Rating: Not available on G2 or Capterra (open-source GitHub project, not a SaaS product).
GitHub stars: 6,769 in 12 days (strong positive signal).
Sample: 15 data points from GitHub issues, PRs, social media, and third-party coverage.
Trend: Overwhelmingly positive in the first 2 weeks, with very limited critical feedback surfacing yet.
Weighting: Recency-weighted (all data points from March 2026). Specificity-weighted (concrete feedback prioritized over "great project!" signals).

## Top Praise Themes

### 1. Framework Depth and PM Rigor

Users consistently praise the fact that skills encode genuine PM frameworks (Torres, Cagan, Savoia) rather than generic prompt templates. The distinction between "text" and "structure" resonates with the PM audience.

> "Really impressed by pm-skills -- 65 skills and 36 chained workflows is an incredible catalog. I especially like how you encode methodologies from Torres, Cagan, and Savoia into structured workflows." -- Ahmed (GitHub Issue #10), PM AI Partner creator

Third-party coverage (VibeSparking AI) specifically praised the framework integration: "The skills encode established methodologies from respected authors rather than generic templates."

### 2. Workflow Chaining Architecture

The command chaining model -- where `/discover` sequences brainstorm-ideas -> identify-assumptions -> prioritize-assumptions -> brainstorm-experiments -- is recognized as a genuine innovation over flat prompt libraries.

> "Discovery feeds into strategy feeds into execution." -- VibeSparking AI review, summarizing the workflow design

The chaining approach is noted as matching "actual PM work cycles," which distinguishes PM Skills from competitors that offer standalone prompts.

### 3. Breadth of Coverage

The 65 skills across 8 plugins covering the full PM lifecycle (discovery through GTM) is cited as unmatched by any competing open-source PM skills repository. Competing repos offer 5-24 skills at most.

### 4. Ease of Installation

The one-command marketplace installation (`claude plugin marketplace add phuryn/pm-skills`) and Cowork's GUI-based "Add marketplace from GitHub" flow are praised when they work. The instant availability of all 8 plugins simultaneously is a positive friction-reducer.

### 5. Open Source and Free Access

The MIT license and zero-cost model generate goodwill. Multiple social media reactions emphasize the generosity of releasing this for free given the depth of the content.

## Top Complaint Themes

### 1. Installation Failures (Cowork)

The most concrete complaint is documented in Issue #7: "Failed to add marketplace" error when using the Cowork plugin UI. The error occurs on Claude Desktop v1.1.5749 when attempting to add the marketplace via the GUI flow. The user tried both shorthand (`phuryn/pm-skills`) and full URL formats. A community member suggested updating Claude Desktop as a fix.

> "A red error message is displayed: 'Failed to add marketplace.' No marketplace is added." -- GitHub Issue #7 reporter

### 2. Platform Lock-in for Commands

Third-party coverage explicitly calls out that "Commands (slash-command workflows) only work in Claude Code and Cowork. Other tools get the skills but not the chaining." Since workflow chaining is the primary differentiator, users of Gemini CLI, Cursor, or other tools get a significantly degraded experience.

### 3. Input Quality Dependency

The VibeSparking AI review noted that output quality directly correlates to input quality: "garbage context produces structured garbage." The framework encoding does not compensate for a lack of PM expertise or research data.

> "If you've never read Torres or Cagan, start with the books." -- VibeSparking AI review

### 4. Windows Compatibility Issues

Early commits document Windows-specific issues: UnicodeEncodeError in validate_plugins.py (fixed in PR #1) and a known issue with Windows Cowork VM documented in the README (added 2026-03-03). These suggest the initial release was primarily tested on macOS.

## High-Severity Signals

- **No data integrity concerns.** The tool generates text output and does not store or modify user data. No reports of data loss, corruption, or security issues.
- **No billing concerns.** The product is free.
- **Installation reliability is the highest-severity issue.** Issue #7 (marketplace installation failure) could block adoption entirely. This is a platform-level issue (Claude Desktop), not a PM Skills bug, but it directly impacts the user experience.

## Support Quality Signals

- **Creator responsiveness:** Huryn has been responsive on GitHub. The repo was created 2026-03-01 and already has CONTRIBUTING.md, a Windows known issues section, and a plugin validator.
- **Community support emerging:** Issue #7 received a community-sourced workaround (update Claude Desktop) within 3 days.
- **No formal support channel.** Support is via GitHub Issues only. No Discord, Slack, or dedicated help desk. For a free open-source project, this is expected.
- **Documentation quality:** The README is comprehensive (300+ lines), with detailed installation instructions, skill descriptions, and usage examples. Each plugin has its own README. The blog post on Product Compass provides additional context.

## Churn Signals

No churn signals detected. The project is 12 days old, and users are in the adoption/exploration phase. No reports of users abandoning the tool or switching to alternatives.

Inference: Churn risk is likely to manifest as "tried it once, found it interesting but did not integrate into daily workflow" -- the typical pattern for prompt-based tools that lack persistent state. Without a mechanism to build on previous outputs or maintain project context, the tool may suffer from low retention even if initial adoption is strong.

## Feature Requests (recurring)

Based on GitHub Issues and community proposals:

1. **Interview coach skill for PM job search** (Issue #13): Request to add a skill for PM job interview coaching. Suggests demand beyond active PM work.
2. **PM governance plugin** (Issue #12): Proposed new plugin with 4 skills and 3 commands for decision governance. Signals desire for organizational/process-level capabilities.
3. **Socratic questioning skill** (Issue #11): Request for a meta-cognitive skill that challenges assumptions through questioning. Signals demand for "thinking partner" capabilities beyond framework application.
4. **Cross-project collaboration** (Issue #10): PM AI Partner creator proposed mutual integration, suggesting demand for combining framework-based skills with agent modes (devil's advocate, thought partner).
5. **Skill behavior testing** (PR #5, closed): Proposed testing framework to verify skills work correctly, not just structurally. Signals concern about quality assurance as the skill count grows.

## Reddit / Community Signals

No Reddit discussions found for "pm-skills" or "PM Skills Marketplace" in combination with Claude Code. The PM community on Reddit does not appear to have discovered or discussed this tool yet (as of 2026-03-13).

Community signals are concentrated on:
- **X/Twitter:** Huryn's posts generated visible engagement but specific reply content could not be extracted (Twitter blocks scraping).
- **Substack Notes:** The "1,300+ stars in 72 hours" note on Substack drove additional star surges.
- **LinkedIn:** Third-party PM professionals (e.g., Ron Yang) created their own PM skills libraries in apparent response to the category Huryn catalyzed.
- **GitHub:** The 648 forks suggest significant interest in customizing or learning from the skill format.

## Analyst Notes

Inference: The 6,769 stars in 12 days are largely a distribution signal, not a usage signal. Huryn's 128K+ newsletter audience and 130K+ social media following means the star count reflects audience reach more than sustained product usage. The true test will be whether stars translate into daily active usage over the next 3-6 months.

Inference: The absence of any negative sentiment beyond installation friction and platform lock-in is unusual and likely reflects the project's extreme youth (12 days). As more PMs attempt to integrate PM Skills into real workflows, friction points around stateless operation, lack of persistence, and input quality dependency are likely to surface.

Inference: The community's eagerness to propose new skills and plugins (4 proposals in 12 days) suggests the marketplace format is resonating as a contribution model. If Huryn can maintain review quality while accepting community contributions, the skill count could grow rapidly. If not, quality dilution is a risk.

Inference: The emergence of 3+ competing PM skills repos within days of Huryn's launch (deanpeters, product-on-purpose, aakashg) suggests PM Skills Marketplace validated the category rather than locking it down. The long-term competitive dynamics will depend on whether Huryn's distribution advantage (newsletter) can maintain lead over technically superior but less-distributed alternatives.
