pre() {
  file-exists .pm/quality/case-state.json
  file-exists case-state.md
  file-exists product-evidence.json
  file-exists product-output-contract.md
  command-fails "node contract-check.js"
}

post() {
  check-transcript skill-called pm:strategy
  artifact-exists quality-output.md
  artifact-exists quality-outcome.json
  quality-outcome-valid blocked-and-recovery strategy
  artifact-contains quality-outcome.json "\"lifecycle\": \"blocked\""
  artifact-contains quality-outcome.json "\"recovery_test\":"
  artifact-exists product-evidence-receipt.json
  product-evidence-valid blocked-and-recovery
  command-fails "node contract-check.js"
}
