pre() {
  file-exists .pm/quality/case-state.json
  file-exists case-state.md
  file-matches case-state.md "Workflow: pm:ship"
  file-matches case-state.md "Case: repeated-run-variance"
  file-exists .pm/quality/hosted-state.json
  file-exists release.txt
  file-exists .pm/quality/repeat-control.json
  file-exists .pm/quality/base-main-ref
}

post() {
  check-transcript skill-called pm:ship
  artifact-exists quality-output.md
  artifact-exists quality-outcome.json
  quality-outcome-valid repeated-run-variance ship
  artifact-contains quality-outcome.json "\"repeat_control\": \"frozen\""

}
