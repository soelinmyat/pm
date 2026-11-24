---
name: synthetic-survey
description: "Pressure-test positioning, features, onboarding or pricing by surveying AI-played respondents and ranking the options. Use for a synthetic or simulated customer survey, not for real customer evidence."
---

# pm:synthetic-survey

## Purpose

Rank product options quickly by asking invented respondents, played by an AI, to react to them. It produces a per-study report, a decision discussion, and a research artifact that labels every finding as synthetic.

It is a brainstorming aid that narrows a dozen opinions to a ranked list with reasons. It does not measure demand.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution, telemetry, and custom instructions.
Read `${CLAUDE_PLUGIN_ROOT}/references/writing.md` before generating any output.
Read `${CLAUDE_PLUGIN_ROOT}/skills/synthetic-survey/references/study-design.md` before writing any persona or card; it holds the design rules and the failure modes found in practice.
Read `${CLAUDE_PLUGIN_ROOT}/references/evidence-system.md` before durable writeback.

**Workflow:** `synthetic-survey` | **Telemetry steps:** `frame`, `design`, `pilot`, `run`, `read`, `writeback`

## Iron Law

**NEVER PRESENT A SYNTHETIC ANSWER AS CUSTOMER EVIDENCE.**

Every table, summary and saved artifact says the answers were written by an AI playing invented respondents. Scores and shares are never quoted as forecasts.

## When NOT to use

- The user has real interviews, transcripts or survey exports: use `pm:ingest`.
- The question is a fact about a market or competitor: use `pm:research`.
- The question is one decision to reason through: use `pm:think`.
- The user needs to know whether people understand a page, whether staff adopt a tool, or what price level to charge. This method cannot answer those; say so and suggest a real test.

## Hard rules

- **Subscription, not API.** Respondents answer through the `claude` CLI, which bills to the user's Claude subscription. Do not read API keys or call a model API unless the user asks for that.
- **Cost authority.** State the number of answers and the rough duration before any run above a pilot, and wait for the user's go-ahead. A run is about 30 answers a minute.
- **Pilot before the full run.** Ask 3 to 5 respondents per study first and read the answers yourself. Fix a persona line that every answer repeats, a question owners answer about the wrong thing, or a choice that will not parse.
- **Every study carries its own checks.** A decoy that should lose, the same respondents across all options, and the split-half stability figure. A study whose decoy does not land last, or whose order is unstable, is reported as noise.
- **Compare, never forecast.** Report gaps between options and whether each gap is clear. Do not report a share or score as what real customers will do.
- **Rival facts come from the rival's own page.** Check each fact on the vendor's source, record the URL and access date, and mark what you could not confirm. A wrong line on a rival's card decides the result.
- **One writer for the scripts.** Copy `engine.py` from `${CLAUDE_PLUGIN_ROOT}/skills/synthetic-survey/scripts/` beside a study script modelled on `example_study.py`. Do not rewrite the engine per project.

## Workflow

Run the beats in order. Ask one question at a time, and only when the answer changes the design.

1. **Frame.** Restate what the user wants to decide as a short list of questions, such as which pitch, which feature set, which price shape, or which app owners pick. Name the market and who the respondent is. Agree the list before designing.
2. **Design.** Write the personas and cards following `study-design.md`. Use a rating study to rank versions of one thing, and a choice study when rivals or "carry on as I do now" are the real alternatives. Show the user one persona and one card per study with `--show`, which costs nothing.
3. **Pilot.** Run 3 to 5 respondents per study on the cheaper model. Read the answers, fix the design, and say what you changed.
4. **Run.** After the user approves the size, run in the background with 40 respondents per rating study or 80 per choice study. Answers are cached, so a stopped run resumes.
5. **Read.** Report each study with its trust level first, then the order, the clear gaps and one or two quotes. Say plainly which studies are noise. Then go through what it means for the product one topic at a time, recording each decision the user makes and each idea that needs another round.
6. **Writeback.** Save the output described below. Offer a harder follow-up when a study hits a ceiling, and name the assumptions only a real test can check.

## Output and provenance

- **Working files:** the study script, `engine.py`, raw answers and reports go in `{pm_state_dir}/synthetic-survey/{slug}/`. Raw answers stay there.
- **Research artifact:** `{pm_dir}/evidence/research/{slug}.md` with the method, findings, limits and open questions, written to the research template in `study-design.md`. Set `source_origin` to `internal`, or `mixed` when rival facts cite vendor pages, and list those source URLs with access dates.
- **Decision record:** `{pm_dir}/evidence/research/{slug}-decisions.md` when the user made decisions during the read.
- Register the artifact through the evidence runtime as `synthesized`, with method `synthetic-survey`. Confidence for every finding is low until a real source supports it; write each finding as a hypothesis.
- Update the research index and log the same way `pm:research` does.

## Red Flags — Self-Check

- **"The numbers look decisive, so I can state the finding."** Stop and check the decoy, the stability figure and whether the personas were written to produce that answer.
- **"Every respondent chose our product."** The study hit a ceiling. Include milder respondents, fairer rival cards and a version with one feature removed before reporting.
- **"I know what the rival offers."** Check the vendor page and record the source. Mark what you could not confirm.
- **"The pilot is a formality."** Check the pilot answers yourself. Most design faults show in the first ten.
- **"A bigger run will fix a noisy study."** If options do not separate at 40 respondents, the options are too alike or the question is wrong. Redesign instead.
- **"This shows what price to charge."** Synthetic respondents barely tell two prices apart and overreact to free. Keep to price shape.

## Escalation Paths

- **The user has real customer data:** "You have real answers for this. Want me to switch to `/pm:ingest` and use those instead?"
- **The question needs sourced facts first:** "The cards need facts about the rivals. Want me to run `/pm:research` on them before designing the study?"
- **A result needs a real check:** "This survey cannot test that. The cheapest real check is showing the same cards to five customers. Want that written up as a `/pm:task`?"
- **Decisions are ready to build:** "These decisions change scope. Want to take them into `/pm:groom`?"

## Common Rationalizations

| Excuse | Reality |
|---|---|
| "It is only a brainstorm, so caveats are noise." | Unlabelled synthetic findings get quoted as evidence a month later. The label is the product. |
| "The rival card can be short; ours has more to say." | The longest, richest card wins. Give rivals what their own pages claim. |
| "All respondents need a problem, or nobody will care." | Then the choice follows the persona, not the product. Include mild and no-problem respondents. |
| "Skipping the cheap model saves a step." | The pilot costs a minute and catches faults that waste an hour. |

## Before Marking Done

- [ ] The report, research artifact and any decision record are saved, each labelled as synthetic with source URLs for rival facts.
- [ ] The user approved the run size before it started and confirmed each recorded decision.
- [ ] Decoy, stability, pilot, provenance and writeback gates passed, and every noisy study is reported as noise.

## Resume

Answers are cached by model, study, option, respondent and exact prompt. Rerun the study script to continue a stopped run. An edited card is asked again, and unchanged cards are not.

## Error handling

- **`claude` is not logged in or a usage limit stops the run.** Report it and stop. Cached answers persist; rerun later.
- **The scorer cannot tell yes from no.** The engine asserts this before buying answers. Do not bypass it.
- **Choices come back as "Unclear".** Tighten the instruction to begin with the option name, and check that no option name is a prefix of another.
