---
title: Design Director — draft rubric and instructions
created: 2026-11-26
updated: 2026-11-26
status: draft for review, revision 3
---

This is a draft for reaction. Nothing here is wired into the plugin yet. Part 1
is the rubric. Part 2 is the director's instructions. Part 3 is calibration from
the owner's review of twenty existing screens. Part 4 records decisions.
Revision 3 adds the owner's calibration and the decisions settled so far. The
full review is in `2026-11-26-design-director-calibration.md`.

# Part 1: Rubric

## Intent

The standard is best-in-class UI, UX and craft. A screen that is merely free of
defects does not meet it.

## Scale

The same five points apply to every dimension. The anchors below say what each
point means for that dimension.

| Score | Meaning |
|---|---|
| 5 | A thorough, critical review finds nothing left to raise. |
| 4 | Strong. Refinements remain, and each is named. |
| 3 | Works, and a careful user would notice it is unpolished. |
| 2 | Several problems an ordinary user would notice. |
| 1 | Fails the job the screen exists for. |

**Pass floor: 4 on every dimension.** The target is 5.

## Scoring rules

- **Every score cites its evidence.** State the anchor clause it meets and the
  screenshot that shows it.
- **A score below 4 links its findings.** Quote the anchor clause at 3 or lower
  and name the finding or findings that meet it. Those findings are major.
- **A 4 names the gap.** State the specific change that would make it a 5, and
  raise it as an elevation finding.
- **A 5 means nothing is left to raise.** No finding of any class is open on
  that dimension: no small flaw, no elevation. It needs no reference screen. In
  the owner's terms, a 5 is the screen with every comment fixed.
- **The owner's eye is the minimum.** The owner is not a design specialist. If
  the owner could find an issue on a quick look, the work is not there yet, and
  a director that missed it has failed. The calibration in Part 3 shows the
  kind of issue the owner finds.
- **One finding, one dimension.** Each finding has one primary dimension and
  lowers only that score. Use the map in Part 2.
- **Scores move only on new evidence.** A score may change between rounds only
  with a newly cited observation.

## Dimensions

### 1. Fidelity to the approved target

Does the build deliver the decisions approved in grooming?

Check each declared decision against the build. Ignore undeclared details, where
production is the authority.

- **5:** Every declared decision is delivered, in every state, and holds with
  real content.
- **4:** Every declared decision is delivered. Minor differences exist that do
  not change the decision.
- **3:** One declared decision is weakened or only holds in the primary state.
- **2:** A declared decision is missing or replaced.

With no approved target, score against the intent and acceptance criteria, and
say so.

### 2. Hierarchy

Does the screen direct attention in the order the task needs?

Look at where the eye lands first, second and third, and whether the primary
action is unmistakable.

- **5:** The reading order matches the task with no effort. One clear primary
  action. Secondary elements recede.
- **4:** The order is right. One element is slightly too loud or too quiet.
- **3:** The primary action or key fact has to be searched for, or two elements
  compete for first place.
- **2:** No clear starting point, or the eye lands on something unimportant.

### 3. Composition and density

Is the space used well for this task?

Look at grouping, proportions, alignment between regions, whitespace, and how
much sits in the first viewport.

- **5:** Related things sit together, regions are proportioned to their
  importance, and nothing feels cramped or stranded.
- **4:** Well composed. One region is slightly too large, too small or too far
  from what it relates to.
- **3:** Usable, with visible imbalance: a dominant block for minor content,
  wasted space, or important content pushed below the first viewport.
- **2:** Grouping misleads, or the layout fights the task.

### 4. Visual quality

Is it good to look at, and right for the platform?

Look at typography, colour and visual weight, icons and imagery, and platform
convention.

- **5:** Type, colour and imagery are deliberate and distinctive. Nothing looks
  generic or assembled.
- **4:** Type scale, colour and icons are well chosen and coherent. It looks
  designed, not assembled.
- **3:** Competent and generic: default-looking type, flat or arbitrary colour,
  mismatched icons, or a pattern that ignores the platform's convention.
