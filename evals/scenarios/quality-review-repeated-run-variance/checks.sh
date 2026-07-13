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
  file-exists .pm/dev-sessions/feature/review/report.json
  file-exists .pm/dev-sessions/feature/review/report.html
  file-matches .pm/dev-sessions/feature/review/report.json "\"outcome\": \"passed\""
  command-succeeds "node \"$PM_PLUGIN_ROOT/scripts/review-check.js\" --root \"$PWD\" --report .pm/dev-sessions/feature/review/report.json --from-report"
  command-succeeds "test \"$(find .pm/dev-sessions/feature/review/runs -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')\" = 3"
  file-exists .pm/dev-sessions/feature/review/repeat-comparison.json
  command-succeeds "node \"$PM_PLUGIN_ROOT/scripts/evals/review-repeat-check.js\" \"$PWD\" .pm/dev-sessions/feature/review/repeat-comparison.json"
}
