pre() {
  file-exists .pm/quality/case-state.json
  file-exists case-state.md
  file-matches case-state.md "Workflow: pm:review"
  file-matches case-state.md "Case: low-quality-schema-valid"
  file-exists review-intent.md
  file-exists src/items.js
  file-exists tests/items.test.js
  file-exists weak-but-valid-artifact.json
  command-succeeds "node -e \"const x=require('./weak-but-valid-artifact.json');if(x.schema_version!==1||!x.status)process.exit(1)\""
  file-exists .pm/quality/base-main-ref
}

post() {
  check-transcript skill-called pm:review
  artifact-exists quality-output.md
  artifact-exists quality-outcome.json
  quality-outcome-valid low-quality-schema-valid review
  artifact-contains quality-outcome.json "\"evaluation\": \"needs-revision\""
  command-succeeds "node \"$PM_PLUGIN_ROOT/scripts/evals/quality-repo-state.js\" check \"$(pwd)\""
}
