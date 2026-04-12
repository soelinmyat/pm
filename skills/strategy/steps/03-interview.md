---
name: Interview
order: 3
description: Conduct the strategy interview using the interview guide reference
---

## Interview Process

Follow the interview guide in `${CLAUDE_PLUGIN_ROOT}/skills/strategy/references/interview-guide.md`.

Rules:
- One question at a time. Do not front-load multiple questions.
- Prefer multiple-choice when there is a natural set of options.
- Start with Essentials. Move to Depth only if the user's answers are expansive.
- If the user gives a short answer, accept it and move on — do not interrogate.
- If `{pm_dir}/insights/business/landscape.md` exists, read it first. Use named competitors and market
  segments from it to make questions more specific (e.g., "How do you differ
  from [Competitor A] and [Competitor B]?" instead of "Who are your competitors?").
- If `{pm_dir}/evidence/research/` contains internal or mixed topic findings from `$pm-ingest`,
  use them to sharpen ICP, segmentation, priorities, and non-goals. Customer
  evidence should influence strategy when available.
- After Essentials are complete, ask: "Want to go deeper on any area, or is
  this enough to write the strategy doc?"
