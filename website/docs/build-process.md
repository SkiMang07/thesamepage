# Marketing site — build process

How the public website is built, why it is built this way, and how to work in it.
Read this before touching anything under `website/`.

## Why this shape

The Prism Tree site was built the way HubSpot invites you to build: pages
assembled from pasted HTML inside Custom HTML modules, styled by editing
template-attached stylesheets in Design Manager's browser IDE. The result was
unmaintainable — every page a snowflake, no version control, no cross-file search
or refactor, no fast preview loop, and content edits that required opening code.

Everything below exists to prevent that specific outcome. The three rules:

1. **The site is code in this repo, not in Design Manager.** The HubSpot CLI syncs
   a local folder up. Design Manager becomes a place to look, never to build.
2. **Colours and type resolve in exactly one file.** No page-level CSS anywhere.
3. **Content lives in module fields, not in markup.** After launch, copy and image
   changes happen in HubSpot's page editor with no developer involved.

If a proposed change violates one of these, the change is wrong, not the rule.

## The account

- **HubSpot Content Hub Starter.** Blog included. Full Design Tools access
  confirmed — custom themes, custom modules, and HTML + HubL templates are all
  available, so the "starter templates" restriction that blocks custom modules
  does not apply here.
- **Serverless functions are Enterprise-only.** Not needed: forms, the blog, and
  CRM submission are all native.
- Domain purchased, DNS already connected through HubSpot.
- CLI account alias: `tsp-hubspot`.

## Where things live

```
website/
  docs/
    build-process.md      this file
    security.md           credential handling — read before running hs
  prototype/              standalone HTML design drafts: no HubSpot, no HubL
  theme/                  the HubSpot theme — the thing that actually ships
  package.json            pins the HubSpot CLI to this project
```

The theme is uploaded to HubSpot as **`tsp-theme`**. Local folder name and remote
name are kept distinct on purpose so the upload command reads unambiguously.

`prototype/` is not shipped. It is where design is settled before any HubSpot
syntax is involved, and it stays in the repo afterwards as the reference for what
the modules were cut from.

## Verification

```
npm run verify
```

`scripts/verify-theme.py` runs before every upload — `npm run upload` chains them
and refuses to push if a check fails. Every check in it corresponds to something
that actually broke once. Add to it; do not trim it.

It checks: no zero-byte files, all JSON parses, theme fields are colours only with
no reserved names, every `theme.x.y` reference resolves, every `{{ module.x }}` has
a field, no reserved module field names, every repeatable group has an
`occurrence.default` at least its minimum, no literal colour below the token block,
the template annotation and standard includes are present, and every `include` and
`dnd_module path=` resolves on disk.

**Why the empty-file check is first.** Both partials once shipped as zero bytes, so
the site had no nav and no footer — and nothing reported an error, because an empty
partial resolves fine and renders nothing. The cause was a patch script doing
`open(p,"w").write(open(p).read()...)`: the write handle truncates the file before
the read runs. Never read and write the same path in one expression.

## First upload

```
cd website
npm install
npm run upload
```

Then in HubSpot: Content → Design Manager to see the theme, and Content →
Website Pages → Create → pick **The Same Page → Page — flexible**. The page comes
up already composed from the eight modules.

## Setup from scratch

Only needed on a new machine. The CLI is a project dependency rather than a global
install — no `sudo`, no PATH changes, and the version is pinned in
`package.json` so it cannot drift.

```
cd website
npm install
npx hs account auth
```

The key goes to `~/.hscli/config.yml`, outside this repo. See `security.md`.

Two environment notes:

- zsh here does not have `interactive_comments` enabled, so `#` comments pasted
  into the terminal execute as commands and fail. Paste commands without comments.
- **CLI v8 moved these commands under `hs cms`.** It is `hs cms upload`, not
  `hs upload`. Older tutorials and most blog posts still show the v7 form.
- `npm install` must be run from macOS, never from a Linux shell against this
  folder — the native binaries are platform-specific and a Linux install leaves
  a `node_modules` the Mac cannot run.

## The edit loop

Leave this running in a terminal tab while working:

```
cd website
npx hs cms watch theme tsp-theme
```

