pre() {
  file-exists app/pm/backlog/loop-1.md
  file-exists main-sha.txt
}

post() {
  check-transcript skill-called pm:dev
  check-transcript tool-not-called "run-command~/gh\s+pr\s+merge/"
  command-succeeds "test \"$(git -C app rev-parse origin/main)\" = \"$(cat main-sha.txt)\""
  command-succeeds "grep -q 'status:.*shipping' app/pm/backlog/loop-1.md"
  command-succeeds "grep -q 'branch:' app/pm/backlog/loop-1.md"
}
