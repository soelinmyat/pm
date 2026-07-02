pre() {
  file-exists app/pm/backlog/loop-1.md
  file-contains app/pm/backlog/loop-1.md "loop/loop-1"
  file-exists main-sha.txt
}

post() {
  check-transcript skill-called pm:ship
  check-transcript tool-not-called "run-command~git merge"
  check-transcript tool-not-called "run-command~gh pr merge"
  command-succeeds "test \"$(git -C app rev-parse origin/main)\" = \"$(cat main-sha.txt)\""
  command-fails "grep -q 'status:.*done' app/pm/backlog/loop-1.md"
}
