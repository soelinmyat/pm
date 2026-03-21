---
type: strategy
created: 2026-03-13
updated: 2026-03-21
---

# Product Strategy

## 1. Product Identity

PM (Product Memory) is a free, open-source plugin that gives product engineers structured workflows for the full product lifecycle — research, strategy, competitive analysis, grooming, implementation, code review, and merge — on top of whatever AI coding assistant they already use. It replaces scattered docs, ad hoc AI prompts, and disconnected tool chains with a persistent knowledge base that compounds over time and flows directly into implementation.

## 2. ICP and Segmentation

**Primary ICP:** The product engineer — the person who owns both product decisions and implementation. This role is real and growing: Anthropic's Head of Product Cat Wu describes a world where "designers ship code, engineers make product decisions, product managers build prototypes and evals." Gibson Consultants (March 2026) predicts a "messy middle" where PMs increasingly build prototypes with AI tools. Multiple sources (Bentes, Gottlob, Sachdeva) identify the "AI Product Engineer" as an emerging role averaging ~$165K US compensation, with AI-assisted development shifting the scarce skill from coding to "taste, judgment, and user context." Deloitte and CIO.com name "Agentic Product Managers" as a 2026 trend — engineers who spend less time coding and more time orchestrating AI agents.

PM serves this person: the technical founder, the small-squad builder, the engineer who owns product decisions end-to-end.

**Secondary segments:**
- Technical founders who own the full lifecycle from idea to shipped code — high urgency, broad scope.
- Small-squad builders (2-5 people) where everyone touches both product and code — shared context through the repo, not a dashboard.

**Buyer = User.** No separate procurement process. The person who installs the plugin is the person who uses it.

## 3. Core Value Prop and Differentiation

**Value prop:** PM serves three goals for the product engineer:

1. **Build valuable products.** Research, strategy, and competitive analysis ground product decisions in evidence rather than intuition. The knowledge base compounds — each session builds on prior research, customer evidence, and market context.

2. **Build efficiently.** Groomed issues flow into implementation with zero manual handoff. Context from research and grooming carries through to dev lifecycle phases, reducing ceremony and eliminating the spec-to-code gap.

3. **Manage cognitive load.** Structured workflows reduce context switching across the product lifecycle. Instead of juggling research tools, issue trackers, coding assistants, and review workflows separately, the product engineer works in one environment with one compounding knowledge base.

**Differentiation from alternatives:**
- **vs. Productboard Spark** (nearest agentic competitor): Spark is enterprise SaaS with a conversational interface. PM is a persistent knowledge base that lives in the editor, uses the codebase as context, and compounds from multiple sources (research, customer evidence, analytics, issues). Spark answers questions; PM builds institutional memory.
- **vs. standalone CI tools** (Crayon, Klue): Those are $20-40K/yr enterprise SaaS targeting sales teams. PM brings competitive profiling to builders for free, inside the workflow where decisions happen.
- **vs. general AI prompts** (ChatGPT, Claude chat): PM structures and persists research. A chat session is ephemeral; PM's knowledge base is cumulative and version-controlled.
- **vs. Compound Engineering** (EveryInc, Claude Code plugin): Handles brainstorm, plan, implement, review, compound phases — a strong dev lifecycle tool. But it deliberately chose not to extend into research, strategy, or competitive analysis. PM provides the upstream product work that Compound Engineering assumes already exists.
- **vs. Kiro** (AWS, spec-driven development): Turns requirements into user stories, technical design, and implementation tasks. But as Martin Fowler notes, it assumes specs already exist and cannot detect spec quality. PM provides the research and grooming that produces high-quality specs — the upstream work Kiro needs but doesn't do.
- **vs. MetaGPT** (multi-agent framework): Defines PM + Engineer + Architect + QA roles in a multi-agent pipeline. Closest architectural precedent for combining PM and dev, but a research framework — not a production plugin for real product engineers.

## 4. Competitive Positioning

PM occupies a unique position in the market: **the only editor-native tool that covers the full product lifecycle from research to merge**. No funded competitor offers an integrated research → grooming → implementation → review → merge pipeline.

The competitive landscape has two structural gaps:
- **Compound Engineering's deliberate PM exclusion.** The strongest dev lifecycle plugin in the editor chose not to build research, strategy, or competitive analysis. Product engineers using it must do upstream product work manually or in separate tools.
- **Kiro's spec-blindness.** The most ambitious spec-driven tool assumes specs exist and are good. It cannot detect whether upstream product work was done, whether competitive context was considered, or whether the spec is grounded in research.

