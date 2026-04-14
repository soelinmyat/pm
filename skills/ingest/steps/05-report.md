---
name: Report
order: 5
description: Generate a concise import summary report and recommend the next best step
---

## Report Back

**Goal:** Give the user a clear summary of what was ingested and a concrete recommendation for what to do next with the new evidence.

**How:**

End with a concise import report covering:
- files imported (text + audio separately)
- audio files transcribed (with duration if available)
- records created
- files skipped (with reason: unsupported format, missing deps, transcription failure)
- replacements performed
- themes created or updated
- parse warnings

Then recommend **one** next step based on what the evidence revealed:

| Signal | Recommendation |
|--------|---------------|
| Evidence challenges current ICP or priorities | `$pm-strategy` — new data may shift the strategy |
| Evidence strengthens a specific feature idea | `$pm-groom {slug}` — ready to scope with real customer backing |
| Evidence reveals a new problem area not yet explored | `$pm-think` — worth exploring before committing |
| No clear signal, general enrichment | `pm:start` — review the updated knowledge base |

Pick the strongest signal. If multiple apply, recommend the highest-impact one and mention the others as alternatives.

**Done-when:** The report is printed and the user has a clear next action.

Say: "Ingest complete. {N} items normalized and routed to `{pm_dir}/evidence/`.
Ready to act on this evidence? (a) Groom a feature — `/pm:groom`, (b) Update strategy — `/pm:strategy`, (c) Done for now."
