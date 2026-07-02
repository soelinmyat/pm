pre() {
  file-exists change-request.md
}

post() {
  check-transcript skill-called pm:dev
  check-transcript skill-before-command pm:review '\b(git\s+push|gh\s+pr\s+(create|merge))\b'
  artifact-exists review-report.json
}
