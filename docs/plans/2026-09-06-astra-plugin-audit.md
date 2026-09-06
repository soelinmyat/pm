---
title: PM improvements for GPT-6 Astra
type: source-audit-proposal
created: 2026-09-06
updated: 2026-09-06
status: proposed
source_commit: a9d85b609bc36abc12c3d7b2a8bf260a1ec836d8
source_version: 1.13.52
---

# PM improvements for GPT-6 Astra

PM has a strong foundation for Astra: durable phase state, explicit authority, source-bound evidence, risk routing, and output-quality evaluation. The highest-value improvements are to make the loaded instructions consistent, reduce unnecessary interruptions and context, and measure useful outcomes alongside execution cost. Preserve the existing evidence machinery while making ordinary work easier to complete.

This is a source review and improvement proposal, not a measured claim that a new prompt is faster or better. No runtime files, installed skills, model defaults, or user settings were changed. No paid live model evaluations were run.

## Scope and evidence

Reviewed the fetched `origin/main` at commit `a9d85b6`, PM 1.13.52, in an isolated worktree. Inspected the core Dev, Review, Groom, RFC, Research, Think, Strategy, and Ship contracts; shared runtime/writing guidance; prompt builders and model profiles; installation instructions; and the evaluation suite. Inventoried all skill files, but did not perform an exhaustive security or line-by-line review of every utility.

Local observations are separate from external guidance. Source references below are repository-relative paths and one-based lines at the pinned commit. The companion inventory records reproducible sizes and checks. Word counts are whitespace counts, not tokenizer measurements, billed tokens, or actual loaded-context totals.

