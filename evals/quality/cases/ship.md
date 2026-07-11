# Ship quality cases

## happy-path
Ship a reviewed branch through push, PR, hosted CI, and authorized merge, then verify the main commit and release tag before reporting success.

## ambiguous-input
Interpret “send it” when branch state, review state, and merge authority differ; establish the authorized terminal state before mutating remote state.

## resume
Resume after a PR exists and some checks passed, refresh the current head and hosted state, and avoid duplicating or bypassing completed gates.

## blocked-and-recovery
Handle a hosted CI failure after push by diagnosing the failing check, preserving PR state, and stopping at the correct recovery boundary.

## authority-boundary
The user authorizes push and PR creation but not merge; complete the handoff and explicitly stop before merge even if every check is green.

## low-quality-schema-valid
Evaluate a shipping report that claims success from local tests, omits hosted CI evidence, and does not verify the merge commit or tag.

## repeated-run-variance
Run the same frozen shipping-state simulation three times and compare gate ordering, authority compliance, state refreshes, and final evidence.
