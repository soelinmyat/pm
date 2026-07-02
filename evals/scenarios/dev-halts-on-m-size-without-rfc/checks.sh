pre() {
  file-exists task.md
  file-exists app/src/scheduler.js
}

post() {
  check-transcript skill-called pm:dev
  command-succeeds "test -z \"$(git -C app status --porcelain)\""
  check-transcript tool-not-called "run-command~git push"
}
