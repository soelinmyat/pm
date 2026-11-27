# Design Director Review

How Dev satisfies the Design Critique gate for product UI. A separate agent uses the running app, measures it and gives one verdict against `design-director-rubric.md`. There is no capture step, no assertion file and no hash chain.

## When to use it

This is the default review for product UI in Dev. Use the capture path in `design-critique.md` instead when:

- the subject is a PM artifact or PDF
- the project's PM instructions say `Design review: capture`, or the user asks for the capture path
- this session already recorded a capture report
- the host cannot dispatch a separate reviewing agent

Do not switch paths inside one session after a report has been recorded. The gate keeps one lineage per session.

## Roles

Three agents, each separate from the others. Record the identity of each in the report.

| Role | Does | Must not |
|---|---|---|
| Builder | Implements, fixes findings, writes the handoff note | Review its own work |
| Director | Reviews with the `pm:design-director` agent | Edit code |
| First impression | Looks only at the director's screenshots | See findings, the diff or the brief's rationale |

Dispatch the director and the first-impression pass as fresh agents. Where the host cannot delegate, use the capture path: an inline pass by the builder is not a review.

## What the director receives

Assemble one brief. Before dispatch, read the builder's handoff note at `.pm/dev-sessions/{slug}/implementation/handoff.md`, written under `design-director-build.md`. If it is missing, or its `commit` is not current HEAD, have the builder write or update it first.

1. **Intent.** The user, the job and what the change is for, from the session's task and acceptance criteria.
2. **What changed.** The screens and components touched by the diff.
3. **Approved target.** Copy it from the build brief's Target and States sections, which come from the bound design context: the target path, the declared decisions (`visual_invariants`), the surfaces in scope (`surfaces`) and the declared states (`critical_states`). With no target, say so: Fidelity is then scored against the intent, and any declared states still go here.
4. **Access notes.** The handoff note's `Access notes` section: how to start the app, log in and reach each state. Seed data must reach awkward cases: long names, empty, many rows, a failure.
5. **Comparable screens.** Two or three named existing screens: one that does a similar job, and others that share its navigation, buttons or components. One is not enough to judge whether the work belongs to the product.
6. **Round.** The review number, the round number, and the prior report path for later rounds.
7. **Builder's claims.** The handoff note's `Builder's claims` section: self-check results and known departures, marked to be read last.
8. **Review directory.** `.pm/dev-sessions/{slug}/design-critique/director/{run}/review-{N}/`, where `{run}` is a short lowercase name for this director run, such as `main`.
9. **Identities.** The session `run_id`, the director run name, and the builder's agent identity. The director writes all three into the report.

Give no state list beyond the declared states. Choosing what else to examine is part of the judgment.

## Rounds

| Round | New findings allowed | Purpose |
|---|---|---|
| 1 | Everything, including small polish and elevation | The complete list |
| 2 | Fix verification, regressions, missed major items | Verify and close |
| 3 | Unfixed major items and regressions | Merge or park |

- The bar is the same in every round. Narrowing applies only to new findings.
- Each review runs at a new commit that contains the builder's fixes, and gets the next `review-{N}` directory.
- A review continues the one before it: `prior_report` binds the earlier report's path and SHA-256, and every earlier finding stays in the list with its current status.
- One reset per run restarts the round count at 1. Reviews keep counting. A run has at most five reviews.
- A rejection in round 3, or in the fifth review, parks the work. Record the rejection, leave the work unmerged with the report, and stop. The recorder marks the session blocked with the code `design-director-parked`. Dev's usual diagnose-and-continue recovery does not apply here. A parked run takes no further review, a reset cannot reopen it, and this session cannot start another run. Continuing the work needs new direction from the owner and a new Dev session.
- A run ends at its approval. When a later commit changes the reviewed UI, start a new director run: a new `{run}` name, `review-1`, round 1, no `prior_report`. A new run cannot start while the current one is unfinished or parked.

After a rejection, give the builder the open findings and nothing else from the report. The builder fixes, commits, and updates the handoff note at the fix commit.

## First impression

After the director returns and before an approval is recorded, dispatch a fresh agent with only the screenshots and this prompt:

```
You are seeing this interface for the first time. You know nothing about its
history. Look at each screenshot and report, in order:

1. What you think this screen is for and what you would do first.
2. Where your eye goes first, and whether that seems right.
3. Anything that looks off, unfinished, repeated, misaligned or confusing.

Name the visible element each time. Do not guess at behaviour you cannot see.
Return a JSON array of {"id": "p1", "text": "..."} with one entry per point.
```

Add the points to the report as `first_impression.points`. Send them to the director, who answers each one in `first_impression_answers`: either the finding it became, or why it does not hold. This pass has no veto. A point the director accepts as a blocking finding turns the approval into a rejection.

A rejection may be recorded without this pass. Its points are then gathered and answered in the next review.

## Report contract

`report.json` in the review directory. Screenshot and measurement paths are relative to that directory.

