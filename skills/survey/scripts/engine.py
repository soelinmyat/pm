"""Engine for pm:survey. Copy this file next to your study script and import it.

A study script builds invented respondents and cards, then calls:

    rows = rate(...)    one card at a time, answered in free text, scored 1 to 5
    rows = choose(...)  your product beside the real alternatives; the respondent names one

and passes the rows to rating_report(...) or choice_report(...).

Answers come from the `claude` CLI, so they bill to the Claude subscription and not the API.
They are cached in <out>/responses.jsonl, keyed by model, study, option, respondent and the exact
prompt, so a rerun only asks what is new and an edited card is asked again.

Synthetic answers are a brainstorming aid. Read the order of options within a study, never the level.
"""

import hashlib
import json
import random
import re
import subprocess
import tempfile
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import numpy as np

SCORER = "cross-encoder/nli-deberta-v3-base"
# Append to every persona so answers are short, in character and free of ratings.
FOOTER = (
    "\n\nYou are answering a short survey. Reply as yourself, in two or three plain sentences, the way you would "
    "speak. Say what you would really do, not what sounds polite. Do not give a number or a rating."
)
ANCHORS = [  # each set runs from 1 (no) to 5 (yes); scores are averaged over sets
    ["I would definitely not go for this.", "I probably would not go for this.",
     "I am not sure whether I would go for this.", "I would probably go for this.",
     "I would definitely go for this."],
    ["It is not for me at all, I have no interest.", "I doubt I would bother with it.",
     "Maybe, it depends; I could go either way.", "It sounds good, I am fairly likely to take it up.",
     "Yes, absolutely, I want this right away."],
    ["No way, it is a waste of my time and money.", "Probably not, it does not seem worth it.",
     "I am on the fence about it.", "Probably yes, it seems worth it.",
     "Definitely yes, it is exactly what I need."],
    ["Extremely unlikely.", "Unlikely.", "Neither likely nor unlikely.", "Likely.", "Extremely likely."],
]


# --- Asking -----------------------------------------------------------------

def ask(system, prompt, model, cwd):
    for _ in range(3):
        done = subprocess.run(
            ["claude", "-p", "--model", model, "--system-prompt", system, "--tools", "",
             "--disable-slash-commands", "--strict-mcp-config"],
            input=prompt, capture_output=True, text=True, cwd=cwd, timeout=180,
        )
        if done.returncode == 0 and done.stdout.strip():
            return done.stdout.strip()
    raise RuntimeError(f"claude failed: {done.stderr[-300:]}")


def collect(jobs, model, out):
    """jobs: dicts with study, option, respondent, system, prompt, plus any fields to keep on the row."""
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    cache = out / "responses.jsonl"
    text = cache.read_text() if cache.exists() else ""
    old = []
    for line in text.splitlines():
        try:
            old.append(json.loads(line))
        except json.JSONDecodeError:  # a run killed mid-write leaves one torn line; ask that answer again
            pass
    digest = lambda job: hashlib.sha256((job["system"] + "\0" + job["prompt"]).encode()).hexdigest()[:16]
    key = lambda r: (r["model"], r["study"], r["option"], r["respondent"], r["prompt_sha"])
    have = {key(r): r for r in old}
    for job in jobs:
        job["model"], job["prompt_sha"] = model, digest(job)
    todo = [job for job in jobs if key(job) not in have]
    print(f"{len(jobs) - len(todo)} cached answers, {len(todo)} to ask", flush=True)
    cwd = tempfile.mkdtemp()  # empty folder, so no project instructions leak into the persona

    def run(job):
        row = {k: v for k, v in job.items() if k not in ("system", "prompt")}
        return {**row, "answer": ask(job["system"], job["prompt"], model, cwd)}

    with ThreadPoolExecutor(10) as pool, cache.open("a") as sink:
        if text and not text.endswith("\n"):
            sink.write("\n")  # start after a torn line, not inside it
        futures = [pool.submit(run, job) for job in todo]
        stop = lambda: [future.cancel() for future in futures]  # running requests still finish
        failure = None
        try:
            # Save each answer as it lands, so a failure keeps every answer already asked, in flight included.
            for done, future in enumerate(as_completed(futures), 1):
                if future.cancelled():
                    continue
                try:
                    row = future.result()
                except Exception as error:
                    failure = failure or error
                    stop()
                    continue
                sink.write(json.dumps(row) + "\n")
                sink.flush()
                have[key(row)] = row
                if done % 50 == 0:
                    print(f"  {done}/{len(todo)}", flush=True)
        except BaseException:  # Ctrl-C: stop asking; answers in flight are lost
            stop()
            raise
    if failure:
        raise failure
    return [have[key(job)] for job in jobs]


