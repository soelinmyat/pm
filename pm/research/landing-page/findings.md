---
type: topic-research
topic: Landing Page for productmemory.com
created: 2026-03-30
updated: 2026-03-30
source_origin: external
sources:
  - url: https://evilmartians.com/chronicles/we-studied-100-devtool-landing-pages-here-is-what-actually-works-in-2025
    accessed: 2026-03-30
  - url: https://cursor.com/
    accessed: 2026-03-30
  - url: https://windsurf.com/
    accessed: 2026-03-30
  - url: https://www.continue.dev/
    accessed: 2026-03-30
  - url: https://posthog.com/product-engineers/dogfooding
    accessed: 2026-03-30
  - url: https://newsletter.posthog.com/p/using-your-own-product-is-a-superpower
    accessed: 2026-03-30
  - url: https://bubble.io/blog/dogfooding-startup-tech/
    accessed: 2026-03-30
  - url: https://www.markepear.dev/examples/landing-page
    accessed: 2026-03-30
  - url: https://launchkit.evilmartians.io/
    accessed: 2026-03-30
  - url: https://claudemarketplaces.com/
    accessed: 2026-03-30
  - url: https://code.claude.com/docs/en/discover-plugins
    accessed: 2026-03-30
  - url: https://svitla.com/blog/seo-best-practices/
    accessed: 2026-03-30
---

# Landing Page for productmemory.com — Research Findings

## Summary

Developer tool landing pages follow a narrow, proven formula: centered hero with bold headline, product screenshot, two CTAs (primary action + GitHub/docs), then social proof, features, and a closing CTA. The Evil Martians study of 100+ dev tool pages confirms that "no salesy BS" and "clever and simple" are the two universal rules. For an open-source plugin, the landing page should prioritize showing the tool in action over describing it. Dogfooding is a strong trust signal but only works when shown concretely (screenshots, real artifacts) rather than claimed abstractly. SEO opportunity exists in low-KD terms like "ai product discovery" through a content hub structure with the landing page as pillar.

## Findings

### 1. Competitor Landing Page Patterns

**Cursor** leads with a product screenshot over a minimal brand background. The headline is short and declarative ("The best way to code with AI"). No feature list in the hero — the product UI speaks for itself.

**Windsurf** positions as "the best AI for coding" with emphasis on flow state. Messaging targets the feeling ("keep you in the flow") rather than features. Trusted-by logos appear immediately below the hero.

**Continue.dev** leans into open-source identity: "Open-source AI code assistant" is the headline. Free + customizable + privacy-conscious are the three pillars. The page highlights VS Code and JetBrains compatibility front and center — platform context matters for plugins.

**Supermaven** differentiates on performance: 1M token context window, speed benchmarks. Technical specs in the hero work when they are genuinely differentiating.

**Common pattern across all:** Hero is centered, headline is under 10 words, a product screenshot or animated demo sits below or beside the headline, and the primary CTA is "Get started" or "Download" (not "Learn more").

### 2. Plugin Pages vs Full Product Pages

Plugin/extension pages differ from full product landing pages in three ways:

- **Platform context is mandatory.** Every plugin page leads with which platforms it supports (VS Code, JetBrains, Claude Code). Users need to know "does this work where I already am?" before anything else.
- **Install friction is the enemy.** The best plugin pages have a one-click install or a single CLI command as the hero CTA. Claude Code plugins use `claude plugin add <name>` — that should be the hero action.
- **Marketplace listings are compressed.** In Claude Code marketplaces, plugins get a name, one-line description, category tags, and install count. The landing page must expand on what the marketplace listing compresses — show what the plugin actually does in practice.

### 3. Dev Tool Landing Page Structure (Evil Martians Study)

The Evil Martians analysis of 100+ dev tool landing pages identified this dominant structure:

1. **Hero:** Centered headline + product screenshot/animation + 2 CTAs (primary + secondary)
2. **Social proof / logos:** Immediately after hero. Even early-stage tools show GitHub stars or notable users.
3. **How it works:** 3-step or concept explanation. Especially important when AI/automation is involved and the product is not self-explanatory from UI alone.
4. **Features:** Grid of 3-6 features with icons. Not exhaustive — highlight differentiators.
5. **Testimonials:** Curated quotes (not auto-pulled). Avatar + name + company logo for B2B credibility.
6. **Closing CTA:** Repeat the primary action.

Key design rules: centered layout with max-width container, clean typography, generous whitespace, no flashy animations. Two CTAs in the hero — primary converts, secondary (docs/GitHub) gives immediate value to developers who want to evaluate before committing.

### 4. Messaging Patterns for Open-Source Developer Tools

