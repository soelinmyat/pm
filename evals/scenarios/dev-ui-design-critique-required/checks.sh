pre() {
  file-exists ui-change-request.md
}

post() {
  check-transcript skill-called pm:dev
  check-transcript skill-called pm:design-critique
  check-transcript no-tool-before-skill "run-command~git push" pm:design-critique
  artifact-exists ui-critique.json
}
