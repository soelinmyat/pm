pre() {
  file-exists change-request.md
}

post() {
  check-transcript skill-called pm:dev
  check-transcript skill-before-tool pm:review functions.exec_command
  artifact-exists review-report.json
}
