"""
Sentence placement for the batch intake review (2026-10-01, round 3 personas).

Three leaks survived the lane guards (intake_slices, private_lane): a person's
role draft was still cut from a slice of the paste and then filtered by how the
manager happened to word things. Dana's "he did twice and then he just
stopped", Jamal's "I joined two. That's rescuing, not coaching" and the orphan
"Stopped." all got through. Jamal's "Gwen needs a written summary on Brennan
for HR" was filed as something owed to Brennan, and Andre's, Ignacio's and
Mei's promises had no row at all.

The fix changes who decides. A role draft reads only sentences tagged "About
the role", and a sentence is tagged by a row that cites it (or by the manager,
on the review screen), never by what is left over after filtering. A pasted
sentence no row cites is listed as unplaced, with the same lane and person
choices, so nothing the manager said is silently dropped.

What lives here, all pure (no model, no database):

  - role_sentences: the sentences of a person's slice that a role row's
    evidence points at, minus anything another row cites, any lapse, any
    manager-side line and any private admission. Defaults only: the manager
    can retag on the review screen.
  - verbatim_sentences: the sentences of the typed text that a client says are
    tagged, cut from the text itself, so a draft's stored context is always the
    manager's own words and a quote can never resolve against anything else.
  - cited_sentences: the sentences a row's excerpt covers, for moving a row to a lane.
  - unplaced_sentences: every sentence of the typed text that no shown row cites,
    with the person it names, when it names exactly one.
"""
from __future__ import annotations

import re

from intake_slices import (
    _LAPSE, _MIN_CITE, _OTHER, _THEIRS, _fold, _is_heading, _name_patterns, _named, _plain, manager_side, norm, sentences,
)

# A sentence the manager says about themselves ("I joined two. That's rescuing,
# not coaching.", "My worry is ..."), unless it also states what they expect of
# the person (_THEIRS: "I'd want a weekly status from him"). It is not a line
# about the role, whatever a model thinks, so it is never tagged one by default.
_COMMENT = re.compile(r"^[\"'\u201c\u2018(]*(?:that|this|it)(?:'s|\s+is|\s+was)\b", re.IGNORECASE)
_MANAGER_LED = re.compile(r"^[\"'\u201c\u2018(]*(?:(?:and|but|so|also|then)[, ]+)?(?:I\b|my\b)", re.IGNORECASE)

MAX_ROLE_SENTENCES = 12
MAX_UNPLACED = 60
_MIN_WORDS = 2  # "Stopped." and "Mei." are fragments, not something to place


def quotes_of(texts: list[str | None]) -> list[str]:
    """Normalised quotes long enough to mean something."""
    return [c for c in (norm(t or "") for t in texts) if len(c) >= _MIN_CITE]


def is_cited(sentence: str, cites: list[str]) -> bool:
    """A cite covers a sentence when the sentence sits inside it (a quote that
    runs across several fragments) or it sits inside the sentence (an excerpt
    of part of it). Words only, so quotes and whitespace never decide."""
    n = norm(sentence)
    if len(n.split()) < _MIN_WORDS:
        return False
    return any(n in c or c in n for c in cites)


def cites_of_rows(rows: list[dict], *fields: str) -> list[str]:
    return quotes_of([r.get(f) for r in rows for f in fields])


