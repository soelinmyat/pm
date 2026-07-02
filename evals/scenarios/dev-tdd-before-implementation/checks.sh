pre() {
  file-exists desired-behavior.md
}

post() {
  check-transcript skill-called pm:dev
  check-transcript test-red-green test
}
