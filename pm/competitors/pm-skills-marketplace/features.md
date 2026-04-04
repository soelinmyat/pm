---
type: competitor-features
company: PM Skills Marketplace
slug: pm-skills-marketplace
profiled: 2026-03-13
sources:
  - url: https://github.com/phuryn/pm-skills
    accessed: 2026-03-13
  - url: https://www.productcompass.pm/p/pm-skills-marketplace-claude
    accessed: 2026-03-13
  - url: https://github.com/phuryn/pm-skills/tree/main/pm-product-discovery
    accessed: 2026-03-13
  - url: https://github.com/phuryn/pm-skills/tree/main/pm-product-strategy
    accessed: 2026-03-13
  - url: https://github.com/phuryn/pm-skills/tree/main/pm-execution
    accessed: 2026-03-13
  - url: https://github.com/phuryn/pm-skills/tree/main/pm-market-research
    accessed: 2026-03-13
  - url: https://github.com/phuryn/pm-skills/tree/main/pm-data-analytics
    accessed: 2026-03-13
  - url: https://github.com/phuryn/pm-skills/tree/main/pm-go-to-market
    accessed: 2026-03-13
  - url: https://github.com/phuryn/pm-skills/tree/main/pm-marketing-growth
    accessed: 2026-03-13
  - url: https://github.com/phuryn/pm-skills/tree/main/pm-toolkit
    accessed: 2026-03-13
---

# PM Skills Marketplace -- Features

## Product Discovery (pm-product-discovery: 13 skills, 5 commands)

- **brainstorm-ideas-existing:** Multi-perspective ideation for existing products (PM, Designer, Engineer perspectives). Generates top 10 ideas with rationale.
- **brainstorm-ideas-new:** Ideation for new products in initial discovery phase. Uses divergent thinking approaches.
- **brainstorm-experiments-existing:** Design experiments to test assumptions for existing products. Maps to value, usability, viability, feasibility risks.
- **brainstorm-experiments-new:** Lean startup pretotypes for new products based on Alberto Savoia's "The Right It" methodology.
- **identify-assumptions-existing:** Identify risky assumptions across Value, Usability, Viability, and Feasibility (4 risk categories).
- **identify-assumptions-new:** Identify risky assumptions across 8 risk categories including Go-to-Market, Strategy, and Team.
- **prioritize-assumptions:** Impact x Risk matrix with experiment suggestions for assumption prioritization.
- **prioritize-features:** Feature backlog prioritization based on impact, effort, risk, and strategic alignment.
- **analyze-feature-requests:** Categorize customer feature requests by theme and strategic fit.
- **opportunity-solution-tree:** Build an OST (Teresa Torres) mapping outcome to opportunities, solutions, and experiments. Includes Opportunity Score formula (Importance x (1 - Satisfaction)).
- **interview-script:** Structured customer interview script with JTBD probing questions.
- **summarize-interview:** Interview transcript summarization into JTBD signals, satisfaction signals, and action items.
- **metrics-dashboard:** Product metrics dashboard design with North Star metric, input metrics, and alert thresholds.

Command workflows: `/discover` (full cycle), `/brainstorm`, `/triage-requests`, `/interview`, `/setup-metrics`.

## Product Strategy (pm-product-strategy: 12 skills, 5 commands)

- **product-strategy:** Comprehensive 9-section Product Strategy Canvas (vision through defensibility).
- **startup-canvas:** Combined Product Strategy + Business Model canvas -- alternative to BMC and Lean Canvas for new products.
- **product-vision:** Craft an inspiring, achievable, and emotional product vision statement.
- **value-proposition:** 6-part JTBD value proposition (Who, Why, What before, How, What after, Alternatives).
- **lean-canvas:** Lean Canvas business model for startups and new products (Ash Maurya framework).
- **business-model:** Business Model Canvas with all 9 building blocks (Strategyzer framework).
- **monetization-strategy:** Brainstorm 3-5 monetization strategies with validation experiments.
- **pricing-strategy:** Pricing models, competitive analysis, willingness-to-pay, and price elasticity analysis.
- **swot-analysis:** SWOT analysis with actionable recommendations.
- **pestle-analysis:** Macro environment analysis: Political, Economic, Social, Technological, Legal, Environmental.
- **porters-five-forces:** Competitive forces analysis (rivalry, suppliers, buyers, substitutes, new entrants).
- **ansoff-matrix:** Growth strategy mapping across markets and products.

Command workflows: `/strategy`, `/business-model`, `/value-proposition`, `/market-scan`, `/pricing`.

## Execution (pm-execution: 15 skills, 10 commands)

- **create-prd:** Comprehensive 8-section PRD template.
- **brainstorm-okrs:** Team-level OKRs aligned with company objectives.
- **outcome-roadmap:** Transform feature lists into outcome-focused roadmaps.
- **sprint-plan:** Sprint planning with capacity estimation, story selection, and risk identification.
- **retro:** Structured sprint retrospective facilitation.
- **release-notes:** User-facing release notes from tickets, PRDs, or changelogs.
- **pre-mortem:** Risk analysis with Tigers/Paper Tigers/Elephants classification.
- **stakeholder-map:** Power x Interest grid with tailored communication plan.
- **summarize-meeting:** Meeting transcript to decisions + action items.
- **user-stories:** User stories following 3 C's and INVEST criteria.
- **job-stories:** Job stories: When [situation], I want to [motivation], so I can [outcome].
- **wwas:** Product backlog items in Why-What-Acceptance format.
- **test-scenarios:** Test scenarios: happy paths, edge cases, error handling.
- **dummy-dataset:** Realistic dummy datasets as CSV, JSON, SQL, or Python.
- **prioritization-frameworks:** Reference guide to 9 prioritization frameworks (Opportunity Score, ICE, RICE, MoSCoW, Kano, etc.).

