"""
The private lane (2026-10-01 Dana2 run, Mei's sheet).

Everything a manager types into the prep notes box, and every thought they
keep about a person, is private: the app says "only you see this". It is
context for the sheet, and the sheet is read by the manager. But the sheet also
carries suggested questions, lines the manager may say aloud to the report.
Dana wrote "I avoid the hard feedback with her more than with anyone" for her
own eyes; the sheet handed back "I've noticed I hold back on hard feedback with
you more than I do with others" as a line to say to Mei. The prep prompt asks
the model not to ("WHOSE LINE IS IT"), and it did anyway, so the rule is
enforced here, on the model's output, in code.

The rule: a suggested question never has the manager talking about their own
avoidance, dread or discomfort. It is the one shape a private admission takes
when it crosses the line, and it needs no knowledge of the notes: a model that
invents such a line is as wrong as one that copies it. The rationale and the
summary are addressed to the manager, so they may still say it.

Deliberately narrow: only the manager's own state about handling the person
("I avoid", "I hold back", "I'm nervous to raise this"), never their account of
a promise ("I haven't sent it"), their worry about the work, or an ordinary
"I want to give you a status". Pure, no model, no database.
"""
from __future__ import annotations

import re

_ADVERB = r"(?:(?:still|always|often|really|just|kind\s+of|also|actually)\s+)?"
_SELF_STATE = re.compile(
    "|".join([
        # "I avoid ...", "I've been holding back", "I tend to soften"
        r"\bI(?:'ve|\s+have)?\s+(?:been\s+)?" + _ADVERB +
        r"(?:avoid\w*|dread\w*|resent\w*|soften\w*|dodg\w*|shy(?:ing)?\s+away|hold(?:ing)?\s+back|held\s+back|"
        r"putting\s+off|put\s+off|tiptoe\w*|walk\w*\s+on\s+eggshells)\b",
        r"\bI\s+(?:tend|keep|find\s+myself)\s+(?:to\s+|on\s+)?(?:avoid|hold|put|soften|shy|dodg|skirt|tiptoe)\w*",
        # "I'm nervous to raise this", "I feel awkward"
        r"\bI(?:'m|\s+am)\s+(?:\w+ly\s+|so\s+|a\s+bit\s+|kind\s+of\s+)?"
        r"(?:nervous|anxious|afraid|scared|uncomfortable|uneasy|embarrassed|ashamed|guilty|hesitant|reluctant)\b",
        r"\bI\s+(?:fear|dread|hesitate|feel\s+(?:bad|guilty|awkward|uneasy|uncomfortable|nervous|anxious))\b",
        # "I've noticed I ...", "I realize I ...", "I'll admit I ..."
        r"\bI(?:'ve|\s+have|'ll|\s+will)?\s+(?:noticed|realized|realised|admit|confess)\s+(?:that\s+)?I\b",
        r"\bmy\s+(?:own\s+)?(?:avoidance|reluctance|hesitation|discomfort|fear|anxiety)\b",
    ]),
    re.IGNORECASE,
)


def discloses_self_state(question: str) -> bool:
    """Whether a suggested question has the manager talking about their own
    avoidance or discomfort. Pure."""
    return bool(_SELF_STATE.search((question or "").replace("’", "'")))


def report_facing(questions: list[str]) -> list[str]:
    """The suggested questions the manager can safely say to the report: those
    that do not carry the manager's private state. Order kept. Pure.

    The prep sheet no longer filters with this: prep_guard.py holds such a
    line for the manager instead of dropping it."""
    return [q for q in questions if not discloses_self_state(q)]
