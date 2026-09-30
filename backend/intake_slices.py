"""
Per-person slices of one batch input (batch expectations intake, Build 3a;
docs/EXPECTATIONS_BATCH_INTAKE_SCOPING.md, "The corpus problem" and 2c).

One typed or spoken input describes several people. Each role drafted from it
must see only what the manager said about that person: the slice is stored on
the draft as analysis.context, and it is the ONLY context_text handed to
sanitize_composed(..., mode="description"). That makes both the allowed number
set and the quote-provenance check per person by construction. One flat corpus
would let Kwame's "90-day mark" validate a 90 in Andre's draft, silently.

Rules, all in code (no model call decides who a sentence is about):

  - The input is cut into sentences; a blank line starts a new paragraph.
  - A sentence that names exactly one person belongs to that person, and the
    sentences after it follow until someone else is named.
  - A sentence that names several people belongs to each of them, and nothing
    after it follows (we cannot tell whose it is).
  - A sentence that opens on a pronoun while someone's run is going, and names
    someone else, is about the current person with the other one as an object
    ("He should pair with Andre twice a week"). It goes to no one — giving it
    to either would hand one person's detail to the other — and the run goes on.
  - A paragraph break stops the carry-forward, except after a short heading
    paragraph that only names one person ("Andre" or "Andre:" then his notes).
  - Anyone named who is not being drafted (the rest of the roster, people the
    notes mention who are not on it) still ends the previous person's run.
    Someone who is on neither list cannot be recognised, which is why the
    parse's unmatched_people are passed in as `others`.

Every slice is verbatim text from the input: contiguous runs are cut straight
out of it, and separate runs are joined by a blank line so a quote can never
straddle two of them. When unsure, a sentence is left out rather than given to
the wrong person: a thin draft is visible, a contaminated one is not.

Pure: no database, no model. Tested in tests/test_intake_slices.py.
"""
from __future__ import annotations

import re
import unicodedata

MAX_SLICE = 20_000  # role_expectations._MAX_CONTEXT
_HEADING_WORDS = 8
_OTHER = "__other__"

_PARA_RE = re.compile(r"\n[ \t]*\n+")
_PRONOUN_LEAD = re.compile(
    r"^[\"'\u201c\u2018(]*(?:(?:and|but|so|also|then|plus)[, ]+)?"
    r"(?:he|she|they|him|her|his|hers|them|their|he's|she's|they're|he'll|she'll|they'll|he'd|she'd|they'd)\b",
    re.IGNORECASE,
)
# A sentence runs to terminal punctuation (plus any closing quote or bracket)
# followed by whitespace or the end of the line. "2.5" and "1:1" do not end one.
_SENT_RE = re.compile(r"\S.*?(?:[.!?…]+[\"'”’)\]]*(?=\s|$)|$)")


def _fold(s: str) -> str:
    """Accent-fold one character at a time, so offsets in the folded text are
    offsets in the original. "Tomás" and "Tomas" both match either spelling."""
    out = []
    for ch in s:
        base = unicodedata.normalize("NFKD", ch)[:1] or ch
        out.append(base)
    return "".join(out)


def sentences(text: str) -> list[tuple[int, int, int]]:
    """-> [(start, end, paragraph index)] over `text`, in order."""
    out: list[tuple[int, int, int]] = []
    para = 0
    pos = 0
    for block in _PARA_RE.split(text):
        start = text.find(block, pos)
        pos = start + len(block)
        if not block.strip():
            continue
        line_start = start
        for line in block.split("\n"):
            for m in _SENT_RE.finditer(line):
                s, e = line_start + m.start(), line_start + m.end()
                if text[s:e].strip():
                    out.append((s, e, para))
            line_start += len(line) + 1
        para += 1
    return out


