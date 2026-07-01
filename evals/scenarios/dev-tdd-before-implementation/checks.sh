pre() {
  file-exists desired-behavior.md
}

post() {
  check-transcript skill-called pm:dev
  check-transcript tool-called functions.exec_command
  artifact-exists tdd-evidence.json
}
