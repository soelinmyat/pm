pre() {
  file-exists idea.md
}

post() {
  check-transcript skill-called pm:groom
  check-transcript skill-before-tool pm:groom functions.exec_command
  artifact-exists proposal.md
}