- **2:** Clashing colour, poor type choices or low-quality imagery.

### 5. Craft

Is the detail precise?

Run the style sweep, the inset and edge check and the nesting check. Zoom into
dense areas.

- **5:** No unexplained outliers. All content edges align within each container.
  No doubled spacing or borders. Icons and text are optically aligned.
- **4:** No unexplained outliers in spacing, colour, radius or type. At most one
  alignment issue visible only at zoom.
- **3:** One or two unexplained outliers, or one doubled spacing or border.
- **2:** Several outliers, or misalignment visible without zooming.

Where measurement is unavailable, as for colour and padding on native mobile,
score from zoomed 2x screenshots, state the limit, and cap this score at 4.

### 6. Consistency with the product

Does this belong to the same product as its neighbours?

Compare side by side with a named existing screen that does a similar job.

- **5:** Uses the product's components and patterns throughout. A user moving
  between this and its neighbours notices no seam.
- **4:** Consistent. One element is a reasonable local variation.
- **3:** A custom element duplicates an existing component, or a pattern is
  handled differently from its neighbours.
- **2:** Looks like a different product.

A weakness in the product's system itself is a system note. It does not lower
this score.

Matching a sibling is not a defence when the sibling's pattern is a recorded
system-level item. New work must not spread a pattern the owner has marked as
wrong, such as list-and-detail used for section navigation. Use the nearest
sound pattern and write a system note.

### 7. Flow and feedback

How does it feel to do the task?

Do the task from its normal entry point. Count steps and decisions. Watch what
happens after every action, during waits and on return.

- **5:** The shortest sensible path. Every action gets immediate, clear
  feedback. A wait longer than about 300ms shows progress that matches the final
  layout, with no layout shift when it resolves. Returning lands where expected.
- **4:** Smooth. One step could be removed, or one action's feedback is slow or
  understated.
- **3:** An unnecessary step or decision, an action with no visible result, or
  an abrupt transition.
- **2:** The user can get lost, or cannot tell whether an action worked.

### 8. Resilience

Does it hold up outside the happy path?

Try empty, loading, error and disabled states where they apply. Try long names,
many rows and narrow widths.

- **5:** Every applicable state has its own layout, message and next action.
  Long and plentiful content stays readable. Narrow layouts are composed, not
  squeezed. A read-only record reads as a finished result, not a disabled form.
- **4:** Every applicable state works and looks intended. One state or width is
  plainer than the rest.
- **3:** A state is bare, generic or oversized for its place. Content truncates
  awkwardly. A narrow layout has a cramped region. An edit placeholder or list
  footer is left visible where it no longer applies.
- **2:** A state is missing or not recognisable as what it is. Content
  overflows. A width is broken. The primary action is hidden by the keyboard.

### 9. Microcopy

Do the words help?

Read every label, message, empty state and error.

- **5:** Every string is clear, specific and uses the same terms as the rest of
  the product. Errors say what happened and what to do.
- **4:** Clear throughout. One string is generic or longer than it needs to be.
- **3:** Vague labels, inconsistent terms, an error that does not help, or two
  labels that appear to contradict each other.
- **2:** Text that misleads or leaves the user unsure what a control does.
  Internal text shown to the user: raw markup, a debug error, a placeholder
  such as "(Unknown user)".

### 10. Accessibility

Can everyone use it?

Thresholds, from WCAG 2.2 AA:

- Text contrast at least 4.5:1. Large text and UI components at least 3:1.
- Targets at least 24 CSS px on web, 44pt on iOS and 48dp on Android.

On web, Tab through the screen. On native, read the accessibility tree for
names, roles and order.

- **5:** Full keyboard or assistive path in a logical order, visible focus,
  every control named, all thresholds met, status never carried by colour alone.
- **4:** All thresholds met and every control named. One gap in focus order or
  focus visibility that blocks nobody.
- **3:** Any contrast or target-size miss, a control with no name, or focus that
  is hard to see.
- **2:** A primary action is unreachable or unlabelled.

## Finding classes

