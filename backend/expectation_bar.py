"""Reading a role's bar for one measured expectation, and comparing a reading
with it. Pure functions, no I/O. See docs/systems/goals.md -> From their role.

An approved metric target is text in the manager's or the job description's
words ("8 hours", "92% or above", "at or below 8 hours"), never a structured
number. This reads it only when it is unambiguous: exactly one number in the
target, and a direction stated in the target or the meets wording. Anything
else returns None and the page shows the reading beside the bar with no
verdict. A verdict is a factual line about a recorded reading; it never sets a
status.
"""
from __future__ import annotations

import re
from typing import Literal

Direction = Literal["at_least", "at_most"]

_NUMBER = re.compile(r"(?<![\w.])[-+]?\d+(?:,\d{3})*(?:\.\d+)?")

# Order matters: "at or below" before "below", etc. Each phrase is matched as
# whole words on lower-cased text.
_AT_MOST = (
    "at or below", "or below", "or less", "or fewer", "or under", "no more than", "not more than",
    "at most", "maximum of", "max of", "under", "below", "less than", "fewer than", "within",
    "≤", "<=", "<",
)
_AT_LEAST = (
    "at or above", "or above", "or more", "or higher", "or better", "no less than", "not less than",
    "at least", "minimum of", "min of", "above", "over", "more than", "greater than",
    "≥", ">=", ">",
)


def _numbers(text: str) -> list[float]:
    return [float(m.group(0).replace(",", "")) for m in _NUMBER.finditer(text)]


def _has(text: str, phrase: str) -> bool:
    if phrase[0].isalpha():
        return re.search(r"(?<![a-z])" + re.escape(phrase) + r"(?![a-z])", text) is not None
    return phrase in text


def _direction(text: str) -> Direction | None:
    t = text.lower()
    low = any(_has(t, p) for p in _AT_MOST)
    high = any(_has(t, p) for p in _AT_LEAST)
    if low == high:
        return None
    return "at_most" if low else "at_least"


def parse_bar(target: str | None, expectation: str | None = None) -> dict | None:
    """{value, direction} when the target states one number and a direction
    can be read from it (or, failing that, from the meets wording)."""
    if not target or not target.strip():
        return None
    nums = _numbers(target)
    if len(nums) != 1:
        return None
    direction = _direction(target)
    if direction is None and expectation:
        # The meets wording may carry the direction ("Median resolution at or
        # below the target"), but only if it names no other number.
        others = [n for n in _numbers(expectation) if n != nums[0]]
        if not others:
            direction = _direction(expectation)
    if direction is None:
        return None
    return {"value": nums[0], "direction": direction}


def verdict(value: float | None, bar: dict | None) -> Literal["meets", "below"] | None:
    """"meets" or "below" (the bar) for a recorded reading, or None."""
    if value is None or bar is None:
        return None
    if bar["direction"] == "at_least":
        return "meets" if value >= bar["value"] else "below"
    return "meets" if value <= bar["value"] else "below"
