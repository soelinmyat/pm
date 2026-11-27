---
title: Design Director — calibration notes from owner review
created: 2026-11-26
updated: 2026-11-26
status: in progress
---

The owner's comments on existing Cleanlog screens, recorded verbatim in meaning.
These are the replay set for the director and the source for calibrated rubric
examples. The dimension beside each comment is an interpretation, not the
owner's wording.

Web screenshots come from
`cleanlog-mono/work/design-system/web-client-rollout/evidence/captures`. Mobile
screenshots come from `cleanlog-mono/docs/audits/mobile/screenshots`. Both sets
are dated 2026-11-25.

# Web

## W01: Team member detail

Source: `parameters-0-2-1280.jpg`, route `/admin/manage/team/6`.

**Rating: okay.**

1. The person's name appears in three places: the list row, the detail header
   and the Name field. (Composition: repeated information.)
2. The list row shows a "Never used" pill while the detail shows status
   "Active". The two read as conflicting. (Microcopy: two status concepts with
   no distinction.)
3. The overflow menu is a horizontal "..." beside Invite and a vertical one at
   the top right of the detail. (Consistency: same control, two forms.)
4. The border on the active "Team" item in the main navigation looks too dark.
   (Craft: selected-state border weight.)

## W02: Company detail

Source: `parameters-0-0-1280.jpg`, route `/admin/manage/companies/54`.

**Rating: okay.**

1. Same as W01: the border on the active "Companies" item in the main navigation
   looks too dark. (Craft: selected-state border weight. Repeats across screens,
   so this is a system-level item.)
2. The company name is very long and sits in the top bar of the detail page. If
   names this long are expected, the top bar may be the wrong place for it.
   (Resilience and composition: placement does not suit long content.)
3. This screen and W01 are sibling pages and differ in structure. Here a type
   label ("Client") sits under the name and the list has a collapsible "Clients"
   group. W01 has neither. (Consistency: sibling detail pages handled
   differently.)

## W03: Inspection detail

Source: `parameters-2-1-1280.jpg`, route `/admin/locations/1/inspections/1`.

**Rating: okay.**

1. Unsure about the hierarchy in the summary panel. The values for inspector,
   completed, location and the rest are large and bold. Might be fine.
   (Hierarchy: held loosely, not a firm finding.)

2. The checklist item descriptions show raw Markdown: `**Standard:**`, `**5**`,
   `_any_` and list hyphens appear as literal characters. The owner missed this
   on first look and confirmed the director should catch it. (Craft: unrendered
   markup. A defect, not a matter of taste.)

## W04: Outcome definition

Source: `parameters-1-2-1280.jpg`, route `/admin/outcomes/1/definition`.

**Rating: bad.**

1. The page title is repeated by the text beside the "Live v1" pill.
   (Composition: repeated information.)
2. The top block is confusing: the "Live v1" pill, its label, "Live since" and
   the "New version" button. The owner could not tell what it is.
   (Hierarchy and microcopy: the versioning concept is not explained by the
   layout.)
3. "Example Client Company" appears twice. (Composition: repeated information.)
4. The middle navigation (Scorecards, Definition and so on) looks wrong. The
   owner could not name why. (Visual quality and composition. See the diagnosis
   below.)
5. The helper line "Which signatures each monthly report needs…" has the same
   visual weight as the row labels under it, such as "Learning Design Review"
   and "Client". The labels "Learning Design Review" and "Agreement text" are
   unclear; the first may be seed data. (Hierarchy and microcopy.)

Diagnosis offered for point 4, not the owner's words:

- Three kinds of item share one column with no shared style: a green back link,
  top-level items with icons, and indented sub-items without icons.
- The selected state is a filled grey pill on a sub-item while its parent
  "Definition" shows no state. The main navigation uses a different selected
  style again.
- The column is as wide as the Team and Companies lists but holds six short
  links, so most of it is empty.
- The column has no heading saying what it navigates.

Note on point 5: "Learning Design Review" is the seeded organisation name, also
shown at the top left. The row means "our side" against "Client". The confusion
stands, because an organisation name used as a bare row label does not say what
the row is.

## W05: Work order detail (closed)

Source: `parameters-2-0-1280.jpg`, route `/admin/locations/1/work-orders/1`.

**Rating: bad.**

1. The notice "This work order is closed and cannot be edited." reads
   strangely. (Microcopy: states a system rule, not what the user is looking
   at.)
2. "Add a description…" is still shown although nothing can be added.
   (Resilience: an edit placeholder left visible in a read-only state.)
