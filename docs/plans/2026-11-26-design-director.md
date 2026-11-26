---
title: Design Director — unattended Dev and Ship at best-in-class craft
created: 2026-11-26
updated: 2026-11-26
status: draft
---

# Goal

After the user approves grooming, an agent builds, reviews and merges to the
remote default branch with no further human review. Anything it merges meets a
best-in-class bar for code, UX and visual craft. Anything that does not meet the
bar is parked as an open PR, never merged.

The draft rubric and director instructions are in
`2026-11-26-design-director-rubric.md`.

# Why change

Two problems were reported from daily use.

**Capture keeps blocking.** The capture helper tries to prove evidence is
authentic. It needs a `data-pm-state` marker rendered by the product, a
hand-written assertion file per state, a clean browser profile with no login, and
it cannot click or type. Any failed check exits and deletes the staged files.
There is no degrade path and no waiver. Of the last 99 commits, 74 touched Design
Critique files; 69 of the 96 commits ever made to those files are fixes.

**Weak designs still pass.** Four files state that subjective craft stays P2/P3
and never blocks. Scores gate nothing. There is no craft dimension, no anchor per
dimension and no fidelity check against an approved design. Reviewers see
viewport-only screenshots at 1x and cannot interact with the product.

The evidence chain is labelled `workflow-attested-non-cryptographic` by the plugin
itself. It defends against forged evidence, which is not the observed failure.
The observed failures are omission, self-approval and a low bar.

# The flow

1. **Groom.** The only human touchpoint. UI work ends with an approved rendered
   target, built as an in-app preview from real components where an app exists.
   Grooming records the decisions the target makes and the surfaces in scope.
2. **Implement.** The builder works from the rubric, a build brief and the
   approved target, and checks its own render after each slice.
3. **Design Director review.** A separate agent uses the running app, measures
   it and judges it against the rubric.
4. **Fix loop.** Up to three rounds, with narrowing scope for new findings.
5. **Merge or park.** Passing work merges under a standing authorization.
   Failing work stays as an open PR with the report.
6. **Retro.** Includes one batched question about follow-up items.
7. **Close-out.** Removes everything the run created. Runs on every outcome.

# Design Director

## Inputs

- The intent: user, job, what the change is for.
- What changed: screens and components touched by the diff.
- Access: the running app, a login and seeded data that reaches awkward cases.
- The approved target and its declared decisions.
- The bar: the rubric, the project's reference set and its best existing screens.
- The builder's handoff note.
- The round number.

The director receives no prescribed state list. Choosing what to examine is part
of the judgment.

## Method

The director drives the app in a browser or simulator, takes screenshots at 2x
with zoom, and runs measurement tools on the live page. It reads the numbers
beside the pixels and gives one verdict. Nothing fails mechanically.

Measurement tools, lifted from the existing probe without its pass/fail wrapper:

- **Style sweep.** Like elements grouped, outliers listed.
- **Inset and edges.** Container edge to content, and content alignment.
- **Nesting.** Doubled padding, surfaces inside surfaces, adjacent borders and
  dividers.
- **Point query.** Computed values for a chosen element.

The standard sweep is mandatory on every changed screen. Each outlier gets a
disposition: defect, or intentional with a reason.

## Verdict

Approve or reject. Craft and composition can block. Every dimension has a floor.
A second, context-free agent then looks only at the director's screenshots and
reports a first impression.

## Rounds

| Round | New findings allowed | Purpose |
|---|---|---|
| 1 | Everything, including small polish and elevation | The complete list |
| 2 | Fix verification, regressions, missed major items | Verify and close |
| 3 | Unfixed major items and regressions | Merge or park |

The bar is the same in every round. Narrowing applies only to new findings.
Findings from earlier rounds stay open until fixed. Regressions count in any
round.

End of round 3:

- Everything fixed: merge.
- Only small items remain: merge and file them as follow-ups.
- Any major item or regression remains: park.

## Mockup and production

The approved target is authoritative only for its declared decisions. Production
is authoritative for everything else. A mismatch on an undeclared detail is a
flaw in the mockup, not a defect in the build.

The director never restyles the product. A system-level issue becomes a system
improvement note and does not affect the verdict.

# Build step additions

1. The builder receives the rubric, hunt list and reference set before coding.
2. A build brief: components and tokens to use, which container owns spacing at
   each level, layout at desktop and narrow, states to build.
3. Start from the approved preview's code where one exists.
4. Realistic seed data from the first render: long names, empty, many rows,
   failures.
5. After each slice: render at desktop and narrow, run the director's
   measurement tools, compare with the target.
6. A handoff note: how to run and log in, how to reach each state, self-check
   results, known departures from the target.

# Mechanical checks that remain

- The review ran at the merged commit and exercised the app.
- The director and code reviewer are separate agents from the builder.
- The diff has no unexplained hardcoded colours or pixel values.
- The diff stays inside the declared surfaces.
- Untouched neighbouring screens are unchanged, by pixel comparison.
- CI and both gates are green before merge.

