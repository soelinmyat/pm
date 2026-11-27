---
title: Design Director — replay on the twenty calibrated screens
created: 2026-11-27
updated: 2026-11-27
status: in progress
---

# Result

The director does not yet meet the bar the plan set: "it should find at least
what the owner found on each screen". It fully found 34 of the owner's 65
criticisms, half-found 17 and missed 14. It matched or exceeded the owner with
nothing missed on 10 of 20 screens, and with nothing missed or half-found on 4.

It is reliable on concrete defects and unreliable on whole-screen judgments.

# How the replay ran

- Plugin version 1.14.69. Reviewer and judge agents ran on Opus.
- Four director agents each reviewed five screens from the calibration set,
  following `agents/design-director.md`, as a round 1 review.
- Screenshots only: the same images the owner commented on. Nothing was
  measured or clicked. Web images are 1x viewport captures.
- The director was given the rubric without its Calibration section, since
  that section describes these same screens.
- Two judge agents compared each director output with the owner's comments in
  `2026-11-26-design-director-calibration.md`, and checked a sample of the
  director's extra findings against the screenshots.

Limits of this test:

- The rubric's hunt list was written from the owner's comments, so the
  director was not blind to the kinds of issue the owner raises.
- Each director saw one screenshot per screen and no sibling screens, so
  cross-screen comparisons were harder than in a real review.
- The judges are agents. Their found, partial and missed calls were not
  checked by the owner.
- The measurement tools were not exercised.

# Numbers

| Set | Owner criticisms | Found | Partial | Missed |
|---|---|---|---|---|
| Web, 12 screens | 45 | 24 | 12 | 9 |
| Mobile, 8 screens | 20 | 10 | 5 | 5 |
| All | 65 | 34 (52%) | 17 (26%) | 14 (22%) |

| Screen | Owner | Director's lowest score | Found | Partial | Missed | Severity |
|---|---|---|---|---|---|---|
| W01 Team member detail | okay | 3 | 3 | 1 | 0 | aligned |
| W02 Company detail | okay | 2 | 0 | 1 | 2 | harsher |
| W03 Inspection detail | okay | 2 | 1 | 1 | 0 | harsher |
| W04 Outcome definition | bad | 3 | 3 | 2 | 2 | softer |
| W05 Closed work order | bad | 2 | 3 | 0 | 0 | aligned |
| W06 Billing plans | bad | 3 | 3 | 1 | 1 | softer |
| W07 Invite team member | okay | 3 | 0 | 0 | 1 | aligned |
| W08 Work orders, empty | bad | 3 | 2 | 1 | 0 | softer |
| W09 Timesheet | bad | 3 | 2 | 1 | 2 | softer |
| W10 Analytics, empty | bad | 3 | 3 | 1 | 1 | softer |
| W11 Team member, narrow | bad | 3 | 2 | 2 | 0 | softer |
| W12 Closed work order, narrow | bad | 2 | 2 | 1 | 0 | aligned |
| M01 Team schedule | okay | 3 | 1 | 0 | 0 | aligned |
| M02 Worker schedule | bad | 3 | 0 | 2 | 1 | softer |
| M03 Chat thread | okay | 3 | 2 | 1 | 1 | aligned |
| M04 Report issue | bad | 2 | 0 | 1 | 1 | aligned |
| M05 Alert detail | bad | 2 | 4 | 1 | 0 | aligned |
| M06 Worker profile | okay | 3 | 0 | 0 | 1 | aligned |
| M07 Sign-in code error | bad | 2 | 2 | 0 | 0 | aligned |
| M08 Open issues, empty | okay | 4 | 1 | 0 | 0 | softer |

# What worked

- **It rejected all twenty.** The owner rated none good, so no weak screen
  would have been approved.
- **No contradictions.** It never criticised something the owner called good.
- **No misreadings in the sampled extras.** A few were speculative; none
  invented a problem that is not on the screen.
- **Concrete defects were caught**, including the ones the rubric says must be
  caught every time: raw Markdown, the leaked debug error, "(Unknown user)",
  the keypad over the button, the back button over the clock, the stray dot.
- **It found real issues the owner did not raise**, such as a work order
  completed before it was created.

# What did not work

- **Whole-screen judgments.** "Looks like a different design system",
  "confusing", "no place to start reading", "the whole page looks switched
  off" were split into element-level defects or missed. On W10 it scored
  hierarchy 4 where the owner saw no starting point.
- **Fit of a pattern or control.** It did not question the day picker for one
  shift a day (M02), the dropdown used to assign several sites (W07), or
  plan features shown without bullets (W06).
