pre() {
  file-exists .pm/quality/case-state.json
  file-exists case-state.md
  file-matches case-state.md "Workflow: pm:ship"
  file-matches case-state.md "Case: happy-path"
  file-exists .pm/quality/hosted-state.json
  file-exists release.txt
  file-exists .pm/quality/base-main-ref
}

post() {
  check-transcript skill-called pm:ship
  artifact-exists quality-output.md
  artifact-exists quality-outcome.json
  quality-outcome-valid happy-path ship
  artifact-contains quality-outcome.json "\"lifecycle\": \"complete\""
  command-succeeds "test \"$(git rev-parse HEAD)\" = \"$(git --git-dir=.pm/quality/origin.git rev-parse refs/heads/main)\""
  command-succeeds "test \"$(git rev-parse HEAD)\" = \"$(git --git-dir=.pm/quality/origin.git rev-parse refs/tags/v9.9.9^{})\""
  command-succeeds "test \"$(git rev-parse HEAD)\" != \"$(cat .pm/quality/base-main-ref)\""
  artifact-contains quality-outcome.json "\"hosted_ci\": \"passed\""
}
