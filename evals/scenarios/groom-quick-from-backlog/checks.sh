pre() {
  file-exists pm/backlog/csv-export.md
}

post() {
  check-transcript skill-called pm:groom
  file-matches pm/backlog/csv-export.md "status: (drafted|proposed)"
  file-matches pm/backlog/csv-export.md "id: "
  # The groom state machine ran: the session dir exists. The session FILE is
  # deliberately deleted by step 11 cleanup on full completion, so its absence
  # is success evidence, not failure — do not assert on the file.
  command-succeeds test -d .pm/groom-sessions
}
