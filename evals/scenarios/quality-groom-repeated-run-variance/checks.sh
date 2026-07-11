pre() {
  file-exists .pm/quality/case-state.json
  file-exists case-state.md
  file-matches case-state.md "Workflow: pm:groom"
  file-matches case-state.md "Case: repeated-run-variance"
  file-exists pm/backlog/csv-export.md
  file-exists pm/evidence/export-signals.md
  file-exists .pm/quality/repeat-control.json
  file-exists .pm/quality/base-main-ref
}

post() {
  check-transcript skill-called pm:groom
  artifact-exists quality-output.md
  artifact-exists quality-outcome.json
  quality-outcome-valid repeated-run-variance groom
  artifact-contains quality-outcome.json "\"repeat_control\": \"frozen\""
  file-matches pm/backlog/csv-export.md "status: (drafted|proposed)"
}
