# The Same Page — Design Reference

Read this for any session involving UI, component decisions, visual design, or UX
patterns.

This doc holds the conventions that are true across the app plus the decisions
still load-bearing today. Feature-specific behavior lives in
`docs/systems/<area>.md`. The complete historical decisions log — every row ever
recorded, including superseded ones — is `docs/archive/DESIGN_ARCHIVE.md`.

---

## Framework & tooling

- **CSS:** Tailwind, configured in `frontend/tailwind.config.js`. Plain Tailwind —
  no component library. Add shadcn/ui only if complexity warrants it, and confirm
  before pulling it in.
- **Shared components:** `frontend/components/` — `AppNav`, `Sidebar`, `PageShell`,
  `ZoneMap`, `QuickAddModal`, `ScribeDrawer`, `CheckInPanel`, `RolePicker`,
  `RoleImportPanel`, `DraftExpectationRows`.
- **Colour lives in `tailwind.config.js`; recurring class strings live in
  `lib/tokens.ts`.** The full system — the five colour roles, the ink scale and
  its contrast floors, surfaces, the status vocabulary — is
  `docs/systems/brand.md`. Read that before touching colour anywhere.
  Arbitrary hex values (`text-[#4f46e5]`) are no longer used; there are none
  left in the app.
- **Layout tokens live in `ZoneMap.tsx`**: `NAV_GROUPS`, `ZONE_STYLE`,
  `ZONE_GRADIENT`, `TONE_TEXT` / `TONE_TEXT_ON_GRADIENT`, `NAV_STRIP_HEIGHT`,
  `SECTION_GAP`. Import from there rather than redefining a value locally —
  that drift is what these tokens exist to stop.
- **Icons and fonts:** not yet decided. The wordmark currently sets in the
  default sans; a pairing for the editorial T10-C mark is still open.

---

## Design principles

1. **Manager-first clarity.** Every screen answers a question the manager actually
   has. If there's no clear question being answered, the screen is wrong.
2. **Calm, not busy.** The manager is already overwhelmed. Prefer whitespace, clear
   hierarchy, one primary action per view.
3. **Mobile-aware but desktop-first.** Managers use this at their desks before
   1:1s. Responsive, but desktop is the primary viewport.
4. **Confidence, not just information.** Copy, empty states, and AI output should
   make the manager feel prepared — not clinical or corporate.

---

## App shell

Every authenticated page renders inside one shell, built once in
`app/app/layout.tsx`:

