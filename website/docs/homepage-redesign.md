# Homepage redesign — the visual rollout

**Status: cut and verified, waiting on one upload.** Started 2026-08-26.

All five picked concepts are drawn, Andrew answered the seven open copy items, and
the sweep into `theme/` is done and verified. What is left is the single
`npm run upload`, which can only run from Andrew's Mac (see the sweep entry in the
changelog for why), and the single `tsp-push`. Once the upload lands, fold the
Soft register and the two drawing rules into `build-process.md` and delete this file.

This file tracks one specific piece of work: putting pictures on the homepage.
It is the running plan and the changelog for that work. When the last stage is
done and shipped, fold anything durable into `build-process.md` and delete this.

---

## Read this first: which page is the target

**The look and feel to build against is `website/theme/`,** the HubSpot theme
live on the draft page. Andrew, 2026-08-26: *"I wanna call the live website
what's currently in my HubSpot portal and, like, live on the draft page. Like,
that's the look and feel."*

`homepage-v2.html` is a warm-paper direction that was never shipped. **It is not
the target and this rollout no longer runs through it.** The homepage prototype
is now `website/prototype/homepage-live.html`.

---

## Why this exists

The homepage copy, the eight-beat structure and the visual identity are all
settled and parked. Three rounds of layout work still left Andrew with the same
verdict: *"I'm looking at a wall of text. You're giving me a Google Doc."*

The reason was simpler than the fixes being proposed. **The page contains zero
images.** No photograph, no illustration, no diagram, no animation. Every
proposal up to that point was therefore a different arrangement of text, and no
arrangement of text was ever going to answer the objection.

Seven visual concepts were mocked up low-fidelity, all mechanics running:
**https://claude.ai/code/artifact/8cd392fc-d519-4d2f-b508-dec128613a61**

Andrew picked five and set the order. Concepts 03 (the October scrollback) and
07 (the year strip) are cut. His words on the mockup, which govern every stage
below:

> These are low quality outlines, but the concepts land. It's not gonna look
> exactly like what you have here. We want it to look even better.

**So: the mockup is the concept, never the spec.** Each stage below is a
rebuild at full fidelity against the real page's type, palette, grid and
constraints. Copying the mockup's markup across is a failure, not a shortcut.

---

## The stages

One stage per session. Each stage ends with the prototype working, reviewed by
Andrew, and a handoff written for the next one. Nothing goes near `theme/`
until Andrew says the prototype is right.

### Stage 1 — 01 the two pages + 02 the illustration register
**Status: done.** These shipped together because they are one decision: the
page gets pictures, and it gets a drawing hand to make them with.

- **01 · Two pages that become one.** The H1 has described a picture since the
  day it was written and nobody drew it. Two sheets, each with its own version
  of the same week, marks in different places. They slide into register and the
  marks resolve to one record. Sits in the hero.
- **02 · The illustration register.** One single-weight ink line, warm paper,
  teal and clay only. No gradients, no stock photography, no 3D. Spots at the
  beats that need them. This is the higher-leverage of the two: it fixes every
  beat at once rather than just the one it sits in.

The register is settled and written down at the bottom of this file. Stages 2 to
4 draw inside it rather than re-deciding it.

### Stage 2 — 06 the product film
**Status: done.** The concept described replacing a Mission Control shot and its
three scene tabs. Neither exists in the shipped theme, so the film replaced
nothing and instead filled the spine's "the product once" beat, which had no
module at all. It sits between the three moves and the argument: Tuesday's 1:1
with one real sentence open in amber, the week stacking records over it until the
sentence is buried, Monday's brief where the same sentence returns with the day
it came from attached. **Scrubbing became stepping**, because a continuous scrub
needs JavaScript and a hover-scrub does nothing on a phone. Monday is the resting
stop, so the payoff needs no interaction.

### Stage 3 — 04 the desk
**Status: done.** The objects a manager uses instead of a system, scattered at
angles over the one clean record that was underneath them the whole time.

**The copy question was settled first.** The three objects come from the essay in
the retired `homepage-v2.html`, which Andrew approved on 2026-08-26 before the
target was corrected to the shipped theme. The copy never moved across, so the
live recognition section still read "Three dashboards, a spreadsheet and a notes
doc", which is a phrase rather than a picture. Andrew took the recommendation:
**draw the essay's objects and bring only the one line across.** Recognition item
01 is now "A spreadsheet HR sent in January, a Notion page you gave up on by
April, a Notes file, and still no answer to 'how is she doing?'" Same length, same
shape, same closing question, and it names exactly what the drawing shows. The
rest of the essay stayed in the retired file.

