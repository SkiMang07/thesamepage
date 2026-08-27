# Go-to-market

Everything about who we sell to, what we are to them, how we sound, and how we make
money. **`gtm/` is the thinking. `website/` is the build.** The marketing site stays
a separate root because it carries its own HubSpot CLI tooling, and that setup can
never be re-run from a Cowork session.

Two things bind every file here:

**The current site copy is scaffolding.** It was written to get a site standing
pre-launch, it is unpublished, there are no customers, and no shipped line constrains
this work. Never defend an existing line; rebuild from the foundation.

**Evidence and assertion are labelled separately.** Where a claim comes from a
manager's own words, it says so and cites a source. Where it is ours, it says that
too. Do not blur the two — see the contamination audit in `research/`.

---

## What is here

| File | Read it when |
|---|---|
| `business-model.md` | Pricing, tiers, distribution, the content and SEO plan |
| `positioning.md` | Deciding what we are, to whom, against what alternative |
| `personas/new-manager.md` | Before writing any copy, or deciding who a feature is for |
| `research/audience-2026-08.md` | Checking whether a claim is actually evidenced |
| `research/miro-board-source.md` | The original board material, working source |
| `brand/voice-rules.md` | Before writing a sentence anyone outside will read |
| `site/<page>.md` | Changing what a marketing page argues |
| `brand/assets/` | Logo and palette exploration. Gitignored, ~31 MB, reference only |

The shipped visual system is **not** here. Colour tokens and the logo spec live in
`docs/systems/brand.md`, because they are read during code work on
`frontend/tailwind.config.js` and `frontend/lib/tokens.ts`.

---

## The five-layer sequence

The brand foundation is being built in order, because each layer is the input to the
next. Skipping ahead is what produced copy nobody could defend.

1. **Audience truth** — done. `personas/new-manager.md`
2. **Positioning** — done. `positioning.md`
3. **Point of view** — not written. The argument we would make in public even if we
   sold nothing, plus what we are against. **Write it cold, before reading any
   existing site copy.**
4. **Message hierarchy** — not written. One value prop, three pillars, proof under
   each. This is what turns page-writing from invention into assignment.
5. **Voice system** — partial. `brand/voice-rules.md` holds the rules that already
   bind. The full system comes after layers 3 and 4 and absorbs that file.

Then the copy, rebuilt rather than defended.

---

## The three things most likely to be got wrong

**The competitor is not Lattice.** Across five threads spanning 2020 to 2026, zero
managers named a performance-management product as what they actually use. It is a
doc per person plus their memory, and increasingly plus an LLM. Lattice is what their
company bought and what they copy-paste into.

**The lead differs by surface, and the split is forced by channel.** Acquisition leads
with review season, because the dossier guilt has no search query. The homepage leads
with the guilt and the shared record, because that is the one claim a competitor
selling to HR structurally cannot make. Retention is the review again.

**Some of our vocabulary is ours, not theirs.** "The bar," "what good looks like" and
"mission control" are our metaphors. They may be right. They are not the reader's
language, and `brand/voice-rules.md` says which is which.