# --- Rating studies ---------------------------------------------------------

def rate(study, people, options, question, *, model, out):
    """Every person answers every option. options: {key: card text}. Name decoys 'decoy_...'."""
    jobs = [{"study": study, "option": option, "respondent": i, "traits": who.get("traits", {}),
             "system": who["text"], "prompt": f"{card}\n\n{question}"}
            for option, card in options.items() for i, who in enumerate(people)]
    return collect(jobs, model, out)


def make_scorer():
    from sentence_transformers import CrossEncoder

    # The source paper scores by embedding similarity to the anchors. With a local embedder that was at
    # chance on multi-sentence answers; asking an entailment model "does the answer imply this anchor?"
    # separated yes from no (0.93 AUC on a pilot). No answer leaves the machine.
    model = CrossEncoder(SCORER)

    def score(texts):
        """Expected 1-5 rating per text: how strongly it entails each anchor, softmaxed."""
        pmfs = []
        for anchors in ANCHORS:
            logits = model.predict([(t, a) for t in texts for a in anchors]).reshape(len(texts), 5, 3)
            entail = logits[:, :, 1] - logits[:, :, 0]  # label order: contradiction, entailment, neutral
            e = np.exp(entail - entail.max(axis=1, keepdims=True))
            pmfs.append(e / e.sum(axis=1, keepdims=True))
        return np.mean(pmfs, axis=0) @ np.arange(1, 6)

    yes, no = score(["Yes, I would sign up today, this solves my biggest headache.",
                     "No, I would not bother, I have no use for this."])
    assert yes > no + 0.5, f"scorer cannot tell yes from no ({yes:.2f} vs {no:.2f})"
    return score


def ranks(values):
    """Average ranks, so tied values share a rank instead of getting an arbitrary order."""
    values = np.asarray(values, dtype=float)
    out, ordered = np.empty(len(values)), np.sort(values)
    for value in np.unique(values):
        out[values == value] = np.flatnonzero(ordered == value).mean()
    return out