### Stage 4 — 05 the bar
**Status: done.** The stage opened with a decision rather than a drawing, because
a count that changes under a dragged finger has no CSS-only form. Three routes
went to Andrew: a stepped control, the one place the prototype takes on
JavaScript, or cutting the stage. He took the recommendation, which was
**stepped, and re-aimed at the ladder.**

**The argument that decided it was not the JavaScript rule.** A line you slide
until the number underneath it looks right is a picture of moving the goalposts,
which is the behaviour the product exists to replace. Setting the line to a level
of a role ladder is both what the software does and what the headline claims, so
the constraint and the argument pointed the same way. Route B was rejected
because it sits on top of the stepped version rather than replacing it: touch,
keyboard and reduced motion all still need a non-drag fallback, and the part JS
adds is the part that fights the scroll on a phone. Route C, cutting, was
rejected because every other drawing on the page is about the record and the H1's
first half had no picture at all.

The drawing is two records side by side. **The bar** lists the expectations one
level asks for, and the card grows as the level rises, three rows at Associate
and seven at Senior. **The team** is five rows of the same evidence scored
against exactly those rows, with a teal line drawn under the last person who
clears every one of them and the count riding on the line: four of five at
Associate, two at Mid, one at Senior. Mid rests. Level names are placeholder.

**Two SVGs, one radio group.** One wide drawing made a phone scroll sideways past
the whole bar card before reaching the line and the count, so the phone's resting
state was the setup with the payoff cropped off. Split, they sit side by side
above 980px and stack below it, and the count chip sits at the left end of the
line for the same reason. Verified on an iPhone profile: the bar card fits with
no scrolling, and the line and the count are both in view at rest.

---

## Rules that bind every stage

- **ONE sweep to HubSpot, at the end.** Andrew's rule, 2026-08-26: *"I want to
  push to HubSpot in one sweep when EVERYTHING is ready."* So nothing is cut into
  `theme/` stage by stage. Every stage lands in
  `website/prototype/homepage-live.html` and stops there. When all the picked
  concepts are in and he has signed the prototype off, **one** pass turns them
  into modules in `theme/`, and **one** upload puts them in the portal. Do not
  offer an interim upload, and do not describe a file as ready to port, which
  reads as a next step for him to take.

- **No `tsp-push` between stages either.** Corrected by Andrew 2026-08-26: *"we
  decided to go through it stage by stage and do targeted work in each session,
  and then we'll do a big sweep and TSP push and push into HubSpot once we're
  ready."* A stage ends with the prototype working, Andrew's review, and this
  file updated. It carries on without a commit. The whole rollout closes out
  once, at the sweep, and that single `tsp-push` covers every stage. Do not hand
  over a paste-ready git block between stages, and do not offer one.

- **`prototype/` first, always.** Design settles in `website/prototype/homepage-live.html`
  as standalone HTML. `theme/` is not touched until Andrew signs off the
  prototype. This is `build-process.md`'s rule, not a preference.
- **Copy is parked.** Do not rewrite it. Locked: the H1 frame, "Define the bar.
  Then see who clears it.", no watch/track/monitor, no invented testimonials.
- **Commerce is parked.** "Start free" and the "14 of 20" counter stay as-is. Do
  not re-raise that no signup flow or Stripe route exists.
- **The eight-beat spine does not change.** hero → recognition → the argument →
  three moves → the product once → fit filter → founder letter and terms →
  close. The argument runs before the product.
- **Every contrast pair clears WCAG AA.** Verify it, don't assume it. Three
  pairs failed on an earlier pass. Note the four known misses inside the app
  mockup (4.45–4.48) are the product's own tokens and are a separate decision.
- **Respect `prefers-reduced-motion`.** Every animation added here needs a
  still, legible resting state.
- **Show a rough version before building a polished one.** The expensive lesson
  from 2026-08-26: a full built page was delivered when a mockup was wanted.
- **No em-dashes and no clause starting with "not"** in anything Andrew's voice
  will carry. See the `andrew_voice_and_ai_tells` memory.

## Where things stand in the files

**`website/prototype/homepage-live.html` is the homepage prototype.** The live
theme's look and feel carrying all four drawings: the hero in place of the
product roster mockup, the film between the three moves and the argument, the
desk in the recognition section's right column, and the bar between the argument
and the close. Standalone, no JavaScript, every token value resolved from
`theme/fields.json` so it can be diffed against the theme rather than trusted.

