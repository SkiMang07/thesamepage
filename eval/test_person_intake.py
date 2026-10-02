#!/usr/bin/env python3
"""
eval/test_person_intake.py -- does capture by person get owner and direction right?

Runs the real draft pipeline (routes/person_intake.py: separate -> prompt -> model
-> validate) on labelled per-person texts, scores it against hand labels, and
prints the cases that went wrong. Needs ANTHROPIC_API_KEY (backend/.env).

  cd <repo-root>/backend && python ../eval/test_person_intake.py [dev|sealed|all]

SEVERE errors are the ones that put wrong data in the record, and the gate is zero
of them on the sealed set:
  wrong side     a matched commitment came back owed by the other side
  false row      a commitment the label says must not exist (already done, a role
                 description, a hedge, someone else's)
  wrong person   a commitment whose wording names another person on the team
A side the model left null is not severe (the page makes the manager choose) but is counted.
A missed commitment is counted as a miss, not severe.

The labels were written by the author of the pipeline, so "sealed" is only sealed
from tuning, not from bias: Andrew should audit those labels before the number is trusted.
"""
import os
import sys
from datetime import date
from pathlib import Path

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2ln")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZSJ9.c2ln")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from ai_core import generate_text  # noqa: E402
from config import AI_DEFAULT_MODEL_HEAVY  # noqa: E402
import routes.person_intake as pi  # noqa: E402

TEAM = ["Mei Tanaka", "Andre Silva", "Lena Park", "Kwame Mensah", "Sofia Reyes", "Tomás Vega", "Priya Nair", "Sam Ortiz"]
M, R = "manager", "direct_report"

# who, text, gold = [(side, [tokens all in description])], optional = same shape (may or may not appear;
# if it does, its side must match), none = tokens that must not appear in any commitment, max = most
# commitments allowed, held = sentences that must be held back unread.
DEV = [
 dict(id="d1", who="Mei Tanaka", text="I owe her written feedback on her design doc, which has been three weeks now.", gold=[(M, ["feedback", "design doc"])]),
 dict(id="d2", who="Mei Tanaka", text="She owns the design-doc review process on the team. I need to talk with her about what meets versus exceeds means for her after calibration, which I haven't raised.", gold=[(M, ["talk", "meets"])], none=["review process"]),
 dict(id="d3", who="Andre Silva", text="I asked him for a weekly written status, which he did twice and then he just stopped last month.", gold=[(R, ["weekly", "status"])]),
 dict(id="d4", who="Lena Park", text="She is going to confirm the on-call priorities with me by Friday.", gold=[(R, ["confirm", "priorities"])]),
 dict(id="d5", who="Kwame Mensah", text="He wants a growth plan and I haven't written it.", gold=[(M, ["growth plan"])]),
 dict(id="d6", who="Sofia Reyes", text="She asked me about a move to staff and I didn't have a good answer.", gold=[], optional=[(M, ["staff"])], max=1),
 dict(id="d7", who="Tomás Vega", text="He joined in the spring. Our first 1:1 is Monday.", gold=[], max=0),
 dict(id="d8", who="Priya Nair", text="I sent her the feedback last week and she thanked me.", gold=[], max=0),
 dict(id="d9", who="Priya Nair", text="She promised to send me the Q3 renewal forecast by the 15th, and I said I'd introduce her to the finance lead.", gold=[(R, ["renewal forecast"]), (M, ["introduce"])]),
 dict(id="d10", who="Sam Ortiz", text="We agreed I'd review his deck on Tuesday and he'd send the draft Monday night.", gold=[(M, ["review", "deck"]), (R, ["draft"])]),
 dict(id="d11", who="Sam Ortiz", text="I don't owe him anything right now, and he owes me nothing either.", gold=[], max=0),
 dict(id="d12", who="Mei Tanaka", text="We should probably think about her career path at some point.", gold=[], max=0),
 dict(id="d13", who="Andre Silva", text="He'll probably send the report if I remind him.", gold=[], optional=[(R, ["report"])], max=1),
 dict(id="d14", who="Lena Park", text="Brennan asked me for the headcount numbers, so I owe Brennan that, and Lena owes me the numbers by Wednesday.", gold=[(R, ["numbers"])], none=["brennan"]),
 dict(id="d15", who="Kwame Mensah", text="so Kwame is great and he's been asking about the growth thing and I keep saying I'll write it and I haven't and he also said he'd put together the onboarding doc for the new hire which I haven't seen yet", gold=[(M, ["growth"]), (R, ["onboarding doc"])]),
 dict(id="d16", who="Mei Tanaka", text="Andre also sits on that review rota. I owe her feedback on the doc.", gold=[(M, ["feedback"])], none=["rota"], held=1),
]
SEALED = [
 dict(id="s1", who="Priya Nair", text="She told me she'll have the onboarding checklist done by month end. I owe her an answer about the budget.", gold=[(R, ["checklist"]), (M, ["answer", "budget"])]),
 dict(id="s2", who="Sam Ortiz", text="I haven't given him any feedback since March. He asked twice.", gold=[], optional=[(M, ["feedback"])], max=1),
 dict(id="s3", who="Tomás Vega", text="He needs to send me the access request form, and I need to approve the laptop order.", gold=[(R, ["access request"]), (M, ["approve", "laptop"])]),
 dict(id="s4", who="Lena Park", text="She's burnt out and I'm worried. I owe her a conversation about workload.", gold=[(M, ["workload"])], none=["burnt", "worried"]),
 dict(id="s5", who="Andre Silva", text="Last quarter I promised him a spot on the architecture review and it never happened.", gold=[(M, ["architecture review"])]),
 dict(id="s6", who="Kwame Mensah", text="I'll cover his on-call shift on the 12th. He said he'd return the favor in December.", gold=[(M, ["cover", "on-call"]), (R, ["favor"])]),
 dict(id="s7", who="Sofia Reyes", text="Her role is to run the partner program and she is accountable for the renewals number.", gold=[], max=0),
 dict(id="s8", who="Priya Nair", text="Mei and Andre both want the lead role.", gold=[], max=0, held=1),
]