def role_sentences(piece: str | None, evidence: list[str], other_cites: list[str]) -> list[str]:
    """The default "About the role" sentences for one person: sentences of
    their slice that their role row's evidence names, verbatim, in the order
    the manager said them. Never one that

      - another row cites (a promise or a kept thought is not a role line),
      - says what happened rather than what is expected (a lapse),
      - is the manager's own side or a private admission (manager_side), or
        is the manager talking about themselves ("I joined two ...").

    A sentence that states something of the report ("I'd want a weekly status
    from him") is never manager-side (manager_side checks), so it stays."""
    text = piece or ""
    own = quotes_of(evidence)
    if not text.strip() or not own:
        return []
    out: list[str] = []
    seen: set[str] = set()
    led_para = None  # the paragraph of the manager-led sentence just before
    for s, e, para in sentences(text):
        sentence = text[s:e].strip()
        plain = _plain(sentence)
        # "I joined two." and the comment that follows it ("That's rescuing,
        # not coaching.") are the manager's, not the role's.
        theirs = bool(_THEIRS.search(plain))
        led = not theirs and (bool(_MANAGER_LED.match(plain)) or (led_para == para and bool(_COMMENT.match(plain))))
        led_para = para if led else None
        n = norm(sentence)
        if led or not n or n in seen or not is_cited(sentence, own):
            continue
        if is_cited(sentence, other_cites):
            continue
        if _LAPSE.search(plain) or manager_side(sentence):
            continue
        seen.add(n)
        out.append(sentence)
        if len(out) >= MAX_ROLE_SENTENCES:
            break
    return out


def verbatim_sentences(text: str | None, wanted: list[str]) -> list[str]:
    """The tagged sentences, cut out of `text` itself. A wanted sentence that
    is not a sentence of the text (altered, invented, or from an attached file
    that is never kept) is dropped; the rest come back as the text has them.
    Order is the order asked for, each once."""
    body = text or ""
    if not body.strip() or not wanted:
        return []
    by_norm: dict[str, str] = {}
    for s, e, _ in sentences(body):
        sentence = body[s:e].strip()
        by_norm.setdefault(norm(sentence), sentence)
    out: list[str] = []
    for w in wanted:
        found = by_norm.get(norm(w))
        if found and found not in out:
            out.append(found)
    return out


def cited_sentences(typed: str | None, excerpt: str | None, limit: int = 4) -> list[str]:
    """The sentences of the typed text a row's excerpt covers, verbatim. This is
    what moving a promise or a kept thought to "About the role" tags: whole
    sentences of the manager's own words, never the model's rewording. Pure."""
    text = typed or ""
    cites = quotes_of([excerpt])
    if not text.strip() or not cites:
        return []
    out = [text[s:e].strip() for s, e, _ in sentences(text)]
    return [x for x in out if x and is_cited(x, cites)][:limit]


def name_guesser(people: list[dict], others: list[str] | None = None):
    """-> f(sentence) = the one roster person the sentence NAMES, else None.
    Only a name in the sentence itself counts. Who a bare "He ..." is about is
    left for the manager to say: a wrong person on a promise is exactly the
    Gwen-filed-under-Brennan mistake this screen exists to catch. Pure."""
    pats = _name_patterns(people, others or [])

    def guess(sentence: str) -> str | None:
        named = _named(_fold(sentence), pats)
        only = next(iter(named)) if len(named) == 1 else None
        return only if only and only != _OTHER else None

    return guess


def unplaced_sentences(typed: str | None, cites: list[str], guess=None,
                       *, limit: int = MAX_UNPLACED) -> tuple[list[dict], int]:
    """-> (sentences of the typed text no row cites, how many more there were).
    Headings ("Kwame:") and one-word fragments ("Stopped.") are not offered.
    Each carries `report_id`: the person it names, when it names exactly one
    (`guess`, from name_guesser), prefilled on a chip the manager can change.
    Pure."""
    text = typed or ""
    if not text.strip():
        return [], 0
    sents = sentences(text)
    found: list[dict] = []
    for i, (s, e, _) in enumerate(sents):
        sentence = text[s:e].strip()
        if not sentence or len(norm(sentence).split()) < _MIN_WORDS or _is_heading(sents, i, text):
            continue
        if is_cited(sentence, cites):
            continue
        found.append({"text": sentence, "report_id": guess(sentence) if guess else None})
    shown = found[:limit]
    for n, item in enumerate(shown, 1):
        item["key"] = f"u{n}"
    return shown, max(0, len(found) - limit)