Command workflows: `/write-prd`, `/plan-okrs`, `/transform-roadmap`, `/sprint`, `/pre-mortem`, `/meeting-notes`, `/stakeholder-map`, `/write-stories`, `/test-scenarios`, `/generate-data`.

## Market Research (pm-market-research: 7 skills, 3 commands)

- **user-personas:** Create refined user personas from research data.
- **market-segments:** Identify 3-5 customer segments with demographics, JTBD, and product fit.
- **user-segmentation:** Segment users from feedback data based on behavior, JTBD, and needs.
- **customer-journey-map:** End-to-end journey map with stages, touchpoints, emotions, and pain points.
- **market-sizing:** TAM, SAM, SOM with top-down and bottom-up approaches.
- **competitor-analysis:** Competitor strengths, weaknesses, and differentiation opportunities.
- **sentiment-analysis:** Sentiment analysis and theme extraction from user feedback.

Command workflows: `/research-users`, `/competitive-analysis`, `/analyze-feedback`.

## Data and Analytics (pm-data-analytics: 3 skills, 3 commands)

- **sql-queries:** Generate SQL from natural language (supports BigQuery, PostgreSQL, MySQL).
- **cohort-analysis:** Retention curves, feature adoption, and engagement trends by cohort.
- **ab-test-analysis:** Statistical significance, sample size validation, and ship/extend/stop recommendations.

Command workflows: `/write-query`, `/analyze-cohorts`, `/analyze-test`.

## Go-to-Market (pm-go-to-market: 6 skills, 3 commands)

- **Beachhead segments:** Identify initial target segments for market entry.
- **ICP definition:** Define ideal customer profiles with demographics, psychographics, and buying behavior.
- **Growth loops:** Design viral, paid, content, and product-led growth loops.
- **GTM motions:** Strategic go-to-market motion planning.
- **Battlecards:** Competitive positioning battlecards for sales and product teams.
- **Plan-launch:** Launch planning workflow.

Command workflows: `/plan-launch`, additional GTM commands.

## Marketing and Growth (pm-marketing-growth: 5 skills, 2 commands)

- **Marketing ideas:** Brainstorm marketing strategies and campaigns.
- **Positioning:** Product positioning framework (likely referencing April Dunford or similar).
- **Value propositions:** Value proposition statement generation.
- **Product naming:** Product and feature naming with validation criteria.
- **North Star metrics:** Define and validate North Star metrics with input metric trees.

Command workflows: `/north-star`, additional marketing commands.

## PM Toolkit (pm-toolkit: 4 skills, 5 commands)

- **Resume review:** PM resume review and improvement suggestions.
- **NDA drafting:** Non-disclosure agreement generation.
- **Privacy policy:** Privacy policy generation.
- **Proofreading:** Grammar, flow, and clarity checking.

Command workflows: 5 utility commands.

## Recent Changelog Highlights

The repo was created on 2026-03-01. Key changes in the first 12 days:

- **2026-03-09:** Merged PR #6 -- OpenCode integration docs (community contribution).
- **2026-03-07:** Hide Python from language detection (.gitattributes change).
- **2026-03-05:** Merged PR #1 -- Fix Windows Unicode errors in validate_plugins.py (community contribution). Added badges. Published CONTRIBUTING.md.
- **2026-03-03:** Added Known Issues section for Windows Cowork VM. Improved skill discoverability. Updated marketplace.json.
- **2026-03-02:** Initial README finalization and image updates.
- **2026-03-01:** Initial repository creation with all 65 skills and 36 commands.

All 65 skills were published in the initial commit. No new skills have been added to the repo yet (12 days old). Proposed additions exist as issues: interview-coach skill (#13), pm-governance plugin (#12), socratic-questioning skill (#11).

## Capability Gaps (observed)

- **No persistent project context.** Skills generate session-scoped output only. No mechanism to maintain a project knowledge base, decision log, or evolving product strategy across sessions.
- **No data integrations.** Skills cannot read from or write to Linear, Jira, Notion, Confluence, Slack, or any external PM tool. All input must be manually provided in the conversation.
- **No file system persistence layer.** Unlike tools that write to `pm/` directories or maintain structured markdown files, PM Skills Marketplace operates entirely within the conversation context. Outputs are ephemeral unless manually saved.
- **No competitive intelligence automation.** The competitor-analysis skill is a framework guide, not an automated research tool. It cannot fetch web data, scrape review sites, or aggregate SEO metrics.
- **No analytics pipeline integration.** The sql-queries and cohort-analysis skills generate SQL text but cannot execute queries against actual databases or analytics tools.
- **No version control or decision tracking.** No mechanism to track how product strategy, PRDs, or OKRs evolved over time. Each invocation is independent.
- **No team collaboration features.** Single-user, single-session design. No shared workspace, commenting, or multi-PM coordination.
- **No hooks or automation.** Unlike plugin architectures with lifecycle hooks (session-start, commit, etc.), PM Skills Marketplace only operates on explicit user invocation or contextual skill loading.
- **Thin coverage in data/analytics.** Only 3 skills in pm-data-analytics compared to 15 in pm-execution and 13 in pm-product-discovery. Analytics is the weakest domain.
