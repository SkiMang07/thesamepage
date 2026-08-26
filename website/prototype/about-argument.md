# About page argument

The case the About page makes, in order, before any pixels exist. Companion to
`homepage-argument.md` — same format, same voice rules.

Sources: `homepage-argument.md` (locked copy system, founder framing decisions),
`positioning-source.md`, `theme/modules/founder.module` (the existing short quote).

---

## The decision this rests on

**Scope, decided 2026-08-25: founder note only.** No team section (there is no
team to show), no separate mission/why section, no stats band. The homepage
already carries the mission line ("everyone on the same page...") and the proof
stats — repeating either here would spend the same material twice for a visitor
who just came from the homepage. What the About page adds that the homepage
doesn't have room for is *space*: the founder's short homepage quote, said at
length.

Three sections, in order: a one-line frame, the founder story, the standard
site-wide close. That's it. Small, honest, and cheap to build — it composes
entirely from modules the theme already has (`hero` in a stripped-down form,
`founder`, `close-cta`).

## Section 1 — Frame

**Job:** tell the visitor what kind of "About" this is before they scroll —
not a company timeline, not a team grid. One person built this, and the page
says so immediately rather than making the visitor discover it.

| Slot | Line |
|---|---|
| Eyebrow | About |
| H1 | Built by someone who needed it. |
| Sub-headline | The Same Page exists because managing a team without a written standard is guesswork — and guesswork is what we're here to end. |

No CTA button in this section — the page's only ask is at the close, after the
story has been read. No hero figure (bar chart), no counter. This is a lighter
module than the homepage hero: heading + sub-headline, centered, no grid.

**Why "we're" in the sub-headline but "I" in the founder story below.**
Company-level copy (the sub-headline, the contact page, form microcopy) uses
"we" as the standing brand voice, the same way it will once there's a team.
The founder section switches to first person deliberately — it's a named
person's account, not brand copy, and pretending otherwise would undercut the
honesty the founding-cohort framing depends on.

## Section 2 — Founder story

**Job:** say, at paragraph length, what the homepage's founder module says in
two sentences. Same voice: confident and even, no self-pity, no hand-holding.
Extends `theme/modules/founder.module`'s existing quote rather than replacing
it — the homepage keeps its short version, this is the long cut.

Draft copy:

> I built this because I needed it. I was managing a team, doing the work
> twice — running the actual job, then reconstructing the story of it from
> memory every time someone asked how my people were doing.
>
> Every tool I looked at was built for the same buyer: an HR team running a
> review cycle. None of it was built for a manager trying to get through a
> normal Tuesday — for the ten minutes before a 1:1 when you're trying to
> remember what actually happened last month.
>
> So I'm building the tool I wanted: one place where the standard is written
> down, the evidence collects itself, and you always know where someone
> stands. It's early. The first members are shaping what gets built next —
> that's the honest position, and I'd rather say it than dress this up as
> more finished than it is.

Signature: **Andrew Godlewski** · Founder. Photo, same treatment as the
homepage founder card, just larger — this section carries the whole page.

**Flagged, not filled in:** this draft stays general on purpose — it doesn't
invent a company name, an industry, a team size, or a number of years, because
none of those are in the source material. If you want the page to carry real
specifics (where you were managing, how long, what the team did), that
belongs in paragraph one — say the word and I'll fold it in. Left general, it
reads honest but slightly abstract; real specifics would make it land harder.

## Section 3 — Close

**Job:** the same ask as everywhere else on the site. Reuses the locked
site-wide close line verbatim — this is the "Close" slot in the homepage's
locked copy table, deliberately identical everywhere it appears.

> Get on the same page. Stay there.

Same CTA (**Start free**), same founding-counter treatment as the homepage
close. If the counter's real number changes, it changes in one place
(`close-cta.module`'s fields) and every page holding that module updates
together.

---

## SEO

- **Title tag:** `About — The Same Page`
- **Meta description:** "The Same Page was built by a manager who needed it —
  one place to define what good looks like, capture evidence, and know where
  every person stands." (149 characters)
- **H1** ("Built by someone who needed it.") is intentionally different from
  the title tag rather than a repeat of it — standard practice, and it gives
  Google two distinct strings instead of one.
- No image alt text to write yet beyond the founder photo — `{{ module.photo.alt }}`
  already exists as a field on `founder.module`; set it to something like
  "Andrew Godlewski, founder of The Same Page" when the real photo goes in.

## Open questions

- **Founder photo.** Still blocked on the same demo-data session noted in
  `docs/build-process.md`'s "Then" list. The prototype ships with the same
  placeholder avatar treatment as the homepage until it exists.
- **Real biographical specifics** — see the flag in Section 2. Andrew's call.
- Nothing else is open. This page is intentionally the smallest of the set.
