pre() {
  file-exists .pm/quality/case-state.json
  file-exists case-state.md
  file-matches case-state.md "Workflow: pm:ship"
  file-matches case-state.md "Case: resume"
  file-exists .pm/quality/hosted-state.json
  file-exists release.txt
  file-exists .pm/quality/resume-session.json
  file-exists user-owned-dirt.txt
  file-exists .pm/quality/base-main-ref
}

post() {
  check-transcript skill-called pm:ship
  artifact-exists quality-output.md
  artifact-exists quality-outcome.json
  quality-outcome-valid resume ship
  artifact-contains quality-outcome.json "\"resume_validated\": true"
  artifact-contains quality-outcome.json "\"preserved_state\": true"
  file-exists .pm/quality/resume-session.json
  file-exists .pm/dev-sessions/release/session.json
  command-succeeds "node \"$PM_PLUGIN_ROOT/scripts/dev-session.js\" validate --session .pm/dev-sessions/release/session.json --json"
  file-exists user-owned-dirt.txt
  file-matches .pm/dev-sessions/release/ship/release-transaction.json "\"status\": \"verified\""
  check-transcript quality-revalidation ship
  command-succeeds "node \"$PM_PLUGIN_ROOT/scripts/evals/quality-resume.js\" check ship \"$(pwd)\""
}