- **`AppNav`** — a static top bar on every page. Contains the global "+ Quick add",
  the Scribe toggle (a filled indigo→violet "✦ Scribe ⌘J" pill), and the avatar
  dropdown (Settings + Sign out — the app's only sign-out control; no "switch org",
  there's no multi-org concept).
- **`Sidebar`** — a persistent left rail on **every** authenticated page, built from
  `ZoneMap.tsx`'s `NAV_GROUPS`. Collapses to a 56px icon-only rail with native
  `title` tooltips; the collapse state persists to `localStorage`.
- **`PageShell`** — owns every page's container
  (`mx-auto max-w-{size} px-6 py-8 sm:px-8`). A `maxWidth` prop keeps each page's
  own width; `8xl` (`max-w-[1600px]`) is reserved for the four grid-heavy pages
  (Dashboard, Goals, Projects, Team). **Never hand-roll a `<main>` wrapper** —
  fourteen of them drifted out of alignment before this existed.
- **`ScribeDrawer`** — a persistent right drawer, `w-[clamp(400px,30vw,640px)]`,
  content reflows beside it, thread survives navigation. ⌘J summons focused, Esc
  closes.

`/app/login` and `/app/ic` render none of this — one is pre-auth, the other is an
IC stub, and a manager-oriented nav would fetch data neither has.

**Sticky gotcha:** `overflow-x-hidden` in `layout.tsx` wraps only `{children}`,
never the div that also renders `<AppNav />`. Setting `overflow-x` to anything but
`visible` makes the browser compute `overflow-y: auto` too, silently turning that
div into a scroll container and breaking `position: sticky` for everything inside
it. Any new sticky element must stay outside whatever wrapper carries horizontal
overflow containment.

Routes: `ls frontend/app/app/`. Marketing pages under `app/(marketing)/` are public
and must stay SSG-renderable — **no client-side-only patterns there.**

---

## Conventions

### Placement: its own page, or a section?

A first-class object that gets **created and updated regularly** gets its own
top-level page — Goals, Projects, Org, Capacity, Assessments, Team, Context.
Settings is for things **configured once and not written to constantly**.

Two refinements:

- **Summary here, edit there.** Where an object also matters on the person page, it
  appears there as a compact read view linking to the full page. Never two editors.
- **No team-wide list, no page.** Development stayed a section on the person page
  because it's always about one person; a page-plus-summary split would add
  navigation without a second real use case.

Per-person config (cadence, capacity overrides, time off) lives with the person,
behind the person page's settings drawer — off the main flow, not in Settings.

### Empty states and degradation

- A section gated behind a **prerequisite** hides entirely until the prerequisite is
  met, with at most a one-line nudge. Expectations is hidden until a role is
  assigned. Capacity's "By department" is empty until a leader is assigned.
- A **first-class object with no prerequisite** is always visible with a one-line
  empty state and a link. Goals, Projects, Commitments.
- **No "coming soon" placeholders anywhere.** Calm beats roadmap-signaling. A card
  ships only when real data backs it.

### Severity and attention

- **Amber is the app's one "needs attention" color.** At-risk, aging, stale,
  conflicting, unfinished setup all read as one visual language. Don't invent a
  second warning color or a new severity system.
- **Only counts that need attention get color.** Healthy stays grey.
- **Never invent tiers the data doesn't support.** Individual Performance stays
  binary (due for a 1:1, or not) plus a raw commitment count, not a synthesized
  3-tier on-track/needs-check-in/at-risk.
- **Exception-first everywhere.** Attention rows with reason chips lead; healthy
  items collapse behind "Show N on track." Applies to Individual Performance,
  Goals, and Key Initiatives alike — a manager scanning should see problems before
  things that are fine.

### Honesty conventions

- **Label which rule produced a number.** "every 14 days (custom)" vs "every 21
  days (org default)"; capacity's logged-vs-assumed off hours. A manager should be
  able to tell whether a figure is theirs, the org's, or a fallback.
- **Distinguish "nothing to report" from "it broke."** The AI insight renders
  nothing when there's legitimately nothing to flag, and a small muted line when
  the call failed. Identical silence for both erodes trust in every other all-clear
  signal.
- **Never fabricate a derived number.** Progress bars render only with a real
  check-in, never inferred from status.

### AI in the UI

- **Draft-then-review, always.** AI output lands on an editable review surface
  before anything saves. Per-item include checkboxes; the manager can adjust each
  row. Never auto-apply.
- **Manual entry is the primary path; AI is an optional assist.** "Draft with AI"
  for a first pass, "Revise with AI" for existing text. Nothing is AI-gated — a
  blocking draft panel produced a dead end the first time a report had no evidence.
- **One shared review implementation.** `DraftExpectationRows.tsx` backs both AI
  draft doors, so they can't drift apart.
- **Scribe drafts** render as in-thread cards: amber "Draft — not saved" badge,
  green resolved-link fields, muted "none yet" optionals, Confirm / Edit details /
  Discard. Confirm calls the same endpoint the forms use, then collapses to a
  receipt with a view link and a 30s Undo. Ambiguity candidates render as tappable
  quick-reply chips.

### Card and form patterns

- **Edit in place.** An Edit action swaps the card for the same form used to create
  it, pre-filled — not a modal, not a separate page. One component, not two.
- **Status is an inline `<select>` styled as a pill** on the card, not a separate
  edit form. It's the field that changes constantly.
- **Scale scores render as a row of scale-point buttons**, labeled with each point's
  configured output, rather than a number input or dropdown — the scale definitions
  already carry the meaning.
- **Fix select widths** (`w-48`/`w-44`) and truncate. An unconstrained select
  balloons to fit its longest option and squeezes sibling columns into slivers.
- **Show a mockup before writing code** for a visually subjective decision — via the
  Design skill, using real fetched data rather than placeholder numbers. Locked in
  after it worked for the Team page, the Person page, Goals/Projects, and the
  gradient-tile question.

---

## Decisions log

Decisions still load-bearing. Everything else — including every superseded row — is
in `docs/archive/DESIGN_ARCHIVE.md`, complete and unedited.

| Date | Decision | Rationale |
|---|---|---|
| 2026-08-09 | `/app/team`'s structure: KPI strip, then Initiatives/Goals/Commitments, then Critical callouts + Meetings, then the roster as a bottom row | Andrew's layout call from a mockup review; leans more colorful than the rest of the app on purpose |
| 2026-08-11 | Check-in staleness turns the freshness label amber after 14 days, vs. the 21-day 1:1 cadence | A stale green is more dangerous than an honest yellow, and goals drift faster than relationships |
| 2026-08-12 | The Context Engine gets its own top-level page (`/app/context`, "The Space") | Managers return to it repeatedly to teach the Librarian; it's not a configure-once setting |
| 2026-08-12 | The Brain's coverage rings are plain inline SVG, not a charting dependency | Mission Control turned out to have no radial component to actually reuse; "radial in spirit" didn't justify a dependency for one visualization |
| 2026-08-13 | The Scribe's chat surface is a persistent right drawer, picked from a 3-mockup review (drawer / command-bar / docked composer) | The only shape serving both multi-turn slot-filling now and a future persistent consult thread; the command-bar's best trait (⌘J summon) was folded in rather than built as a second surface |
| 2026-08-16 | `/app/1-1s` (Due now / Prepped not yet run / Recently wrapped) is the one front door for the 1:1 loop — no off-platform logging, bulk actions, search, or calendar integration on it | Triage plus start/resume prep only |
| 2026-08-18 | Settings → Expectations' entry point is a coverage grid (role × count pills, amber at zero), not a role dropdown | The dropdown gave no sense of what's covered vs. missing across 13 roles; the grid answers "what's left" in one glance |
| 2026-08-18 | Org-wide values get their own block above the role-specific list on the Values tab, not a separate Settings section | Values are edited where the manager is already thinking about "what does good look like here"; a separate section would bury an entry most orgs touch a handful of times |
| 2026-08-18 | Add-role is AI-first: "+ Add a new ladder" opens the JD import panel as the hero, "or start from scratch" is the quiet fallback | Typing expectations by hand is the fallback, not the norm |
| 2026-08-19 | `/app/team`'s team `<select>` filters every section of the page, not just a label swap; "All teams" is the default | Most of it needed no backend work — direct_reports and goals already carried `org_unit_id` |
| 2026-08-20 | `/app/team`'s Goals and Initiatives cascade from parent departments, labeled "inherited from parent"; commitments, roster, notes, and callouts stay exact-match | Andrew's explicit ask, scoped to the two cards where inheritance is meaningful |
| 2026-08-21 | The person page (`/app/reports/[id]`) is a "Command Deck": identity band with primary CTAs, a 4-tile KPI strip, then Conversation / Work / Person columns, with admin inputs behind a gear-triggered settings drawer | The old page was a single-column wall of ~10 form-heavy sections; a manager opening a report mid-week needs "what's the state of this relationship" at a glance, not a form to fill |
| 2026-08-22 | The persistent left rail renders on every authenticated page, Mission Control included | Excluding Mission Control as "already the map" was sound on paper and read as inconsistent in use |
| 2026-08-22 | Goals and Projects use the KPI strip + `border-l-4` card grid with a per-card progress ring, tokens ported verbatim from `team/page.tsx`; level tabs stay as a pill filter on Goals, none on Projects | Third page on the same treatment — Team, Person, then these — so the app reads as one system |
| 2026-08-23 | Current & Carbon is the app's colour system: five roles (brand teal / attention amber / critical red / info blue / inert carbon) and nothing else. Full spec in `docs/systems/brand.md` | Twelve hue families were live across the app — Team alone used ten — so adjacent pages read as different products. Five roles is the fewest that still distinguishes "going well" from "needs you" from "broken" |
| 2026-08-23 | Blue is reserved for Scribe, AI surfaces and focus rings. It is never a status, a zone, or a decorative accent | `docs/branding/colors/README.md` names blue creep as the specific way this palette goes generic. Narrowness is the whole value of the token |
| 2026-08-23 | The locked success green `#24745B` is not used; teal absorbs "good" | It measures dE2000 = 8.8 from brand teal — the same colour to the eye. Keeping both meant one was decoration pretending to be meaning |
| 2026-08-23 | Zone hues are dropped; nav zones are told apart by icon, label and position. Session 55's bold-gradient tile *shape* stands, only its per-hue colouring is superseded | The palette offers teal, blue and carbon, and blue is reserved — there was no third zone colour to spend that wouldn't dilute the brand |
| 2026-08-23 | `tailwind.config.js` remaps the stock gray/green/indigo/rose/sky/cyan/… families onto brand ramps | Makes the palette closed by construction. A stray `text-rose-500` renders as on-brand critical red instead of an off-palette pink, rather than relying on everyone remembering the rule |
| 2026-08-23 | The ink scale's floor for real text is `ink-muted` (5.2:1); `ink-faint` (3.4:1) is disabled-and-decoration only | Tailwind `gray-400` was the app's most-used text colour at 232 usages and sits at 2.54:1 on white. This was an accessibility defect, not a taste question |
| 2026-08-23 | The T10-C mark ships as traced vector (`components/Logo.tsx` + `public/`), with a separate widened-channel cut for 16–24px | Below ~32px the full mark's negative channels close up into a blob — the limitation `docs/branding/tsp/README.md` predicted for T10 |
| 2026-08-22 | `NAV_STRIP_HEIGHT` (`h-14`) and `SECTION_GAP` (`mt-5`) are named tokens rather than emergent properties of each component's own padding | Two independently-padded rows landed ~4px apart, and 13 pages each picked their own block margin. `mt-5` was chosen because it was already the tightest value in real use, not invented |

_(Add new decisions here. If one reverses an existing row, move the old row to
`docs/archive/DESIGN_ARCHIVE.md` rather than leaving both.)_
