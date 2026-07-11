pre() {
  file-exists .pm/quality/case-state.json
  file-exists case-state.md
  file-matches case-state.md "Workflow: pm:groom"
  file-matches case-state.md "Case: ambiguous-input"
  file-exists pm/backlog/csv-export.md
  file-exists pm/evidence/export-signals.md
  file-exists decision-options.md
  file-exists .pm/quality/base-main-ref
}

post() {
  check-transcript skill-called pm:groom
  artifact-exists quality-output.md
  artifact-exists quality-outcome.json
  quality-outcome-valid ambiguous-input groom
  artifact-contains quality-outcome.json "\"decision_recorded\": true"
  command-succeeds "node \"$PM_PLUGIN_ROOT/scripts/evals/quality-repo-state.js\" check \"$(pwd)\""
}
