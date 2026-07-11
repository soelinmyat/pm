pre() {
  file-exists .pm/quality/case-state.json
  file-exists case-state.md
  file-matches case-state.md "Workflow: pm:design-critique"
  file-matches case-state.md "Case: low-quality-schema-valid"
  file-exists ui/report.html
  file-exists renders/mobile.txt
  file-exists renders/print.txt
  file-exists weak-but-valid-artifact.json
  command-succeeds "node -e \"const x=require('./weak-but-valid-artifact.json');if(x.schema_version!==1||!x.status)process.exit(1)\""
  file-exists .pm/quality/base-main-ref
}

post() {
  check-transcript skill-called pm:design-critique
  artifact-exists quality-output.md
  artifact-exists quality-outcome.json
  quality-outcome-valid low-quality-schema-valid design-critique
  artifact-contains quality-outcome.json "\"evaluation\": \"needs-revision\""
  command-succeeds "node \"$PM_PLUGIN_ROOT/scripts/evals/quality-repo-state.js\" check \"$(pwd)\""
}
