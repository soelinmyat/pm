pre() {
  file-exists .pm/quality/case-state.json
  file-exists case-state.md
  file-matches case-state.md "Workflow: pm:dev"
  file-matches case-state.md "Case: repeated-run-variance"
  file-exists change-request.md
  file-exists docs/workflow.md
  file-exists tests/resume.test.js
  file-exists .pm/quality/repeat-control.json
  file-exists .pm/quality/base-main-ref
}

post() {
  check-transcript skill-called pm:dev
  artifact-exists quality-output.md
  artifact-exists quality-outcome.json
  quality-outcome-valid repeated-run-variance dev
  artifact-contains quality-outcome.json "\"repeat_control\": \"frozen\""
  file-matches docs/workflow.md "source identity"
  artifact-exists review-report.json
  check-transcript test-red-green "test"
  check-transcript skill-before-command pm:review "git push"
  command-succeeds "test \"$(git --git-dir=.pm/quality/origin.git rev-parse refs/heads/feature)\" = \"$(git rev-parse HEAD)\""
}