3. The whole page looks disabled. A completed work order is evidence. It cannot
   be edited, but it should not look disabled. (Hierarchy and visual quality:
   read-only is presented as inactive. The page should present a finished
   record with confidence.)

Principle stated by the owner: read-only is not disabled. A completed record is
a result to be read, not a form that has been switched off.

## W06: Billing plans

Source: `static-11-2-1280.jpg`, route `/admin/settings/billing/plans`.

**Rating: bad.**

1. The cards are too plain for pricing cards and unbalanced across the three.
   The first two are nearly empty and the last holds all the text. Its three
   lines have no bullets or markers, so they read as one connected paragraph.
   (Visual quality and composition: generic cards, uneven content, list items
   not shown as a list.)
2. The Monthly and Annual controls do not look like one connected choice.
   (Craft and consistency: two separate buttons where a segmented control is
   meant.)
3. Navigation is not standardised with other pages. Earlier pages use a vertical
   secondary navigation; this one uses horizontal tabs (General, Notifications,
   Billing, Integrations). (Consistency: two patterns for second-level
   navigation.)

## W07: Invite team member

Source: `static-3-0-1280.jpg`, route `/admin/manage/team/new`.

**Rating: okay.**

1. It is strange to use a dropdown for assigning multiple sites. (Flow and
   consistency: a single-select control form used for a multi-select job.)

Observation while recording, not the owner's words: the Email and Phone switch
here is a proper segmented control. W06's Monthly and Annual use two separate
buttons for the same kind of choice. The product already has the right
component.

## W08: Work orders list (empty)

Source: `static-1-7-1280.jpg`, route `/admin/work-orders`.

**Rating: bad.**

1. There are three rows of filtering: the One-time and Periodic switch, the
   location and date dropdowns, and the status pills. It is confusing, and a
   separate "Filters" button sits among them as well. (Composition and
   hierarchy: four filtering mechanisms stacked with no clear order.)
2. The empty-state text is repetitive and too long. (Microcopy.)
3. A stray "0 work orders" count sits below the empty state. (Resilience: a
   list footer left visible when the list is empty.)

## W09: Timesheet detail (draft)

Source: `parameters-2-5-1280.jpg`, route `/admin/timesheets/1`.

**Rating: bad.**

The owner found the page confusing without being able to name one cause.

1. A full-width information bar competes for attention. (Hierarchy.)
2. Two boxes with background colour, the hours summary and the side panel,
   compete for attention. (Hierarchy and composition.)
3. The Breaks section and its empty message are large and centred, and compete
   for attention. Breaks does not deserve that much empty space. (Composition
   and resilience.)
4. This may be a design-system issue. (System note candidate.)
5. The primary button is usually on the right, but here "Approve" sits to the
   left of "Discard". (Consistency: button order. W07 has Cancel then Send
   invite, and W08 has Export CSV then New work order, both with the primary on
   the right.)

Diagnosis offered, not the owner's words:

- The page has no single focal point. Four regions carry emphasis: the blue
  bar, the grey hours box, the grey side panel and the centred empty state.
- The fact the approver needs, payable time of 7h 30m, is small and sits at the
  bottom left of a grey box, while less important content is louder.
- "Manual" is said three times: once in the bar and once beside each time.
- "Edit times" and "Adjust time" are two similar buttons a few lines apart.
- The empty state is the full-page pattern used inside a sub-section. The
  system appears to lack a compact empty state for sections, which makes this a
  system-level item as the owner suspected.

## W10: Analytics overview (no data)

Source: `static-2-4-1280.jpg`, route `/admin/reports`.

**Rating: bad.**

1. It is an analytics view, yet it is wordy and gives no place to start
   reading. (Hierarchy: no focal point in a view meant to be scanned.)
2. The visualisation is not understandable. A legend is shown with nothing it
   refers to. (Resilience: chart furniture left on screen with no chart.)
3. It is a very bad empty state. It took a moment to realise the page is empty,
   because the table, legend and summary are all still drawn. (Resilience: the
   empty state is not recognisable as one.)
4. The analytics navigation is strange and probably a design-system issue. It
   uses the same pattern as the user and company lists. Those lists hold
   instances of users and companies; they are not navigation. The KPI definition
   screen (W04) probably has the same problem. (Consistency and composition:
   system note.)

Principle stated by the owner: a list of records and a set of sections are
different things. The list-and-detail pattern is for picking one instance from
many. It should not be reused as section navigation.

This links W04 point 4 and W10 point 4 to one system-level cause.

## W11: Team member detail (narrow)

Source: `parameters-0-2-390.jpg`, route `/admin/manage/team/6` at 390 wide.

**Rating: bad.**

