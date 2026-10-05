# Product UI judgment

Use this method for product UI critique and visual QA. Evidence integrity checks establish what was inspected. They do not establish that the experience is good. Keep existing gate ownership, freshness and bounded review rules; this method adds judgment, not another schema or scorecard.

## Start with the task

Give the reviewer the persona, goal and ordinary starting context before the implementation explanation. For example: “As a manager, find a worker's leave, inspect its status and dates, then return to the team.” Do not tell them which overflow menu to open. Use normal navigation for the first QA attempt; direct links are useful afterwards for isolating states. Record the path actually taken, hesitation or failed discovery, and how return navigation behaved. A direct-loaded detail screenshot cannot prove discoverability or a successful return journey.

In Design Critique, inspect the rendered entry, list and detail context before judging individual controls. Use QA's observed journey evidence for functional navigation claims; when that evidence is absent, identify the gap rather than claiming the journey passed. Design owns information architecture and navigation presentation; QA owns executed navigation behavior.

## Make an independent assessment

Form the initial assessment from the task, rendered evidence and applicable product principles before reading the implementer's rationale, previous findings or proposed fixes. Save that assessment before consulting explanations, using the existing summary or report notes. In a verification round, retain the original assessment and check the prior findings afterwards. Fresh Eyes keeps its separate context and existing restricted-input contract.

Compare with a relevant established sibling screen when selecting or evaluating composition. Choose one with a similar user job, explain what is comparable, and name any justified differences. Bind any cited sibling captures through the existing evidence route; a source-only comparison proves implementation convention, not its current rendered quality. If no suitable sibling exists, say so and judge against the product principles. Do not require a fixed number of comparisons.

## Explain the user consequence

Ask whether the entry is discoverable, the destination remains clear, the important facts are easy to scan, decisions are understandable, and the person can return to context. Look at the whole composition: page width, grouping, hierarchy, density and repeated chrome. Allowed tokens and components can still make an inappropriate layout. A `Stack surface="card"` can recreate the same unwanted card composition as a `Card` import.

Write checkable claims: “Time off is a visible sibling of Members while inspecting a request” is stronger than “navigation looks intuitive.” Link each consequential claim to observed behavior or a specific capture and relevant principle. Distinguish observation, inference and untested state. Explain the weakest part of the result and any accepted tradeoff or exception in the existing assessment; do not manufacture a defect when the evidence is clean. Calibrate severity by demonstrated user impact and established rules, not taste.

A complete report, capture count, high aggregate score or fluent rationale never compensates for a supported usability defect. Conversely, required prose fields and word counts cannot certify good judgment. Use the existing summaries, findings and evidence rather than introducing new mandatory fields or finding quotas.

## Recheck the affected journey

After a fix, rerun the part of the task the change can affect, including its entry and return context when navigation changed. Compare the relevant before/after views and the sibling pattern where composition changed. Preserve earlier evidence and unresolved findings. Reuse unchanged context only through the existing freshness/delta contracts, with the reason it still applies; never copy an old pass label onto new source. Add states or viewports when a new risk justifies them, not to repeat the entire review mechanically.
