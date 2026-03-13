---
type: strategy
created: 2026-03-13
updated: 2026-03-13
---

# Product Strategy

## 1. Product Identity

PM (Product Memory) is a free, open-source plugin for AI coding assistants that gives small product teams structured workflows for competitive research, product strategy, and feature grooming — all inside the editor. It replaces scattered docs, ad hoc AI prompts, and gut-feel prioritization with a persistent knowledge base that compounds over time.

## 2. ICP and Segmentation

**Primary ICP:** Small product squads (2-8 people) who own both product decisions and implementation. This includes technical founders, product managers on small teams, and indie builders. Company size is less relevant than squad autonomy — even enterprise teams operate as small squads with their own focus.

**Secondary segments:**
- Solo founders doing all PM work themselves — high urgency, low complexity.
- Product managers at larger companies who use AI coding assistants and want research workflows in their editor — high value but slower adoption.

**Buyer = User.** No separate procurement process. The person who installs the plugin is the person who uses it.

## 3. Core Value Prop and Differentiation

**Value prop:** PM turns upstream product work — research, strategy, competitive analysis, and grooming — from scattered manual effort into structured, compounding knowledge inside your coding environment.

**Differentiation from alternatives:**
- **vs. Productboard Spark** (nearest agentic competitor): Spark is enterprise SaaS with a conversational interface. PM is a persistent knowledge base that lives in the editor, uses the codebase as context, and compounds from multiple sources (research, customer evidence, analytics, issues). Spark answers questions; PM builds institutional memory.
- **vs. standalone CI tools** (Crayon, Klue): Those are $20-40K/yr enterprise SaaS targeting sales teams. PM brings competitive profiling to builders for free, inside the workflow where decisions happen.
- **vs. general AI prompts** (ChatGPT, Claude chat): PM structures and persists research. A chat session is ephemeral; PM's knowledge base is cumulative and version-controlled.

## 4. Competitive Positioning

PM occupies the bottom-left quadrant of the market: **editor-native tools for individual builders and small squads**. No funded competitor occupies this space.

- Enterprise PM platforms (Productboard, Amplitude, Jira PD) serve the top-right: standalone SaaS for large teams. PM doesn't compete here.
- CI tools (Crayon, Klue) serve sales enablement. PM serves builders.
- Other editor-native tools (Get Shit Done, Compound Engineering) are dev-focused and lack research, CI, or strategy workflows.

**Where we win:** Deep product context (codebase + research + evidence), structured workflows, persistence, and zero cost.

**Where we intentionally don't compete:** Enterprise procurement, product analytics, sprint management, or any tool that requires a standalone dashboard as primary interface.

## 5. Go-to-Market

**Distribution:** Plugin marketplaces (Claude Code, Cursor, Codex, OpenCode, Gemini CLI). Free forever. No signup, no API key, no paywall.

**Acquisition motion:** Product-led, community-driven. Users discover PM through plugin marketplaces, GitHub, word-of-mouth, and content marketing targeting low-competition keywords ("AI product discovery" at KD 3, "AI tools for product discovery" at KD 3).

**Geographic focus:** Global from day one. English-language first. No geographic restrictions.

**Expansion path:** Free plugin → community adoption → cloud product at productmemory.io for team collaboration and shared knowledge base. The plugin is the acquisition engine; the cloud product is the monetization layer.

## 6. Current Phase and Priorities

**Phase:** 0-to-1. Early release. Strong on competitive research, customer evidence ingest, strategy, and grooming. Not yet focused on integrations breadth or team features.

**Top 3 priorities:**

1. **Depth of product context.** Add more input sources — Google Docs integration, PostHog/analytics, issue trackers, user feedback channels. The more context PM has, the better its research and grooming output. This is the moat.

2. **Quality of groomed output.** Each groomed ticket should be 10x better than what a PM could produce manually — grounded in research, validated against strategy, with competitive context and customer evidence. Output quality drives word-of-mouth.

3. **Plugin ecosystem reach.** Ensure PM works well across all major AI coding assistants (Claude Code, Cursor, Codex, Gemini CLI). Broader platform support = larger addressable community.

## 7. Explicit Non-Goals

1. **No development or implementation.** PM ends at the groomed ticket. It does not write code, run tests, or manage deployments. The boundary is deliberate: PM does the thinking; coding agents do the building.

2. **No sprint planning or project management.** PM is not Jira, Linear, or Shortcut. It may lightly track whether groomed backlog items are completed, but it does not manage sprints, velocity, or team capacity.

3. **No product analytics.** PM will ingest analytics data from external sources (PostHog, Amplitude) but will not instrument, collect, or visualize product usage data itself. Analytics tools already exist; PM synthesizes their output.

4. **No enterprise sales motion.** PM is free, open-source, and self-serve. No sales team, no procurement process, no SOC 2 compliance (yet). Enterprise adoption happens bottom-up through individual squad adoption.

## 8. Success Metrics

**Leading indicators:**
- GitHub stars and plugin installs (adoption signal)
- Repeat usage: users who run 3+ PM commands in a week (retention signal)
- Knowledge base depth: average number of research artifacts per active project (compounding signal)

**Lagging indicators:**
- Community contributions (PRs, issues, discussions)
- Organic traffic to productmemory.io (pre-cloud interest)
- Conversion from plugin users to cloud waitlist (when available)
