pre() {
  file-exists .pm/quality/case-state.json
  file-exists case-state.md
  file-matches case-state.md "Workflow: pm:review"
  file-matches case-state.md "Case: happy-path"
  file-exists review-intent.md
  file-exists src/items.js
  file-exists tests/items.test.js
  file-exists .pm/quality/base-main-ref
}

post() {
  check-transcript skill-called pm:review
  artifact-exists quality-output.md
  artifact-exists quality-outcome.json
  quality-outcome-valid happy-path review
  artifact-contains quality-outcome.json "\"lifecycle\": \"complete\""
  command-succeeds "npm test"
  file-exists .pm/dev-sessions/feature/review/report.json
  file-exists .pm/dev-sessions/feature/review/report.html
  file-matches .pm/dev-sessions/feature/review/report.json "\"outcome\": \"passed\""
  command-succeeds "node \"$PM_PLUGIN_ROOT/scripts/review-check.js\" --root \"$PWD\" --report .pm/dev-sessions/feature/review/report.json --from-report"
  command-succeeds "node -e \"const fs=require('fs'),r=require('./.pm/dev-sessions/feature/review/report.json');if(!/^\\.pm\\/dev-sessions\\/feature\\/review\\/runs\\/[^/]+\\/round-[1-3]\\/target\\.json$/.test(r.target.path)||!fs.existsSync(r.target.path))process.exit(1)\""
}