def _name_patterns(people: list[dict], others: list[str]) -> list[tuple[str, re.Pattern]]:
    """(owner, pattern) pairs. A full name always matches its owner; a first
    name only when no one else in view shares it. Case-sensitive, because a
    name is capitalised and "will", "mark" or "may" are words."""
    entries: list[tuple[str, str]] = []
    for p in people:
        name = " ".join(_fold(p.get("name") or "").split())
        if name:
            entries.append((p["id"], name))
    for n in others:
        name = " ".join(_fold(n or "").split())
        if name:
            entries.append((_OTHER, name))
    firsts: dict[str, set[str]] = {}
    for owner, name in entries:
        firsts.setdefault(name.split(" ")[0], set()).add(owner if owner != _OTHER else f"{_OTHER}:{name}")
    pats: list[tuple[str, re.Pattern]] = []
    for owner, name in entries:
        forms = {name}
        first = name.split(" ")[0]
        if len(firsts.get(first, ())) == 1 and len(first) >= 2:
            forms.add(first)
        for form in sorted(forms, key=len, reverse=True):
            pats.append((owner, re.compile(r"(?<![\w'])" + re.escape(form) + r"(?![\w])")))
    return pats


def _named(sentence: str, pats: list[tuple[str, re.Pattern]]) -> set[str]:
    return {owner for owner, pat in pats if pat.search(sentence)}


def slice_by_person(text: str, people: list[dict], *, others: list[str] | None = None,
                    want: set[str] | None = None, limit: int = MAX_SLICE) -> dict[str, str]:
    """-> {person id: that person's verbatim slice of `text`}.

    people: every person in view ({"id", "name"}) — the whole roster, so anyone
            named ends the previous person's run, not only the ones drafted.
    others: names the notes mention that are not on the roster.
    want:   the ids to return (default: all). People with nothing get no key.
    """
    text = text or ""
    folded = _fold(text)
    pats = _name_patterns(people, others or [])
    sents = sentences(text)
    owned: dict[str, list[int]] = {}
    current: str | None = None
    carry_heading = False
    prev_para = None
    for i, (s, e, para) in enumerate(sents):
        if prev_para is not None and para != prev_para and not carry_heading:
            current = None
        carry_heading = False
        named = _named(folded[s:e], pats)
        if named and current and current not in named and _PRONOUN_LEAD.match(text[s:e].replace("\u2019", "'")):
            prev_para = para
            continue
        if named:
            for owner in named:
                if owner != _OTHER:
                    owned.setdefault(owner, []).append(i)
            current = next(iter(named)) if len(named) == 1 else None
            if current == _OTHER:
                current = None
            # A short paragraph that is only a name reads as a heading.
            if current and _is_heading(sents, i, text):
                carry_heading = True
        elif current:
            owned[current].append(i)
        prev_para = para

    out: dict[str, str] = {}
    for owner, idxs in owned.items():
        if want is not None and owner not in want:
            continue
        runs: list[str] = []
        run_start = run_end = None
        prev = None
        for i in idxs:
            s, e, _ = sents[i]
            if prev is not None and i == prev + 1 and sents[prev][2] == sents[i][2]:
                run_end = e
            else:
                if run_start is not None:
                    runs.append(text[run_start:run_end].strip())
                run_start, run_end = s, e
            prev = i
        if run_start is not None:
            runs.append(text[run_start:run_end].strip())
        joined = _cap("\n\n".join(r for r in runs if r), limit)
        if joined:
            out[owner] = joined
    return out


def _is_heading(sents: list[tuple[int, int, int]], i: int, text: str) -> bool:
    """Sentence i is the whole of its paragraph, a few words long, and not a
    finished sentence ("Kwame", "Kwame:", "Kwame (backend)")."""
    s, e, para = sents[i]
    alone = (i == 0 or sents[i - 1][2] != para) and (i + 1 == len(sents) or sents[i + 1][2] != para)
    words = text[s:e].strip()
    return alone and len(words.split()) <= _HEADING_WORDS and not re.search(r"[.!?\u2026][\"'\u201d\u2019)\]]*$", words)


def _cap(slice_text: str, limit: int) -> str:
    """Cut at the last sentence end that fits, never mid-sentence."""
    if len(slice_text) <= limit:
        return slice_text
    cut = slice_text[:limit]
    ends = [m.end() for m in re.finditer(r"[.!?…][\"'”’)\]]*(?=\s)", cut)]
    return cut[: ends[-1]].strip() if ends else cut.strip()