It carries the nav, hero, recognition, stats-band, moves, the film, claims, the
bar, close and footer. **`pivot-stat` and `founder` are still missing** and have
to be brought across from `theme/` before Andrew can sign the whole page off.

**`website/prototype/homepage-v2.html` is retired.** It holds the warm-paper
typographic architecture pass, which was a direction Andrew never shipped. Keep
it for the history, build nothing further on it.

**`website/theme/` is untouched** and stays that way until Andrew signs off the
prototype.

## Open items, answered 2026-08-26

Andrew took every recommendation. For the record, since these are the words on
the page now:

1. **The film's one real sentence** is "You own the vendor review, draft by the
   12th." A delegation with a date rather than a project task, because the date
   is what gives the sentence a reason to come back on Monday. It was trimmed
   from "draft to me by the 12th" after rendering showed the longer version
   overran the Monday card's tinted plate by 0.2px at 13px.
2. **The film's heading holds** ("What you said on Tuesday, waiting on Monday").
   The lede tightened to "The record builds itself in the 1:1. It briefs you
   before the next one.", which drops the second "record".
3. **Recognition item 01** stands as rewritten in stage 3.
4. **`pivot-stat` and `founder`** are in the prototype, reproduced from `theme/`
   with their shipped field defaults. No design change.
5. **The bar's heading** is "Move the level. See who still clears it.", echoing
   the H1 because that is the claim this drawing exists to prove. The lede drops
   "raising".
6. **Associate, Mid and Senior stay.** They read across industries and the
   product makes them per-org anyway, so anything more specific claims a ladder
   that would then have to be defended. They are module fields, so they change
   without a developer.
7. **Both captions moved off `--ink-faint`** to `--ink-muted`, measured at 4.84
   on canvas. They are real type naming a control, so the register's
   pills-are-exempt rule does not cover them.

## Still open, and not part of this rollout

- The founder photo is still the dashed placeholder. That is the shipped state,
  not something the sweep changed.
- **Three places where shipped copy breaks the no-em-dash rule**:
  `pivot-stat`'s follow-on, the founder note, and two of the four `stats-band`
  figures. The stats-band case is the odd one: `homepage-live.html` already
  carries a comma version and `theme/` still has the em-dash version, so the
  prototype has been quietly ahead of the theme there. `pivot-stat` also ships
  straight apostrophes where the rest of the page uses typographic ones.
  Copy is parked, so none of this was touched.
- `close-cta`'s counter note is longer in `theme/` than in the prototype
  ("and your feedback shapes what gets built"). Same class of drift.

## Changelog

- **2026-08-26** — Typographic architecture built into `homepage-v2.html`.
  Rejected as insufficient: still a wall of text.
- **2026-08-26** — Seven visual concepts mocked up. Andrew picked 01, 02, 06,
  04, 05 in that order and asked for this tracker. Stage 1 not yet started.
- **2026-08-26** — Stage 1 rough. The illustration register was settled and
  written into this file. The hero plate was drawn in two layouts, and spots
  were drawn for beats 03 and 06. Every colour pair was measured rather than
  assumed, and the reduced-motion resting state was verified by rendering the
  page with motion reduced and screenshotting it before the animation would have
  finished. Rough shown to Andrew as an artifact:
  **https://claude.ai/code/artifact/8d2ebc96-3654-4fd4-bfc0-b754a8005088**
  Nothing written to `homepage-v2.html` yet. Four decisions are open: hero
  layout A or B, what triggers the hero, whether the clay square in row three
  stays, and whether the register marks read as noise.