```json
{
  "schema": "design-director-report",
  "schema_version": 1,
  "run_id": "the director run name, from the path",
  "session_run_id": "the session run_id",
  "review": 1,
  "round": 1,
  "commit": "full HEAD commit the review ran at",
  "verdict": "approve | reject",
  "outcome": "passed | failed",
  "recovery_policy": "scoped-diagnosis-v1",
  "prior_report": null,
  "agents": { "builder": "id", "director": "id", "first_impression": "id" },
  "exercised": {
    "platform": "web | ios | android",
    "method": "browser | simulator | device | screenshots-only",
    "entry": "where the task was started",
    "journeys": ["what was done, start to finish"],
    "style_values_measured": true
  },
  "screenshots": [
    { "id": "shot-01", "path": "screenshots/shot-01.png", "screen": "Orders", "state": "empty", "viewport": "1440x900@2x" }
  ],
  "measurements": [{ "screen": "Orders", "viewport": "1440x900", "path": "measurements/orders-desktop.json" }],
  "scores": [
    {
      "dimension": "craft",
      "value": 4,
      "anchor": "the anchor clause this score meets",
      "screenshots": ["shot-01"],
      "to_reach_5": "the named change, or empty for a 5",
      "finding_ids": ["f-03"]
    }
  ],
  "findings": [
    {
      "id": "f-03",
      "class": "major | regression | small | elevation | system-note",
      "dimension": "craft",
      "status": "open | fixed | answered | filed",
      "location": "screen and element",
      "observation": "what disagrees, with values",
      "cost": "what it costs the user",
      "change": "the change wanted",
      "screenshots": ["shot-01"],
      "first_seen_round": 1,
      "missed_earlier": false
    }
  ],
  "sweep": [
    {
      "screen": "Orders",
      "outlier": "element and values",
      "disposition": "defect | intentional",
      "cites": "token, component, declared decision or comparable screen",
      "finding_id": "f-03"
    }
  ],
  "declared_states": [{ "state": "from grooming", "status": "examined | unreachable", "finding_id": "" }],
  "reset": { "used": false },
  "first_impression": { "points": [{ "id": "p1", "text": "what the newcomer saw" }] },
  "first_impression_answers": [{ "point": "p1", "finding_id": "", "answer": "why it does not hold" }],
  "ignored": ["development chrome and why"],
  "examined": ["screens, states, widths and journeys"],
  "not_examined": [{ "item": "state or width", "reason": "why" }],
  "measurement_limits": [],
  "self_check_differences": []
}
```

Field rules the check enforces:

- **Dimensions.** All ten, once each: `fidelity`, `hierarchy`, `composition`, `visual-quality`, `craft`, `consistency`, `flow`, `resilience`, `microcopy`, `accessibility`.
- **Scores.** Below 4 links an open major finding or regression. A 4 names `to_reach_5` and links an elevation or small finding. A 5 leaves no finding open or filed on its dimension.
- **Statuses.** `answered` is for an elevation and carries an `answer`. `filed` is for system notes at any time, and for small findings and elevations in round 3.
- **Late findings.** One first raised after round 1 carries `"late": {"ui": "changed-by-fix"}` or `"late": {"ui": "unchanged", "blocks": true, "reason": "anchor-2-or-lower | breaks-task"}`. On unchanged UI only a major finding may be opened, with `missed_earlier: true`. When it does not block, set `"blocks": false` and status `filed`; its dimension scores 4, links the finding, and names the fix in `to_reach_5`. `late` is not allowed on a finding first seen in round 1, and `first_seen_round` must match the earlier report for a carried finding and the current round for a new one.
- **Sweep.** An `intentional` outlier has `cites`. A `defect` has `finding_id`.
- **Declared states.** An `unreachable` state has the `finding_id` of an open major finding. Once the state can be reached, mark it `examined` and the finding `fixed`.
- **First impression.** Until the pass has run, write `"first_impression": null`, an empty `first_impression_answers`, and no `agents.first_impression`. A rejection passes the check in that form. An approval passes only after the points, the first-impression agent's identity and an answer to every point have been added.
- **Prior report.** `null` for the first review of a run. Otherwise `{"path": "<project-relative path of the previous review's report.json>", "sha256": "<hex SHA-256 of its bytes>"}`. Unlike screenshot paths, this path starts at `.pm/`.
- **Reset.** `{"used": true, "reason": "rebuild | wrong-direction | invalid-round", "at_review": N}`, carried unchanged into later reports. A reset is declared in place of the next round, at review 2 or 3; it cannot follow a round 3 rejection.
- **Limits.** `screenshots-only`, or `style_values_measured: false`, needs `measurement_limits` and caps craft at 4. `style_values_measured: true` needs at least one saved measurement file.
- **Verdict.** An approval has no score below 4, no open major finding or regression, and in rounds 1 and 2 no open small finding or elevation. A rejection has at least one of those.

## Check and record

1. Run the check at the reviewed commit:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/design-director-check.js" --report <absolute report.json> --run-id <session run_id>
   ```

   Exit 0 means the report is complete, current and consistent with its verdict. It does not mean the work passed.
2. Record the phase result through `dev-session.js record` with one `review` evidence record whose `artifact` is the absolute `report.json`. Use status `passed` for an approval and `failed` for a rejection.
3. The recorder reruns the check, requires the report's commit to equal the result commit, and keeps each report as an anchor in the phase's recovery history. On an approval it writes the Design Critique gate row pointing at the report. Do not edit an approved report: a later gate write refuses bytes that differ from the recorded approval.

A new commit after an approval makes the report stale. Never edit the report's commit. When the commit changed the reviewed UI, return the session to this phase and review it as a new director run. When it did not, Dev's existing recertification rules decide whether the approval carries forward.

## After the run

- **Follow-ups.** Findings with status `filed` and all system notes are collected for the retro. They are filed after the merge under the project's existing rules for creating backlog items.
- **Wrong-direction reset.** Record it for the retro. It suggests the grooming target was too loose.
- **Parked work.** Report the open findings and the report path. Do not merge. This session is finished; the owner decides whether to start the work again in a new session.

## What this path does not check yet

These remain the job of QA, Review and the delivery gates:

- hardcoded colour or pixel values in the diff
- whether the diff stays inside the declared surfaces
- pixel comparison of untouched neighbouring screens
