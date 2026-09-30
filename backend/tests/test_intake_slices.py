"""Per-person slices of a batch input (Build 3a). The slice is the only corpus a
role's draft sees, so these tests are about who gets which sentence — and above
all that one person's numbers never reach another person's slice."""
from intake_slices import MAX_SLICE, sentences, slice_by_person
from routes.role_expectations import numbers_in

# Fiction: business/digital-customers/personas/02-eng-manager-scaling/sessions/
# 2026-09-30-dana-spoken-monologue.md (gitignored, so copied here verbatim).
DANA = """Okay. The five without expectations. Andre first, because he's the one I keep replaying. Backend, mid-level, two years. What good looks like for him, I never wrote down. Two conversations, nothing on paper. I'd want a weekly written status from him. He sent two, then stopped. Last month. And consistent delivery, I guess. That's the actual thing.

Kwame. Junior, eight months. Remote onboarding. I said at his 90-day mark I'd write him a growth plan. Still a bullet point in my head. So, growth plan, mine. His side is, ask questions early, don't sit on a blocker. He needs a lot of coaching. Weekly 1:1, thirty minutes.

Lena. Senior platform, SRE. Six hours ahead. Only remote one. Biweekly, mostly async. Honestly I don't know what she's working on until something breaks. I owe her quarterly priorities. Asked two weeks ago, waiting on her. What I'd want from her, visibility. Tell me before it breaks.

Mei. Senior full-stack. Three years. Was my peer. Applied for the job. Design doc feedback, I owe her, three weeks now. And the meets versus exceeds talk after calibration. Not raised. For her role, owning design docs, reviewing others' work. Hold the senior bar. I avoid this one. Write that down.

Sofia. Frontend, mid-level, year and a half. Steady. Low maintenance. Her 1:1 gets moved. Often. Career goals, I never actually asked. Open by omission. Expectations for her, I'd say solid delivery, and I should ask her what she wants next. Weekly 1:1, thirty minutes, when it happens.

That's it. Tomás is done already."""

ROSTER = [
    {"id": "andre", "name": "Andre Okafor"},
    {"id": "kwame", "name": "Kwame Mensah"},
    {"id": "lena", "name": "Lena Fischer"},
    {"id": "mei", "name": "Mei Tanaka"},
    {"id": "sofia", "name": "Sofia Reyes"},
    {"id": "tomas", "name": "Tomás Silva"},
]


def test_each_person_gets_their_own_paragraph_verbatim():
    s = slice_by_person(DANA, ROSTER)
    assert s["andre"].startswith("Andre first, because")
    assert s["andre"].endswith("That's the actual thing.")
    assert s["kwame"].startswith("Kwame. Junior, eight months.")
    assert "90-day mark" in s["kwame"]
    assert s["lena"].endswith("Tell me before it breaks.")
    assert s["mei"].startswith("Mei. Senior full-stack.")
    assert s["sofia"].endswith("Weekly 1:1, thirty minutes, when it happens.")
    for text in s.values():
        assert text in DANA  # verbatim, one contiguous run each here


def test_preamble_and_closing_belong_to_no_one():
    s = slice_by_person(DANA, ROSTER)
    everything = "\n".join(s.values())
    assert "The five without expectations" not in everything  # "five" would leak to all
    assert "That's it." not in everything
    assert s["tomas"] == "Tomás is done already."


def test_no_number_crosses_from_one_person_to_another():
    s = slice_by_person(DANA, ROSTER)
    nums = {k: numbers_in(v) for k, v in s.items()}
    assert "90" in nums["kwame"] and "8" in nums["kwame"]
    assert "90" not in nums["andre"] and "8" not in nums["andre"]
    assert "6" in nums["lena"] and "6" not in nums["mei"]
    assert "3" in nums["mei"]
    for who in ("andre", "kwame", "lena", "sofia"):
        assert "3" not in nums[who], who
    assert "5" not in set().union(*nums.values())


def test_want_limits_the_result_but_everyone_still_ends_a_run():
    text = "Andre owns the release train, weekly. Mei has been out. She ships 4 docs a quarter."
    s = slice_by_person(text, ROSTER, want={"andre"})
    assert set(s) == {"andre"}
    assert "4 docs" not in s["andre"]