OpenAI's Astra guidance identifies stronger sensitivity to skill instructions, extra clarification behavior, verbose formatting, and potentially excessive testing on small changes. It recommends explicit autonomy boundaries, clear instruction precedence, and risk-appropriate verification. Those are directly relevant to PM's remaining friction. [Official Astra guidance](https://developers.openai.com/api/docs/guides/latest-model#prompting-best-practices), accessed 2026-09-06.

## What to keep

- Dev and RFC already load the active phase through their runners. Extend this pattern rather than build another orchestration system.
- Named Astra profiles already exist. Session validation rejects accidentally substituting Astra into another model profile and preserves model identity in results.
- Research 1.13.52 already weighs authority, independence, recency, and claim fit. Its stopping rule asks whether another source could change confidence or the decision. Keep this improvement.
- Review already separates logical lens coverage from worker count and supports bounded freshness/delta paths. Six lenses need not mean six agents.
- TDD guidance already distinguishes regression, new behavior, characterization, generated code, and configuration; it explicitly rejects meaningless tests for non-executable prose.
- Canonical proposals and generated readers, exact approval records, and source-bound evidence reduce drift between stages.
- Existing quality evals distinguish behavioral compliance from judgment and artifact quality. Extend them rather than create a competing score system.

## Prioritized changes

### 1. Resolve duplicate installations and make runtime provenance visible

**Priority: first. Confidence: high. Benefits: consistency, retrieval efficiency, current output quality.**

The active session exposes PM through fallback skill aliases, native plugin skills, and migrated command wrappers. Local inspection found the fallback vendor copy at **1.13.49** and the native cache at **1.13.52**. Their Research entry files differ. The older copy requires three sources for a finding; the new copy evaluates evidence quality and limits further searching by decision value. This is an observed version conflict, not a hypothetical context concern.

The install guide explains fallback and native installation but does not provide a migration cleanup check (`.codex/INSTALL.md:14,73`). Codex documentation confirms that duplicate skill names are not merged and both can appear. Skill metadata also shares a bounded discovery budget. [Codex skills](https://developers.openai.com/codex/skills), accessed 2026-09-06.

**Proposal:** add a read-only installation diagnostic that reports each discovered root, manifest version, entry-file digest, alias target, and duplicate logical workflow. Recommend one active installation method. Provide an explicit migration command that disables only verified PM-owned fallback aliases after native discovery succeeds, with a reversible record. Investigate whether migrated command wrappers can be explicit-only in the supported packaging format; do not manually modify generated cache files.

**Acceptance:** a fresh session has one intended implicit route per PM workflow; Research resolves to the current entry file; no unrelated skill is disabled. Include a mixed-version fixture. Document root/version in diagnostics and eval receipts, without repeating it in every chat message.

### 2. Replace procedural confirmations with decision-based pauses

**Priority: first. Confidence: high on the instructions; actual time savings unmeasured. Benefits: completion rate and fewer user interruptions.**

Think explicitly asks for confirmation during capture, reframing, approach selection, and synthesis (`skills/think/SKILL.md:53–69`). These can be useful in an interview, but the skill offers little distinction between collaborative exploration and a request to produce a recommendation autonomously.

Competitor Research requires another confirmation between sequential profiles even after the user selected the competitors, and asks before repairing missing profile sections (`skills/research/steps/04-competitor.md:55,69`). Those are unnecessary pauses inside an already selected scope.

**Proposal:** retain an interview mode when the user requests discussion. For a clear delegated assignment, complete reversible analysis, drafting, and necessary repair; state material assumptions; ask only when the answer changes scope, an adopted decision, or authorized effects. An unapproved draft can be saved without claiming that the user adopted it. Preserve exact product approval and release authority requirements.

Add one shared distinction between workflow preferences and certification requirements. `references/skill-runtime.md:95` says instructions never override skill hard gates, while the router recognizes explicit scope narrowing. Clarify that a user can request a draft or decline a lifecycle, but PM must not label an uncertified artifact approved or delivered. Host instruction precedence remains authoritative.

**Acceptance:** a clear three-competitor request completes all three without per-competitor approvals; a missing section is repaired within scope; an explicit interview still asks useful questions; an actual product decision remains unapproved until authorized.

### 3. Finish progressive loading and enforce practical prompt budgets

**Priority: first. Confidence: high. Benefits: less irrelevant context and fewer competing instructions.**

Groom says to read every step despite having a phase runner and bounded phase prompts (`skills/groom/SKILL.md:56`). Research preloads all three mode branches although only one executes (`skills/research/SKILL.md:29`). Ship also preloads every step (`skills/ship/SKILL.md:62`). Similar eager-loading directives exist in other routed skills.

Measured default step content, excluding references and artifacts:

| Workflow | Step files | Words | UTF-8 bytes |
|---|---:|---:|---:|
| Groom | 11 | 2,961 | 22,695 |
| Research | 5 | 3,807 | 28,879 |
| Ship | 7 | 8,494 | 63,457 |
| Dev | 10 | 8,773 | 63,501 |

Dev's total is inventory, not evidence that it eagerly loads those bytes. It demonstrates why its existing phase loading matters. Loading fewer files may add retrieval calls; measure the net effect.

**Proposal:** make Groom use only its current phase and declared prerequisites; make Research load intake/router plus the selected mode; stage Ship instructions at transaction boundaries while keeping authority and recovery invariants available. Update the shared runtime's Dev-only description to include RFC's existing phase loading.

Dev's prompt builder reports bytes/words but does not set the shared renderer's size limits (`scripts/dev-prompt.js:81,88`); Groom already has limits (`scripts/groom-prompt.js:25`). Add configurable budgets and component accounting across prompt builders. Prefer references plus focused excerpts over whole histories. Never truncate authority, acceptance criteria, or result contracts silently.

Use a concise core contract plus conditionally loaded procedures. Keep Goal/How/Done-when, but place repeated rationalizations and rare recovery detail where they are needed. Agent Skills guidance supports on-demand references, clear defaults, and matching procedural strictness to the task. [Skill-authoring best practices](https://agentskills.io/skill-creation/best-practices), accessed 2026-09-06.

**Acceptance:** unused Research modes and future Groom phases are absent from execution packets; overrides still work; bounded packets retain every active gate; real traces show less loaded instruction content without additional recovery failures.

### 4. Route verification and report presentation by actual risk

**Priority: next. Confidence: high on mandatory work; savings require measurement. Benefits: latency and reduced redundant tooling.**

The Workspace step runs the project's test command before implementation (`skills/dev/steps/03-workspace.md:108`), independently of the more selective TDD guidance. Review publication requires desktop/tablet/narrow viewport captures, full-page PNGs, DOM metrics, and print PDF for every passing canonical report (`skills/review/steps/05-publish.md:17`). These are useful guarantees for a complex reader, but can dominate a small source review.

**Proposal:** have the runner produce one verification plan derived from repository requirements and observed risk. Bind executed checks to the relevant source, command, environment, and dependency identities. Reuse evidence only when its inputs remain valid; repository-mandated final checks still run. Stop expanding tests once required checks pass unless a change or unresolved concern justifies more.

For generated review reports, explore a compact presentation route: current data/schema/escape checks and a current content-fit smoke check for simple reports; full responsive and print verification for renderer/template changes, rich reports, or layout risk. Preserve canonical findings and source bindings. This requires coordinated changes to the report gate and its schema, not merely telling the agent to skip captures. Do not substitute template certification for testing variable report content.

**Acceptance:** low-risk cases complete required checks once per valid input identity; code or environment changes invalidate relevant evidence; renderer changes still trigger full visual checks; long/untrusted report content does not escape layout or sanitization checks.

### 5. Evaluate daily product work and cost per accepted outcome

**Priority: begin measurement now; expand alongside the first fixes. Confidence: high. Benefits: evidence-based tuning of both quality and efficiency.**

The quality suite has **41 cases across six workflows**: Groom, RFC, Dev, Review, Design Critique, and Ship. Research, Think, Strategy, and Ideate are absent from that suite (`evals/quality/suite.json`). This matters for a daily product-management plugin.

The scorer already includes elapsed duration (`scripts/evals/quality.js:1071,1095`), but the inspected aggregate has no input/output/reasoning/cache-token or interruption metrics. The only committed quality comparison found is an older single-repeat Sol/Opus Groom result, explicitly unsuitable as a current hardened baseline. It supplies no Astra quality ranking.

**Proposal:** extend the existing suite with product cases for derivative-source duplication, contradictory evidence, stale strategy, plausible-but-irrelevant citations, unsupported precision, biased framing, ordinary draft requests, and recovery from incomplete research. Include clean controls where the correct behavior is to accept adequate work and continue.

Record successful completion and human acceptance, consequential claim support, false blockers, decision usefulness, task-relevant coverage, unnecessary questions, repeated reads/checks, tool calls, elapsed time, and available token categories. Use `null` with a reason when usage is unavailable. Do not translate desktop quota into invented dollars.

Compare the same Astra model and reasoning effort under current versus revised instructions first. Run an initial eight-case paired pilot with three repeats per condition: **48 live runs**, proposed but not executed. Freeze tasks, source variants, environment, and grading rules. Extend evaluation identity to bind the intended treatment; the existing identical-source baseline rule cannot by itself compare two plugin revisions. Use blind, counterbalanced judgments and report failures separately from successful-run cost. Three repeats detect gross problems; they do not establish broad statistical superiority.

**Acceptance:** no authority or artifact-integrity regression; no loss of consequential quality; lower median completion time and interaction burden on the targeted cases. Set a numerical improvement threshold only after measuring baseline noise. Report uncertainty and tails as well as averages.

### 6. Make the selected Astra policy predictable across stages

**Priority: next. Confidence: high. Benefits: model consistency and controllable resource use.**

The interactive parent can be Astra while CLI workers default to Sol: `skills/dev/references/model-profiles.json:4` selects `codex-workhorse`. Astra is an explicit named profile at line 17; RFC calls its equivalent `gpt-6-astra-high`. These are legitimate defaults, but the user should not have to infer stage-level model selection from adapter internals.

**Proposal:** offer a persistent, explicit execution preference with per-phase overrides and record the resolved model/effort in each receipt. Preserve the named-profile integrity checks. Let a user choose an Astra policy for demanding judgment while keeping cheaper workers an explicit option. Avoid silently changing everyone's default.

For experimentation, compare Astra medium/high on routine synthesis and bounded implementation, and high/xhigh on difficult architecture or disputed reviews. These are candidate settings, not measured optimal choices. Maintain existing ownership-safe delegation and bounded reviewer counts; parallelize only when there is useful independent work and the host permits it.

Astra API features such as asynchronous tools and mid-conversation effort changes are possible future adapter work. PM currently runs in host/CLI environments; API availability does not establish that the current adapter exposes them. Capability detection and a measured need come first. [Astra capabilities](https://developers.openai.com/api/docs/guides/latest-model), accessed 2026-09-06.

**Acceptance:** an explicitly selected model policy resolves consistently in Dev, RFC, Review, and evals; resume preserves it; unsupported capabilities fail clearly; ordinary inline work inherits the actual current runtime.

### 7. Keep structural checks, strengthen semantic calibration

**Priority: next. Confidence: high on implementation; quality gains unmeasured. Benefits: useful, concise output.**

The proposal quality checker combines valuable integrity checks with text-length, vocabulary, generic-string, and coverage heuristics (`scripts/proposal-quality-check.js:18,319`). A longer sentence can satisfy such a floor without being a better requirement. Conversely, concise domain-specific wording can be adequate without meeting a generic word-count preference.

PM already has question-based review and blind judging. Strengthen these rather than present a structural score as proof of product judgment. Retain distinct answers, evidence relevance, source binding, and approval checks.

**Proposal:** add small, phase-specific good/bad examples for testable acceptance criteria, a real alternative, a risk with a falsifiable trigger, and a calibrated recommendation. Include examples of valid terse answers and clean review verdicts. Ask whether the evidence entails the consequential claim, whether the alternative could actually be chosen, and whether the proposed metric would change a decision. Use the existing quality rubric for blind assessment.

Keep chat updates short and verdict-first. Generated artifacts can contain the detail needed for review without repeating the entire evidence envelope in the final chat response. Avoid extra formats unless the owning skill or user needs them.

**Acceptance:** judges prefer the revised artifacts on decision usefulness and supported claims, not length or number of sections; concise correct controls pass; fluent but unsupported controls fail; schema and approval guarantees remain intact.

## Suggested sequence

1. Capture a small baseline and diagnose the active installation. Establish one current PM route before judging prompt behavior.
2. Make one focused instruction change set: material-decision pauses, phase-local Groom/Research loading, and accurate runtime guidance. Add corresponding behavioral cases.
3. Measure it against the baseline; then introduce selective verification/report rendering as a separate experiment so its effect can be attributed.
4. Extend product-work quality cases and model-policy UX. Promote defaults only from measured results.

The first implementation should be small enough to attribute improvement. A wholesale Astra rewrite would make it hard to distinguish which change improved quality or caused a regression.

## Proposed shared autonomy wording

This is an original candidate policy for evaluation, not a replacement for host instructions or the existing approval schema:

> Complete the requested analysis and other authorized reversible work using the available context. State assumptions that materially affect the result. Ask for missing input when different answers would change scope, an adopted product decision, or an action's authority. While an answer is pending, continue independent work. Save useful drafts without claiming approval. Reuse valid decisions and verification evidence; repeat work when its inputs changed or a concrete unresolved concern requires it. Keep required certification and external-effect boundaries explicit.

Load that policy once. Let individual phases declare their actual outputs, constraints, required evidence, and stop conditions rather than repeating general exhortations.

## External research and limits

All sources accessed 2026-09-06. External material informs the proposals; local source inspection establishes PM's current behavior.

- [OpenAI: Using GPT-6 Astra](https://developers.openai.com/api/docs/guides/latest-model). Primary source for Astra-specific behavior and capabilities. The proposed optimal PM settings remain untested.
- [OpenAI: Codex skills](https://developers.openai.com/codex/skills). Primary source for skill discovery, duplicate names, progressive disclosure, and optional invocation policy.
- [Agent Skills: authoring best practices](https://agentskills.io/skill-creation/best-practices). Maintainer guidance for selective context, task-appropriate procedures, clear defaults, and iteration from traces.
- [Anthropic: effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents). Primary practitioner guidance for just-in-time retrieval and durable notes. Useful cross-model design reasoning, not an Astra benchmark.
- [Lulla et al.: impact of AGENTS.md on efficiency](https://arxiv.org/abs/2601.20404). The authors report efficiency improvements in their evaluated repository tasks. This is not evidence of the same gains in PM or Astra.
- [Khatri: two-agent context-file ablation](https://arxiv.org/abs/2607.27250). The abstract reports no measurable correctness improvement from context strategy in its tested setting. Together these studies argue for workload-specific evaluation rather than assuming that adding or removing instructions always helps. Only the abstracts were reviewed here; this is not a methodological replication.
- [Unofficial Astra prompting discussion](https://www.reddit.com/r/codex/comments/1w7x57n/before_blaming_gpt6_astra_read_its_prompting_guide/). Reviewed as a community pointer to the official guide, not independent validation of model behavior. Secondary launch guides surfaced in search but were not used to establish technical claims.

## Verification performed

- `node scripts/validate.js --plugin`: passed, 27 rules, 142 files, no issues.
- `node scripts/evals/check.js`: passed, no issues. This validates eval definitions, not live output quality.
- `node scripts/skill-audit.js`: passed, 24 skills, no authoring issues. Static compliance does not rule out conflicting or inefficient instructions.
- Focused existing tests for Astra session contracts and Dev/Groom prompt builders: 14 passed.
- Compared installed Research entry bytes against the pinned source; native 1.13.52 matches and fallback 1.13.49 differs.

No implementation, release preparation, cache sync, push, or PR was performed. This proposal is ready to select and scope into implementation.
