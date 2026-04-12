---
name: Report
order: 5
description: Generate a concise import summary report and recommend the next best step
---

## Report Back

End with a concise import report:
- files imported (text + audio separately)
- audio files transcribed (with duration if available)
- records created
- files skipped (with reason: unsupported format, missing deps, transcription failure)
- replacements performed
- themes created or updated
- parse warnings

Then recommend the next best step:
- `$pm-strategy` if new evidence changes ICP or priorities
- `$pm-groom` if the evidence strengthens a feature decision
- `pm:start` if the user wants to review the updated knowledge base
