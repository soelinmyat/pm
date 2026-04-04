---
type: competitor-profile
company: PM Skills Marketplace
slug: pm-skills-marketplace
domain: github.com/phuryn/pm-skills
profiled: 2026-03-13
sources:
  - url: https://github.com/phuryn/pm-skills
    accessed: 2026-03-13
  - url: https://www.productcompass.pm/p/pm-skills-marketplace-claude
    accessed: 2026-03-13
  - url: https://www.productcompass.pm/about
    accessed: 2026-03-13
  - url: https://x.com/PawelHuryn/status/2029697412701282511
    accessed: 2026-03-13
  - url: https://substack.com/@huryn/note/c-223649381
    accessed: 2026-03-13
  - url: https://www.vibesparking.com/en/blog/ai/claude-code/2026-03-05-pm-skills-marketplace-ai-operating-system-for-product-decisions/
    accessed: 2026-03-13
---

# PM Skills Marketplace -- Profile

## Overview

Founded: March 2026 (repo created 2026-03-01) | HQ: Individual creator (Pawel Huryn, Poland-based) | Stage: Open-source side project, no funding

PM Skills Marketplace is a free, open-source collection of 65 product management skills and 36 chained workflows distributed as 8 Claude Code/Cowork plugins. Created by Pawel Huryn, author of The Product Compass newsletter (128K+ subscribers, #1 PM influencer on Favikon with 4M+ monthly impressions). Each skill encodes a named PM framework (Teresa Torres, Marty Cagan, Alberto Savoia) into structured markdown files that Claude loads contextually during conversation.

## Positioning

- **Category claim:** "AI Operating System for Better Product Decisions." Positions itself as a PM-specific skill layer for AI coding assistants, not a standalone SaaS product.
- **Primary ICP:** Product managers using Claude Code or Claude Cowork who want structured, framework-based PM workflows rather than generic AI text generation. Skews toward PMs familiar with modern product discovery and strategy frameworks.
- **Differentiation claim:** "Generic AI gives you text. PM Skills Marketplace gives you structure." Core thesis is that encoding named frameworks (OSTs, Lean Canvas, pretotyping) into skills produces better PM outputs than raw prompting.
- **Tone:** Practitioner-casual, educator-oriented. Uses direct language, avoids enterprise jargon. Heavy framework name-dropping (Torres, Cagan, Savoia, Olsen) signals credibility to PM audience. Promotional messaging leverages social proof heavily (star count, subscriber count).

## Pricing

| Tier | Price | Key Limits | Gating Factor |
|---|---|---|---|
| Open Source | $0 (MIT license) | All 65 skills, 36 commands, 8 plugins | None |

Note: The tool itself is entirely free. The creator monetizes through The Product Compass newsletter ($15/month or $120/year paid tier with 2,500+ paid subscribers) and an AI PM Learning Program. The PM Skills Marketplace functions as a top-of-funnel distribution asset for the newsletter brand.

Pricing observed on 2026-03-13.

## Strengths

- **Massive distribution advantage.** 6,769 GitHub stars and 648 forks in 12 days (created 2026-03-01). Driven by Huryn's 128K+ newsletter audience and 130K+ cross-platform social media following. This is one of the fastest-growing Claude Code plugin repos.
- **Framework depth.** Each skill contains genuine domain knowledge, not just prompt templates. The opportunity-solution-tree skill, for example, includes scoring formulas (Opportunity Score = Importance x (1 - Satisfaction)), process steps, and attribution to original authors.
- **Comprehensive coverage.** 65 skills across 8 plugins cover the full PM lifecycle from discovery through GTM. No other open-source PM skills repo matches this breadth.
- **Workflow chaining.** Commands like `/discover` chain 4+ skills into end-to-end workflows that mirror actual PM work sequences. This is a genuine architectural advantage over standalone prompt collections.
- **Cross-platform compatibility.** Skills (SKILL.md files) follow a universal format that works with Gemini CLI, OpenCode, Cursor, Codex CLI, and Kiro. Commands are Claude-specific, but the knowledge layer is portable.
- **Creator credibility.** Huryn has 5 years as CPO, 10+ years as PM, 15+ years in tech. The Product Compass is #17 on Substack's Technology bestseller list. This is not a weekend project by an unknown -- it carries real PM authority.

## Weaknesses

- **No persistent data layer.** This is a workflow-chaining architecture, not a knowledge base. Skills generate outputs per-session but do not persist decisions, accumulate project context, or maintain a structured product memory across sessions. Each invocation starts fresh.
- **Claude-platform dependency for commands.** The 36 chained command workflows only work in Claude Code and Cowork. Other AI tools get the raw skills but lose the orchestration layer -- a significant capability gap.
- **Single maintainer risk.** 49 of 49 commits are from phuryn. No other substantial contributor. Bus factor is 1. The repo is 12 days old with only 2 merged community PRs (one bug fix, one docs addition).
- **No state management or project tracking.** Cannot track which frameworks have been applied, what decisions were made, or how a product strategy evolved over time. Each skill invocation is stateless.
- **Output quality depends on input quality.** As third-party coverage notes, "garbage context produces structured garbage." The framework encoding does not substitute for PM expertise -- it assumes it.
- **Installation friction.** Issue #7 documents "Failed to add marketplace" errors in Cowork. The Claude plugin marketplace mechanism is still maturing, and installation can be brittle.
- **No integrations with external PM tools.** No connection to Linear, Jira, Notion, Confluence, or any project management system. Skills operate in a text-in, text-out paradigm only.

## Notable Signals

- **Velocity of adoption:** 1,300+ stars in 72 hours, 6,769+ stars in 12 days. This growth rate rivals Anthropic's own community tools and indicates strong latent demand for PM-specific AI tooling.
- **Community proposals already emerging:** Issue #10 proposes collaboration with PM AI Partner (agent modes), Issue #12 proposes a new pm-governance plugin, Issue #13 requests an interview-coach skill. The repo is attracting ecosystem contributors despite being under 2 weeks old.
- **Fork of note:** VibeWithClaude/Claude-Code-PM-skills is a fork with 0 stars, created 2026-03-06. Appears to be a mirror/distribution copy, not a divergent fork.
- **Competing repos appeared immediately:** product-on-purpose/pm-skills (24 skills), deanpeters/Product-Manager-Skills, and aakashg/pm-claude-skills all emerged in the same timeframe, suggesting Huryn's launch catalyzed the category.
- **Newsletter-to-OSS distribution flywheel:** The Product Compass newsletter announced the launch, driving the star surge. This is a playbook for newsletter-led open-source growth that other PM tool creators may replicate.
