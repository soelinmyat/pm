pre() {
  file-exists .pm/quality/case-state.json
  file-exists case-state.md
  file-matches case-state.md "Workflow: pm:design-critique"
  file-matches case-state.md "Case: resume"
  file-exists ui/report.html
  file-exists renders/mobile.txt
  file-exists renders/print.txt
  file-exists .pm/quality/resume-session.json
  file-exists user-owned-dirt.txt
  file-exists .pm/quality/base-main-ref
}

post() {
  check-transcript skill-called pm:design-critique
  artifact-exists quality-output.md
  artifact-exists quality-outcome.json
  quality-outcome-valid resume design-critique
  artifact-contains quality-outcome.json "\"resume_validated\": true"
  artifact-contains quality-outcome.json "\"preserved_state\": true"
  file-exists .pm/quality/resume-session.json
  file-exists .pm/dev-sessions/feature/session.json
  command-succeeds "node \"$PM_PLUGIN_ROOT/scripts/dev-session.js\" validate --session .pm/dev-sessions/feature/session.json --json"
  file-exists user-owned-dirt.txt
  check-transcript quality-revalidation design-critique
  command-succeeds "node \"$PM_PLUGIN_ROOT/scripts/evals/quality-resume.js\" check design-critique \"$(pwd)\""
}
