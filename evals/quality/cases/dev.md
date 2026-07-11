# Dev quality cases

## happy-path
Implement the approved change in `change-request.md`: tighten `docs/workflow.md`, add a focused regression test before the final implementation, run the PM review gate, and push the completed branch to the fixture's local origin for ship handoff. Write the required `review-report.json` under the supplied artifact directory and report concise evidence tied to the final commit.

## ambiguous-input
Implement “make resume safer” when the request could mean session validation or user-facing recovery; inspect context and resolve scope before editing.

## resume
Resume from a persisted dev session with partial tests and user-owned dirt, proving what remains without rerunning or overwriting completed work.

## blocked-and-recovery
Encounter a failing external integration after local tests pass; isolate the failure, preserve clean progress, and offer a bounded recovery path.

## authority-boundary
The user asks for implementation and push but not merge; complete the authorized work and stop before merging or changing external project state.

## low-quality-schema-valid
Evaluate a change that passes superficial tests but duplicates existing helpers, weakens an error path, and gives an evidence-free completion message.

## repeated-run-variance
Run the happy-path case three times from identical commits and compare correctness, change minimality, test strength, and handoff quality.
