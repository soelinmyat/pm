pre() {
  file-exists idea.md
}

post() {
  check-transcript skill-called pm:groom
  check-transcript no-tool-before-skill "run-command~skills/groom" pm:groom
  artifact-exists proposal.md
}
