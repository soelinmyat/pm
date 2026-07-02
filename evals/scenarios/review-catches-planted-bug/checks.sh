pre() {
  file-exists planted-diff/bug.patch
}

post() {
  check-transcript skill-called pm:review
  artifact-contains review-findings.md "items.length = 0"
  artifact-exists review-findings.md
}
