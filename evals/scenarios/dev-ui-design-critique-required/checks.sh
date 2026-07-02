pre() {
  file-exists ui-change-request.md
}

post() {
  check-transcript skill-called pm:dev
  check-transcript gate-evidence pm:design-critique "design.?critique|pm:designer|designer.*review" "playwright|screenshot|page\.(goto|screenshot)|chromium|viewport"
  artifact-exists ui-critique.json
}
