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

## First upload

```
cd website
npm install
npx hs cms upload theme tsp-theme
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

**Three templates.** One flexible page template carries home, product walkthrough,
about, contact, support, legal and offers. The blog needs its own two.

```
theme/
  theme.json                    name, preview path, breakpoints
  fields.json                   every colour and the font stack — theme settings
  css/main.css                  THE stylesheet. Tokens at the top, everything else below.
  templates/
    page.html                   HTML + HubL, one {% dnd_area %}, seeded with the 8 modules
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
```

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
- **Nav links, the site name and the tagline are literals in the partials.** They
  are site chrome, not page content. The proper fix, once the real pages exist, is
  HubSpot menus (Settings → Website → Navigation) referenced with `{% menu %}` —
  not theme fields, which cannot hold them.

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
feature-row, walkthrough-step, quote, cta-band, faq, offer-card, legal-body.

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

## Open items

- Positioning and copy — not started. This gates the design.
- Support routing: HubSpot Knowledge Base requires Service Hub Professional, so
  support will be a form or a routed inbox rather than a KB.
- Legal page set, following the Prism Tree structure.
- Whether to add the GitHub Action, or keep deploying from the watched folder.