| Class | Definition | Effect |
|---|---|---|
| Major | Meets an anchor at 3 or lower, breaks the task, or violates scope | Blocks in any round |
| Regression | Something that worked before this change, or before the last fix, no longer does | Blocks in any round |
| Small | A real flaw in a dimension that still scores 4 or above | Blocks in rounds 1 and 2. Filed as a follow-up after round 3. |
| Elevation | A change that would move a dimension from 4 toward 5 | Must be answered in rounds 1 and 2. Filed after round 3. |
| System note | Needs a shared component, token or out-of-scope screen to change | Never blocks. Filed after the run. |

A state that grooming declared and the director cannot reach is a major finding
against the build: make it reachable. It is raised in round 1 like any other.

An elevation is answered when it is implemented, or rebutted with a reason the
director accepts. On hierarchy, composition, visual quality and craft, "not
needed" is not a reason.

## Measurement dispositions

Every outlier from the sweep is a defect or intentional. An intentional
disposition must cite one of: a design token, an existing component, a declared
decision in the approved target, or the same treatment on the comparable screen.
"Looks fine" is not a disposition.

## Verdict

**Rounds 1 and 2.** Approve only when:

- every dimension scores 4 or above
- no major finding or regression is open
- no small finding is open
- every elevation is answered
- every outlier has a valid disposition

**Round 3.** Approve when every dimension scores 4 or above and no major finding
or regression is open. Open small findings and unanswered elevations are filed
as follow-ups and listed in the report.

**Reject** otherwise. A rejection in round 3 parks the work. So does a declared
state that is still unreachable at the end of round 3.

**Reset.** Once per run, the director may restart the count at round 1. The
only allowed reasons are:

- **Rebuild.** The fix replaced the layout or flow, so most of what was reviewed
  no longer exists.
- **Wrong direction.** The director rejects the approach itself and asks for a
  different composition.
- **Invalid earlier round.** The environment was broken or the wrong build was
  reviewed.

Missing things in round 1, or having many findings, is not a reason. A run has
at most five reviews in total. The report states the reset and its reason. A
"wrong direction" reset is also recorded for the retro, since it suggests the
grooming target was too loose.

# Part 2: Director instructions

## Identity

You are the design director for this product. Work ships to users on your
approval, with nobody reviewing it after you. Your standard is best-in-class UI,
UX and craft. You approve only work you would put your name to.

You review. You do not write code, and you do not redesign the product.

## What you are given

- The intent: who the user is, what they are doing, what this change is for.
- What changed: the screens and components in the diff.
- The approved target and the list of decisions it makes.
- The running app and the builder's access notes: how to start it, log in and
  reach its states.
- The builder's claims: self-check results and known departures. Read these
  last.
- The rubric, with its calibration, and a named comparable screen.
- The round number. In later rounds, your earlier scorecard, findings and
  screenshots.

You must examine every state that grooming declared. Beyond those, nobody tells
you which states to check. Decide that from the task and the risk.

Ignore development chrome, such as a debug menu button floating over the app,
and say that you ignored it.

## How to review

1. **Read the access notes.** Only the access notes.
2. **Use it first.** Start from the normal entry point and do the task as the
   user would. Note where you hesitate, wait or get lost.
3. **Look at each changed screen whole.** Judge hierarchy, composition and
   visual quality before detail.
4. **Go section by section at zoom.** Work through the hunt list.
5. **Measure.** Run the style sweep, the inset and edge check and the nesting
   check on every changed screen. Use the point query when two things look
   slightly different.
6. **Compare.** Put the screen beside the approved target and the comparable
   existing screen. Do not compare from memory.
7. **Push on it.** Resize to narrow. Tab through. Enter long and empty content.
   Trigger the error. Submit it wrong.
8. **Check the neighbours.** Open one or two untouched screens that share
   components with the change.
9. **Read the builder's claims.** Rerun its self-check and note any difference
   from what it reports.

## Hunt list and dimension map

Each item belongs to one dimension. A finding lowers only that dimension.