PM closes both gaps: it provides the upstream product work (research, strategy, competitive analysis, grooming) and connects it to the dev lifecycle (implementation, review, merge) in a single integrated pipeline.

- Enterprise PM platforms (Productboard, Amplitude, Jira PD) serve the top-right quadrant: standalone SaaS for large teams. PM doesn't compete here.
- CI tools (Crayon, Klue) serve sales enablement. PM serves builders.
- Dev lifecycle plugins (Compound Engineering, Kiro) cover implementation but not product discovery. PM covers both.

**Where we win:** Full-lifecycle context (research + grooming + implementation), groomed issues that reduce dev ceremony, structured workflows, persistence, and zero cost.

**Where we intentionally don't compete:** Enterprise procurement, product analytics, sprint management, capacity planning, or any tool that requires a standalone dashboard as primary interface.

## 5. Go-to-Market

**Distribution:** Plugin marketplaces (Claude Code, Cursor, Codex, OpenCode, Gemini CLI). Free forever. No signup, no API key, no paywall.

**Acquisition motion:** Product-led, community-driven. Users discover PM through plugin marketplaces, GitHub, word-of-mouth, and content marketing targeting low-competition keywords ("AI product discovery" at KD 3, "AI tools for product discovery" at KD 3).

**Geographic focus:** Global from day one. English-language first. No geographic restrictions.

**Expansion path:** Free plugin → community adoption → cloud product at productmemory.io for team collaboration and shared knowledge base. The plugin is the acquisition engine; the cloud product is the monetization layer.

## 6. Current Phase and Priorities

**Phase:** 0-to-1. Early release. Strong on competitive research, customer evidence ingest, strategy, and grooming. Dev lifecycle skills recently merged. Not yet focused on integrations breadth or team features.

**Top 3 priorities:**

1. **Groom-to-dev handoff quality.** Groomed issues should flow into implementation with minimal ceremony — skipping brainstorm and spec review when upstream work is already done. This is the unique value of the merged plugin: no competitor connects upstream PM work to dev lifecycle. Measure: groomed issues completing in fewer dev steps than ungroomed ones.

2. **Depth of product context.** Add more input sources — Google Docs integration, PostHog/analytics, issue trackers, user feedback channels. The more context PM has, the better its research and grooming output. This is the moat.

3. **Plugin ecosystem reach.** Ensure PM works well across all major AI coding assistants (Claude Code, Cursor, Codex, Gemini CLI). Broader platform support = larger addressable community.

## 7. Explicit Non-Goals

1. **Not an AI model, coding platform, or infrastructure tool.** PM is a workflow optimization layer for product engineers. It does not train models, provide compute, manage infrastructure, or serve platform engineering, infrastructure operations, or production incident management. PM orchestrates the product lifecycle; it does not replace the tools that execute each step.

2. **Not an enterprise project management tool.** No sprint planning, velocity tracking, capacity management, approval workflows, or role-based access control. PM lightly tracks whether groomed backlog items ship, but it does not manage sprints, team capacity, or org-level reporting. Small teams share context through the repo — scales to the squad, not the org.

3. **No product analytics.** PM will ingest analytics data from external sources (PostHog, Amplitude) but will not instrument, collect, or visualize product usage data itself. Analytics tools already exist; PM synthesizes their output.

4. **No enterprise sales motion.** PM is free, open-source, and self-serve. No sales team, no procurement process, no SOC 2 compliance (yet). Enterprise adoption happens bottom-up through individual squad adoption.

## 8. Success Metrics

**Leading indicators:**
- GitHub stars and plugin installs (adoption signal)
- Repeat usage: users who run 3+ PM commands in a week (retention signal)
- Knowledge base depth: average number of research artifacts per active project (compounding signal)
- Groomed issues completing in fewer steps: number of dev flow steps skipped when a groomed issue is detected vs. an ungroomed issue (handoff quality signal)
- One-session shipping rate: percentage of groomed issues that go from "ready" to merged PR in a single dev session (end-to-end velocity signal)

**Lagging indicators:**
- Community contributions (PRs, issues, discussions)
- Organic traffic to productmemory.io (pre-cloud interest)
- Conversion from plugin users to cloud waitlist (when available)