- **Comparisons across screens.** Button order against the rest of the
  product, the navigation pattern, the repeated dark border on the active
  item.
- **Small mismatches inside one row and missing cues.** The chat field and
  send button heights (M03), no hint that a photo can be added (M06).
- **Severity does not separate okay from bad.** It scored a lowest of 3 on six
  of the eight bad web screens and a lowest of 2 on two okay ones. Scores
  cluster at 3.
- **Volume.** It raised about nine findings per screen beyond the owner's.
  Many are valid craft catches. Others are requests to add content, wording
  pedantry classed as major, or "could not measure" placeholders that say
  nothing about the screen.
- **A reject with every dimension at 4 (M08).** Correct under the round 1
  rule, since small findings were open, but the verdict alone then says
  nothing about how good the screen is.

# Proposed changes

Changes 1 to 5 are made in `agents/design-director.md`,
`skills/dev/references/design-director-rubric.md` and
`skills/dev/references/design-director.md`. They are uncommitted. Change 6 is
half done: see Rerun below.

1. **A whole-screen read before any findings.** The director states what the
   screen reads as at a glance, where the eye lands, and whether it looks like
   the same product, then scores hierarchy, composition and consistency from
   that read. A problem named in the read cannot coexist with a 4.
2. **Hunt list additions.** A control or pattern that does not fit its job or
   content; mismatches between elements in one row; an available action with
   no cue; components that are too heavy for their content.
3. **A severity rule.** Two or more major findings on one dimension, or a
   whole-screen problem, is a 2.
4. **Limits on extras.** No finding that only reports an unmeasured value. No
   request to add content or scope. A major finding must state a cost to the
   user that the screenshot supports.
5. **Give the director sibling screens.** The flow already names one
   comparable screen; the replay shows one is not enough for consistency
   calls.
6. **Rerun after the changes**, on the same twenty, and on three or four web
   screens against the running app so the measurement tools are tested too.

# Rerun

Run on 2026-11-27 after changes 1 to 5, on the same twenty screenshots.

The director still does not meet the bar. The result is a small gain that one
run cannot separate from noise.

| Run | Criticisms | Found | Partial | Missed |
|---|---|---|---|---|
| First replay | 65 | 34 (52%) | 17 (26%) | 14 (22%) |
| Rerun | 64 | 37 (58%) | 15 (23%) | 12 (19%) |

| Set | Criticisms | Found | Partial | Missed |
|---|---|---|---|---|
| Web, 12 screens | 45 | 26 | 10 | 9 |
| Mobile, 8 screens | 19 | 11 | 5 | 3 |

How it differed from the first replay:

- Each director was given two or three other screens from the set as
  comparable screens.
- The judges were new agents with a stricter brief, and the split of compound
  criticisms was reconstructed from the first replay's per-screen counts. The
  first replay's mobile rows add up to 19 criticisms and 4 missed, not the 20
  and 5 in its totals row. The rerun counts 19.
- Scores were given under "one major scores 3". That rule was corrected
  afterwards to "3 at most", because directors applied it even where a finding
  met an anchor at 2: raw Markdown on W03 scored 3. Rerun scores for such
  cases read one point soft.

## What improved

- **The whole-screen read works where it is used.** It named the owner's main
  complaint on 10 of the 12 screens that have one, including "reads as a
  locked form" (W05), the pattern that does not fit one shift a day (M02) and
  the empty analytics page that does not read as empty (W10).
- **Severity on bad screens.** 8 of the 12 bad screens got a lowest score of
  2, against 5 in the first replay. On 6 of them the 2 is on a dimension the
  owner complained about.
- **Extras are cleaner.** Of 44 extra major findings checked against the
  screenshots, 40 are valid, 3 are wording taste and 1 is scope. None is
  speculative and none reports an unmeasured value.

## What did not

- **Belonging is still judged too easily.** On M04 the read says the screen
  belongs and consistency scores 5, where the owner saw a different design
  system. On W06 the read says the horizontal tabs match the other pages,
  which use vertical navigation. Siblings were supplied and did not help.
- **A problem in the read does not always reach the score.** W09 has seven
  major findings and W10 a named whole-screen problem, and both score a
  lowest of 3. The read rule caps a dimension below 4; the count rule that
  makes it a 2 was not applied.
- **Weight and emphasis.** Helper text as heavy as its labels (W04), bold
  summary values (W03), two tinted boxes competing (W09). On W09 the director
  took the opposite view of the side panel.
- **System-level details.** The dark border on the active navigation item
  was missed on both screens again.
- **Missing cues.** No hint that a photo can be added (M06) was missed again,
  although the hunt list has that row.
