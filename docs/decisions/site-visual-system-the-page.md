# The marketing site's look is The Page

**Status:** Implemented (homepage and contact page; About to follow)

## Context

The launch homepage (live 2026-09-27) read as flat and templated. A design
review measured why: every heading and paragraph was in the visitor's system
font, the H1 was smaller than four of the section headings, seven of eight
sections followed one recipe (label, big left heading, grey lede, white card in
a 1200px container), there were eight corner radii and six section grounds, and
the one picture of the product's core idea (manager and report aligned in a 1:1)
sat five screens down.

## Decision

Direction A from that review, "The Page": the site looks like the thing it is
named after, and the thing it replaces (a doc per person), done well. Newsreader
headlines; paper as a white sheet with a teal margin rule, used only for things
that are pages; only paper casts a shadow; three section grounds. The rules live
in `website/docs/build-process.md`, "The Page: the site's visual system".

## Rejected

- **Across the Table:** the 1:1 scene as the hero. Told the alignment story best,
  but bet the hero on the people-kit figures holding up at hero size and shrank
  the locked product picture.
- **Sharpen what's there:** an owned typeface and a real type scale on the same
  structure. Fastest, but kept the recipe that caused the problem.

## Consequences

- The homepage and contact page no longer share the ticking countdown card; the
  contact page shows a one-line day count like the homepage hero.
- The design rests on Newsreader loading from Google Fonts; the fallback is
  Georgia.
- The contact page's layout rule (one two-column grid aligned to the nav, sheets
  hanging their margin) came from a margin review and a "too constricted" review
  the same day; the narrow single-column version was tried and rejected.

## Reopen if

Outside visitors or early customers show the serif, paper look reads as a notes
app rather than management software, or a new page cannot be drawn inside it.
