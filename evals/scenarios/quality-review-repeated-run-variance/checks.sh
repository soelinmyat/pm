pre() {
  file-exists .pm/quality/case-state.json
  file-exists case-state.md
  file-matches case-state.md "Workflow: pm:review"
  file-matches case-state.md "Case: repeated-run-variance"
  file-exists review-intent.md
  file-exists src/items.js
  file-exists tests/items.test.js
  file-exists .pm/quality/repeat-control.json
  file-exists .pm/quality/base-main-ref
}

post() {
  check-transcript skill-called pm:review
  artifact-exists quality-output.md
  artifact-exists quality-outcome.json
  quality-outcome-valid repeated-run-variance review
  artifact-contains quality-outcome.json "\"repeat_control\": \"frozen\""
  command-succeeds "npm test"
}
