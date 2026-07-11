pre() {
  file-exists .pm/quality/case-state.json
  file-exists case-state.md
  file-matches case-state.md "Workflow: pm:rfc"
  file-matches case-state.md "Case: blocked-and-recovery"
  file-exists pm/backlog/export-v2.md
  file-exists docs/architecture.md
  file-exists dependency-contract.md
  file-exists contract-check.js
  command-fails "node contract-check.js"
  file-exists .pm/quality/base-main-ref
}

post() {
  check-transcript skill-called pm:rfc
  artifact-exists quality-output.md
  artifact-exists quality-outcome.json
  quality-outcome-valid blocked-and-recovery rfc
  artifact-contains quality-outcome.json "\"lifecycle\": \"blocked\""
  artifact-contains quality-outcome.json "\"recovery_test\":"
  command-succeeds "node \"$PM_PLUGIN_ROOT/scripts/evals/quality-repo-state.js\" check \"$(pwd)\""
}
