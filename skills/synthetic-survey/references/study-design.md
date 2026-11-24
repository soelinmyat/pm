# Study design for a synthetic survey

Rules for personas, cards and reading results. Each rule exists because breaking it produced a wrong or empty result in practice.

## The method in one paragraph

An invented respondent (a persona in the system prompt) reads one card and answers in two or three sentences of free text. For a rating study, a local entailment model scores the answer from 1 to 5 against anchor statements running from "definitely not" to "definitely yes". For a choice study, the respondent names one option and the engine reads the name. The same respondents answer every option in a study, so gaps are measured within respondents. The approach follows "LLMs Reproduce Human Purchase Intent via Semantic Similarity Elicitation of Likert Ratings" (Maier et al., 2025), with the scoring changed: similarity scoring with a local embedder was at chance on multi-sentence answers, so the engine uses entailment instead.

## Personas

- **Describe a situation, not an opinion.** Give age, business, size, how they do the job today, who works for them, and one sentence on their main problem. Do not tell them how they feel about new products.
- **Never write an attitude toward the thing being tested.** A line such as "you ignore most new apps" gets repeated in every answer.
- **Include respondents with a mild problem and with none.** If every persona has a main headache the product solves, every choice follows the persona and the study hits a ceiling.
- **Mark planted traits.** Traits written in to drive interest (the problem, comfort with apps, attitude to money) will move scores. Pass them as `planted` so the report flags them, and look for signal in the traits you did not plant.
- **Rotate the segment by index** so each business type gets equal numbers, and seed the random source by study name so the same study draws the same people.
- **Keep rival names out of the persona when a run hides brand names.** A persona who already uses a rival gives the name away.
- **End every persona with `engine.FOOTER`.** It keeps answers short, in character and free of ratings.

## Cards

- **Change one thing per option.** Hold the product description fixed and vary the pitch, the feature, the price or the route.
- **Add a decoy that should lose**, named `decoy_...`: an enterprise pitch, a sales form, a yearly contract paid upfront. If it does not land last, distrust the study.
- **Pick a reference option** and report every other option as a gap to it.
- **Nest options when comparing additions.** If most cards include a feature, the reference must include it too, or the gaps mix two changes.
- **State the price for that respondent.** "Cost for you: $40 for your 2 locations" is concrete; a pricing rule is not.
- **Keep rival cards as full as yours.** Give each rival what its own pages claim, with the benefit of the doubt where the plan is unclear. An undersold rival scored 0% and a fair one 41% on otherwise identical studies.
- **Hide who is asking.** Do not say whose survey it is.

## Questions

- **Ask about one thing.** "Leaving aside whether you like the app, how likely are you to go through this way of getting started?" stops a respondent who likes the product from rating the route highly.
- **Name the product in the question when a rival is mentioned.** Otherwise "I'd go with the rival" reads as a yes.
- **For choices, require the option name first:** "Begin your answer with the name of your choice followed by a full stop."

## Which study type

| Question | Type | Size |
|---|---|---|
| Which pitch, feature set, route or price shape is preferred | Rating | 40 respondents per option |
| Would they pick us over a named rival or over doing nothing | Choice | 80 respondents per group |
| Which feature carries the choice | Choice, with one feature removed per version | 80 |
| What happens at the first bill | Choice, told they have used it for some months | 60 |

Always include "carry on as I do now" in a choice study. For most respondents that is the real rival.

Run a choice study once with real brand names and once with neutral labels when you need to separate the offer from the brand.

## Reading results

- **Trust first.** Report the split-half figure and whether the decoy landed last before any ranking. Below about 0.5, call the study noise.
- **Clear means a gap over twice its standard error.** Report other gaps as within noise.
- **Order, not level.** Synthetic respondents say yes far more often than real ones. A 55% share is not a forecast.
- **Ceilings hide effects.** When nearly every respondent with a problem already picks the product, an added feature shows nothing. Make the test harder: fuller rival cards, milder respondents, one feature removed at a time.
- **Rosy premises inflate.** "You have used it for six months and it works" makes almost everyone stay. Read the direction only, and vary the premise in a follow-up.
- **Check a second model when the result matters.** If two models disagree on the order, treat it as noise.

## What the method cannot tell you

- Price levels. Respondents barely separate two prices and overreact to free.
- Comprehension. An AI respondent understands any rule you write.
- Whether end users will adopt the product once the buyer has chosen it.
- Whether buyers ever hear of the product.
- Anything not written on the card.

Name these in the write-up and suggest the cheapest real check, such as showing the same cards to five customers.

## Running

```bash
uv run study.py --show          # one persona and card per study, free
uv run study.py --n 4 --model haiku   # pilot
uv run study.py --n 40 --model opus   # full run, in the background
```

- Scripts declare `sentence-transformers` and `numpy` as inline dependencies and run with `uv`.
- The first scored run downloads the entailment model. Scoring a few thousand answers takes some minutes on a laptop.
- Ten answers are asked at a time; expect about 30 a minute.

## Research artifact template

```markdown
# {Product} synthetic survey

## Summary
Two or three sentences: what was asked, of how many AI-written respondents, and that nothing was checked against a real customer.

## Method
Respondents, study types, sizes, models, checks.

## Findings
Numbered. Each is a hypothesis with its gap, whether it is clear, and the study's trust level.

## Limits
What the personas forced, where a ceiling or rosy premise applies, what the method cannot test.

## Open Questions
Unconfirmed rival facts and the real checks worth running.
```
