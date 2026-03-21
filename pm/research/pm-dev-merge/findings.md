---
type: research-findings
topic: "Merging PM and Dev plugins into a single plugin"
created: 2026-03-21
updated: 2026-03-21
---

# PM + Dev Plugin Merge — Research Findings

## 1. Competitor Landscape: Combined PM+Dev Tools

**No AI coding tool or plugin currently bundles PM and dev workflows into a single integrated pipeline.**

- **Kiro (AWS):** Closest thing — spec-driven development turning requirements into user stories, acceptance criteria, technical design, and implementation tasks. But Martin Fowler notes it assumes specs already exist. No market research, competitive analysis, strategy, or product discovery.
- **MetaGPT:** Defines PM + Engineer + Architect + QA roles in a multi-agent framework. Closest architectural precedent, but a research framework, not a production plugin.
- **Compound Engineering Plugin** (EveryInc, Claude Code): Handles brainstorm, plan, implement, review, compound phases. Purely dev lifecycle — no PM features. Deliberately chose NOT to extend into research/strategy.
- **claude-skills** (alirezarezvani, 5,200+ stars): 192+ skills spanning engineering, product, marketing. Independent skill packs installed a la carte — no integrated pipeline between PM and dev skills.
- **PM Skills Marketplace** (phuryn, 6,769 stars): 65+ PM framework skills, no dev lifecycle features.
- **Cursor, Windsurf, Claude Code, Codex CLI, Gemini CLI:** None bundle PM-like features with dev features. Code-execution tools only.
- **Linear, Shortcut, Notion:** Issue trackers / workspaces, not combined PM+Dev lifecycle tools.

**Bottom line:** The market is fragmented. No one has built a single unified plugin from research through grooming through implementation through merge.

## 2. Market Signals: PM/Engineer Convergence

**The "product engineer" role is real and growing.**

- **Gibson Consultants (March 2026):** Predicts a "messy middle" where PMs increasingly build prototypes with AI tools. High-quality code generation is becoming easily accessible.
- **Anthropic (Cat Wu, Head of Product):** "Designers ship code, engineers make product decisions, product managers build prototypes and evals." Same workflow for strategic thinking and building.
- **Multiple sources (Bentes, Gottlob, Sachdeva):** "AI Product Engineer" owns full lifecycle from strategy to execution. Avg US comp ~$165K. AI-assisted dev reduced coding timelines ~20%, shifting scarce skill to "taste, judgment, and user context."
- **Deloitte / CIO.com (2026):** Engineers spend less time coding, more time orchestrating AI agents. New roles: "Agentic Product Managers."
- **Convergence from both directions:** PMs learn to prototype with AI coding tools. Engineers own product decisions end-to-end.

## 3. Risks of Merging

- **Feature bloat:** 56% of consumers overwhelmed by complexity. Hick's Law applies. Every feature increases codebase complexity, testing, maintenance.
- **Plugin size/context:** GitHub Copilot recommends <1,000 lines for instruction files. Combined plugin would have significantly more.
- **Identity confusion:** Is it for PMs? Engineers? Product engineers? Risk diluting both value props.
- **Bundling dynamics:** Bundling works when user does both jobs (product engineers at startups). Fails when it forces capabilities on users who only need half.
- **DevOps precedent:** Focused tools win bottom-up developer adoption. Bundling works for enterprise procurement, unbundling for developer adoption.

## 4. Key Insight

Martin Fowler on Kiro: it assumes "a developer would do all this analysis" without making explicit who does the upstream product work. This is exactly the gap PM fills. **The strongest argument is not full merger but ensuring PM's groomed output is directly consumable by dev lifecycle tools.** The handoff point — not the merger — is where the value is.

## 5. Middle Paths

- **Tight integration:** Groom output becomes dev input automatically, shared state, but separate installs
- **Plugin family:** pm + dev as siblings with shared conventions and interop protocol
- **A-la-carte:** Users install skills independently (claude-skills model) — but shallow integration depth

## Sources

- Cursor vs Windsurf vs Claude Code 2026 comparison (dev.to)
- AI Coding Agents 2026 comparison (lushbinary.com)
- Product management on the AI exponential (Anthropic blog)
- The Future of the PM Role (Gibson Consultants, March 2026)
- The AI Product Engineer (Bentes, Medium)
- The Rise of the AI Product Engineer (Gottlob, Medium)
- PM/Engineering Convergence in the AI Era (Medium)
- Understanding Spec-Driven Development (Martin Fowler)
- Kiro blog
- Compound Engineering Plugin (GitHub)
- claude-skills (GitHub, 5,200+ stars)
- The Bundling and Unbundling of the DevOps Market (Codacy)
- Feature Bloat articles (Kodekx Solutions, The New Stack)
- Agentic AI in 2026 (CIO.com, Deloitte)
- MetaGPT (GitHub)
