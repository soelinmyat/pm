pre() {
  file-exists .pm/quality/case-state.json
  file-exists case-state.md
  file-matches case-state.md "Workflow: pm:rfc"
  file-matches case-state.md "Case: resume"
  file-exists pm/backlog/export-v2.md
  file-exists docs/architecture.md
  file-exists .pm/quality/resume-session.json
  file-exists user-owned-dirt.txt
  file-exists .pm/quality/base-main-ref
}

post() {
  check-transcript skill-called pm:rfc
  artifact-exists quality-output.md
  artifact-exists quality-outcome.json
  quality-outcome-valid resume rfc
  artifact-contains quality-outcome.json "\"resume_validated\": true"
  artifact-contains quality-outcome.json "\"preserved_state\": true"
  file-exists .pm/quality/resume-session.json
  file-exists .pm/rfc-sessions/quality-resume/session.json
  command-succeeds "node \"$PM_PLUGIN_ROOT/scripts/rfc-session.js\" validate --session .pm/rfc-sessions/quality-resume/session.json --json"
  file-exists user-owned-dirt.txt
  check-transcript quality-revalidation rfc
  command-succeeds "node \"$PM_PLUGIN_ROOT/scripts/evals/quality-resume.js\" check rfc \"$(pwd)\""
}
