---
type: topic-research
topic: Groom-Centric Entry Point
created: 2026-03-21
updated: 2026-03-21
source_origin: external
sources:
  - url: https://github.com/EveryInc/compound-engineering-plugin
    accessed: 2026-03-21
  - url: https://github.com/obra/superpowers
    accessed: 2026-03-21
  - url: https://github.com/garrytan/gstack
    accessed: 2026-03-21
  - url: https://github.com/gotalab/cc-sdd
    accessed: 2026-03-21
  - url: https://kiro.dev/blog/introducing-powers/
    accessed: 2026-03-21
  - url: https://kiro.dev/docs/powers/create/
    accessed: 2026-03-21
  - url: https://impeccable.style/
    accessed: 2026-03-21
  - url: https://evilmartians.com/chronicles/six-things-developer-tools-must-have-to-earn-trust-and-adoption
    accessed: 2026-03-21
  - url: https://www.nngroup.com/articles/progressive-disclosure/
    accessed: 2026-03-21
  - url: https://lollypop.design/blog/2025/may/progressive-disclosure/
    accessed: 2026-03-21
  - url: https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html
    accessed: 2026-03-21
---

# Groom-Centric Entry Point — Research Findings

## Summary

No competing AI coding plugin requires a linear setup pipeline before the user can do real work. The most successful tools use either a single hero command that bootstraps dependencies on-demand (cc-sdd's `/kiro:spec-init`), contextually-activated skills (Superpowers), or independent role-based commands (gstack). Progressive disclosure research (NN/g, IxDF) confirms that linear pipelines are problematic when steps are interdependent — the 2026 UX consensus is to reveal complexity at the moment of readiness, not before.

## Findings

1. **No competitor has a mandatory linear prerequisite chain.** Compound Engineering starts at `workflow:plan`. Superpowers auto-activates skills based on context. gstack has independent role-based commands. cc-sdd starts at `/kiro:spec-init <what-to-build>`. Kiro uses POWER.md as a single entry point that routes to context-specific steering files. Impeccable has independent design commands. PM is the only tool that requires setup → research → strategy → groom as sequential prerequisites.

2. **cc-sdd is the closest competitive pattern to groom-as-hero.** Its `/kiro:spec-init <what-to-build>` is a single command that runs the full pipeline: requirements → design → tasks → implementation. Everything bootstraps on-demand from that one entry point. This directly validates the groom-hero approach — the user says what they want to build and the system handles the rest.

3. **Compound Engineering uses a 4-phase loop, not a pipeline.** Plan → Work → Review → Compound. The entry point is `workflow:plan`. There's no prerequisite research or strategy step. The "compound" phase feeds learnings back into the system — similar to PM's memory injection, but positioned as the core loop rather than a side effect.

4. **Superpowers eliminated all commands in favor of auto-activated skills.** After installation, skills like TDD, debugging, and brainstorming activate contextually based on what the user is doing. No explicit command invocation needed. This is the extreme end of progressive disclosure — zero friction, zero explicit routing.

5. **gstack uses role-based commands, each independent.** `/office-hours` for brainstorming, `/plan-ceo-review` for strategy, `/ship` for deployment. No required sequence. The user picks the role/perspective they need. Proactive suggestions surface relevant commands contextually.

6. **Kiro's POWER.md is a single entry point with context-specific routing.** The POWER.md file serves as both onboarding guide and workflow dispatcher. On first activation, it validates dependencies and installs hooks. After that, it routes to context-specific steering files based on what the user is doing. Onboarding happens once, inline, not as a separate step.

7. **Progressive disclosure research validates on-demand bootstrapping.** NN/g: "Progressive disclosure defers rarely needed features to a secondary screen." IxDF (2026): "Reveal complexity at the moment of readiness — after a user has demonstrated they need it." Staged disclosure (wizards) is only appropriate when steps have little interaction. Groom's phases are highly interdependent — strategy informs scoping, research informs scope review — making a linear prerequisite chain the wrong pattern.

8. **Evil Martians (2026) identifies "single entry point" as a trust signal for developer tools.** Their 6 requirements for developer tool adoption include: works out of the box, progressive complexity, sensible defaults, and escape hatches. A tool that requires 3 setup commands before doing useful work fails the "works out of the box" test.

9. **Martin Fowler's spec-driven development critique applies to us.** His core observation about Kiro — "it assumes a developer would do all this analysis" — cuts both ways. PM's answer is to do the analysis, but if doing the analysis requires 3 prerequisite commands, we've created our own version of the same assumption: "the user will have already set up, researched, and strategized."

## Strategic Relevance

This research directly supports Priority #1 (Groom-to-dev handoff quality). The handoff quality depends on issues being groomed — and grooming rates depend on how easy it is to start grooming. A 4-step linear prerequisite chain suppresses grooming adoption. Making groom the entry point that bootstraps everything on-demand maximizes the number of issues that get groomed, which maximizes the number of issues that get the reduced-ceremony dev handoff.

It also supports Priority #2 (Depth of product context). If groom bootstraps strategy and research on-demand, users who would have skipped those steps now get them automatically as part of grooming. The knowledge base grows as a side effect of doing real work, not as a prerequisite to it.

## Implications

1. **Make `/pm:groom` and `/pm:research` the two hero entry points.** Groom for "I want to build something" and research for "I want to understand something." Everything else (setup, strategy, ideate, dig, ingest, refresh) becomes supporting infrastructure invoked on-demand.

2. **Auto-bootstrap setup within groom.** If `.pm/config.json` doesn't exist, create it with sensible defaults. Don't make the user run `/pm:setup` first. Setup becomes an advanced configuration command, not a prerequisite.

3. **Strategy should be creatable inline during groom Phase 2.** This already partially works (groom offers to run `/pm:strategy`), but the UX should be lighter — quick-start strategy creation, not the full strategy skill. A minimal strategy (ICP + 3 priorities + 3 non-goals) is enough to unblock groom.

4. **Dashboard should orbit groom.** Home page shows active groom sessions and recent proposals as the hero. Research and strategy are reference material, not primary navigation. This aligns with PM-025 (already done) but should be reinforced.

5. **README and onboarding should lead with groom.** The "Get Started" section should be: install, then `/pm:groom <your idea>`. Not install, setup, research, strategy, then groom.

6. **Consider the Superpowers pattern for future evolution.** Auto-activation of skills based on context (no explicit command needed) is the ultimate progressive disclosure. Not for v1, but worth watching.

## Open Questions

1. How light can the inline strategy creation be? Can we derive a minimal strategy from the first groom session's research, or does the user need to provide ICP/priorities explicitly?
2. Should `/pm:research` also auto-bootstrap setup, or is that only for groom?
3. How do we handle the case where a user has been doing research for weeks and then starts grooming? The research exists but strategy doesn't — should groom synthesize a strategy from existing research?
4. Should the dashboard have a prominent "Start grooming" CTA on the empty state, or is the command-line entry point enough?

## Source References

- https://github.com/EveryInc/compound-engineering-plugin — accessed 2026-03-21
- https://github.com/obra/superpowers — accessed 2026-03-21
- https://github.com/garrytan/gstack — accessed 2026-03-21
- https://github.com/gotalab/cc-sdd — accessed 2026-03-21
- https://kiro.dev/blog/introducing-powers/ — accessed 2026-03-21
- https://kiro.dev/docs/powers/create/ — accessed 2026-03-21
- https://impeccable.style/ — accessed 2026-03-21
- https://evilmartians.com/chronicles/six-things-developer-tools-must-have-to-earn-trust-and-adoption — accessed 2026-03-21
- https://www.nngroup.com/articles/progressive-disclosure/ — accessed 2026-03-21
- https://lollypop.design/blog/2025/may/progressive-disclosure/ — accessed 2026-03-21
- https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html — accessed 2026-03-21
