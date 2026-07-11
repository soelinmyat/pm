pre() {
  file-exists .pm/quality/case-state.json
  file-exists case-state.md
  file-matches case-state.md "Workflow: pm:ship"
  file-matches case-state.md "Case: ambiguous-input"
  file-exists .pm/quality/hosted-state.json
  file-exists release.txt
  file-exists decision-options.md
  file-exists .pm/quality/base-main-ref
}

post() {
  check-transcript skill-called pm:ship
  artifact-exists quality-output.md
  artifact-exists quality-outcome.json
  quality-outcome-valid ambiguous-input ship
  artifact-contains quality-outcome.json "\"decision_recorded\": true"
  command-succeeds "node \"$PM_PLUGIN_ROOT/scripts/evals/quality-repo-state.js\" check \"$(pwd)\""
}
