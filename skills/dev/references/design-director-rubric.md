# Design Director Rubric

The standard a change must meet before the Design Director approves it. The builder reads this before writing UI code. The director scores against it.

A screen that is only free of defects does not meet the standard.

## Scale

The same five points apply to every dimension. The anchors under each dimension say what a point means there.

| Score | Meaning |
|---|---|
| 5 | A thorough, critical review finds nothing left to raise. |
| 4 | Strong. Refinements remain, and each is named. |
| 3 | Works, and a careful user would notice it is unpolished. |
| 2 | Several problems an ordinary user would notice. |
| 1 | Fails the job the screen exists for. |

**Pass floor: 4 on every dimension.** The target is 5.

## Scoring rules

- **Every score cites its evidence.** State the anchor clause it meets and the screenshot that shows it.
- **A score below 4 links its findings.** Quote the anchor clause at 3 or lower and name the findings that meet it. Those findings are major.
- **A 4 names the gap.** State the change that would make it a 5 and raise it as an elevation finding. When the only gap is something that could not be examined, name that limit instead; it is not a finding.
- **A 5 means nothing is left to raise.** No finding of any class is open on that dimension. It needs no reference screen.
- **The owner's eye is the minimum.** If the product owner could find an issue on a quick look, the work is not there yet, and a director that missed it has failed.
- **One finding, one dimension.** Each finding lowers only its primary dimension. Use the hunt list to place it.
- **Scores move only on new evidence.** A score changes between rounds only with a newly cited observation.
- **Count the majors.** A dimension with two or more major findings, or with a whole-screen problem (the screen reads as something it is not, has no starting point, or looks like a different product), scores 2. One major scores 3 at most. A finding that meets an anchor at 2 scores 2 on its own: counting never raises a score above its anchor.
- **Judge the whole before the parts.** Hierarchy, composition, visual quality and consistency are scored from the whole-screen read first. Element-level findings may lower that score; they never raise it.
- **Consistency is shown, not felt.** A consistency score of 4 or above lists what was compared with each comparable screen: navigation, back or close control, component weight, button order and density.
- **Zoom-only differences are small.** A difference visible only at zoom does not lower a dimension below 4 unless it repeats.

## Dimensions

### 1. Fidelity to the approved target

Does the build deliver the decisions approved in grooming? Check each declared decision. Ignore undeclared details, where production is the authority.

- **5:** Every declared decision is delivered, in every state, and holds with real content.
- **4:** Every declared decision is delivered. Minor differences exist that do not change the decision.
- **3:** One declared decision is weakened or only holds in the primary state.
- **2:** A declared decision is missing or replaced.

With no approved target, score against the intent and acceptance criteria, and say so.

### 2. Hierarchy

Does the screen direct attention in the order the task needs? Look at where the eye lands first, second and third, and whether the primary action is unmistakable.

- **5:** The reading order matches the task with no effort. One clear primary action. Secondary elements recede.
- **4:** The order is right. One element is slightly too loud or too quiet.
- **3:** The primary action or key fact has to be searched for, or two elements compete for first place.
- **2:** No clear starting point, or the eye lands on something unimportant.

### 3. Composition and density

Is the space used well for this task? Look at grouping, proportions, alignment between regions, whitespace, and how much sits in the first viewport.

- **5:** Related things sit together, regions are proportioned to their importance, and nothing feels cramped or stranded.
- **4:** Well composed. One region is slightly too large, too small or too far from what it relates to.
- **3:** Usable, with visible imbalance: a dominant block for minor content, wasted space, or important content pushed below the first viewport.
- **2:** Grouping misleads, or the layout fights the task.

### 4. Visual quality

Is it good to look at, and right for the platform? Look at typography, colour and visual weight, icons and imagery, and platform convention.

- **5:** Type, colour and imagery are deliberate and distinctive. Nothing looks generic or assembled.
- **4:** Type scale, colour and icons are well chosen and coherent. It looks designed, not assembled.
- **3:** Competent and generic: default-looking type, flat or arbitrary colour, mismatched icons, or a pattern that ignores the platform's convention.
- **2:** Clashing colour, poor type choices or low-quality imagery.

### 5. Craft

Is the detail precise? Run the style sweep, the inset and edge check and the nesting check. Zoom into dense areas.

- **5:** No unexplained outliers. All content edges align within each container. No doubled spacing or borders. Icons and text are optically aligned.
- **4:** No unexplained outliers in spacing, colour, radius or type. At most one alignment issue visible only at zoom.
- **3:** One or two unexplained outliers, or one doubled spacing or border.
- **2:** Several outliers, or misalignment visible without zooming.

