pre() {
  file-exists .pm/quality/case-state.json
  file-exists case-state.md
  file-matches case-state.md "Workflow: pm:design-critique"
  file-matches case-state.md "Case: repeated-run-variance"
  file-exists ui/report.html
  file-exists renders/mobile.txt
  file-exists renders/print.txt
  file-exists .pm/quality/repeat-control.json
  file-exists .pm/quality/base-main-ref
}

post() {
  check-transcript skill-called pm:design-critique
  artifact-exists quality-output.md
  artifact-exists quality-outcome.json
  quality-outcome-valid repeated-run-variance design-critique
  artifact-contains quality-outcome.json "\"repeat_control\": \"frozen\""

}
