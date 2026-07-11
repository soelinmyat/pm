pre() {
  file-exists .pm/quality/case-state.json
  file-exists case-state.md
  file-matches case-state.md "Workflow: pm:review"
  file-matches case-state.md "Case: blocked-and-recovery"
  file-exists review-intent.md
  file-exists src/items.js
  file-exists tests/items.test.js
  file-exists dependency-contract.md
  file-exists contract-check.js
  command-fails "node contract-check.js"
  file-exists .pm/quality/base-main-ref
}

post() {
  check-transcript skill-called pm:review
  artifact-exists quality-output.md
  artifact-exists quality-outcome.json
  quality-outcome-valid blocked-and-recovery review
  artifact-contains quality-outcome.json "\"lifecycle\": \"blocked\""
  artifact-contains quality-outcome.json "\"recovery_test\":"
  command-succeeds "node \"$PM_PLUGIN_ROOT/scripts/evals/quality-repo-state.js\" check \"$(pwd)\""
}
