pre() {
  file-exists .pm/quality/case-state.json
  file-exists case-state.md
  file-matches case-state.md "Workflow: pm:review"
  file-matches case-state.md "Case: happy-path"
  file-exists review-intent.md
  file-exists src/items.js
  file-exists tests/items.test.js
  file-exists .pm/quality/base-main-ref
}

post() {
  check-transcript skill-called pm:review
  artifact-exists quality-output.md
  artifact-exists quality-outcome.json
  quality-outcome-valid happy-path review
  artifact-contains quality-outcome.json "\"lifecycle\": \"complete\""
  command-succeeds "npm test"
}