def test_someone_not_on_the_roster_ends_the_run():
    text = "Sofia keeps delivery steady. Priya starts Monday. She will own 12 services."
    # Unknown to the slicer, Priya reads as more about Sofia: the known limit,
    # and why the parse hands its unmatched_people over as `others`.
    assert "12" in slice_by_person(text, ROSTER)["sofia"]
    s = slice_by_person(text, ROSTER, others=["Priya Nair"])
    assert s["sofia"] == "Sofia keeps delivery steady."


def test_a_sentence_naming_two_people_goes_to_both_and_ends_the_run():
    text = "Andre and Mei both own on-call. Weekly handover, 2 pages max. Kwame is new."
    s = slice_by_person(text, ROSTER)
    assert s["andre"] == "Andre and Mei both own on-call."
    assert s["mei"] == "Andre and Mei both own on-call."
    assert "2 pages" not in s["andre"] and "2 pages" not in s["mei"]


def test_tangled_backtracking_does_not_cross_contaminate():
    # The scoping doc's open risk: a manager who comes back to someone.
    text = ("Andre, weekly written status. Kwame, 90-day plan, and ask early. "
            "Actually, same for Lena. She owes me 3 postmortems a quarter. "
            "Back to Andre, he should review 5 PRs a week.")
    s = slice_by_person(text, ROSTER)
    assert s["andre"] == "Andre, weekly written status.\n\nBack to Andre, he should review 5 PRs a week."
    assert s["lena"] == "Actually, same for Lena. She owes me 3 postmortems a quarter."
    assert "90" not in numbers_in(s["lena"])
    assert "3" not in numbers_in(s["andre"]) and "3" not in numbers_in(s["kwame"])
    # Separate runs never join into one line a quote could straddle.
    assert "status. Back" not in s["andre"]


def test_paragraph_break_stops_carry_forward_but_a_heading_carries():
    text = "Andre ships weekly.\n\nThe team hit 40 deploys.\n\nKwame\n\nAsk early. Pair twice a week."
    s = slice_by_person(text, ROSTER)
    assert s["andre"] == "Andre ships weekly."
    assert s["kwame"] == "Kwame\n\nAsk early. Pair twice a week."
    s = slice_by_person("Kwame:\n\nAsk early.\n\nLena ships.", ROSTER)
    assert s["kwame"] == "Kwame:\n\nAsk early."


def test_first_name_shared_by_two_people_needs_the_full_name():
    roster = [{"id": "a1", "name": "Alex Park"}, {"id": "a2", "name": "Alex Moreno"}]
    s = slice_by_person("Alex owns billing, 3 releases. Alex Park owns search.", roster)
    assert s == {"a1": "Alex Park owns search."}


def test_names_match_case_and_accent_but_not_common_words():
    roster = [{"id": "w", "name": "Will Harper"}, {"id": "t", "name": "Tomás Silva"}]
    s = slice_by_person("Tomas owns releases. I will ask about 7 things.", roster)
    assert "w" not in s
    assert s["t"] == "Tomas owns releases. I will ask about 7 things."


def test_decimals_and_ratios_do_not_split_sentences():
    spans = sentences("Keep 99.5% uptime. Weekly 1:1, thirty minutes.")
    assert len(spans) == 2


def test_long_slices_are_cut_at_a_sentence_end():
    text = "Andre. " + "He ships a steady release every week. " * 1000
    out = slice_by_person(text, ROSTER)["andre"]
    assert len(out) <= MAX_SLICE and out.endswith(".")


def test_empty_input_and_no_names():
    assert slice_by_person("", ROSTER) == {}
    assert slice_by_person("Everyone should write docs.", ROSTER) == {}


def test_a_pronoun_led_sentence_naming_someone_else_goes_to_no_one():
    # Found in a live run: Kwame's sentence named Andre as an object and was
    # handed to Andre, taking Kwame's "twice a week" with it.
    text = ("Andre, weekly written status. Kwame is junior. He should ask questions early and pair with "
            "Andre twice a week. He's also on call 3 nights a month. Back to Andre: review two PRs a day.")
    s = slice_by_person(text, ROSTER)
    assert s["andre"] == "Andre, weekly written status.\n\nBack to Andre: review two PRs a day."
    assert s["kwame"] == "Kwame is junior.\n\nHe's also on call 3 nights a month."
    assert "twice" not in s["andre"] and "twice" not in s["kwame"]
    # Without a run going, a name still starts one, pronoun or not.
    assert slice_by_person("She reports to Mei now.", ROSTER) == {"mei": "She reports to Mei now."}
