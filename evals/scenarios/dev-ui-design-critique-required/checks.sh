pre() {
  file-exists ui-change-request.md
}

post() {
  check-transcript skill-called pm:dev
  check-transcript skill-or-agent pm:design-critique "design.?critique|pm:designer|designer.*review"
  artifact-exists ui-critique.json
}
