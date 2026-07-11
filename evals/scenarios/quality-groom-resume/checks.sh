pre() {
  file-exists .pm/quality/case-state.json
  file-exists case-state.md
  file-matches case-state.md "Workflow: pm:groom"
  file-matches case-state.md "Case: resume"
  file-exists pm/backlog/csv-export.md
  file-exists pm/evidence/export-signals.md
  file-exists .pm/quality/resume-session.json
  file-exists user-owned-dirt.txt
  file-exists .pm/quality/base-main-ref
}

post() {
  check-transcript skill-called pm:groom
  artifact-exists quality-output.md
  artifact-exists quality-outcome.json
  quality-outcome-valid resume groom
  artifact-contains quality-outcome.json "\"resume_validated\": true"
  artifact-contains quality-outcome.json "\"preserved_state\": true"
  file-exists .pm/quality/resume-session.json
  file-exists .pm/groom-sessions/quality-resume.md
  file-matches .pm/groom-sessions/quality-resume.md "phase: research"
  file-exists user-owned-dirt.txt
  check-transcript quality-revalidation groom
  command-succeeds "node \"$PM_PLUGIN_ROOT/scripts/evals/quality-resume.js\" check groom \"$(pwd)\""
}