# ---------------------------------------------------------------------------
# Whose side a sentence is on (the 2026-09-30 Dana rerun).
#
# A slice is about one person, but not every sentence in it is something that
# person owes. "I owe her quarterly priorities" is the manager's commitment;
# "Weekly 1:1, thirty minutes" is the manager's meeting rhythm. Handed to the
# drafter, the first became "Quarterly priorities delivered", owned by Lena,
# and the second a measured "Weekly 1:1 attendance" target on Kwame. So those
# sentences are held back from the drafter in code: it never sees them, their
# numbers leave the allowed set (a target can't be built from them), and a
# quote from them can't resolve. They stay in the stored slice, which is the
# manager's own words, and the review row lists them as left out.
#
# Deliberately narrow. A sentence that also states something of the report
# ("I'd want a weekly written status from him", "his side is ...") is never
# held back: missing a manager-side sentence costs a line the manager deletes,
# holding back a real expectation costs one they never see.
# ---------------------------------------------------------------------------

_I = r"\bI"
_COMMITMENT = re.compile(
    "|".join([
        _I + r"\s+owe\b",
        _I + r"\s+(?:promised|committed|offered)\b",
        _I + r"\s+said\b[^.!?]*?\bI(?:'d|\s+would|'ll|\s+will)\b",
        _I + r"(?:'ll|\s+will|\s+need\s+to|\s+have\s+to|\s+should|\s+must|\s+ought\s+to|'ve\s+got\s+to|\s+still\s+have\s+to)"
             r"\s+(?:write|send|give|get|share|set|schedule|draft|book|do|finish|put|make|ask|raise|have|talk|sort|follow|find|figure)\b",
        _I + r"\s+(?:still\s+)?(?:haven't|have\s+not|never)\s+(?:written|sent|given|shared|set|scheduled|drafted|done|finished|asked|raised|had)\b",
        _I + r"'d\s+(?:write|send|give|get|share|set\s+up|schedule|draft|book|put\s+together)\s+(?:him|her|them)\b",
        r"(?<!\bof\s)\bmine\b",
        r"\bon\s+me\b",
        r"\bmy\s+(?:side|job|action|to-?do|homework)\b",
    ]),
    re.IGNORECASE,
)
# A plain promise, as opposed to a loose "I have to ask" or "that's on me". The
# held-back rule above is wide on purpose (missing a manager-side sentence costs
# a line the manager deletes), but a row proposed as a commitment is pre-checked,
# so the net that adds one when the model missed it only trusts these.
_PROMISE = re.compile(
    "|".join([
        _I + r"\s+owe\b",
        _I + r"\s+(?:promised|committed|offered)\b",
        _I + r"\s+said\b[^.!?]*?\bI(?:'d|\s+would|'ll|\s+will)\b",
        _I + r"'d\s+(?:write|send|give|get|share|set\s+up|schedule|draft|book|put\s+together)\s+(?:him|her|them)\b",
    ]),
    re.IGNORECASE,
)
_ONE_ON_ONE = re.compile(r"(?<![\w:])(?:1\s*[:\-–]\s*1s?|1\s*-?on-?\s*1s?|one[- ]on[- ]ones?)(?![\w:])", re.IGNORECASE)
_RHYTHM = re.compile(
    r"\b(?:weekly|bi-?weekly|fortnightly|monthly|daily|every\s+(?:other\s+)?\w+|(?:once|twice)\s+a\s+\w+|"
    r"minutes?|mins?|hours?|hrs?)\b",
    re.IGNORECASE,
)
# Something the report is expected to do or own. Any of these keeps a sentence.
_THEIRS = re.compile(
    "|".join([
        r"\b(?:he|she|they)\s+(?:should|needs?\s+to|has\s+to|have\s+to|must|owes?|ought\s+to)\b",
        _I + r"(?:'d|\s+would)?\s+(?:want|expect|need|like)\b[^.!?]*?\b(?:from\s+(?:him|her|them)|(?:him|her|them)\s+to)\b",
        r"\b(?:his|her|their)\s+side\b",
        # A sentence that names an expectation is about them even when it also
        # carries the manager's to-do ("Expectations for her, I'd say solid
        # delivery, and I should ask her what she wants next").
        r"\bexpect(?:s|ed|ing|ations?)?\b",
        r"\bwhat\s+good\s+looks\s+like\b",
        r"\bfor\s+(?:his|her|their)\s+role\b",
    ]),
    re.IGNORECASE,
)
# What follows a commitment and only continues it ("Still a bullet point in my
# head.", "Asked two weeks ago, waiting on her.").
_CONTINUES = re.compile(
    r"\b(?:still|asked|waiting|haven't|not\s+yet|in\s+my\s+head|overdue|weeks?\s+now|months?\s+now)\b",
    re.IGNORECASE,
)


