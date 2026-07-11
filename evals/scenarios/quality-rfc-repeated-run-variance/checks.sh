pre() {
  file-exists .pm/quality/case-state.json
  file-exists case-state.md
  file-matches case-state.md "Workflow: pm:rfc"
  file-matches case-state.md "Case: repeated-run-variance"
  file-exists pm/backlog/export-v2.md
  file-exists docs/architecture.md
  file-exists .pm/quality/repeat-control.json
  file-exists .pm/quality/base-main-ref
}

post() {
  check-transcript skill-called pm:rfc
  artifact-exists quality-output.md
  artifact-exists quality-outcome.json
  quality-outcome-valid repeated-run-variance rfc
  artifact-contains quality-outcome.json "\"repeat_control\": \"frozen\""

}
