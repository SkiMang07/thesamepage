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