def _plain(s: str) -> str:
    return s.replace("’", "'").replace("‘", "'")


def manager_side(sentence: str) -> str | None:
    """-> "commitment" (the manager owes it), "meeting" (the manager's 1:1
    rhythm) or None (keep it). Pure."""
    s = _plain(sentence)
    if _THEIRS.search(s):
        return None
    if _COMMITMENT.search(s):
        return "commitment"
    if _ONE_ON_ONE.search(s) and _RHYTHM.search(s):
        return "meeting"
    return None


def is_promise(sentence: str) -> bool:
    """A manager-side sentence that states a promise outright ("I owe her ...",
    "I said I'd write him a plan"), not a loose to-do or "that's on me". Pure."""
    return manager_side(sentence) == "commitment" and bool(_PROMISE.search(_plain(sentence)))


def for_drafting(slice_text: str | None) -> tuple[str, list[str]]:
    """-> (what the drafter reads, the sentences held back as the manager's).

    Verbatim, like the slice: kept runs are cut straight out of it, and runs a
    held-back sentence separates are joined by a blank line, so a quote can
    never straddle the gap."""
    text = slice_text or ""
    sents = sentences(text)
    held: list[int] = []
    prev_commitment = False
    prev_para = None
    for i, (s, e, para) in enumerate(sents):
        sentence = text[s:e]
        side = manager_side(sentence)
        if (side is None and prev_commitment and para == prev_para
                and _CONTINUES.search(_plain(sentence)) and not _THEIRS.search(_plain(sentence))
                and not _PRONOUN_LEAD.match(_plain(sentence))):
            side = "commitment"
        if side:
            held.append(i)
        prev_commitment = side == "commitment"
        prev_para = para
    if not held:
        return text.strip(), []
    runs: list[str] = []
    start = end = None
    prev = None
    for i, (s, e, para) in enumerate(sents):
        if i in held:
            if start is not None:
                runs.append(text[start:end].strip())
            start = end = prev = None
            continue
        if start is not None and prev is not None and sents[prev][2] == para:
            end = e
        else:
            if start is not None:
                runs.append(text[start:end].strip())
            start, end = s, e
        prev = i
    if start is not None:
        runs.append(text[start:end].strip())
    return "\n\n".join(r for r in runs if r), [text[sents[i][0]:sents[i][1]].strip() for i in held]


_STOP = frozenset(
    "the and for with from that this what when then than them they their his her him she he you your our "
    "are was were has have had not but all any can will would should about into just also only more most "
    "each very really like want wants need needs".split()
)


def _bigrams(text: str) -> set[tuple[str, str]]:
    words = [w for w in re.findall(r"[a-z0-9:]+", _plain(text).lower()) if len(w) >= 3 and w not in _STOP]
    return set(zip(words, words[1:]))


def echoes_held_back(sentence: str, held: list[str], kept: str) -> bool:
    """A line (the review row's statement) that repeats a pair of words found
    only in a held-back sentence is restating the manager's side, not theirs:
    "Provides quarterly priorities" after "I owe her quarterly priorities"."""
    if not held:
        return False
    only_held = _bigrams(" ".join(held)) - _bigrams(kept)
    return bool(_bigrams(sentence) & only_held) or manager_side(sentence) == "meeting"
