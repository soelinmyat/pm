pre() {
  file-exists ui-change-request.md
}

post() {
  check-transcript skill-called pm:dev
  check-transcript skill-called critique
  artifact-exists ui-critique.json
}
