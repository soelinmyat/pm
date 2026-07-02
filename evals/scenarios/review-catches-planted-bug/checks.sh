pre() {
  file-exists planted-diff/bug.patch
}

post() {
  check-transcript skill-called pm:review
  artifact-contains review-findings.md "items.length"
  artifact-exists review-findings.md
}