- **Run-to-run variance.** The name shown three times on W01 was found in the
  first replay and missed in the rerun.
- **Volume.** About 2.2 extra majors and 1.3 extra smalls per screen. Most
  are valid but secondary: a 4px height difference ranked major.

## Limits

- The hunt list and the new rules were written from these twenty screens, so
  this set flatters the director. A fair test needs screens it has not been
  tuned on.
- One run per screen. Differences of a few criticisms are not evidence.
- The found, partial and missed calls are still agents' calls, unchecked by
  the owner.
- The live part of change 6 was not run: no screen was reviewed against the
  running app, so the measurement tools are still untested in a review.

# Third run

Run on 2026-11-27 after three more changes: the read sets the score, the
"belongs" answer needs written comparison lines, and zoom-only differences are
small. Same twenty screenshots, same judge brief as the rerun, new agents.

Detection got worse and severity got better. The director still does not meet
the bar.

| Run | Found | Partial | Missed | Bad screens with a lowest of 2 | Okay screens scored 2 |
|---|---|---|---|---|---|
| First replay | 34 of 65 | 17 | 14 | 5 of 12 | 2 of 8 |
| Rerun | 37 of 64 | 15 | 12 | 8 of 12 | 1 of 8 |
| Third run | 31 of 64 | 20 | 13 | 12 of 12 | 4 of 8 |

| Third run, by set | Criticisms | Found | Partial | Missed |
|---|---|---|---|---|
| Web, 12 screens | 45 | 20 | 16 | 9 |
| Mobile, 8 screens | 19 | 11 | 4 | 4 |

## What the changes did

- **Binding the read to the score worked.** Every bad screen now has a lowest
  score of 2, and on 10 of the 12 the 2 is on a dimension the owner complained
  about. W06, W09, W10 and M02 moved from 3 to 2.
- **It runs a notch harsh.** Four okay screens scored 2 (W02, W03, M01, M03).
  The judges called four of the five 2s real and noticeable, and one an
  overshoot: table cells centred against top-aligned text on W03.
- **The written comparison did not fix "belongs".** M04 was again judged to
  belong, and the W06 tabs were again judged the same as the vertical
  navigation elsewhere. The director fills in the lines and still answers
  yes.
- **The comparison rule added noise.** Any differing line became a
  consistency major. Extra majors rose from 44 to 59. Of 52 checked, 29 are
  valid, 12 are taste, 9 are minor, 1 is speculative and 1 is scope. In the
  rerun 40 of 44 were valid.
- **The zoom-only rule was not followed.** A 7px offset and a colour
  difference found by sampling pixels were still ranked major.
- **Detection fell on web**, from 26 found to 20, with more partials. The
  whole-screen read named the owner's main complaint on 6 of 11 screens,
  against 10 of 12 in the rerun. A longer read that must produce comparison
  lines appears to crowd out the plain first impression.

## What stayed missed in all three runs

- No cue that a photo can be added (M06).
- A different design system on the report form (M04).
- Horizontal tabs against vertical navigation (W06).
- Helper text as heavy as its labels (W04), even after a hunt-list row was
  added for it.
- Two tinted boxes competing on the timesheet (W09).

These are judgments of visual weight and of the product as a whole. Three
rounds of instruction changes have not moved them.

One repeated miss did close: the dark border on the active navigation item
(W01, W02) was raised on both screens in the third run, as a system note,
once the comparison lines made the director look at navigation.

## What varies between runs

The name shown three times on W01 was found, then missed twice. The chat
field and send button heights on M03 were partial, partial, then not raised.
The dropdown for several sites on W07 was missed, found, missed. With one run
per screen, a change of five or six criticisms between runs is within this
noise.

## Reading

- Rules about scoring are followed. Rules meant to make the director see
  more are not: it sees what it sees, and extra procedure adds findings
  without adding the owner's ones.
- More instruction text is unlikely to close the remaining gap on this set.
- This set can no longer measure improvement. Every rule was written from
  it.

## Next

1. Done after the third run, on the owner's decision: the read-to-score
   binding stays, and the comparison lines no longer set the consistency
   score. A difference is a finding only when it has a named cost to the
   user. This version has not been run on the set.
2. Try a second, separate pass for what one pass keeps missing: a reviewer
   that sees only the screen and its siblings at normal size, is told
   nothing about defects, and answers the four read questions. The flow
   already has a first-impression agent in this position.
3. Test on screens the rules were not written from, with the owner's
   comments taken first, and run each screen twice.
4. Run three or four web screens against the running app.

# Where the evidence is

The director outputs and judge comparisons for both runs are in session
scratch directories and are not committed.
