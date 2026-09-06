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
  quality-outcome-valid happy-path ideate
  artifact-contains quality-outcome.json "\"lifecycle\": \"complete\""
  artifact-exists product-evidence-receipt.json
  product-evidence-valid happy-path
  check-transcript tool-not-called AskUserQuestion
  check-transcript tool-not-called request_user_input
  check-transcript tool-not-called functions.request_user_input
  check-transcript tool-not-called functions.request_user_input_async
}