Unreached states are reported and never block.

# Follow-up items

System improvement notes and leftover small items are collected during the run
and filed after the merge, with the retro.

- Linear projects: one batched confirmation, keeping the existing rule that
  Linear issues are created only with user approval.
- Native knowledge-base projects: filed directly through the backlog capture
  path and listed in the retro.
- Unanswered questions stay pending in the session.
- Before filing, search for an existing open item and add the occurrence to it.

An item is a system item when fixing it means editing a shared component, a
token, or a screen outside the declared surfaces.

# Close-out

v1.14.67 keeps bulky data out of the session folder. It detects and blocks; it
does not delete, does not track scratch directories, runs only on completion and
sees only the session folder.

Additions:

- **Resource ledger.** Scratch directories, worktrees, databases, started
  processes, seeded accounts and simulators are registered in the session when
  created, each with its removal command.
- **`dev-session.js close`.** Removes everything in the ledger, reports bytes
  freed and anything it could not remove. Safe to rerun. Runs on merged, parked,
  failed and interrupted outcomes.
- **Orphan sweep.** Runs at session start and on demand.
- **Auto-clean at completion.** Misplaced generated data is removed by the tool.

Rules: dirty worktrees are preserved and reported. Shared caches are left alone.
Project databases are removed through a teardown command the project declares.

# What is removed

- Capture as a certifying step: `data-pm-state` markers, assertion files, the
  coverage matrix, the clean-profile rule.
- The hash-bound capture, review and receipt chain.
- The "taste never blocks" rules.
- Layout audits as hard gates.

The old code stays in place, unused by default, until in-flight sessions finish
and the replay passes.

# Delivery

Separate PRs, each releasable:

1. Director path: agent, rubric, measurement tools, round rules, gate check.
2. Build step additions.
3. Approved target and declared lists carried from grooming.
4. Scope and token checks, park on failure, standing merge authorization.
5. Ledger, `close` and orphan sweep.
6. Replay against known UI changes, then enable auto-merge.

# Deferred

- Deleting the old capture and checker code.
- Craft evals built from good and weak versions of the same screen.
- A weekly digest of merged work.
- Layout alternatives required in every groom.
- Review of the code-quality gates for unattended merging.
- Evidence diet and archive retention.

# Risks

- The director's bar is tuned on few examples at first. Expect some weak
  approvals and some unfair rejections early.
- The director can dismiss a real outlier as intentional. Dispositions are in
  the report so this can be audited.
- Mobile measurement covers insets, edges and nesting, not colour or padding
  values.
- Unattended merges rest on code-review gates that have not been examined
  against this standard.
- Projects without good seed data get a shallow review.
- Authenticity rests on trust plus the three cheap checks, not on certification.

# Open questions

- The deadline, which sets how much of the delivery list makes the first cut.
- The reference set for the rubric's top anchor.
- Replay material: merged UI changes with a known opinion, good and weak.
- Whether native knowledge-base projects should get the same follow-up
  confirmation as Linear projects.
- Runtimes without browser tools: the fallback is review of supplied
  screenshots, with that limit stated in the report.

# Resume here

State at the end of the first session, 2026-11-26. No runtime plugin file has
been changed. The work so far is three notes in `docs/plans/`:

- `2026-11-26-design-director.md`: this plan.
- `2026-11-26-design-director-rubric.md`: rubric and director instructions,
  revision 3, with decisions in Part 4.
- `2026-11-26-design-director-calibration.md`: the owner's comments on twenty
  Cleanlog screens, with a summary.

Decisions made after this plan was first written are recorded in the rubric's
Part 4 and take precedence over the text above where they differ. The main
ones:

- A floor of 4 on every dimension; a 5 means nothing left to raise and needs no
  reference screen. The owner's eye is the minimum standard.
- States declared in grooming must be examined. An unreachable one is a round 1
  finding; the work parks only if it is still unreachable after round 3.
- One reset per run, for a rebuild, a wrong direction or an invalid earlier
  round, with at most five reviews.
- The first-impression agent has no veto; the director answers each point.
- The director is a new agent; the existing `designer` agent is unchanged.

Next step: delivery item 1, the director path. That means a new agent file, the
rubric as a runtime reference, the measurement tools lifted from
`scripts/design-critique-capture-probe.js`, the round rules, and a gate check
that accepts a director report at the current commit. The old capture path
stays in place.

Before auto-merge is enabled: replay the director on the twenty calibrated
screens. It should find at least what the owner found on each. The screenshots
are in `cleanlog-mono` at
`work/design-system/web-client-rollout/evidence/captures` and
`docs/audits/mobile/screenshots`; the calibration note lists each source file.

Not yet examined: whether `pm:review`, QA and the test gates are strong enough
for unattended merging.

Still needed from the owner: a deadline.
