# Design Director Build

How the builder works when the Design Director will review the change. Write a build brief before UI code, check each slice against the target, and leave a handoff note the director brief is assembled from.

## When to use it

Use it for Dev work that changes product UI and is reviewed by the Design Director, which is the default. `design-director.md` lists the cases that use the capture path instead. Skip this file for those cases and for work with no product UI.

## Who does what

- **Root** writes the build brief and the handoff note. The session folder belongs to root.
- **Inline builder.** Root is the builder and does everything below.
- **Delegated worker.** Receives the rubric path and the build brief path in packet Inputs. Builds, runs the self-check, and returns its self-check results and known departures in the result summary. Root merges them into the handoff note after integration.

## Before any UI code

1. **Read the rubric.** Read `design-director-rubric.md` in full: the scale, the anchors, the hunt list and the calibration. There is no separate reference set. The bar is the rubric's calibration section plus any examples in the project's PM instructions, which take precedence.
2. **Write the build brief** at `.pm/dev-sessions/{slug}/implementation/build-brief.md`, using the template below. Fill every section. Write `none` where a section does not apply, with the reason.
   Take the Target and declared states from the session's bound design context: `task.design_context`, or the work unit's `contract.design_context` on an RFC route. Copy the entries word for word. Never write them from memory or from the proposal prose.
   - **Target.** `prototype.path`, or the `app_preview` observation evidence paths. Neither, or no design context at all, means there is no target.
   - **Declared decisions.** The `visual_invariants` entries, when there is a target.
   - **Surfaces in scope.** The `surfaces` entries, when present.
   - **Declared states.** The `critical_states` entries, whenever there is a design context.
3. **Start from the approved preview's code.** With an `app_preview` in the design context, adopt it as Step 05 item 4b describes. With other preview code, start from that code instead of rebuilding the screen. Record each change from it as a departure in the handoff note.
4. **Seed realistic data before the first render.** Cover long names, an empty list or record, many rows and a failure, plus every declared state. Use the project's fixtures or seed setup; `design-critique-seed-conventions.md` shows one pattern. Commit seed code with the feature. Never use real customer data.

### Build brief template

```markdown
---
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

# Build brief: {slug}

## Target
Target path, its declared decisions and the surfaces in scope, copied from the design context. Or none, with the reason: no design context, or one with no prototype or preview.

## Components and tokens
Existing components and tokens to use, with their paths. Any new component, and why no existing one fits.

## Spacing ownership
For each level (page, region, section or card, row, control): the one container that owns padding and gap. Children add no outer spacing of their own.

## Layout
Desktop: regions, order, what sits in the first viewport.
Narrow: what stacks, moves or hides, and what stays in the first viewport.

## States
Each state to build: the declared states from `critical_states` first, then empty, loading, error, disabled, read-only, long content and many rows where they apply. For each, the seed record or action that reaches it.

## Comparable screens
Two or three named existing screens: one that does a similar job, and others that share its navigation, buttons or components.
```

The comparable screens here become item 5 of the director brief.

## After each slice: self-check

This is the builder's own check. It never replaces the director and never counts as a review.

1. **Render** each changed screen at desktop, such as 1440x900, and at narrow width, such as 390x844. Use the seeded states.
2. **Read the whole screen first.** Compare it side by side with the target and the comparable screens: reading order, grouping, density, button order, navigation.
3. **Measure.** On web, evaluate the output of `node "${CLAUDE_PLUGIN_ROOT}/scripts/design-director-measure.js" snippet` in the page. On native, run `design-director-measure.js analyze --model <file>`. Give each outlier a disposition as the rubric's measurement rule requires, and fix defects now. Keep raw output and screenshots in the run's scratch directory.
4. **Walk the hunt list** for the changed screens and fix what it finds.
5. **Record** what was rendered, measured and compared, the outliers and their dispositions, and anything that could not be rendered.

Without a browser or simulator, say so in the handoff note. An unrun self-check is a stated limit, not a pass.

## Handoff note

Write it at `.pm/dev-sessions/{slug}/implementation/handoff.md` before Implementation is recorded. After each director rejection, update it at the fix commit. Its two sections become items 4 and 7 of the director brief in `design-director.md`, so keep them separate: the director reads the access notes first and the claims last.

```markdown
---
created: YYYY-MM-DD
updated: YYYY-MM-DD
commit: full HEAD commit this note describes
---

# Handoff: {slug}

## Access notes
- Start: commands to start the app and its services.
- Log in: where to log in, and the seeded account and password.
- Seed: the command that loads the data, and how to reset it.
- States: for each state in the build brief, how to reach it from the normal entry point.

## Builder's claims
- Self-check: per screen and width, what was measured and compared, outliers and their dispositions.
- Departures: each known difference from the approved target, and why.
- Not checked: states or widths the builder could not render, and why.
```

Access notes say how to reach a state. They do not say what to look at or what the builder expects the director to find.

## Done-when

- The build brief exists and every section is filled before UI code.
- Each slice was rendered at desktop and narrow width and measured, or the limit is stated.
- The handoff note exists, its `commit` is current HEAD, and every state in the build brief has a route in the access notes.

**Advance:** return to Step 05 (Implementation) and record the phase result.
