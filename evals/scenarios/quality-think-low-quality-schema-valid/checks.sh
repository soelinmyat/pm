pre() {
  file-exists .pm/quality/case-state.json
  file-exists case-state.md
  file-exists product-evidence.json
  file-exists product-output-contract.md
}

post() {
  check-transcript skill-called pm:think
  artifact-exists quality-output.md
  artifact-exists quality-outcome.json
  quality-outcome-valid low-quality-schema-valid think
  artifact-contains quality-outcome.json "\"evaluation\": \"needs-revision\""
  artifact-exists product-evidence-receipt.json
  product-evidence-valid low-quality-schema-valid
}
