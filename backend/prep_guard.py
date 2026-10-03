"""
The prep sheet's report-facing guard (2026-10-03, Jamal round 3).

A prep sheet holds two kinds of text. The summary, each item's rationale and
`from_your_notes` are addressed to the manager. `suggested_questions` are lines
the manager may say aloud to the report, and when the employee view ships they
are what the report may read. The manager's notes are full of context that is
theirs alone: what HR or their boss wants, a decision that isn't made, another
person on the team, a guess about someone's life outside work, their own doubts.

Jamal wrote "HR wants documentation." The sheet handed back "I want you to know
HR has asked me to start documenting performance here" as a line to say to
Brennan. The prompt now asks the model not to do that. This module makes sure
it can't happen anyway, without the model deciding anything:

1. HOLD, never drop. A suggested line that names HR, the manager's boss or
   leadership, another person on the roster, a performance process, a pending
   decision, an org change, a comparison with others, personal life the notes
   don't mention, or the manager's own state is moved out of
   `suggested_questions` into the item's `held` list with a plain reason. The
   manager sees every held line on the sheet and decides whether to say it.
   Nothing the model wrote disappears (Andrew, 2026-10-03: the AI does not
   scrub; the manager is responsible for what goes on the sheet).
2. FLAG claims the record doesn't make. In any sentence that mentions HR or
   leadership, an escalation word ("asked", "flagged", "start documenting")
   that never appears in what was given to the model is listed in the item's
   `unsupported` so the sheet can say "Not in your notes: asked".
3. AUDIENCE. Every item is stored with `audience: "manager"`. Only the fields in
   SHAREABLE_FIELDS could ever be shown to the report, and only once the manager
   chooses to share. A sheet saved without the field is manager-only.

Deliberately lexical and narrow. It does not read tone ("given the numbers",
"What's actually going on?"); that stays a prompt rule. Pure, no model, no
database.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from private_lane import discloses_self_state

SHAREABLE_FIELDS = ("title", "suggested_questions")
DEFAULT_AUDIENCE = "manager"


@dataclass
class GuardContext:
    """What the guard needs to know: who the sheet is about, who else is on the
    roster, and every piece of record text the model was given."""
    report_name: str = ""
    others: list[str] = field(default_factory=list)
    source: str = ""

    @classmethod
    def from_dict(cls, d: dict | None) -> "GuardContext":
        d = d or {}
        return cls(
            report_name=str(d.get("report_name") or ""),
            others=[str(n) for n in (d.get("others") or []) if n],
            source=str(d.get("source") or ""),
        )

    def to_dict(self) -> dict:
        return {"report_name": self.report_name, "others": self.others, "source": self.source}


def _rx(*parts: str, flags=re.IGNORECASE) -> re.Pattern:
    return re.compile("|".join(parts), flags)


_HR = [re.compile(r"\bHR(?:BP)?s?\b"), _rx(
    r"\bhuman\s+resources\b", r"\bpeople\s+(?:team|ops|operations|partner)\b",
    r"\bemployee\s+relations\b", r"\blegal\s+(?:team|department)\b", r"\blawyers?\b",
)]
_LEADERSHIP = [_rx(
    r"\bmy\s+(?:own\s+)?(?:boss|manager|director|vp|skip[- ]?level|leadership|higher[- ]ups?)\b",
    r"\b(?:leadership|upper\s+management|senior\s+management|exec(?:utive)?\s+team|the\s+execs?\b|"
    r"skip[- ]?level|higher[- ]ups?|the\s+(?:ceo|cfo|coo|cro|founders?|board))\b",
)]
_PERFORMANCE_PROCESS = [_rx(
    r"\bPIP\b", r"\bperformance\s+(?:improvement\s+)?plan\b",
    r"\b(?:written|final|formal)\s+warning\b",
    r"\bdocument(?:ing|ed|ation)?\b[^.?!]{0,40}\bperformance\b",
    r"\bperformance\b[^.?!]{0,40}\bdocument(?:ing|ed|ation)?\b",
    r"\bon\s+paper\b", r"\bpaper\s+trail\b",
)]
_ORG_CHANGE = [_rx(
    r"\blay\s*offs?\b", r"\blaid\s+off\b", r"\blet\s+(?:you\s+|him\s+|her\s+|them\s+|people\s+)?go\b",
    r"\bterminat\w+", r"\bfir(?:ed|ing)\b", r"\bre-?org\w*", r"\brestructur\w+",
    r"\bheadcount\b", r"\bredundan\w+", r"\bcuts\b",
)]
# Only held when said as a statement: "Are you interested in a promotion
# path?" is an ordinary career question; "Your promotion is on hold" is a
# decision told before it's made.
_PENDING_DECISION = [_rx(
    r"\bpromot\w+", r"\braises?\b", r"\bpay\s+(?:rise|increase|bump|review)\b",
    r"\bcomp(?:ensation)?\b", r"\bsalar\w+", r"\bbonus\w*", r"\bequity\b", r"\btitle\s+change\b",
)]
_COMPARISON = [_rx(
    r"\bcompared\s+(?:to|with)\b",
    r"\b(?:than|like)\s+(?:the\s+rest\s+of\s+the\s+team|everyone\s+else|your\s+peers|the\s+others|"
    r"others\s+on\s+the\s+team|the\s+other\s+(?:reps|aes|engineers|people))\b",
    r"\b(?:the\s+rest\s+of\s+the\s+team|everyone\s+else|your\s+peers)\s+(?:is|are|has|have|hit|did)\b",
)]
_SELF_DOUBT = [_rx(
    r"\bI(?:'m|\s+am)\s+(?:not\s+sure|unsure)\s+(?:if\s+|whether\s+|that\s+)?I\b",
    r"\bI\s+(?:don't|do\s+not)\s+know\s+(?:if|whether)\s+I\b",
    r"\bI(?:'m|\s+am)\s+(?:still\s+)?new\s+(?:to|at)\s+(?:this|managing|management|being|leading)\b",
    r"\bI(?:'ve|\s+have)\s+never\s+(?:managed|done\s+this|had\s+to|led)\b",
    r"\bas\s+a\s+(?:new|first[- ]time)\s+manager\b",
    r"\bI\s+worry\s+(?:that\s+)?I\b",
    r"\bI(?:'m|\s+am)\s+(?:still\s+)?(?:figuring\s+out|learning)\s+(?:how\s+to\s+)?(?:manag|lead|do\s+this)",
)]
# Held only when the notes and record never raise it: "How is your dad
# doing?" is fine when the manager wrote that his dad is sick.
_PERSONAL = re.compile(
    r"\b(home|family|families|kids?|child(?:ren)?|wife|husband|partner|spouse|divorce\w*|marriage|married|"
    r"pregnan\w+|baby|babies|health|sick|illness|ill|medical|doctor|therapy|therapist|mental|drinking|"
    r"personal\s+life|outside\s+(?:of\s+)?work|going\s+on\s+at\s+home|parents?|mom|dad|mother|father)\b",
    re.IGNORECASE,
)

REASONS = {
    "hr": "Mentions HR.",
    "leadership": "Mentions your boss or leadership.",
    "roster": "Names {name}, someone else on your team.",
    "performance_process": "Raises a performance process (documentation, a plan, a warning).",
    "org_change": "Raises a reorg, layoffs or someone's job.",
    "pending_decision": "Tells them about a decision that isn't theirs to know yet (promotion, pay).",
    "comparison": "Compares them with other people.",
    "personal_life": "Raises their life outside work, which your notes don't mention.",
    "self_state": "Shares your own feelings or doubts from your notes.",
}

# Escalation words: in a sentence about HR or leadership, each must appear in
# the record the model was given, or the sheet says it isn't in your notes.
_THIRD_PARTY = _HR + _LEADERSHIP
_ESCALATION_PHRASES = ("start documenting", "begin documenting", "started documenting")
_ESCALATION_WORDS = frozenset(
    "asked asking requested requesting require requires required flagged flagging escalated escalating "
    "documented documenting formal formally warning warned pip decided approved mandated insisted told "
    "informed notified investigating investigation complaint complained concerned concerns".split()
)


def _any(patterns: list[re.Pattern], text: str) -> bool:
    return any(p.search(text) for p in patterns)


def _norm(s: str) -> str:
    return " ".join(re.sub(r"[^\w\s]", " ", (s or "").replace("’", "'").casefold()).split())


def _sentences(text: str) -> list[str]:
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+", (text or "").strip()) if s.strip()]


def _first(name: str) -> str:
    return (name.strip().split() or [""])[0]


def _names(line: str, name: str) -> bool:
    return bool(name) and re.search(rf"(?<!\w){re.escape(name)}(?!\w)", line, re.IGNORECASE) is not None


def named_other(line: str, ctx: GuardContext) -> str | None:
    """The other roster person a line names. A first name shared with the
    report (or with a third person) counts only as a full-name match — the
    same rule capture-by-person uses (routes/person_intake.mentioned_other)."""
    this_first = _first(ctx.report_name).casefold()
    firsts = [_first(n).casefold() for n in ctx.others] + [this_first]
    for full in ctx.others:
        first = _first(full)
        shared = first.casefold() == this_first or firsts.count(first.casefold()) > 1
        if _names(line, full.strip()) or (not shared and _names(line, first)):
            return full.strip()
    return None


_BOSS_ROLE = r"(?:[Bb]oss|[Mm]anager|[Dd]irector|VP|[Ss]kip[- ]?level|CEO|CRO|COO|CFO|[Hh]ead\s+of\s+\w+)"
_BOSS_NAMED = [
    # "my boss Priya", "my manager, Priya", "my VP (Priya)"
    re.compile(r"\b[Mm]y\s+" + _BOSS_ROLE + r"\s*,?\s*\(?([A-Z][a-z]+)"),
    # "Priya (my boss)", "Priya, my manager", "Priya - my VP"
    re.compile(r"\b([A-Z][a-z]+)\s*(?:\(|,|-|–|—)\s*my\s+" + _BOSS_ROLE),
]


def leadership_names(source: str) -> set[str]:
    """First names the record itself tags as the manager's boss or leadership
    ("Priya (my boss)", "my manager Gwen"). Pure."""
    names: set[str] = set()
    for rx in _BOSS_NAMED:
        for m in rx.finditer(source or ""):
            names.add(m.group(m.lastindex))
    return names


def hold_reason(line: str, ctx: GuardContext) -> dict | None:
    """Why a suggested line is held for the manager, or None if the report can
    hear it. One reason, the first that applies. Pure."""
    text = (line or "").replace("’", "'")
    if _any(_HR, text):
        return {"reason": "hr", "label": REASONS["hr"]}
    if _any(_LEADERSHIP, text) or any(_names(text, n) for n in leadership_names(ctx.source)):
        return {"reason": "leadership", "label": REASONS["leadership"]}
    other = named_other(text, ctx)
    if other:
        return {"reason": "roster", "label": REASONS["roster"].format(name=_first(other))}
    if _any(_PERFORMANCE_PROCESS, text):
        return {"reason": "performance_process", "label": REASONS["performance_process"]}
    if _any(_ORG_CHANGE, text):
        return {"reason": "org_change", "label": REASONS["org_change"]}
    if any(_any(_PENDING_DECISION, s) and not s.rstrip().endswith("?") for s in _sentences(text)):
        return {"reason": "pending_decision", "label": REASONS["pending_decision"]}
    if _any(_COMPARISON, text):
        return {"reason": "comparison", "label": REASONS["comparison"]}
    source = _norm(ctx.source)
    for m in _PERSONAL.finditer(text):
        if f" {_norm(m.group(0))} " not in f" {source} ":
            return {"reason": "personal_life", "label": REASONS["personal_life"]}
    if discloses_self_state(text) or _any(_SELF_DOUBT, text):
        return {"reason": "self_state", "label": REASONS["self_state"]}
    return None


def unsupported_words(text: str, source: str) -> list[str]:
    """Escalation words in sentences about HR or leadership that the record
    never uses. Empty when there is no record to check against. Pure."""
    if not (source or "").strip():
        return []
    src = f" {_norm(source)} "
    found: list[str] = []
    for s in _sentences(text):
        if not _any(_THIRD_PARTY, s.replace("’", "'")):
            continue
        ns = f" {_norm(s)} "
        for phrase in _ESCALATION_PHRASES:
            if f" {phrase} " in ns and f" {phrase} " not in src and phrase not in found:
                found.append(phrase)
        for w in ns.split():
            if w in _ESCALATION_WORDS and f" {w} " not in src and w not in found \
                    and not any(w in p.split() for p in found):
                found.append(w)
    return found


def guard_item(item: dict, ctx: GuardContext) -> dict:
    """One agenda item with report-facing lines split into kept and held,
    unsupported claims listed, and the audience set. Pure."""
    kept, held = [], []
    for q in item.get("suggested_questions") or []:
        why = hold_reason(q, ctx)
        if why:
            held.append({"line": q, **why})
        else:
            kept.append(q)
    unsupported = []
    for fld in ("rationale", "from_your_notes"):
        words = unsupported_words(item.get(fld) or "", ctx.source)
        if words:
            unsupported.append({"field": fld, "words": words})
    line_words: list[str] = []
    for q in (item.get("suggested_questions") or []):
        for w in unsupported_words(q, ctx.source):
            if w not in line_words:
                line_words.append(w)
    if line_words:
        unsupported.append({"field": "suggested_questions", "words": line_words})
    return {
        **item,
        "suggested_questions": kept,
        "held": held,
        "unsupported": unsupported,
        "audience": DEFAULT_AUDIENCE,
    }