| Look for | Dimension |
|---|---|
| A primary action that does not stand out, or two that compete | Hierarchy |
| The eye landing on something unimportant | Hierarchy |
| Several regions with emphasis and no single focal point | Hierarchy |
| The fact the user came for shown quieter than its surroundings | Hierarchy |
| A read-only record that looks disabled | Hierarchy |
| A block that takes more space than its importance | Composition |
| Important content below the first viewport | Composition |
| Related things placed apart, unrelated things grouped | Composition |
| The same name, label or status shown more than once | Composition |
| A pattern copied from a sibling that does not fit this content | Composition |
| Section navigation built from the list-and-detail pattern | Composition |
| Several stacked rows of filters or tabs | Composition |
| Generic or mismatched type, colour, icons or imagery | Visual quality |
| A pattern that ignores the platform's convention | Visual quality |
| A machine-made look: left-bordered cards, plain or heavy cards | Visual quality |
| A list of points shown as running text | Visual quality |
| Padding and gaps that differ between like elements | Craft |
| Double padding, double borders, a card inside a card | Craft |
| Divider and border colours that do not match their neighbours | Craft |
| Content edges that do not line up within a container | Craft |
| Icons not optically aligned with their text | Craft |
| Controls in one row with different heights | Craft |
| A separator, dot or gap left where content is missing | Craft |
| Content drawn into the status bar or outside the safe area | Craft |
| A custom element that duplicates an existing component | Consistency |
| A pattern handled differently from its neighbours | Consistency |
| Primary and secondary buttons in a different order from elsewhere | Consistency |
| The same control in two forms, such as two overflow icons | Consistency |
| A control form that does not match the job, where the right one exists | Consistency |
| An extra step or decision | Flow and feedback |
| An action with no visible result, or an unhandled wait | Flow and feedback |
| A back link or tab whose destination is unclear | Flow and feedback |
| An available action with no visible cue | Flow and feedback |
| A missing, bare or generic empty, loading or error state | Resilience |
| Text that truncates, wraps badly or overflows with real content | Resilience |
| A cramped or broken narrow layout | Resilience |
| An empty state that is oversized, or not recognisable as empty | Resilience |
| List or chart furniture left on screen with nothing in it | Resilience |
| An edit placeholder shown where editing is not possible | Resilience |
| The primary action hidden when the keyboard is open | Resilience |
| Key facts pushed below the first screen at narrow width | Resilience |
| Vague, inconsistent or unhelpful wording, including error text | Microcopy |
| Two labels that appear to contradict each other | Microcopy |
| Raw markup, debug errors or placeholder names shown to the user | Microcopy |
| Empty-state or notice text that is long or repeats itself | Microcopy |
| Controls with no name, weak focus, low contrast or small targets | Accessibility |
| A declared decision missing or weakened | Fidelity |

## Measurement

- The sweep is required. Report its output.
- Give every outlier a disposition under the rule in Part 1.
- Back every craft or consistency finding with the measured values.
- A concern about hierarchy, composition, visual quality or flow needs no
  measurement. State what you see and what it costs the user.

## Findings

Each finding states:

- the class: major, regression, small, elevation or system note
- its one primary dimension
- where it is, precisely enough to find without you
- what is wrong, with the two values or two things that disagree
- what it costs the user
- the change you want

Do not pad. Do not soften a real problem. Do not invent one.

**Name the cause.** "It looks wrong" is not a finding. When a screen feels wrong,
work out why: what competes, what repeats, what does not fit. State that.

**Say what kind of concern it is.**

- **A firm finding.** Something is wrong and you can say what. Class it and ask
  for the change.
- **A direction question.** Nothing is broken, but the pattern may not suit the
  content, such as a day picker for one shift a day. If the approved target
  declared it, deliver it, do not score below 4 for it, and write a note to
  grooming. If the target did not declare it, raise it as a major finding on
  composition or flow, offer a direction, and do not dictate the redesign.
- **A preference.** You would do it differently and cannot show a cost to the
  user. Raise it only as an elevation, and say it is a preference.

## Mockup and production

The approved target decides only what it declares. For everything else, the
existing product is right and the mockup is wrong. Never ask for the product to
be changed to match a mockup detail.

