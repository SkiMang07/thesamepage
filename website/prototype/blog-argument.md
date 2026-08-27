# The blog — the argument

Direction 04, **Field Guide**. Locked 2026-08-27. This file records why the two
pages are shaped the way they are, so a later session changes them on purpose.

## The constraint that decided the whole design

HubSpot Content Hub Starter gives **one authored string per post beyond the
title** (`post_summary`). There are no custom per-post fields, and module fields
do not attach to blog posts. So none of the per-post furniture in the drawing can
be a field, and none of it can be a hand-pasted `<div class="...">` either, since
HubSpot's rich-text paste sanitiser strips classes and tags (this already
happened on the Terms and Security pages).

**Everything is therefore styled on a structural element the editor preserves:**

| Furniture | Element | Author does |
|---|---|---|
| "What you leave with" contract box | the **first `<blockquote>`** | writes a blockquote with a bulleted list inside |
| The carbon script block | a **`<pre>`** | uses the editor's code-block button |
| A numbered step | an **`<h3>`** | uses Heading 3; the numeral is a CSS counter |
| A pull quote | any **blockquote after the first** | writes a second blockquote |

The two labels — "What you leave with" and "Say it like this" — are **generated
content**, so the author writes the bullets and the lines and never the
furniture. The step numerals are a counter, so they cannot be wrong after an
edit and they renumber themselves when a step moves.

**This is unverified against the live editor.** The next session publishes one
throwaway post through the normal editor and views source before anything is
cut into the theme. If the editor mangles any of the four, the fallback is the
field's Advanced → source-code view, which the legal pages already proved works.

## The four kinds

Kind comes from a **HubSpot tag**, so adding or retiring one later is a tagging
change rather than a rebuild.

- **Playbook** — filled teal square, white card, 4px teal top rule, **spans two
  columns**. A sequence you run start to finish.
- **Teardown** — open amber square, amber-tint ground, amber border. A real
  artefact taken apart.
- **Script** — mono brackets, carbon card, **mono title**. Change the words,
  keep the order.
- **Note** — teal dot, **no card at all**, a 2px ink top rule and nothing else.
  One rule, under 400 words.

The legend across the top of the index teaches all four in one glance. It is
site chrome, so it lives in the template rather than in any post.

## Decisions carried in

- **No Copy pill on the script block.** It needed JavaScript and the site has
  none. The rule was not broken for one button.
- **No ordinal.** "Playbook 04" would make HubL loop the whole blog to find a
  number, and an unpublish renumbers history. The kind stays, the number goes.
- **No counters anywhere.** No "41 pieces", no "most read". The catalogue does
  not exist yet and a counter that is not true costs more than it buys.
- **CTA is "Ask for a founding place"**, matching the homepage. There is no free
  tier and no Stripe route.
- The legend's Script cell reads **"Change the words, keep the order."**

## Two things the drawing did not settle, decided here

- **The grid leaves holes.** A double-width Playbook that lands in the last
  column wraps, and the column it left is empty. This is the cost of spanning by
  kind and it was taken knowingly. `grid-auto-flow: dense` would fill the holes
  by pulling a later post forward, at the price of the index no longer reading
  newest-first. Left off.
- **The article runs in a 660px column**, narrower than the site's 1200. At the
  full width the prose measured about 82 characters a line. The legal pages
  already set this precedent at 760.

## One new theme field

**Space Grotesk**, as a `font` field, for headings on these two pages. No new
colour field: the four kinds are carried by glyph, ground and rule weight from
tokens that already ship. Note that `--brand` measures 2.92 on carbon and cannot
be used on it, so the Script card's accents are `--teal-300`.

## Open, for Andrew

- The nav button. The shipped header still says **"Start free"**, which the
  homepage retired. "Ask for a founding place" is too long for a nav button and
  wraps to three lines on a phone. This wants a short string of its own.
- The reading time in the byline. **Dropped in the cut**: computing it needs a
  `wordcount` filter this session could not verify against HubL, and an unknown
  filter is a render error rather than a graceful miss. The byline is author and
  date. Add it back once the filter is confirmed in a preview.
- Whether "Say it like this" over every `<pre>` reads as noise on a Script post,
  where the whole piece is script blocks.
