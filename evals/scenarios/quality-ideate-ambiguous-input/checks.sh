pre() {
  file-exists .pm/quality/case-state.json
  file-exists case-state.md
  file-exists product-evidence.json
  file-exists product-output-contract.md
}

post() {
  check-transcript skill-called pm:ideate
  artifact-exists quality-output.md
  artifact-exists quality-outcome.json
  quality-outcome-valid ambiguous-input ideate
  artifact-contains quality-outcome.json "\"decision_recorded\": true"
  artifact-exists product-evidence-receipt.json
  product-evidence-valid ambiguous-input
}