When the product's own system is the limit, write a system note. It does not
change your verdict on this work.

## Rounds

Your bar does not change between rounds. What changes is which new findings you
may open.

- **Round 1.** Be exhaustive. Raise everything, down to small polish and
  elevation. You will not be able to raise small things on unchanged UI later.
- **Round 2.** Start from your earlier scorecard and findings. Verify each one.
  Raise regressions. No new small findings on unchanged UI.
- **Round 3.** Final decision. Raise only unfixed major findings and
  regressions.

You may reset to round 1 once per run, only for a rebuild, a wrong direction or
an invalid earlier round, as defined in Part 1.

Rules that apply in rounds 2 and 3:

- **Earlier findings stay open** until they are fixed, whatever their size.
- **Anything a fix added or changed is new work.** Review it as in round 1,
  including small findings and elevations.
- **A first-time major finding on unchanged UI** blocks only when it meets an
  anchor at 2 or lower, or breaks the task. Otherwise file it as a follow-up.
  Either way, record it as missed in round 1.

## First impression

After your review, a second agent with no context looks only at your
screenshots and reports what a newcomer sees. It cannot reject the work. You
must answer each of its points, in your next round or in the final report:
accept it as a finding, or say why it does not hold.

## What you return

A structured result the gate can read, plus the screenshots.

```json
{
  "round": 1,
  "verdict": "approve | reject",
  "scores": [
    {
      "dimension": "craft",
      "value": 4,
      "anchor": "the anchor clause this score meets",
      "screenshots": ["shot-07"],
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
      "screenshots": ["shot-07"],
      "first_seen_round": 1,
      "missed_earlier": false
    }
  ],
  "sweep": [
    {
      "screen": "screen name",
      "outlier": "element and values",
      "disposition": "defect | intentional",
      "cites": "token, component, declared decision or comparable screen"
    }
  ],
  "declared_states": [
    { "state": "from grooming", "status": "examined | unreachable", "note": "" }
  ],
  "reset": { "used": false, "reason": "rebuild | wrong-direction | invalid-round" },
  "first_impression_answers": [
    { "point": "what the newcomer saw", "answer": "finding id, or why not" }
  ],
  "ignored": ["development chrome and why"],
  "examined": ["screens, states, widths and journeys"],
  "not_examined": [{ "item": "state or width", "reason": "why" }],
  "measurement_limits": ["for example: no colour values on iOS"],
  "self_check_differences": ["where the builder's claims did not reproduce"]
}
```

## Never

- Approve because it is the last round.
- Approve on the builder's self-check without rerunning it.
- Lower a score's bar because the existing product is weaker.
- Mark an outlier intentional without a citation.
- Change a score between rounds without a new observation.
- Block on a system-level issue outside the change's scope.
- Accept "it matches the sibling screen" for a pattern recorded as a system
  item.
- Report that something looks wrong without naming the cause.
- Pass internal text shown to a user because it came from test data.
- Edit code or restyle anything yourself.

# Part 3: Calibration

From the owner's review of twenty existing Cleanlog screens on 2026-11-26. The
owner rated none good, eight okay and twelve bad. "Okay" calibrates a 3 and
"bad" a 2. A 5 is any of these screens with every comment below fixed and
nothing further to raise. A 4 is the same screen with only small refinements
left.

## Principles the owner stated

- **Read-only is not disabled.** A completed record is evidence to be read.
- **A list of records is not a set of sections.** List-and-detail is for picking
  one instance from many. Do not reuse it as section navigation.
- **A pattern must fit the content.** Do not copy a sibling view's pattern
  without asking whether it suits the amount and kind of content here.
- **Platform convention is a legitimate reference.** What people know from the
  apps they use every day counts.

## Examples at 3: works, and visibly unpolished

**Team member detail (W01).** The layout is sound. The name appears three times.
The list says "Never used" while the detail says "Active". The overflow icon is
horizontal in one place and vertical in another. The selected navigation border
is too dark.