Edit a file, and it uploads in about a second. Refresh the HubSpot preview.
That watched folder is the entire bridge between local work and HubSpot — there
is no copy-paste step, and nothing is ever authored in Design Manager.

Useful one-offs:

```
npx hs cms upload theme tsp-theme      one-shot push of the whole theme
npx hs fetch theme tsp-theme       pull remote state down, for reconciling drift
```

## Architecture

**Six templates, so far.** `page.html` is the flexible one: it's the homepage,
and doubles as the fallback for anything without its own template yet (product
walkthrough, support, offers — none of those are designed yet). About, Contact,
and now Legal turned out common and simple enough to earn dedicated templates
instead of being hand-assembled from the flexible one each time — each seeds
its own module set directly, so HubSpot's page-creation screen shows a distinct
card for it and a brand-new page lands pre-composed, no drag-and-drop cleanup
required. Legal (`legal.html`) is reused for all three legal documents —
Privacy, Terms, Security — since a policy document's shape doesn't change page
to page, only its content does. The blog needs its own two, not built yet.

```
theme/
  theme.json                    name, preview path, breakpoints
  fields.json                   every colour and the font stack — theme settings
  css/main.css                  THE stylesheet. Tokens at the top, everything else below.
  templates/
    page.html                   the flexible/home template — seeded with the 8 homepage modules
    about.html                  seeded with frame + founder + close-cta
    contact.html                seeded with frame + contact-form
    legal.html                  seeded with frame + legal-body; reused for Privacy/Terms/Security
    partials/header.html        logo + site_nav menu + Start free
    partials/footer.html        logo + tagline + footer_nav menu
  modules/
    hero.module                 headline, sub, both CTAs, the counter, the bar chart
    recognition.module          heading + repeatable lines, auto-numbered
    stats-band.module           carbon band — repeatable stats, stakes, source note
    moves.module                three moves; drops in real screenshots when you add them
    claims.module               competitive section
    pivot-stat.module           the standalone figure
    founder.module              photo, note, name, role
    close-cta.module            closing heading, CTA, counter
    frame.module                eyebrow + H1 + lede — the intro block for About/Contact/Legal
    contact-form.module         native HubSpot form (type: "form" field + {% form %} tag)
    legal-body.module           one richtext field for a whole policy doc; auto-numbered
                                 headings via CSS counters, a blockquote callout, a
                                 draft-note style for flagged/unresolved clauses
```

About and Contact still draw from the same module library rather than getting
one-off modules — `frame.module` carries the intro on both, `founder.module`
and `close-cta.module` are reused unchanged on About — the difference is just
that each now has its own template file instead of being reassembled by hand
in the page editor every time. One manual step remains: `contact.html` seeds
`frame.module` with its default, About-flavoured copy, rather than overriding
it at the template level — an untested HubL param-override risked breaking the
whole upload batch for a cosmetic win. Swap the three Page frame fields
(eyebrow/heading/lede) to the Contact copy once, in the page editor, the first
time that page is built.

Blog templates (`blog-index.html`, `blog-post.html`) are not built yet.

**One token file.** `theme/fields.json` declares every colour and the font stack;
the token block at the top of `theme/css/main.css` consumes them as
`{{ theme.color.brand.color }}`. Defaults are the exact values from
`frontend/app/globals.css`, so the site and the product share literal hex values
rather than copies that drift. Changing a brand colour is one edit, in theme
settings or in one file.

### What theme fields can and cannot hold

Learned the hard way on first upload. `theme/fields.json` accepts only a
restricted set of field types — **colour, font, number, choice, boolean, spacing,
image, url**. A plain `text` field is rejected outright, and `label` is a reserved
name that cannot be used for any field.

Consequences, all deliberate now rather than accidental:

- **Theme fields are colours only.** That is the right scope anyway — theme
  settings are the brand, not the content.
- **The font stack is a literal in `css/main.css`**, with a comment saying why.
  When a real typeface is chosen it becomes a proper `font` field.
- **The site name and the tagline are literals in the partials.** They are site
  chrome, not page content, and too small a surface to justify a theme field.
