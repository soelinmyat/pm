pre() {
  file-exists .pm/quality/case-state.json
  file-exists case-state.md
  file-matches case-state.md "Workflow: pm:ship"
  file-matches case-state.md "Case: blocked-and-recovery"
  file-exists .pm/quality/hosted-state.json
  file-exists release.txt
  file-exists dependency-contract.md
  file-exists contract-check.js
  command-fails "node contract-check.js"
  file-exists .pm/quality/base-main-ref
}

post() {
  check-transcript skill-called pm:ship
  artifact-exists quality-output.md
  artifact-exists quality-outcome.json
  quality-outcome-valid blocked-and-recovery ship
  artifact-contains quality-outcome.json "\"lifecycle\": \"blocked\""
  artifact-contains quality-outcome.json "\"recovery_test\":"
  command-succeeds "node \"$PM_PLUGIN_ROOT/scripts/evals/quality-repo-state.js\" check \"$(pwd)\""
  command-succeeds "test \"$(git --git-dir=.pm/quality/origin.git rev-parse refs/heads/main)\" = \"$(cat .pm/quality/base-main-ref)\""
}