def stability(n, measure):
    """Split-half agreement of the option order, averaged over 200 random splits of n respondents.
    measure(respondent indices) -> one value per option. A half with no order counts as 0, not 1."""
    rng, splits = np.random.default_rng(0), []
    for _ in range(200):  # one random split is itself noisy, so average many
        order = rng.permutation(n)
        a, b = ranks(measure(order[: n // 2])), ranks(measure(order[n // 2:]))
        splits.append(0.0 if a.std() == 0 or b.std() == 0 else np.corrcoef(a, b)[0, 1])
    return float(np.mean(splits))


def lowest(names, values):
    """The lowest option, all of them on a tie, plus a warning unless only decoys share the bottom."""
    bottom = [name for name, value in zip(names, values) if value <= min(values) + 1e-9]
    ok = all(name.startswith("decoy") for name in bottom) or not any(x.startswith("decoy") for x in names)
    return ", ".join(bottom) + ("" if ok else " (the decoy did not land last, so distrust this study)")


assert list(ranks([3, 3, 1])) == [1.5, 1.5, 0.0]
assert stability(4, lambda idx: [3.0, 3.0, 3.0]) == 0.0
assert lowest(["decoy_x", "a"], [3.0, 3.0]).endswith("distrust this study)")
assert lowest(["decoy_x", "a"], [2.0, 3.0]) == "decoy_x"


def rating_report(rows, score, *, reference=None, planted=()):
    """Markdown for one rating study. reference: the option every other one is compared against.
    planted: trait names you wrote into the personas to drive interest, so readers discount them."""
    for row, value in zip(rows, score([r["answer"] for r in rows])):
        row["score"] = float(value)
    study = rows[0]["study"]
    names = list(dict.fromkeys(r["option"] for r in rows))
    n = 1 + max(r["respondent"] for r in rows)
    grid = np.zeros((n, len(names)))
    for r in rows:
        grid[r["respondent"], names.index(r["option"])] = r["score"]
    mean = grid.mean(axis=0)
    halves = stability(n, lambda idx: grid[idx].mean(axis=0))
    lines = [f"## {study}", "",
             f"{n} respondents per option. Halves agree: {halves:.2f} (1 = stable order, 0 = noise). "
             f"Lowest option: {lowest(names, mean)}.", "",
             "| Option | Score | Likely or better |" + (f" Gap to {reference} |" if reference else ""),
             "|---|---|---|" + ("---|" if reference else "")]
    for j in np.argsort(-mean):
        line = f"| {names[j]} | {mean[j]:.2f} | {100 * np.mean(grid[:, j] >= 3.5):.0f}% |"
        if reference:
            # The same people saw both options, so compare within each person.
            gap = grid[:, j] - grid[:, names.index(reference)]
            se = gap.std(ddof=1) / n ** 0.5
            clear = "clear" if se > 0 and abs(gap.mean() / se) >= 2 else "noise"
            line += " |" if names[j] == reference else f" {gap.mean():+.2f} ({clear}) |"
        lines.append(line)
    real = [j for j, name in enumerate(names) if not name.startswith("decoy")]
    own = grid[:, real].mean(axis=1)  # each person's average over the real options
    groups = defaultdict(list)
    for r in rows:
        if r["option"] == names[0]:
            for trait, group in r.get("traits", {}).items():
                groups[(trait, group)].append(own[r["respondent"]])
    if groups:
        lines += ["", "Who responds (average over the real options). Traits marked * were written into the "
                  "personas to drive interest.", "", "| Trait | Group | People | Score |", "|---|---|---|---|"]
        for (trait, group), values in sorted(groups.items(), key=lambda kv: (kv[0][0], -np.mean(kv[1]))):
            lines.append(f"| {trait}{'*' if trait in planted else ''} | {group} | {len(values)} | {np.mean(values):.2f} |")
    lines += ["", "Warmest and coldest answer per option:", ""]
    for name in names:
        mine = sorted((r for r in rows if r["option"] == name), key=lambda r: r["score"])
        for r in (mine[-1], mine[0]):
            lines.append(f"- **{name}** ({r['score']:.1f}): {r['answer']}")
    return lines


# --- Choice studies ---------------------------------------------------------

def choose(study, people, versions, alternatives, *, model, out, stay="Carry on",
           stay_text="keep doing it the way you do now.",
           intro="You are deciding what to do. These are your options."):
    """Each person sees one version of your product beside the alternatives and must name one.

    versions: version names. alternatives(person, version) -> {name: card text for this person}, with
    your product and each rival; work each price out for that person so the comparison is concrete.
    Rival cards must not change between versions. The order rotates between people and stays fixed
    for one person, so versions compare fairly.
    """
    jobs = []
    for version in versions:
        for i, who in enumerate(people):
            cards = alternatives(who, version)
            order = list(cards)
            order = order[i % len(order):] + order[: i % len(order)]
            prompt = (intro + "\n\n" + "\n\n".join(f"{name}: {cards[name]}" for name in order)
                      + f"\n\n{stay}: {stay_text}\n\nWhich one would you really go with? Begin your answer with the "
                      f"name of your choice ({', '.join(order)} or {stay}) followed by a full stop, then say why.")
            jobs.append({"study": study, "option": version, "respondent": i, "traits": who.get("traits", {}),
                         "names": order + [stay], "system": who["text"], "prompt": prompt})
    rows = collect(jobs, model, out)
    for r in rows:
        r["choice"] = pick(r["answer"], r["names"])
    return rows


def pick(answer, names):
    """Which option the answer names: its opening words, or else the only option it mentions early on."""
    start = re.sub(r"^[\W_]+", "", answer).lower()
    said = lambda name, text: re.search(rf"(?<!\w){re.escape(name.lower())}(?!\w)", text)  # whole words only
    for name in sorted(names, key=len, reverse=True):
        hit = said(name, start)
        if hit and hit.start() == 0:
            return name
    found = {name for name in names if said(name, start[:160])}
    found = {name for name in found if not any(name != other and said(name, other.lower()) for other in found)}
    return found.pop() if len(found) == 1 else "Unclear"  # two names mentioned is no choice


assert pick("**Acme.** Known name", ["Ours", "Acme", "Carry on"]) == "Acme"
assert pick("Carry on. Nothing is broken.", ["Ours", "Acme", "Carry on"]) == "Carry on"
assert pick("Honestly I can't decide", ["Ours", "Acme", "Carry on"]) == "Unclear"
assert pick("I cannot decide between Acme and Ours.", ["Ours", "Acme", "Carry on"]) == "Unclear"
assert pick("Pickles aside, I would carry on.", ["Pick", "Carry on"]) == "Carry on"
assert pick("I would go with Acme Pro.", ["Acme", "Acme Pro", "Carry on"]) == "Acme Pro"


def choice_report(rows, *, ours, baseline=None, split_by=None):
    """Markdown for one choice study. ours: your product's name on the cards. baseline: the version every
    other one is compared against. split_by: a trait name to break the shares down by."""
    study = rows[0]["study"]
    versions = list(dict.fromkeys(r["option"] for r in rows))
    names = list(dict.fromkeys(name for r in rows for name in sorted(r["names"]))) + ["Unclear"]
    names = [ours] + [x for x in names if x != ours]
    picks = defaultdict(dict)
    for r in rows:
        picks[r["option"]][r["respondent"]] = r["choice"]
    n = len(picks[versions[0]])
    real = [x for x in names if x != "Unclear"]

    def shares(idx):  # share choosing each real option, version by version, among these respondents
        return [sum(picks[v][i] == x for i in idx) / len(idx) for v in versions for x in real]

    total = np.reshape(shares(range(n)), (len(versions), len(real)))
    if any(v.startswith("decoy") for v in versions):  # a decoy version of your product should win least
        low = f"Version least chosen as {ours}: {lowest(versions, total[:, 0])}"
    else:
        low = f"Least chosen option: {lowest(real, total.mean(axis=0))}"
    lines = [f"## {study}", "",
             f"{n} respondents. Halves agree: {stability(n, shares):.2f} (1 = stable order, 0 = noise). {low}.", "",
             f"Share choosing each option, one row per version of {ours}.", "",
             "| Version | " + " | ".join(names) + " |", "|---|" + "---|" * len(names)]
    for version in versions:
        count = Counter(picks[version].values())
        lines.append(f"| {version} | " + " | ".join(f"{100 * count[x] / n:.0f}%" for x in names) + " |")
    if baseline:
        lines.append("")
        for version in versions:
            if version != baseline:  # same people, so count who moved to and from your product
                gained = sum(picks[version][i] == ours != picks[baseline][i] for i in picks[version])
                lost = sum(picks[baseline][i] == ours != picks[version][i] for i in picks[version])
                lines.append(f"- {version} against {baseline}: {gained} moved to {ours}, {lost} moved away.")
    if split_by:
        lines += ["", f"Share choosing {ours}, by {split_by}:", "", "| Version | Group | People | Share |", "|---|---|---|---|"]
        for version in versions:
            groups = defaultdict(list)
            for r in rows:
                if r["option"] == version:
                    groups[r.get("traits", {}).get(split_by, "?")].append(r["choice"] == ours)
            for group, hits in sorted(groups.items()):
                lines.append(f"| {version} | {group} | {len(hits)} | {100 * np.mean(hits):.0f}% |")
    return lines


def write_report(out, name, title, sections):
    """sections: lists of markdown lines from rating_report and choice_report."""
    head = [f"# {title}", "", "Synthetic answers written by an AI playing invented respondents. A brainstorming aid: "
            "compare options within a study, and do not read any score or share as a forecast.", ""]
    path = Path(out) / name
    path.write_text("\n".join(head + [line for section in sections for line in section + [""]]))
    print(path.read_text())
    return path


def seeded(name):
    """A random source tied to a name, so the same study always draws the same people."""
    return random.Random(name)
