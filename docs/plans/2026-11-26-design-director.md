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

State at the end of the second session, 2026-11-26. Delivery item 1, the
director path, is built on branch `claude/design-director-planning-f41f75`. It
is not released and no real director review has been run with it yet.

What item 1 added:

- `agents/design-director.md`: the director, registered as `pm:design-director`.
- `skills/dev/references/design-director-rubric.md`: the rubric, hunt list and
  calibration as a runtime reference. The calibration examples carry no product
  name.
- `skills/dev/references/design-director.md`: the review flow, round rules,
  first-impression pass and report contract.
- `scripts/design-director-measure.js`: sweep, insets, nesting, thresholds and
  point query. It runs in the page through any browser tool, or over a JSON
  model for native hierarchies.
- `scripts/design-director-check.js` and `scripts/lib/design-director-report.js`:
  the report check.
- Gate acceptance in `scripts/lib/dev-session-schema.js` and
  `scripts/lib/dev-gate-writer.js`: an approved director report at the current
  commit passes the Design Critique gate, and rejections are kept in the phase's
  recovery history.

Decisions made while building. The owner set the first; the rest are for the
owner to confirm:

- **Default.** By the owner's decision on 2026-11-26, the director is the
  default review for product UI in Dev. Capture remains for PM artifacts, PDFs,
  sessions already in flight on it, hosts that cannot dispatch a separate
  reviewer, and projects whose PM instructions say `Design review: capture`.
  The replay has not been run, so early verdicts are untuned.
- **Measurement tools were rewritten, not lifted.** The probe's audits read a
  Chrome DevTools snapshot and cannot be injected into a page. The new script
  measures the same things from the live DOM.
- **A fifth tool, `thresholds`.** It lists low contrast, small targets and
  unnamed controls, since the rubric's accessibility anchors need those numbers.
- **Native measurement takes a prepared model.** There is no converter from a
  simulator's hierarchy dump yet.
- **The report's `review` number is the lineage.** A reset restarts `round` at
  1 while `review` keeps counting to five.
- **A run ends at its approval.** A later commit that changes the reviewed UI
  is reviewed as a new director run in its own directory.
- **Parked is terminal.** After a round 3 rejection or a fifth review, Dev
  stops. It does not diagnose and continue, a reset cannot reopen the run, and
  the owner restarts the work in a new session.
- **A late major below the blocking bar scores 4.** The rubric files such a
  finding instead of blocking on it, so its dimension cannot score below the
  floor. The score links the finding and names its fix.

Decisions recorded in the rubric's Part 4 still take precedence over the plan
text above where they differ.

Shipped: v1.14.68 made the director the default (PR 478). v1.14.69 closes four
review findings: a parked run now blocks the session, the gate writer binds the
recorded approval, measured styles need saved output, and the check runs from
any directory.

Next steps, in order:

1. Replay the director on the twenty calibrated screens. It should find at
   least what the owner found on each. The screenshots are in `cleanlog-mono`
   at `work/design-system/web-client-rollout/evidence/captures` and
   `docs/audits/mobile/screenshots`; the calibration note lists each source
   file. Screenshots allow only a screenshots-only review, so run a few of the
   web screens against the running app as well, to exercise the measurement
   tools.
2. Delivery item 2, the build step additions.
3. Delivery item 4 holds the remaining mechanical checks: hardcoded values,
   declared surfaces and neighbour pixel comparison.

2026-11-27: delivery item 2 is built, not released. A new reference,
`skills/dev/references/design-director-build.md`, holds the builder's part: read
the rubric, write a build brief at
`.pm/dev-sessions/{slug}/implementation/build-brief.md`, start from the
preview's code, seed awkward data, self-check each slice at desktop and narrow
with the measurement tools, and write a handoff note at
`.pm/dev-sessions/{slug}/implementation/handoff.md`. Its access notes and
builder's claims sections feed items 4 and 7 of the director brief. Step 05,
the implementer and worker references and `scripts/dev-prompt.js` load it for
product UI. No session schema or gate change: Dev reads the note to assemble
the brief and checks its `commit` against HEAD before dispatch.

2026-11-27: delivery item 3 is built, not released. It reuses the bound
`design_context` that already travels from the proposal through the RFC sidecar
to Dev and its worker packets. `visual_invariants` are the declared decisions and
`critical_states` the declared states. One optional field is new: `surfaces`,
a list of `{name, paths}` for the screens and components in scope, allowed only
when `ui_impact` is true. `validateDesignContext` and the Dev and RFC JSON
schemas check it, and the proposal reader shows it to the approver. Groom Step 5
writes all three lists for a rendered target and Handoff checks them. The build
brief copies them into Target and States, and director brief item 3 copies the
brief. Older contexts without `surfaces` still validate. Grooming has to write
`surfaces`; no checker requires it yet, because a required field would fail
proposals already approved.

2026-11-27: delivery item 4 is built without the standing merge authorization,
not released. `scripts/design-director-mechanical.js` runs the scope, token and
neighbour checks against the diff from where the branch left the default
branch. Dispositions, UI-file overrides and neighbour screenshot pairs live in
`.pm/dev-sessions/{slug}/design-critique/mechanical/checks.json`. Neighbour PNGs
are compared by decoded pixels with the existing decoder in
`scripts/lib/media-inspect.js`; other formats only by bytes. The checks enforce
only when the design context declares `surfaces`; otherwise they report and
never fail. The recorder reruns them on a director approval and refuses it
while they fail. An unfixable failure is recorded as a `blocked` result with
the code `design-director-mechanical`. Merge authorization was deliberately left
out: the owner has not approved unattended merging, so nothing merges without a
human. The code reviewer is still not checked to be a separate agent from the
builder; Review allows a shared-orchestrator fallback.

Not yet examined: whether `pm:review`, QA and the test gates are strong enough
for unattended merging.

Still needed from the owner: a deadline.
