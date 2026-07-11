pre() {
  file-exists .pm/quality/case-state.json
  file-exists case-state.md
  file-matches case-state.md "Workflow: pm:dev"
  file-matches case-state.md "Case: blocked-and-recovery"
  file-exists change-request.md
  file-exists docs/workflow.md
  file-exists tests/resume.test.js
  file-exists dependency-contract.md
  file-exists contract-check.js
  command-fails "node contract-check.js"
  file-exists .pm/quality/base-main-ref
}

post() {
  check-transcript skill-called pm:dev
  artifact-exists quality-output.md
  artifact-exists quality-outcome.json
  quality-outcome-valid blocked-and-recovery dev
  artifact-contains quality-outcome.json "\"lifecycle\": \"blocked\""
  artifact-contains quality-outcome.json "\"recovery_test\":"
  command-succeeds "node \"$PM_PLUGIN_ROOT/scripts/evals/quality-repo-state.js\" check \"$(pwd)\""
}