- **"See it in action" beats "here's what it does."** Animated product UI or a real demo GIF is the strongest hero element. Developers want to see the tool working, not read about it.
- **GitHub stars and contributor count are social proof.** For open-source tools, the GitHub badge in the hero is the equivalent of "trusted by 10,000 companies."
- **Open-source identity should be explicit but not the whole pitch.** Continue.dev leads with "open-source" in the headline. But the value prop is still about what the tool does, not its license.
- **Speed and simplicity are universal developer values.** Linear ("built for speed"), Raycast ("blazingly fast"), Warp ("modern terminal") — the messaging always implies "this removes friction."

### 5. Dogfooding as Marketing

**PostHog is the gold standard.** They are their own ideal customer and document this publicly. Their product team found booking user interviews laborious, which validated surveys. HogQL was driven by internal usage. Their data warehouse was born from a strategic need to be the source of truth. Each feature has an internal origin story they share openly.

**How dogfooding is typically presented:**

- **Build-log blog posts:** "How we built X with Y" posts showing real internal usage (PostHog, Stripe).
- **Screenshots of actual internal usage:** Not mockups — real dashboards, real data (anonymized), real workflows.
- **"This page was built with our tool" footers:** Simple, concrete, verifiable.
- **Changelog as dogfood evidence:** Every shipped feature that was internally validated first gets flagged as "dogfooded."

**For Product Memory specifically:** The plugin manages its own backlog, writes its own research (including this document), grooms its own features, and tracks its own strategy. That is a uniquely strong dogfooding story because the product's entire lifecycle is managed by the product. Show real PM artifacts — a groom proposal, a research finding, the backlog dashboard — as the demo content.

### 6. SEO Opportunity: "ai product discovery"

**Target keywords:** "ai product discovery" (KD 3) and "ai tools for product discovery" (KD 3) are low-competition terms with clear intent.

**Content structure for ranking:**

- **Pillar page:** The landing page itself should mention "ai product discovery" naturally in the hero and feature descriptions. Product Memory's research skill is literally an AI product discovery tool.
- **Content hub:** Supporting pages (blog posts, guides) targeting long-tail variants: "ai product discovery for startups," "ai product discovery workflow," "how to validate product ideas with AI."
- **Topical authority:** Google's 2026 algorithm prioritizes topic-by-topic expertise. A focused site with dense, interconnected content about AI-assisted product workflows will outrank a broad tool that mentions it once.
- **Structured data:** FAQ schema on the landing page for questions like "What is AI product discovery?" and "How do product engineers use AI for research?"

**Key insight:** High-volatility keywords (where rankings are unstable) are 2.8x easier to rank for during fluctuation periods. "AI product discovery" is new enough that rankings are not yet settled — early mover advantage is real.

## Strategic Relevance

This research directly supports the productmemory.com landing page groom. The landing page is the top of the adoption funnel — if it does not communicate value in 5 seconds, the plugin does not get installed. The dogfooding angle is a genuine differentiator: no competing tool can show "our product manages its own product lifecycle" because no competing tool does what PM does.

## Implications

1. **Hero should show the product, not describe it.** A screenshot or animation of a groom proposal being generated, or the dashboard showing real PM data, is worth more than any headline. The headline should be short and declarative: "AI workflows for product engineers" or "Ship better products, faster."

2. **Two CTAs: install command + GitHub.** Primary: `claude plugin add productmemory` (or equivalent). Secondary: GitHub repo link with star count. This follows the universal dev tool pattern and serves both "I want to try it now" and "I want to evaluate it first" users.

3. **Lead with platform context.** "Claude Code Plugin" should be visible in the hero. Users need to know this is a plugin for a tool they already use.

4. **Dogfooding section should be concrete, not abstract.** Do not say "we use our own tool." Instead, show a real groom proposal generated by PM, a real research finding, the real backlog dashboard. Label it: "This plugin manages its own product lifecycle. Here's what that looks like."

5. **"How it works" section maps to the product lifecycle.** Research -> Strategy -> Groom -> Dev -> Review -> Merge. Each step gets an icon and one sentence. This is the "how it works" that explains the non-obvious value.

6. **SEO: build a content hub around "ai product discovery."** The landing page is the pillar. Blog posts, guides, and changelog entries are the supporting content. Internal linking between them builds topical authority. Target low-KD long-tail variants in supporting content.

7. **Social proof will be thin at launch — lean on GitHub.** Stars, contributors, and "built in public" transparency substitute for enterprise logos. As adoption grows, add user testimonials.

8. **Consider LaunchKit as a starting template.** Evil Martians open-sourced their dev tool landing page template based on the 100-page study. It encodes all the structural patterns above and would accelerate implementation.

## Open Questions

1. Should the landing page be a single static page or a multi-page site with docs, blog, and changelog from day one?
2. What is the right dashboard screenshot to use in the hero — home view, groom proposal, or backlog?
3. Should the dogfooding section be a static showcase or a live embed pulling real data from the PM repo?
