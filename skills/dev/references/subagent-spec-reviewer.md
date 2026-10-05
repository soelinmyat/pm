# Spec Compliance Reviewer Prompt Template

Use this template when dispatching a spec compliance reviewer subagent.

**Purpose:** Independently verify the requested outcome, domain rules, and scope. This legacy per-unit template is optional evidence; it does not replace the current authoritative Review skill.

```
Task tool (general-purpose):
  description: "Review spec compliance for Task N"
  prompt: |
    You are reviewing whether an implementation matches its specification.

    ## What Was Requested

    [FULL TEXT of task requirements]

    ## Independent First Pass

    Read the approved requirements, applicable repository/domain context, changed
    source and relevant tests before reading the implementer report or rationale.
    Form your own assessment of the outcome, boundary cases and scope. Record
    concrete observations and uncertainties. Do not infer quality from work speed.

    ## Implementer Claims (read after first pass)

    [Provide separately or withhold until the independent first pass is recorded]

    Compare these claims with your observations; inspect any discrepancy. Claims
    can explain intent but cannot substitute for source/runtime evidence.

    **DO NOT:**
    - Take their word for what they implemented
    - Trust their claims about completeness
    - Accept their interpretation of requirements

    **DO:**
    - Read the actual code they wrote
    - Compare behavior and integration to the approved outcome and requirements; trace domain rules and relevant unhappy paths, not merely text correspondence
    - Check for missing pieces they claimed to implement
    - Look for extra features they didn't mention

    ## Your Job

    Read the implementation code and verify:

    **Missing requirements:**
    - Did they implement everything that was requested?
    - Are there requirements they skipped or missed?
    - Did they claim something works but didn't actually implement it?

    **Extra/unneeded work:**
    - Did they build things that weren't requested?
    - Did they over-engineer or add unnecessary features?
    - Did they add "nice to haves" that weren't in spec?

    **Misunderstandings:**
    - Did they interpret requirements differently than intended?
    - Did they solve the wrong problem?
    - Did they implement the right feature but wrong way?

    **Verify source and meaningful test/runtime evidence.** Identify tests that could pass with the feature broken (mock-only checks, vacuous results, implementation-derived expectations). State what remains unexamined. An apparent specification gap is an uncertainty to explain; do not silently expand scope or endorse a harmful literal implementation.

    Report:
    - ✅ Spec compliant (if everything matches after code inspection)
    - ❌ Issues found: [list specifically what's missing or extra, with file:line references]
```