def has(desc, tokens):
    d = desc.casefold()
    return all(t.casefold() in d for t in tokens)


# Where the model's reply comes from. By default the real model through ai_core. With
# `score REPLIES_DIR` it is a saved reply per case (<id>.json), so the same scoring runs
# on replies produced elsewhere; with `dump PROMPTS_DIR` the prompts are written out.
REPLY_DIR = None
DUMP_DIR = None


def model_reply(case, prompt):
    if DUMP_DIR:
        Path(DUMP_DIR).mkdir(parents=True, exist_ok=True)
        (Path(DUMP_DIR) / f"{case['id']}.txt").write_text(prompt.prefix + "\n\n=====\n\n" + prompt.body)
        return "{}"
    if REPLY_DIR:
        f = Path(REPLY_DIR) / f"{case['id']}.json"
        return f.read_text() if f.exists() else "{}"
    return generate_text(prompt, model=AI_DEFAULT_MODEL_HEAVY, max_tokens=1500)


def run(case):
    this = {"id": "x", "name": case["who"]}
    others = [{"id": str(i), "name": n} for i, n in enumerate(TEAM) if n != case["who"]]
    readable, held = pi.separate(case["text"], this, others)
    parsed = {}
    if readable.strip():
        raw = model_reply(case, pi.build_prompt(case["who"], readable, date.today().isoformat()))
        parsed = pi._parse_json(raw)
    out = pi.validate(parsed, readable, [])
    dropped = max(0, len(parsed.get("commitments") or []) - len(out["commitments"]))
    got = out["commitments"]
    severe, unclear, misses = [], 0, []
    used = set()
    for side, toks in case["gold"] + case.get("optional", []):
        required = (side, toks) in case["gold"]
        hit = next((i for i, c in enumerate(got) if i not in used and has(c["description"], toks)), None)
        if hit is None:
            if required:
                misses.append("/".join(toks))
            continue
        used.add(hit)
        got_side = got[hit]["committed_by"]
        if got_side is None:
            unclear += 1
        elif got_side != side:
            severe.append(f"WRONG SIDE: '{got[hit]['description']}' came back {got_side}, label says {side}")
    for i, c in enumerate(got):
        if any(has(c["description"], [t]) for t in case.get("none", [])):
            severe.append(f"FALSE ROW (forbidden): '{c['description']}'")
        for n in TEAM:
            if n != case["who"] and pi._names_in(c["description"], pi._first(n)):
                severe.append(f"WRONG PERSON: '{c['description']}' names {n}")
    allowed = case.get("max")
    if allowed is not None and len(got) > allowed:
        severe.append(f"FALSE ROW (over the {allowed} allowed): {[c['description'] for c in got]}")
    if "held" in case and len(held) < case["held"]:
        severe.append(f"HELD BACK {len(held)}, label says {case['held']}")
    return dict(id=case["id"], severe=severe, unclear=unclear, misses=misses, dropped=dropped,
                required=len(case["gold"]), got=len(got), rows=[(c["committed_by"], c["description"]) for c in got])


def main(which):
    sets = {"dev": DEV, "sealed": SEALED, "all": DEV + SEALED}[which]
    totals = dict(cases=0, required=0, found=0, severe=0, unclear=0, dropped=0)
    for case in sets:
        r = run(case)
        totals["cases"] += 1
        totals["required"] += r["required"]
        totals["found"] += r["required"] - len(r["misses"])
        totals["severe"] += len(r["severe"])
        totals["unclear"] += r["unclear"]
        totals["dropped"] += r["dropped"]
        flag = "SEVERE" if r["severe"] else ("miss" if r["misses"] else "ok")
        print(f"[{flag:6}] {r['id']:4} rows={r['got']} missed={r['misses'] or '-'} side_unclear={r['unclear']} quote_dropped={r['dropped']}")
        for s in r["severe"]:
            print("         ", s)
        if r["severe"] or r["misses"]:
            for side, d in r["rows"]:
                print(f"          got: [{side}] {d}")
    print(f"\n{which}: {totals['cases']} cases, severe errors {totals['severe']}, "
          f"recall {totals['found']}/{totals['required']}, side left unclear {totals['unclear']}, rows dropped for a bad quote {totals['dropped']}")
    return 0 if totals["severe"] == 0 else 1


if __name__ == "__main__":
    args = sys.argv[1:]
    if args[:1] == ["dump"]:
        DUMP_DIR = args[1]
        main("all")
        print(f"prompts written to {DUMP_DIR}")
        sys.exit(0)
    if args[:1] == ["score"]:
        REPLY_DIR = args[1]
        sys.exit(main(args[2] if len(args) > 2 else "all"))
    sys.exit(main(args[0] if args else "all"))
