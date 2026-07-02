pre() {
  file-exists change-request.md
}

post() {
  check-transcript skill-called pm:dev
  check-transcript no-tool-before-skill "run-command~git push" pm:review
  check-transcript no-tool-before-skill "run-command~gh pr create" pm:review
  artifact-exists review-report.json
}