- **Nav links are HubSpot menus, not literals.** Both `header.html` and
  `footer.html` render the same menu (Settings → Website → Navigation → "The Same
  Page - Menu") via `{% menu "site_nav", id=<menu id>, max_levels=2,
  flow="horizontal" %}` — one level of dropdown children is supported in
  `css/main.css` (`hs-item-has-children` / `hs-menu-children-wrapper`) since the
  menu has a nested parent item. Menu items pointing at pages that don't exist yet
  render with HubSpot's "Deleted"/unset-link state until those pages are built and
  the menu is repointed — that's expected, not a bug to chase.

### Module field rules that only surface on upload

Three more, all learned by being rejected:

- **Reserved field names.** `label`, `body`, `name`, `id`, `type`, `class`, `style`
  and `content` cannot be used as field names anywhere. This theme uses `copy`
  instead of `body` and `person_name` instead of `name`.
- **A repeatable `group` needs `occurrence.default`**, and it must be greater than
  or equal to `occurrence.min`. Omitting it sends `null` and the upload fails.
  Set it to the number of items in the group's `default` array.
- **Upload validates the whole theme, not the file you changed.** A single bad
  field rejects the batch — though every other file still uploads, so progress is
  real even when the command exits with an error.

Before uploading after any field edit, re-run the checks in the
"Verification" section of the memory note: JSON parses, every `{{ module.x }}`
resolves, every `theme.x.y` exists, no reserved names, every occurrence default
at least the minimum, and no literal colours below the token block.

### Two rules the illustrated modules added

Learned cutting the four homepage drawings in, and binding on any module that
carries inline SVG.

- **A drawing declares no colour of its own.** Every `fill=` and `stroke=` in an
  SVG is a class naming what the shape *is* in the illustration register (a
  surface, a pill, a recorded mark, an open mark), and `css/main.css` resolves
  that class from a token. The first pass had 353 literal hexes across 7 SVGs;
  none of them survived. This is the same rule as "no literal colour below the
  token block", extended to the only place that could have dodged it, since the
  verify script reads `main.css` and not `module.html`. If a drawing needs a
  colour the theme has no token for, add the field: that is how `color.pill` and
  `color.amber_tint` got there.
- **Any id inside a module is namespaced with `{{ name }}`.** A module can be
  dropped on a page twice. The CSS-only steppers key off `:checked`, and the SVG
  shadows off filter ids, so a duplicate instance would cross-wire the radio
  groups and break the shadows. Ids carry `{{ name }}`; the CSS never selects on
  an id, it selects on a class (`.film-radio.f3:checked ~ .film-plate .fr3`).
  Those two go together: the CSS had to stop using ids before the ids could move.

Module `fields.json` is a different, much richer schema — `text`, `richtext`,
`link`, `image`, repeatable `group`, and the rest all work there. **Page content
belongs in modules; brand belongs in theme fields.** The type system enforces the
split whether you like it or not.

**There is not one literal colour below that token block**, and that is enforced,
not aspirational — the verification script checks it. White is a token too
(`--on-dark`), for the same reason. If you find yourself wanting to write a hex
into a module, the answer is a new theme field.

**Modules, one per repeated block.** Each is a folder with `module.html`,
`module.css`, `fields.json` and `meta.json`. Planned set: hero, problem-trio,
feature-row, walkthrough-step, quote, cta-band, faq, offer-card. (`legal-body`
was in this list and is now built — see Architecture above.)

Add a module only when the design calls for it. A module that exists "in case we
need it" is how a theme grows into an unmaintainable one.

**Modules carry no CSS of their own.** Every rule lives in `css/main.css`; a
module emits markup and class names only. This is deliberate — it is what stops
the Prism Tree outcome where a colour has to be hunted through fifteen files.

## Editing the page after launch

Everything on the homepage is a typed field. In HubSpot: Content → Website Pages →
edit → click the section → change the text. No code, no deploy, no developer.

Repeatable things are repeaters: recognition lines, statistics, the three moves,
the competitive claims, and the people plotted on the bar chart can each be added,
removed and reordered in the editor.

**The counter is a number field, and it must be true.** `places_left` and
`places_total` appear on both the hero and the closing CTA. Either keep them
honest or delete the note. A counter frozen at "3 spots left" costs more trust
than it buys.

## The template type rule

Design Manager's New File dialog offers two template types. The distinction
matters more than it looks:

- **Drag and drop** — HubSpot's visual template builder. **Do not use.** It cannot
  be meaningfully versioned, diffed or refactored.
- **HTML + HubL** — a real file. Put `{% dnd_area %}` inside it and the *page
  editor* still gets full drag-and-drop.

The second gives both things at once: code that lives in git, and an editor that
works without a developer. This is the single most important choice in the build.

## Working order

Design is settled **outside HubSpot first**. A page is drafted as a standalone
HTML file in `prototype/`, reviewed as a rendered screenshot, and iterated until
approved. Only then is it cut into modules.

This ordering is not a preference. Iterating on look and feel through HubSpot's
publish-and-refresh cycle is slow enough to distort design decisions, and it is
most of what made the Prism Tree build painful. Converting an approved design into
a module afterwards is mechanical work — wrap the markup, replace hard-coded
strings with `{{ module.x }}`, write the field list.

## Source of truth

Git is authoritative. Once the theme is live, **lock the assets in Design
Manager** so they cannot be edited there — this is HubSpot's own recommendation
and it is what prevents remote edits silently diverging from the repo.

If CI is added later, it is HubSpot's CMS Deploy GitHub Action on `main`, with the
access key stored as a repository secret and never in a workflow file.

## Pages planned

Home (the problems, and how the product solves them) · product walkthrough · blog ·
contact · support · legal · about · offers.

**About and Contact: theme code done, pages not yet live.** Argument docs and
standalone prototypes live in `prototype/` (`about-argument.md`/`about.html`,
`contact-argument.md`/`contact.html`), reviewed and approved. `about.html` and
`contact.html` are real templates now (see Architecture above), each seeded
with the right modules already — `npm run verify` passes. What's left is
manual, in HubSpot itself, not code: create the two pages by picking the
"Page — About" and "Page — Contact" cards (each lands pre-composed — no
module drag-and-drop needed), swap the Contact page's Page frame copy from
About's default to the Contact lines (one-time, see Architecture), create the
actual HubSpot form under Marketing → Forms (Name/Email/Message, "Send
message" button) and pick it in the contact form module's field, upload the
real founder photo (`prototype/images/andrew-headshot.png`) via the page
editor, and — once both pages are live — repoint the nav's "About
Us"/"Support" menu items away from
their current "Deleted" state.

**Legal: all three pages live in HubSpot** (`/legal/privacy`,
`/legal/terms`, `/legal/security`), built by Andrew directly from the
`legal-body.module` + `legal.html` template. `prototype/legal-argument.md`
plus the three prototypes remain as the reference the module was cut from.
One real gap surfaced doing this by hand: pasting the Terms/Security content
from a rendered browser tab strips real `<h2>`/`<blockquote>` tags down to
plain bold text, so the CSS auto-numbering and callout styling don't fully
render on those two — HubSpot's rich-text paste sanitizer, not a theme bug.
The fix (paste via the field's Advanced &gt; source-code editor instead of
pasting rendered text) is documented, but Andrew reviewed the result and
called it good enough to ship as-is rather than re-pasting for pixel-perfect
numbering. Worth doing properly next time a module needs long pasted HTML.

## Open items

- Positioning and copy — done for the homepage and About/Contact. Still
  needed for the product walkthrough, blog and offers pages.
- Support routing: HubSpot Knowledge Base requires Service Hub Professional, so
  support will be a form or a routed inbox rather than a KB. The Contact page
  folds support in rather than splitting it out — one form, one inbox.
- Legal page set is live (see Architecture/Pages planned above) but not
  finished: four things still sit as visible draft-notes inside the content
  itself, editable in the page editor with no developer needed once Andrew
  has an answer — the AI/model-training clause (left open on purpose), the
  employee-data section (new language, no Prism Tree precedent), Supabase's
  AWS region, and the governing-law state. None of these block the pages
  being live; they block calling the legal docs actually reviewed and final.
- Whether to add the GitHub Action, or keep deploying from the watched folder.
