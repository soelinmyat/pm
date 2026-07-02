pre() {
  file-exists pm/backlog/csv-export.md
}

post() {
  check-transcript skill-called pm:groom
  file-matches pm/backlog/csv-export.md "status: (drafted|proposed)"
  file-matches pm/backlog/csv-export.md "id: "
  file-exists .pm/groom-sessions/csv-export.md
}
