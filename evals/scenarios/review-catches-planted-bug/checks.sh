pre() {
  file-exists planted-diff/bug.patch
}

post() {
  check-transcript skill-called pm:review
  file-contains review-findings.md "items.length = 0"
  artifact-exists review-findings.md
}
