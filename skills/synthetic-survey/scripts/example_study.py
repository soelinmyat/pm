# /// script
# requires-python = ">=3.10"
# dependencies = ["sentence-transformers", "numpy"]
# ///
"""Example study for pm:synthetic-survey. Copy it with engine.py, then replace the product, people and cards.

Run:   uv run example_study.py --show          print one card per study and stop (free)
       uv run example_study.py --n 4           pilot: read the answers before spending more
       uv run example_study.py --n 40          full run

The product here is invented: a booking app for small bike repair shops.
"""

import argparse
from pathlib import Path

import engine

OUT = Path(__file__).parent / "out"
SHOPS = ["one-person workshop", "shop with a showroom", "mobile repair van"]  # rotate, so each gets equal numbers
TOOLS = [(50, "a paper diary"), (30, "a shared phone calendar"), (20, "the free plan of FixDesk, a booking app")]
PROBLEMS = [  # written in on purpose; include mild and none, or every respondent will want the product
    ("none", "Bookings mostly run fine and you rarely think about them."),
    ("mild", "Now and then a booking is missed, but it is not a big problem."),
    ("no-shows", "Your main headache is customers who book and do not turn up."),
    ("double bookings", "Your main headache is two jobs landing in the same slot."),
]


def people(name, n):
    rng = engine.seeded(name)
    out = []
    for i in range(n):
        shop, staff = SHOPS[i % len(SHOPS)], rng.randint(1, 6)
        tool = rng.choices([t for _, t in TOOLS], [w for w, _ in TOOLS])[0]
        problem, pain = rng.choice(PROBLEMS)
        text = (f"You are {rng.randint(25, 60)} years old and you own a bike repair {shop} with {staff} staff. "
                f"You take bookings with {tool}. {pain}") + engine.FOOTER
        out.append({"text": text, "staff": staff,
                    "traits": {"Shop": shop, "Takes bookings with": tool.split(",")[0], "Problem": problem}})
    return out


BASE = "Slotwise is a booking app for repair shops. Customers book a slot from a link and you see the day's jobs on your phone."
PITCHES = {  # one thing changes per option; the decoy should lose, and tells you the method is working
    "base": f"{BASE} It is free for one shop.",
    "reminders": f"{BASE} It texts customers a reminder the day before. It is free for one shop.",
    "deposit": f"{BASE} Customers pay a small deposit when they book. It is free for one shop.",
    "decoy_sales_call": f"{BASE} To start, you book a call with our sales team and sign a one-year contract.",
}


def alternatives(who, version):
    """What each app is and costs for this person. The rival's card is the same in every version."""
    ours = BASE + {"plain": "", "reminders": " It texts customers a reminder the day before."}[version]
    return {
        "Slotwise": f"{ours} Cost for you: {'free' if who['staff'] <= 3 else '$15 a month'}.",
        "FixDesk": "a booking app for repair shops. Customers book online and you get a calendar. "
                   f"Cost for you: {'free' if who['staff'] <= 2 else '$25 a month'}.",
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--n", type=int, default=40, help="respondents per study")
    parser.add_argument("--model", default="opus", help="claude CLI model alias")
    parser.add_argument("--show", action="store_true", help="print one persona and card per study and stop")
    args = parser.parse_args()
    question = "How likely are you to sign up and try it? Why?"
    if args.show:
        who = people("pitch", 3)[2]
        print(f"{who['text']}\n\n{PITCHES['reminders']}\n\n{question}\n\n---\n")
        print("\n\n".join(f"{name}: {card}" for name, card in alternatives(who, "reminders").items()))
        raise SystemExit
    score = engine.make_scorer()  # first, so a broken scorer fails before any answers are bought
    pitch = engine.rate("pitch", people("pitch", args.n), PITCHES, question, model=args.model, out=OUT)
    choice = engine.choose("choice", people("choice", args.n), ["plain", "reminders"], alternatives,
                           model=args.model, out=OUT, intro="You are deciding how to take bookings. These are your options.")
    engine.write_report(OUT, f"report-{args.model}.md", "Slotwise synthetic survey", [
        engine.rating_report(pitch, score, reference="base", planted=("Problem",)),
        engine.choice_report(choice, ours="Slotwise", baseline="plain", split_by="Problem"),
    ])