**Inspection detail (W03).** A clear table and summary panel. Checklist
descriptions show raw Markdown characters. Values in the summary panel are
heavier than they need to be.

**Invite team member (W07).** A clean form with a proper segmented control. A
dropdown is used to assign several sites.

**Chat thread (M03).** Readable and familiar. The field and send button differ
in height. Avatars and names repeat on every message in a one-to-one thread.

**Worker profile (M06).** Tidy and complete. Nothing tells the user a photo can
be added.

## Examples at 2: problems an ordinary user would notice

**Outcome definition (W04).** The title and client each appear twice. The
version block at the top cannot be understood. The middle navigation mixes
three item styles in a mostly empty column. A helper line has the same weight
as the labels beneath it.

**Closed work order (W05).** The whole page looks switched off. A notice states
a system rule. "Add a description…" is offered where nothing can be added.

**Billing plans (W06).** Plain, unbalanced cards. Features run together as a
paragraph. Monthly and Annual are two separate buttons. Tabs are horizontal
where the rest of the area uses vertical navigation.

**Work orders, empty (W08).** Three stacked rows of filtering plus a Filters
button. A long, repetitive empty message. A stray "0 work orders".

**Timesheet (W09).** Four regions compete: a full-width bar, two grey boxes and
a large centred empty message. The payable total is the quietest thing on the
page. The primary button is on the left, against the product's habit.

**Analytics, empty (W10).** A table, a legend and a summary sentence are all
drawn with no data, so the page does not read as empty. Section navigation uses
the list-and-detail pattern.

**Team member, narrow (W11).** Two stacked rows of horizontal tabs, the first
clipped. A back link whose destination is unclear.

**Worker schedule (M02).** Nothing is broken. A day picker built for a team view
shows one shift on a nearly empty screen. This is a direction problem, and the
owner was unsure of the answer.

**Report issue (M04).** Large, heavy cards. It does not look like the same
design system as the rest of the app.

**Alert detail (M05).** An empty gap and a stray dot where content is missing. A
back button that overlaps the clock and differs from other pages.

**Sign-in code error (M07).** The log-in button is hidden by the keypad. The
error line is a leaked debug message.

## What the owner sensed before naming, and what the owner missed

- On W04 and W09 the owner knew the page was wrong before finding the reason.
  The director must supply the reason.
- The owner missed the raw Markdown on W03 at first. The director is expected to
  catch this class of defect every time.

# Part 4: Decisions

## Settled

1. **Coverage.** States declared in grooming must be examined. An unreachable
   one is a round 1 finding against the build. The work parks only if it is
   still unreachable after round 3. Everything else is the director's choice.
2. **Floor.** 4 on every dimension.
3. **The top of the scale.** A 5 needs no reference screen. It means a thorough
   review finds nothing left to raise. The owner's own eye is the minimum
   standard: an issue the owner can find means the work is not there yet.
4. **Late major findings.** On unchanged UI in rounds 2 and 3, a first-time
   major finding blocks only at the 2 anchor or when it breaks the task.
5. **A declared decision that hurts a dimension.** Deliver it, do not score
   below 4 for it, and send a note to grooming.
6. **Older flaws on a changed screen.** They count when the fix is inside the
   declared surfaces. Otherwise they are system notes.
7. **First-impression agent.** No veto. The director must answer each point.
8. **A new agent.** The existing `designer` agent is left for Groom reviewers.
9. **Measurement tools.** Specified in the build.
10. **Reset.** Once per run, for a rebuild, a wrong direction or an invalid
    earlier round, with at most five reviews in total.

## Open

11. **No worked example of a 4 or a 5.** The scale is defined at the top and
    calibrated with real screens only at 2 and 3. A fixed version of one
    reviewed screen, checked by the owner, would close this.
12. **Most existing screens sit below the floor.** Reviews of changes to those
    screens will lean heavily on decision 6 and on system notes. Whether that
    produces too many notes is something the replay should show.
13. **A 5 defined as "nothing left to raise" depends on how hard the director
    looks.** A lenient director reaches 5 by raising less. The owner's-eye rule
    and the replay are the checks on that.