- **2026-08-26** — Andrew answered all four: **hero A, hover triggers it, keep
  the open square, keep the register marks.** He also corrected the target: the
  look and feel is the shipped theme, not the paper prototype. The stage 1 work
  was rebuilt against `theme/` and four drawing hands were shown side by side
  (https://claude.ai/code/artifact/6588d54b-efa2-4a01-9b83-393bc3e2ae66).
- **2026-08-26** — **Soft locked as the hand.** Built out at
  https://claude.ai/code/artifact/04e154d5-7388-47d3-9be2-a015db771c28 and
  written to `website/prototype/homepage-live.html`, which has no JavaScript in
  it. The register below was rewritten for the theme. Three things were fixed
  between the comparison and the build: the second record now fans far enough to
  read as a record rather than a drop shadow, the marks now clear 3:1 where they
  were at 1.6, and a teal identity dot was added because grey pills on a white
  card read as a loading skeleton. Verified by rendering with reduced motion and
  on an iPhone profile: both land on the finished picture, and the hover hint
  hides where hover does not exist. **`theme/` still untouched.**

- **2026-08-26** — **Stage 2 scoped before drawing.** The concept's premise was
  stale: there is no Mission Control section and no scene tabs in the theme, so
  the film replaces nothing. The live module order is hero, recognition,
  stats-band, moves, claims, pivot-stat, founder, close-cta, which means **the
  spine's "the product once" beat has no module at all** and stage 1 widened the
  hole by taking the roster mockup out of the hero. Three placements were put to
  Andrew as a rough:
  **https://claude.ai/code/artifact/845703ba-dc02-482f-ae9c-6843970dc653**
  A, its own section between moves and claims (recommended); B, three previews
  inside the `moves.module` cards (rejected: a 104px card floor cannot carry one
  thread across four days, and three thumbnails read as three unrelated
  features); C, the film replaces moves (rejected: the spine does not change).
  Also established that **"scrubbable" cannot survive the no-JavaScript rule** and
  becomes a CSS-only stepper of three named stops, hidden radios plus labels,
  which works on touch and takes arrow keys natively. The mechanism was built and
  rendered inside the rough rather than promised. Five questions are open:
  placement, three stops or four, which stop rests, the one real sentence the
  film needs, and the ground the film sits on. **`theme/` still untouched.**

- **2026-08-26** — **Stage 2 built.** Andrew took the recommendation on every
  open question, so: placement A, three stops, Monday rests, canvas ground with a
  white plate. `homepage-live.html` now also carries the **moves** and **claims**
  sections reproduced from `theme/`, so the film can be judged in its real
  neighbours. The film is a section between them, drawn in the Soft register:
  Tuesday's 1:1 with one real sentence in an open amber row, the week stacking
  three more records over it until the sentence is buried, and Monday's brief
  where the same sentence returns in a teal-tint card with `FROM TUESDAY'S 1:1`
  under it. **Scrubbing was dropped for stepping**: three hidden radios plus
  labels, no JavaScript, clicking works on touch and arrow keys move between stops
  because it is a real radio group. Monday is checked by default, so the payoff
  needs no interaction. Below 980px the drawing scrolls inside its own box rather
  than shrinking its type past legibility. Verified by rendering all three stops
  and the whole page. Reviewable at
  **https://claude.ai/code/artifact/d557420c-6e93-4717-a7cc-db073e29ebc8**
  Open: the section heading and lede are placeholder copy, and the film's one real
  sentence is Claude's, both waiting on Andrew. **`theme/` still untouched.**

- **2026-08-26** — **Stage 3 built, the desk.** It sits in the right-hand column
  of the recognition section, which was carrying a wide empty margin because
  `.recog` caps its text at 52ch. Three white records scattered at angles, each
  labelled in mono because the dates are the point: SPREADSHEET &#183; JANUARY, a
  filled grid; NOTION &#183; ABANDONED APRIL, a title and two lines and then
  nothing; NOTES, uneven lines with one amber open mark. Under them, one clean
  record whose teal dot and heading show above the pile at rest.
  **The resting state is the mess**, which is the picture beat two needs, so
  touch, keyboard and reduced motion all get the whole desk. Where a fine pointer
  and motion are both available, hovering sweeps the three scraps out and fades
  them on a stagger and leaves the clean record. The hint sits inside that same
  media query. No JavaScript. Verified at rest, on hover, and on an iPhone
  profile with reduced motion, where the scraps measure opacity 1 and the hint is
  hidden. Reviewable at
  **https://claude.ai/code/artifact/d557420c-6e93-4717-a7cc-db073e29ebc8**
  **`theme/` still untouched**, and no commit, per the sweep rule above.

- **2026-08-26** — **Stage 4 built, the bar. Every picked concept is now drawn.**
  The stage opened with a decision put to Andrew as an artifact
  (https://claude.ai/code/artifact/e05a67d0-bd20-4a94-8cf1-62461fa1167b): stepped,
  JavaScript, or cut. He took the recommendation of stepped, then took every
  recommendation on the rough that followed
  (https://claude.ai/code/artifact/105632c5-f754-4700-9df4-ba8e37e9788a), which
  showed two structures live. So: **structure A**, the standard beside the team
  rather than the team alone; **its own section between the argument and the
  close**; **Mid rests**; placeholder level names; and the register's three mark
  states read here as clears it, evidence on file and it does not, and nothing on
  file yet, which gives teal a second job inside this one drawing. Rejected on the
  way: person-cards floating at heights, which is a scatter plot wearing a costume
  and has no vocabulary in the register. **The single wide drawing was split into
  two SVGs sharing one radio group** after rendering it on an iPhone profile
  showed the resting state was the bar card with the line and the count cropped
  off to the right. Every contrast pair was measured rather than assumed: marks
  clear 3:1 on the card at 4.92, 3.36 and 3.91, and every piece of type in the
  section clears 4.5 except the caption, which is now open item 7. The stale file
  header, which still said the only new block was the hero, was rewritten to name
  all four drawings. Reviewable at
  **https://claude.ai/code/artifact/9e187f42-dda8-4d79-a975-f92d8a9315c3**
  The stage 2 and 3 artifact URL could not be updated from this session, since
  `*.frame.claudeusercontent.com` is off the network allowlist, so this is a new
  URL and the old one is stale. **`theme/` still untouched**, and no commit, per
  the sweep rule above.

- **2026-08-26** — **The sweep. `theme/` now carries all four drawings.** Andrew
  answered the seven open items, took every recommendation, and approved the
  module plan. What moved:

  | | |
  |---|---|
  | `hero.module` | extended: the plate replaces the roster mockup. `mockup_title` and the `rows` repeater deleted, since they drove markup that no longer exists. **The hero picture is no longer editable in HubSpot**, which is correct: it is an illustration rather than content. |
  | `recognition.module` | extended: the list is wrapped in `.recog-grid` and the desk is the right column. Item 01's default copy updated to the stage-3 rewrite. |
  | `film.module` | new. Fields: heading, lede, the one real sentence, caption. |
  | `ladder.module` | new. Fields: heading, lede, the three level names, caption, the three key labels. |
  | `templates/page.html` | two new `dnd_section`s. The spine is now hero, recognition, stats-band, moves, **film**, claims, **ladder**, pivot-stat, founder, close-cta. |
  | `css/main.css` | 184 lines of drawing CSS, the token-class block, and one `@media (max-width:980px)` block carrying only the new selectors. |
  | `theme/fields.json` | two new colours. |

  **No hex survived into a module.** The four drawings carried 353 literal
  colours across 7 SVGs. Every `fill=` and `stroke=` became a class naming its
  role in the register (`.d-surface`, `.d-pill`, `.d-recorded`, `.d-open` and so
  on) and `main.css` resolves each from a token, so changing `--brand` now
  repaints all four drawings and `build-process.md`'s rule holds. Twelve of the
  fourteen distinct colours already had tokens. The two that did not are now
  theme fields: **`color.pill`** `#D5DADE`, the grey a line of handwriting is
  drawn as, and **`color.amber_tint`** `#FBF1E0`, the fill behind an open mark.
  The open mark is the one shape whose fill and stroke are a pair, so it is one
  class rather than two.

  **The id hooks became class hooks.** The radios keyed off `#fs1`/`#lv1` and the
  seven SVG filters off global ids, so a second copy of either module on one page
  would have cross-wired the radio groups and broken the shadows. Every id is now
  namespaced with HubL's `{{ name }}` and the CSS selects on classes
  (`.film-radio.f3:checked ~ ...`) instead, which is what let the ids move.

  **Verified by rendering the built theme, not by reading it.** The modules were
  resolved with their own field defaults and diffed against the signed-off
  prototype. All six changed regions render **pixel-identical**: the hero plate,
  the desk, the film, the bar, `pivot-stat` and `founder`. Section heights match
  exactly everywhere except two sections this rollout never touched, where the
  prototype had drifted from `theme/` (see "Still open" above). `npm run verify`
  passes. No horizontal scroll at 1440, 940 or 390.

  **The new responsive rules sit at 980px in their own block**, separate from the
  theme's existing 900px block, which is untouched. Each drawing is two records
  side by side and needs to stack earlier than a row of three cards does. Checked
  at 940px, where the desk stacks under the recognition list and reads fine.

  **The upload could not run from this session, and should not have.**
  `build-process.md` says `npm install` must never be run from a Linux shell
  against this folder, and the HubSpot key lives in `~/.hscli/config.yml` on the
  Mac, outside the repo. The Linux VM's `node_modules` is missing
  `@rollup/rollup-linux-arm64-gnu` for exactly that reason. So `npm run upload`
  and the push are one paste-ready block for Andrew's own terminal.

## The illustration register — Soft

Settled 2026-08-26. **This replaces the register written earlier the same day for
the paper prototype**, which assumed square corners, one weight of ink and a warm
ground. None of that survived the move to the theme. Stages 2 to 4 draw inside
this rather than re-deciding it.

Reference build: `website/prototype/homepage-live.html`, and the review page at
https://claude.ai/code/artifact/04e154d5-7388-47d3-9be2-a015db771c28

### Why Soft

Four hands were drawn and shown side by side: Line, Soft, Overprint, Blueprint.
Andrew picked Soft. Claude's recommendation was Overprint, so **this is a
deliberate override and the reasoning behind Overprint should not be re-litigated
in a later stage.** Soft is the most native to the theme and the lowest risk
across four more drawings, which is a real argument.

### The rules

**A record is a surface, never an outline.** `--surface` `#FFFFFF`, radius 16,
carrying the theme's own two-part shadow. The second record is `--canvas`
`#F5F8FA` with a `--control` hairline and a softer shadow. Nothing in the
drawing has a drawn outline, because the material is UI surfaces rather than ink.

**Writing is a pill.** Rounded rect, height 10, radius 4.5. `--ink-muted` for a
heading, `--control` for a label, `#D5DADE` for body. Real words appear only when
the word itself is the point.

**A mark is a filled rounded square,** size about 5% of the card width,
radius 6. Three states and no more:
- **Recorded** `#878D92`, 3.36 on the card
- **Agreed** `--brand` `#087E78`, 4.92
- **Still open** `--amber-500` `#B67118` outline at 2.5 on `#FBF1E0`, 3.91

**A dot says whose record it is,** never a square. `--brand` for the reader's own
record, `--control` for the other one. It is chrome rather than state, so it does
not disturb what teal means on a mark. It also has to be a circle: a rounded
square would be read as a mark. It echoes `.counter .dot`, which is already on
the page.

**No people.** The register draws objects and marks, never figures, faces or
hands. A person is present through what they left behind.

**Marks are held to a contrast floor. Pills are not.** Marks carry the meaning of
the picture and each clears 3:1 against the card behind it. The pills stand in
for handwriting and carry nothing on their own, so they are allowed to be light.
**This is a judgment call, and it is the line to revisit if an accessibility
review ever pushes back.**

**Register marks are rounded corner brackets,** stroke 3.5, round caps, in
`--brand`, at the top left and bottom right of the joined record. Printer's crop
hairlines belong to a different hand and look borrowed in this one.

**On carbon**, the surface lifts to `rgba(255,255,255,.07)` with a
`rgba(255,255,255,.16)` edge, pills go to `rgba(255,255,255,.24)`, a recorded
mark to `rgba(255,255,255,.45)` at 4.13, and an agreed mark to `--teal-300`
`#B1D5D1` at 7.35 on the lifted surface.
- **`--brand` measures 2.92 on carbon and cannot be used there at all.**
- **`--amber-500` measures 3.68 on carbon**, technically passing and visually
  muddy. A lifted `#E0A64B` measures 5.37. **That value is not in the theme.** If
  a later stage puts a drawing on the dark band, add it to `theme/fields.json` as
  something like `amber_on_carbon` rather than hard coding it into a module.

**No JavaScript.** The whole drawing is inline SVG plus CSS transitions, which is
what makes it portable into a HubSpot module unchanged.

**Motion: the resting state is the finished picture.** Registered, resolved,
everything visible. The un-registered start state is applied only inside
`@media (hover:hover) and (pointer:fine) and (prefers-reduced-motion:no-preference)`,
so touch, keyboard and reduced motion all get the whole drawing and nothing is
hidden behind an interaction that cannot happen. The card takes keyboard focus,
so `:focus-within` does what `:hover` does. **Any hint text naming the
interaction lives inside that same media query**, or it promises something the
device cannot do.

### Two traps this hand sets

**Grey pills on a white card is how the entire internet draws a loading
skeleton.** With the drawing waiting on a hover there was no colour in the hero
at all, and it read as an unfinished page. The teal identity dot is what fixes
it. Any future drawing in this hand needs at least one saturated element in its
resting state for the same reason.

**A second surface behind the first reads as a drop shadow, not as a second
thing.** The first pass had the back card peeking out by 18 units and the picture
said "one document" rather than "two records that disagree". It has to fan far
enough that the second record's own pills and its own marks are visible.