1. Scrollable horizontal tabs are the wrong pattern for the Administration
   sections here, especially with a second row of horizontal tabs (Details,
   Locations) below. (Composition and resilience: two stacked tab rows at narrow
   width, the first one clipped.)
2. The "x" at the top right looks misaligned. (Craft.)
3. A back link sits below the tabs. It is unclear where it goes, and the
   navigation structure looks wrong. (Flow and hierarchy: "Team" is both a
   selected tab and a back destination.)
4. The name is repeated. (Composition: repeated information, as on W01.)

## W12: Work order detail (closed, narrow)

Source: `parameters-2-0-390.jpg`, route `/admin/locations/1/work-orders/1` at
390 wide.

**Rating: bad.**

1. The same comments as W05 apply: the closed notice reads strangely, the
   description placeholder is still shown, and the page looks disabled when it
   should present a finished record.

Observations while recording, not the owner's words:

- At narrow width the status, priority and assignee drop below Activity. The
  most important fact about the work order, that it is completed, is off the
  first screen.
- The activity line reads "(Unknown user) created this work order". This
  appears on W05 too.
- The timestamp wraps mid-phrase: "· 11" then "minutes ago".

# Mobile

## M01: Supervisor team schedule

Source: `schedule-timesheets/01-supervisor-team-schedule-today.png`.

**Rating: okay.**

1. The card with a coloured left border is an AI anti-pattern. (Visual quality:
   a generic, machine-made look.)

Note: the grey gear button over the header is likely a development overlay, not
part of the product. A director should ignore development chrome and say so.

## M02: Worker schedule

Source: `schedule-timesheets/07-worker-schedule-today.png`.

**Rating: bad, with the owner conflicted.**

1. A worker has about one shift a day, so a day picker leaves the screen nearly
   empty and forces a tap per day. The whole week should probably be visible at
   once. (Composition and flow: the view does not fit the amount of content.)
2. There still needs to be a consistent approach with the team view, since both
   use the same day navigation at the top. (Consistency: this pulls against
   point 1.)
3. A possible direction: when workers view their own schedule, drop the per-day
   selection and show the week as a list. Grey out past shifts, and scroll to
   the current or next shift. (A design direction, not a defect.)

Calibration value: nothing on this screen is broken. Spacing, alignment and
components are fine. It is bad because the pattern was copied from the team
view without asking whether it fits one shift a day. A director that only hunts
defects would pass it. This is the clearest example so far of a composition
problem that needs a grooming-level decision, and the owner's own uncertainty
shows why the director should raise it as a direction question and not dictate
the answer.

## M03: Chat thread

Source: `chat/03-conversation-thread-worker-dm.png`.

**Rating: okay.**

1. The "ML" avatar at the top right is unnecessary. (Composition: repeated
   information; the name is already in the header.)
2. Small craft issue: the message field and the send button are not the same
   height. (Craft: mismatched heights in one row.)
3. In a one-to-one conversation, an avatar on every reply and the sender's name
   above every bubble are not needed. (Composition: group-chat furniture shown
   in a direct message.)
4. The name and time outside the bubble are a little distracting. It may be an
   acceptable design choice; the owner notes that familiarity with WhatsApp
   shapes this reaction. (Visual quality: held loosely. Platform convention is
   a legitimate reference.)

## M04: Report issue (filled, keyboard open)

Source: `issues-alerts/05-issue-form-filled.png`.

**Rating: bad.**

1. The cards are very prominent. (Hierarchy and visual quality: the location
   card and the four option buttons are large and heavy for what they hold.)
2. It is not clear this uses the same design system as the rest of the app.
   (Consistency: this screen looks like a different product from the schedule
   and chat screens.)

## M05: Alert detail (open, overdue)

Source: `issues-alerts/07-alert-detail-open-overdue.png`.

**Rating: bad.** Overall a low-craft page.

1. A large empty space sits above "Dock A" inside the card. (Craft and
   resilience: a blank where content was expected.)
2. A stray dot follows "Dock A". (Craft: a separator left with nothing after
   it.)
3. The back button is not a circle as on other pages. (Consistency.)
4. The back button overlaps the phone's clock. (Craft: content drawn into the
   status bar, ignoring the safe area.)

Observations while recording, not the owner's words:

- Points 1 and 2 look like one cause: a title or type and a second location
  part are missing, and the layout still draws their space and separator.
- The "No photo" placeholder takes about a quarter of the screen to say that
  nothing is there.

## M06: Worker profile

Source: `profile-settings/01-profile-worker.png`.

**Rating: okay.**