Where style values cannot be measured, as for colour and padding on native mobile, score from zoomed 2x screenshots, state the limit, and cap this score at 4.

### 6. Consistency with the product

Does this belong to the same product as its neighbours? Compare side by side with a named existing screen that does a similar job.

- **5:** Uses the product's components and patterns throughout. A user moving between this and its neighbours notices no seam.
- **4:** Consistent. One element is a reasonable local variation.
- **3:** A custom element duplicates an existing component, or a pattern is handled differently from its neighbours.
- **2:** Looks like a different product.

A weakness in the product's system itself is a system note. It does not lower this score.

Matching a sibling is not a defence when the sibling's pattern is a recorded system-level item. New work must not spread a pattern the owner has marked as wrong. Use the nearest sound pattern and write a system note.

### 7. Flow and feedback

How does it feel to do the task? Do it from its normal entry point. Count steps and decisions. Watch what happens after every action, during waits and on return.

- **5:** The shortest sensible path. Every action gets immediate, clear feedback. A wait longer than about 300ms shows progress that matches the final layout, with no layout shift when it resolves. Returning lands where expected.
- **4:** Smooth. One step could be removed, or one action's feedback is slow or understated.
- **3:** An unnecessary step or decision, an action with no visible result, or an abrupt transition.
- **2:** The user can get lost, or cannot tell whether an action worked.

### 8. Resilience

Does it hold up outside the happy path? Try empty, loading, error and disabled states where they apply. Try long names, many rows and narrow widths.

- **5:** Every applicable state has its own layout, message and next action. Long and plentiful content stays readable. Narrow layouts are composed, not squeezed. A read-only record reads as a finished result, not a disabled form.
- **4:** Every applicable state works and looks intended. One state or width is plainer than the rest.
- **3:** A state is bare, generic or oversized for its place. Content truncates awkwardly. A narrow layout has a cramped region. An edit placeholder or list footer is left visible where it no longer applies.
- **2:** A state is missing or not recognisable as what it is. Content overflows. A width is broken. The primary action is hidden by the keyboard.

### 9. Microcopy

Do the words help? Read every label, message, empty state and error.

- **5:** Every string is clear, specific and uses the same terms as the rest of the product. Errors say what happened and what to do.
- **4:** Clear throughout. One string is generic or longer than it needs to be.
- **3:** Vague labels, inconsistent terms, an error that does not help, or two labels that appear to contradict each other.
- **2:** Text that misleads or leaves the user unsure what a control does. Internal text shown to the user: raw markup, a debug error, a placeholder such as "(Unknown user)".

### 10. Accessibility

Can everyone use it? Thresholds, from WCAG 2.2 AA:

- Text contrast at least 4.5:1. Large text and UI components at least 3:1.
- Targets at least 24 CSS px on web, 44pt on iOS and 48dp on Android.

On web, Tab through the screen. On native, read the accessibility tree for names, roles and order.

- **5:** Full keyboard or assistive path in a logical order, visible focus, every control named, all thresholds met, status never carried by colour alone.
- **4:** All thresholds met and every control named. One gap in focus order or focus visibility that blocks nobody.
- **3:** Any contrast or target-size miss, a control with no name, or focus that is hard to see.
- **2:** A primary action is unreachable or unlabelled.

## Finding classes

| Class | Definition | Effect |
|---|---|---|
| Major | Meets an anchor at 3 or lower, breaks the task, or violates scope | Blocks in any round |
| Regression | Something that worked before this change, or before the last fix, no longer does | Blocks in any round |
| Small | A real flaw in a dimension that still scores 4 or above | Blocks in rounds 1 and 2. Filed as a follow-up after round 3. |
| Elevation | A change that would move a dimension from 4 toward 5 | Must be answered in rounds 1 and 2. Filed after round 3. |
| System note | Needs a shared component, token or out-of-scope screen to change | Never blocks. Filed after the run. |

A state that grooming declared and the director cannot reach is a major finding against the build: make it reachable.

An elevation is answered when it is implemented, or rebutted with a reason the director accepts. On hierarchy, composition, visual quality and craft, "not needed" is not a reason.

An older flaw on a changed screen counts when its fix is inside the declared surfaces. Otherwise it is a system note.

A major finding first seen after round 1 on UI the fix did not change blocks only when it meets an anchor at 2 or lower, or breaks the task. Otherwise it is filed as a follow-up and recorded as missed. Its dimension then scores 4, not lower: the score links the finding and names its fix as the way to reach 5.

## Measurement dispositions

