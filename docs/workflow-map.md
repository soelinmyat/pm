# PM Workflow Map

PM is a set of connected workflows, not a mandatory waterfall. Start at the lane that
matches the evidence and certainty you already have, then move only when the next
artifact is useful.

## The five lanes

| Lane | Use it to | Commands | Durable result |
|---|---|---|---|
| Evidence | Capture, normalize, research, and refresh signals | `/pm:note`, `/pm:ingest`, `/pm:research`, `/pm:refresh` | Evidence ledger, research, transcripts, feedback, and insights |
| Product reasoning | Explore a decision, set direction, inventory the product, and find opportunities | `/pm:think`, `/pm:strategy`, `/pm:features`, `/pm:ideate` | Decision briefs, strategy, feature inventory, and ranked ideas |
| Definition | Turn a validated idea into an approved product and technical contract | `/pm:groom`, `/pm:rfc` | Canonical proposal plus reader projections, then an executable RFC and sidecar |
| Delivery | Capture fast work or implement reviewed work through verified release | `/pm:task`, `/pm:bug`, `/pm:dev`, `/pm:design-critique`, `/pm:review`, `/pm:ship` | Backlog record, implementation, checked reports, PR, merge, and delivery receipt |
| Operations | Bootstrap, configure, inspect, synchronize, and run unattended work safely | `/pm:start`, `/pm:setup`, `/pm:list`, `/pm:board`, `/pm:sync`, `/pm:loop` | Project configuration, operational views, synchronized knowledge, and durable run state |

## Common routes

```text
Customer evidence -> note / ingest -> research -> strategy -> ideate
                                           |            |
                                           +------> groom -> RFC -> Dev

Small known chore -> Task --------------------------------------> Dev
Observed defect --> Bug ----------------------------------------> Dev

Dev -> Design Critique (when UI or a PM HTML artifact changed)
    -> QA (when UI changed)
    -> Review -> Ship -> merged delivery receipt
```

Task and Bug are deliberate fast paths. They skip product discovery and technical RFC
authoring because the work is already bounded, but they do not bypass Dev's risk routing,
tests, review, verification, or delivery checks. If capture reveals product uncertainty,
route the work to `/pm:think` or `/pm:groom`. If it reveals architectural uncertainty,
route it to `/pm:rfc`.

## Reader and state boundaries

`pm/` contains durable, human-facing product memory and is intended to be committed:
research, strategy, backlog records, proposals, RFCs, and portable evidence bindings.

`.pm/` contains private or machine-local runtime state and is intended to be ignored:
raw normalized evidence, workflow sessions, leases, gate manifests, captures, and delivery
transactions. A workflow may publish a checked reader into `pm/` while retaining the
machine evidence that proved it under `.pm/`.

The [artifact gallery](artifact-gallery.md) shows this source/reader/evidence split for
the four flagship HTML outputs.

## Routing rules that prevent duplicate work

- `/pm:dev` is the lifecycle owner for implementation. It calls the relevant quality
  phases and hands external delivery to `/pm:ship`.
- `/pm:design-critique` evaluates product UI and PM HTML readers. It does not replace
  source review.
- `/pm:review` owns bug, design, edge, reuse, quality, and efficiency lenses. The
  deprecated `/pm:simplify` compatibility redirect points to `/pm:review`; it is not a
  separate phase or gate.
- `/pm:list` is the compact operational view; `/pm:board` is the visual view of the same
  work; `/pm:loop` owns unattended orchestration and reconciliation.
- Bare `/pm:sync` is bidirectional. Use explicit `pull`, `push`, or `status` only when
  one-way intent is real.

## Choosing a starting point

| What you have now | Start with |
|---|---|
| A raw observation worth remembering | `/pm:note` |
| A folder or export of customer evidence | `/pm:ingest` |
| A market, competitor, or claim to investigate | `/pm:research` |
| An uncertain product decision | `/pm:think` |
| A validated feature that needs sprint-ready scope | `/pm:groom` |
| An approved M/L/XL proposal that needs an execution contract | `/pm:rfc` |
| A small known chore | `/pm:task` |
| A reproducible defect | `/pm:bug` |
| Approved or bounded work ready to build | `/pm:dev` |
| Committed work ready for delivery | `/pm:ship` |