1. It would be better to show the user that they can upload a photo. The avatar
   shows only the initials, with no camera icon or other cue. (Flow and
   feedback: an available action has no visible affordance. An elevation, not a
   defect.)

## M07: Sign-in code (error)

Source: `auth/08-otp-error-wrong-code.png`.

**Rating: bad.**

1. The log-in button is covered by the keypad. (Resilience and flow: the
   primary action is hidden while the keyboard is open, on the one screen where
   the keyboard is always open.)

2. The error message "Expected HMRClient.setup() call at startup." is wrong. It
   is a debug message leaking to the user. (Microcopy and resilience: a
   technical string shown where a user-facing error belongs. Confirmed by the
   owner as a defect.)

Note: because of the leak, the real wrong-code message was not observed on this
screen. A director should say so.

## M08: Open issues (empty)

Source: `issues-alerts/11-issues-list-empty.png`.

**Rating: okay.**

1. The empty-state icon could be better. (Visual quality: a generic tick. An
   elevation, not a defect.)

# Summary

## Ratings

| Rating | Count | Screens |
|---|---|---|
| Good | 0 | none |
| Okay | 8 | W01, W02, W03, W07, M01, M03, M06, M08 |
| Bad | 12 | W04, W05, W06, W08, W09, W10, W11, W12, M02, M04, M05, M07 |

No screen in this set was rated good. Against the rubric, "okay" sits at about
3 and "bad" at about 2. The set supplies calibrated examples for 2 and 3 and
none for 4 or 5.

## Recurring findings

1. **Repeated information.** The same name or label shown two or three times on
   one screen. W01, W02, W04, W11, M03.
2. **A pattern used where it does not fit.** List-and-detail used as section
   navigation (W04, W10). A day picker for one shift a day (M02). Group-chat
   furniture in a direct message (M03). A full-page empty state inside a
   section (W09). A dropdown for multi-select (W07). Two buttons where a
   segmented control exists (W06).
3. **Competing emphasis.** No single focal point; several regions shout at
   once, and the fact that matters is quiet. W08, W09, W10, M04.
4. **Weak empty states.** Too long, oversized, not recognisable as empty, or
   with list and chart furniture left on screen. W08, W09, W10, M05, M08.
5. **Read-only shown as disabled.** A finished record presented as a
   switched-off form, with edit placeholders left visible. W05, W12.
6. **Internal text leaking to users.** Raw Markdown (W03), a debug error (M07),
   "(Unknown user)" (W05, W12).
7. **Inconsistency between sibling screens.** Overflow icon orientation, button
   order, second-level navigation style, back button shape, selected-state
   style. W01, W02, W06, W09, M05.
8. **Narrow-width and device problems.** Two stacked tab rows (W11), key facts
   pushed below the fold (W12), the primary action hidden by the keyboard
   (M07), content drawn into the status bar (M05).
9. **Generic or machine-made look.** The left-bordered card (M01), plain
   pricing cards (W06), heavy cards (M04).

## Principles stated by the owner

- Read-only is not disabled. A completed record is evidence to be read.
- A list of records and a set of sections are different things. Do not reuse
  list-and-detail as section navigation.
- A pattern must fit the amount and kind of content, not be copied from a
  sibling view.
- Familiar platform conventions are a legitimate reference.

## What this says about the director

- **Felt before named.** On W04 and W09 the owner knew the page was wrong
  before being able to say why. The director must name the cause.
- **Missed on a quick read.** The owner missed the raw Markdown on W03 and
  first passed over the debug text on M07. The director can catch more than a
  quick human read on this class of defect.
- **Not broken, still bad.** M02 has no defect and is bad because of a
  direction choice. A director that only hunts defects would pass it.
- **Loosely held views.** Several comments were offered with doubt (W03, M02,
  M03). The director should carry that distinction: a firm finding, a direction
  question, or a preference.

## System-level items found

- Selected-state border in the main navigation is too dark.
- No dedicated pattern for second-level section navigation.
- No compact empty state for use inside a section.
- Overflow menu icon orientation is not standardised.
- Primary and secondary button order is not standardised.
- Segmented control exists and is not used for every two-way choice.
- Mobile card styles differ between screens.
- Mobile back button shape and safe-area handling differ between screens.

## Consequences for the rubric

- The fallback reference, the product's own best screen, has no candidate in
  this set. A 5 cannot be anchored on it.
- With a floor of 4, most existing screens would fail. The rules for older
  flaws on a changed screen and for system notes will carry much of the load.
- "Match your siblings" must not enforce a weak pattern. Consistency needs an
  exception where the sibling pattern is itself a recorded system-level item.