Every outlier from the sweep is a defect or intentional. An intentional disposition cites one of: a design token, an existing component, a declared decision in the approved target, or the same treatment on the comparable screen. "Looks fine" is not a disposition.

## Verdict

**Rounds 1 and 2.** Approve only when:

- every dimension scores 4 or above
- no major finding or regression is open
- no small finding is open
- every elevation is answered
- every outlier has a valid disposition

**Round 3.** Approve when every dimension scores 4 or above and no major finding or regression is open. Open small findings and unanswered elevations are filed as follow-ups and listed in the report.

**Reject** otherwise. A rejection in round 3 parks the work. So does a declared state that is still unreachable at the end of round 3.

**Reset.** Once per run, the director may restart the count at round 1. The only allowed reasons are:

- **Rebuild.** The fix replaced the layout or flow, so most of what was reviewed no longer exists.
- **Wrong direction.** The director rejects the approach itself and asks for a different composition.
- **Invalid earlier round.** The environment was broken or the wrong build was reviewed.

Missing things in round 1, or having many findings, is not a reason. A run has at most five reviews in total.

## Hunt list

Each item belongs to one dimension. A finding lowers only that dimension.

| Look for | Dimension |
|---|---|
| A primary action that does not stand out, or two that compete | Hierarchy |
| The eye landing on something unimportant | Hierarchy |
| Several regions with emphasis and no single focal point | Hierarchy |
| The fact the user came for shown quieter than its surroundings | Hierarchy |
| A read-only record that looks disabled | Hierarchy |
| Helper text as heavy as the labels it explains, or values heavier than they need | Hierarchy |
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
| Components heavier or larger than their content needs | Visual quality |
| The whole screen reading as switched off, unfinished or from another product | Visual quality |
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
| A single-choice control used where several can be chosen | Consistency |
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

## Calibration

These examples come from a product owner's review of twenty shipped screens. None was rated good. They show what a 3 and a 2 look like. A 5 is any of them with every comment fixed and nothing further to raise. A 4 is the same screen with only small refinements left.

A project may add its own examples in its PM instructions. Project examples take precedence over these.

### Principles

- **Read-only is not disabled.** A completed record is evidence to be read.
- **A list of records is not a set of sections.** List-and-detail is for picking one instance from many. Do not reuse it as section navigation.
- **A pattern must fit the content.** Do not copy a sibling view's pattern without asking whether it suits the amount and kind of content here.
- **Platform convention is a legitimate reference.** What people know from the apps they use every day counts.

### At 3: works, and visibly unpolished

- **A member detail page.** The layout is sound. The name appears three times. The list says "Never used" while the detail says "Active". The overflow icon is horizontal in one place and vertical in another.
- **A record detail page.** A clear table and summary panel. Descriptions show raw Markdown characters. Values in the summary panel are heavier than they need to be.
- **An invite form.** A clean form with a proper segmented control. A dropdown is used to assign several items.
- **A chat thread.** Readable and familiar. The field and send button differ in height. Avatars and names repeat on every message in a one-to-one thread.
- **A profile screen.** Tidy and complete. Nothing tells the user a photo can be added.

### At 2: problems an ordinary user would notice

- **A definition page.** The title and owner each appear twice. A version block at the top cannot be understood. The middle navigation mixes three item styles in a mostly empty column.
- **A closed record.** The whole page looks switched off. A notice states a system rule. "Add a description…" is offered where nothing can be added.
- **A plans page.** Plain, unbalanced cards. Features run together as a paragraph. Monthly and Annual are two separate buttons.
- **An empty list.** Three stacked rows of filtering plus a Filters button. A long, repetitive empty message. A stray "0 items".
- **A summary page.** Four regions compete. The total the user came for is the quietest thing on the page. The primary button is on the opposite side from the rest of the product.
- **An empty analytics page.** A table, a legend and a summary sentence are all drawn with no data, so the page does not read as empty.
- **A narrow detail page.** Two stacked rows of horizontal tabs, the first clipped. A back link whose destination is unclear.
- **A schedule screen.** Nothing is broken. A day picker built for a team view shows one item on a nearly empty screen. This is a direction problem.
- **A report form.** Large, heavy cards that do not look like the same design system as the rest of the app.
- **An alert detail.** An empty gap and a stray dot where content is missing. A back button that overlaps the status bar.
- **A sign-in error.** The log-in button is hidden by the keypad. The error line is a leaked debug message.

### What the owner sensed before naming

On two of these screens the owner knew the page was wrong before finding the reason. The director must supply the reason. The owner also missed the raw Markdown at first. The director is expected to catch that class of defect every time.
