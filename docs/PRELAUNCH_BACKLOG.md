# Pre-Launch Review Backlog — 2026-09-01

> **Status 2026-09-22.** Re-audited against `git log` and the live deploy.
> Nothing below has landed: the last two commits since this doc was written
> (`5a8ff73` Away, `1d50192` Managing Better publishing) touch none of these
> items, so every checkbox is still honestly unticked. This file itself is
> still untracked — commit it. Two sections were added at the end: **§6 New
> findings** (things a code + live walkthrough on 2026-09-22 turned up that
> the 2026-09-01 review deliberately or accidentally left out) and **§7 the
> production-readiness checklist** — the launch gate, distinct from the
> polish list.

Product-level and customer-level sweep before launch. Two passes, run blind of
each other and merged here: **Pass 1** = product executive reviewing the whole
app; **Pass 2** = the ideal customer (first-time manager per
`gtm/personas/new-manager.md`) walking every surface in week one with zero data.
Every finding was verified against the actual frontend/backend code — file and
element cited on each line. Work through this list in later sessions and check
items off.

**Out of scope by design:** `website/` (scaffolding), code quality (separate
engineering pass later), and known WIP — dictation v2, the person-page
prep-sheet fix, the 1:1 log date bug.

**Assumptions made (no questions asked, per instructions):** billing is filed
as a P0 *decision*, not necessarily a P0 *build* — launching consciously free
is a valid answer. The "Mission Control vs. ratings dashboard" vision question
is filed as a decision, not a defect. Severity calls are mine; the cut/hide
section changes the scope of everything below it, so read it first.

**What held up well:** Hard Rule 6 (AI draft-then-review) held on every surface
checked — Scribe confirm cards, assessment drafts, JD import, development
drafts, wrap-up review, context-engine extraction all land on an editable
review step before anything saves. The core loop (prep → 1:1 → wrap-up →
commitments → action brief) is launch-quality. The problems are monetization,
the sharing story, multi-manager surface area, and naming drift.

---

## 1. Cut / hide for launch

These change the scope of the backlog below — decide them first. "Hide" means
remove from nav/UI for launch, not delete the code.

- [ ] **CUT-1 · Hide the IC invite ("Invite to log in") and the IC page** —
  [Pass 1 + Pass 2] — `/app/team` Team details → Account
  (`frontend/app/app/team/page.tsx` ~2181–2235), `frontend/app/app/ic/page.tsx`.
  The flow dead-ends: the invited IC sees "Your manager will be adding more
  here soon. There's nothing to do on your end yet." (`ic/page.tsx:43`), and the
  "Send" / "Sending…" button implies an email that `backend/routes/invites.py`
  never sends (it returns a copyable link). Inviting a report before the IC
  view exists actively *advertises the dossier* to them — the manager's side is
  stamped "manager-only" and "not sent to {name}" while their side is a shrug.
  Hide the Account block and the invite path until an IC experience exists.
  **Effort S. P1 if not cut.**
- [ ] **CUT-2 · Hide Capacity's "By department" section; consider hiding the
  whole Capacity page** — [Pass 1] — `/app/capacity`
  (`frontend/app/app/capacity/page.tsx` ~360–395). The department rollup
  requires org-unit leaders no solo $20/mo manager has, and its empty state
  says "Assign a leader… on the Build tab" (`capacity/page.tsx:380`) — a tab the
  2026-08-26 Org redesign retired (`docs/DESIGN.md`). Reads as half of another
  company's product. Minimum: hide "By department" and fix the stale copy;
  stronger: drop Capacity from `NAV_GROUPS` (`ZoneMap.tsx`) for launch.
  **Effort S–M.**
- [ ] **CUT-3 · Hide the Org scope selector for single-manager orgs** —
  [Pass 1] — `/app/org` (`frontend/app/app/org/page.tsx`;
  `docs/systems/org-scoping.md`). "Units I lead" / "Entire organization"
  scoping, leader assignment, and "Detailed people and performance data is
  outside your current leadership scope" all presuppose multiple managers —
  and org-scoping.md concedes there is no admin concept gating leader
  assignment. Zero wedge value for the launch ICP; cognitive surface only.
  Hide the selector when the org has one manager. **Effort M.**
- [ ] **CUT-4 · Hide the "Team update record" (team_messages)** — [Pass 1] —
  `/app/team` Team details (`frontend/app/app/team/page.tsx` ~2143–2178).
  A fourth write surface ("Manager-only and not sent to {member.name}…",
  `team/page.tsx:2147`) whose backend is explicitly "STORE-ONLY for v1"
  (`backend/routes/team.py:19`). Notes with no reader confuse the
  already-crowded private/shared story. Hide until IC login gives it a reader.
  **Effort S.**

---

## 2. P0 — must fix before launch

- [ ] **P0-1 · Decide the money path: there is no billing or entitlement
  anywhere** — [Pass 1] — `backend/config.py:30–31` holds empty
  `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` and no route uses them; magic
  link auto-creates full accounts (`/app/login`). Anyone who finds the login
  page gets the $20/mo product free forever, and nothing enforces a trial.
  Either build the Stripe path (**L**) or consciously launch free /
  manual-invoice and align the site copy (**S**). **Effort: decision now,
  build varies.**
  **Decided 2026-09-24 (Andrew):** free beta first, no Stripe before launch.
  Managers 1–20 get 3 months free; manager 21 onward gets a 14-day trial;
  when either clock runs out the account goes read-only (everything visible,
  nothing new saved) until they pay $20/mo. Stripe must be live before the
  first 14-day trial ends. The build is §7 B; this row closes when §7 B does.
- [ ] **P0-2 · The rating chip is a secret grade stapled to the person's
  name** — [Pass 2] — `/app/reports/[id]`
  (`frontend/app/app/reports/[id]/page.tsx:511–512`): `{ratingLabel}` (e.g.
  "Needs Improvement") renders in a pill beside the h1 name with no indication
  of who can see it and no path to share or discuss it. This is the literal
  "creepy dossier" the persona fears, on the surface the manager opens before
  every conversation. Minimum: visibility label + link to the assessment it
  came from. **Effort S.**
- [ ] **P0-3 · Nothing in the product tells the manager what is and isn't
  shared — the sharing story exists only in marketing** — [Pass 2] — the
  manager's surfaces are stamped "This view is manager-only."
  (`team/page.tsx:1111`), "Manager-only and not sent to {member.name}"
  (`team/page.tsx:2147`), "Only you can see these" (manager notebook), while
  no screen ever says what the report will eventually see or own. The
  persona's entire willingness to keep the record rests on "it's not
  surveillance if you tell them they own the doc as well" — the product is
  named The Same Page and never shows one. Minimum for launch: one honest,
  consistent visibility statement on the person page + team page explaining
  what's private now and what sharing is coming (**S**); the real fix is the
  IC experience itself (**L**, post-launch, behind CUT-1). **Effort S now.**

---

## 3. P1 — fix soon (before or immediately after launch)

Naming and trust:

- [ ] **P1-1 · The app calls itself "TSP" to customers** — [Pass 1 + Pass 2] —
  `frontend/components/mission-control/ActionBrief.tsx:199, 375, 472` ("Why
  TSP suggested this", "Recorded in TSP", "TSP needs one real working
  relationship…") and `backend/mission_control_engine.py:566` ("TSP has
  limited evidence so far."). The acronym is never introduced anywhere; the
  wordmark says The Same Page. Replace with the product name or "we".
  **Effort S.**
- [ ] **P1-2 · One feature, four names: Knowledge → The Space → The Brain →
  the Librarian** — [Pass 1 + Pass 2] — nav label "Knowledge"
  (`ZoneMap.tsx:232`) opens `/app/context` whose h1 is "The Space"
  (`context/page.tsx:178`), containing section "The Brain" fed by "the
  Librarian" (`context/page.tsx:180,194`). A customer cannot name the feature
  after using it. Pick one customer-facing name and keep the rest internal.
  **Effort S–M.**
- [ ] **P1-3 · "Projects" vs "initiatives" on the same screen** — [Pass 1 +
  Pass 2] — nav + h1 say "Projects" (`projects/page.tsx:255`) while the same
  page's copy says "No initiatives yet" (291), "Initiative portfolio" (389),
  "Standalone initiative" (425, 522), and Goals shows a critical-toned "No
  initiative attached" KPI (`goals/page.tsx:403`). A new user assumes
  "initiative" is a different object they haven't found. Pick one word.
  **Effort S.**
- [ ] **P1-4 · "Critical callouts" is a private note wearing a broadcast
  name** — [Pass 2] — "Critical callouts … This view is manager-only."
  (`team/page.tsx:1103,1111`). A "callout" sounds like something the team
  receives; it's private manager writing, which makes the labels harder to
  trust. Rename to something honestly private ("Must-knows"). Same logic
  applies to "Team update record" if CUT-4 doesn't hide it. **Effort S.**
- [ ] **P1-5 · Blue used as a status colour, violating the locked brand
  rule** — [Pass 1] — `goals/page.tsx:80,92` and `reports/[id]/page.tsx:119`
  render `completed` as blue; `assessments/page.tsx:34` gives the top rating
  `bg-blue-50 text-blue-600`; but `lib/tokens.ts:127` says `completed:
  "bg-brand text-on-brand"` and `docs/systems/brand.md` locks blue to "Scribe,
  AI surfaces, focus rings — nothing else". A completed goal is blue on Goals
  and teal on Team. Point all three files at tokens.ts. **Effort S.**

Week-one experience (this IS the product in week one):

- [x] **P1-6 · The login page only says "Sign in" — a new customer assumes
  they need an invite** — [Pass 2] — `/app/login`
  (`frontend/app/app/login/page.tsx:63,66`): "Sign in" / "We'll send you a
  magic link — no password needed." No create-account wording exists anywhere
  under `frontend/app`, even though magic link silently creates the account.
  Say "Sign in or create your account". **Effort S.**
  **Done 2026-09-23.** "Sign in or create your account".
- [ ] **P1-7 · The empty dashboard renders two dead cards and an unexplained
  aside under the "start here" card** — [Pass 2] — in empty mode
  `ActionBrief.tsx` still renders "Conversation runway" → "No conversation
  records yet." (363) and "What has changed" → "No recent recorded changes."
  (386), plus the server's "TSP has limited evidence so far."
  (`mission_control_engine.py:566`). Half the first screen is empty furniture.
  Suppress the supporting cards until data exists. **Effort S.**
- [ ] **P1-8 · Empty states send the user on a round trip to the dashboard
  instead of opening Quick add** — [Pass 2] — "Add your first one from
  Mission Control →" (`1-1s/page.tsx:293–294`), and `/app/dashboard` links in
  `capacity/page.tsx:295` and `assessments/page.tsx:62` — while "+ Quick add"
  sits in the header of those same pages. Week one is mostly empty states, so
  the extra hop is the main felt experience. Open the modal in place.
  **Effort S.**
- [ ] **P1-9 · "Context is gathering automatically" reads as surveillance to
  the exact customer we court** — [Pass 2] — chip "Gathering context"
  (`1-1s/page.tsx:120`), "Context gathers here automatically. Review it before
  the agenda is built." (`reports/[id]/page.tsx:608`), then "Nothing gathered
  yet." (705). Gathering *what*, from *where*? The prep page's own "Pulled
  from goals, development, and the last conversation." is the fix — one
  sentence naming the sources, everywhere the gathering language appears.
  **Effort S.**
- [ ] **P1-10 · Day-one prep dead end: the suggested flow lands on a disabled
  button with no explanation** — [Pass 2] — `/app/reports/[id]/prep`
  (`prep/page.tsx:466–472`): "Build agenda →" is disabled exactly when a
  report is fresh (no notes, no carry-forward, no topics, no commitments) and
  nothing says "write a line to start". Also "Add anything the record does not
  already know." — "the record" is another unnamed character. **Effort S.**
- [ ] **P1-11 · Settings' definition of "done" demands an org chart and full
  expectation coverage from a manager of six** — [Pass 2] —
  `settings/page.tsx:233–240`: `peopleReady` requires `teams_count > 0` and
  zero people without role/team; `rolesReady` requires *every* role to have
  expectations; the amber "not finished" state propagates to the Settings nav
  door (`ZoneMap.tsx`). This is the "discipline" wall that made the persona
  abandon the last tool. Relax the bar or reframe as optional depth, not
  readiness. **Effort M.**

Judgment surfaces:

- [ ] **P1-12 · A bare 1–5 scale with zero calibration help, usable before any
  expectations exist** — [Pass 2] — `/app/assessments/[reportId]`
  (`assessments/[reportId]/page.tsx:414`): with no role configured — "You can
  still set an overall rating above." — five seeded buttons ("Needs
  Improvement"→"Outstanding", `backend/routes/assessments.py:41–46
  _DEFAULT_LEVELS`) and an optional notes box. The persona's defining gap is
  "I can't even assess what's reasonable"; this is the one place the product
  most needs to help and instead hands them a naked scale. Gate overall
  ratings behind expectations, or add calibration guidance per level.
  **Effort M.**
- [ ] **P1-13 · "Draft with AI" pre-selects scores for a person without
  showing what evidence it used** — [Pass 2] — `runDraft`
  (`assessments/[reportId]/page.tsx:203`) pre-clicks `level_ordinal` buttons
  across overall/skills/values/metrics with no "based on…" evidence list —
  contrast Mission Control's "Why this?" panel, which does show evidence.
  Draft-then-review is technically honored, but a sourceless AI opinion of a
  human is the exact line the positioning promises not to cross. Show the
  evidence set used. **Effort M.**

---

## 4. P2 — nice to have

- [ ] **P2-1 · "Management runway" + "Now/Next/Watch" is internal-sounding
  ranking language** — [Pass 2] — `ActionBrief.tsx:233,268`; with "Why TSP
  suggested this" it reads like a scoring system, not help. Consider "What to
  do next". **Effort S.**
- [ ] **P2-2 · Quick add's pointers and side effects are subtly wrong** —
  [Pass 2] — `QuickAddModal.tsx:260` says "Full setup (teams, expectations)
  lives in Settings → People" but expectations live under "Roles &
  expectations"; inline role creation silently assigns `job_level: 1`,
  rendering "· L1" everywhere with no chosen ladder. **Effort S.**
- [ ] **P2-3 · "Organization" vs "Company" for the same goal tier** — [Pass 1 +
  Pass 2] — `QuickAddModal.tsx:79` labels the tier "Organization"; the Goals
  page tab is "Company" (`goals/page.tsx:63`). A goal created under one name
  appears under the other. **Effort S.**
- [ ] **P2-4 · "Open Relationship Desk →" names a room the destination never
  wears** — [Pass 1 + Pass 2] — `team/page.tsx:2005,2100` and Settings copy
  use "Relationship Desk"; `/app/reports/[id]` never shows the term, and
  `1-1s/page.tsx:445,450` calls it "the relationship workspace". Put the name
  on the page or drop it from links. **Effort S.**
- [ ] **P2-5 · Ten nav destinations on day one, unsequenced, with
  "Assessments" up front** — [Pass 2] — `ZoneMap.tsx` NAV_GROUPS +
  `Sidebar.tsx`: Team, 1:1s, Assessments, Goals, Projects, Capacity, Org,
  Knowledge, Settings on a zero-data account. For someone afraid of becoming
  a micromanager, "Assessments" before the first conversation reads as "start
  grading". Consider progressive disclosure or a suggested order. **Effort M.**
- [ ] **P2-6 · "Check-in" means goal-progress here but human-contact
  everywhere else** — [Pass 2] — "Log check-in" (`CheckInPanel.tsx:104`),
  "Never checked in" (`CheckInPanel.tsx:158`) attach to goals/projects while
  1:1s are the person surface; a stale "Never checked in" is ambiguous between
  a neglected goal and a neglected human. **Effort M.**
- [ ] **P2-7 · Goals hands a line manager company-strategy homework** —
  [Pass 2] — `goals/page.tsx:280` "Company, department, team, and individual
  goals in one place." with an empty Organization tab ("No company goals yet.
  Add the first one above."). No copy says the upper tiers are optional for a
  solo manager. **Effort M.**
- [ ] **P2-8 · Utilization vocabulary without help, on the most
  surveillance-flavored input in the app** — [Pass 2] — "Target utilization %"
  (`reports/[id]/page.tsx:1265`), "Hours are the shared currency"
  (`capacity/page.tsx:289`) — no explanation of what a reasonable number is or
  what it changes. **Effort S.**
- [ ] **P2-9 · "…ground future prep in agreed expectations" — agreed with
  whom?** — [Pass 2] — `backend/mission_control_engine.py:666`; nothing is
  agreed with the report (they can see nothing), so the copy promises a
  shared-agreement feature that doesn't exist. Say "the expectations you set".
  **Effort S.**
- [ ] **P2-10 · Decide the launch framing: the landing surface deliberately
  isn't the vision's ratings dashboard** — [Pass 1] —
  `docs/systems/mission-control.md` excludes assessment scores and inferred
  risk from the brief, while `PRODUCT_VISION.md`'s load-bearing sentence is a
  ratings-against-expectations mission control. The evidence-boundary
  rationale is sound and matches the newer positioning; just make sure launch
  copy sells the action brief, not a ratings dashboard. **Effort: decision.**

---

## 5. First five moves, in order

1. **P0-1 (billing decision).** It gates the launch plan itself — everything
   else on this list assumes you know whether launch means "paying customers
   exist" or "conscious free beta". One decision, made once.
2. **CUT-1 + P0-3 together (hide the IC invite, write the sharing copy).**
   One session. This closes the product's biggest trust hole — the app
   currently *demonstrates* the creepy dossier to any invited report while
   never telling the manager what sharing means. Both are S once decided.
3. **P0-2 (rating chip visibility label).** Smallest fix on the list with the
   largest single emotional payoff: it defuses the literal dossier moment on
   the most-visited judgment surface. S.
4. **The naming sweep: P1-1, P1-2, P1-3, P1-4, P1-5, P2-3 in one session.**
   All are S, all are string/token changes, and together they fix the "app
   speaks four languages" impression that makes a polished product feel 80%
   done. One commit, big perceived-quality jump.
5. **The week-one empty-state pass: P1-6, P1-7, P1-8, P1-9, P1-10 (+ CUT-2's
   stale copy).** Week one *is* empty states for every new customer, and the
   persona has already abandoned tools that made week one feel like homework.
   All S; one focused session covers the entire first-session experience.

That order front-loads decisions, then trust, then breadth-of-polish — and
leaves the M-effort judgment-surface items (P1-11, P1-12, P1-13) as the first
post-launch block, where they'll benefit from real usage data.

---

## 6. New findings — 2026-09-22 walkthrough

Code-verified, plus a live click-through of `thesamepage-blush.vercel.app`
and `www.thesamepage.xyz` in Chrome. The 2026-09-01 review scoped out
`website/` and code quality; the front door and the plumbing are back in
scope here because "production-ready" includes them.

### Blocking — these are broken today, not merely unpolished

- [x] **N-1 · The marketing homepage redirects to a cycling club.**
  `https://www.thesamepage.xyz/` and `https://thesamepage.xyz/` both 30x to
  `http://www.saturdaycyclers.com/` (reproduced three times, 2026-09-22;
  the destination itself then errors). `/blog`, `/about` and the posts load
  fine, so this is a HubSpot domain/redirect rule or a stale URL-mapping on
  the root, not DNS. Every link in every blog post and every social profile
  currently lands here. **Fix in HubSpot → Settings → Website → Domains &
  URLs → URL redirects; confirm the homepage is published on the primary
  domain.** Effort S once found; P0 by any definition.
  **Done 2026-09-24.** The cause was not a bad rule: no TSP site page had ever been
  published (all six were drafts), so HubSpot fell through to a portal-wide 2016
  "/" redirect from the By 2 Pedals days. Home is now published; thesamepage.xyz
  and www both serve it. The old rule is still in URL redirects and only fires
  where no page exists. About, Contact, Legal, Security and Terms are still drafts.
- [x] **N-2 · The 404 page on thesamepage.xyz is Prism Tree's.**
  `www.thesamepage.xyz/pricing` (which does not exist) renders the Prism Tree
  header, footer, "Open the App → app.prismtree.ai", the Prism Tree privacy
  and terms links and the Prism Tree newsletter form. Both sites share one
  HubSpot portal and the 404 system template is portal-wide. Build
  `website/theme/templates/404.html` from `page.html` and set it as the
  system page for the thesamepage.xyz domain (HubSpot → Settings → Website →
  Pages → System pages, per-domain). Effort S.
  **Done 2026-09-24.** `templates/404.html` (templateType error_page, must be
  isAvailableForNewContent: true to be selectable) is the 404 for
  www.thesamepage.xyz only, set as a per-domain override; Prism Tree keeps its own.
- [x] **N-3 · "Sign in" and "Start free" in the marketing header are dead
  links.** `website/theme/templates/partials/header.html:8–9` are `href="#"`;
  the live nav's "Login/Sign Up" is a `javascript:;` menu item. The blog
  currently has a working post, a working CTA to a founding-places form, and
  no way to reach the app. Point them at `https://app.thesamepage.xyz/app/login`
  (see N-4). Effort S.
  **Done 2026-09-23.** Both header buttons, the HubSpot nav's "Login/Sign Up"
  menu item, and every homepage and blog CTA go to app.thesamepage.xyz/app/login.
- [x] **N-4 · The app has no custom domain in use.** `gtm/`, `website/` and
  `docs/` reference `app.thesamepage.xyz` eleven times; the live app is
  `thesamepage-blush.vercel.app` and `app.thesamepage.xyz` does resolve to
  Vercel (`/app/login` loaded there) but nothing links to it, `FRONTEND_URL`
  on Railway and the Supabase auth Redirect URLs allow-list must include it,
  and the marketing header must send people to it. Pick the one URL,
  set it in all four places (Vercel domain, Railway `FRONTEND_URL`, Supabase
  redirect allow-list, `header.html`), verify a magic link round-trips from
  it. Effort S, but it touches auth — test the full login on the new domain
  before announcing it. (`frontend/app/app/login/page.tsx:49` sends
  `emailRedirectTo` from `window.location.origin`, so a domain not in the
  Supabase allow-list fails silently at the email step.)
  **Done 2026-09-23.** app.thesamepage.xyz is the one URL: GoDaddy CNAME (DNS is
  at GoDaddy, not HubSpot), Vercel domain, Railway FRONTEND_URL, Supabase Site URL
  and /auth/callback allow-list, header.html. thesamepage-blush.vercel.app 307s to
  it. A magic link sent from it round-tripped to Mission Control with live data.

### Product polish the first review missed

- [x] **N-5 · Every page navigation fires 9 nav-badge requests plus the
  page's own.** `frontend/components/ZoneMap.tsx:388–400` `useZoneData()`
  calls `getOneOnOnesOverview, getTeamAssessments, getGoals, getProjects,
  getCapacityOverview, getOrgUnits, getContextCoverage, getProfile,
  getSetupStatus` on every mount; the dashboard adds `brief` and
  `assistant/thread`. Observed live: 22 `/api/` requests on one dashboard
  load, several still pending at 6 s; Team showed a bare "Loading…" for
  >3 s; 1:1s was still a skeleton at 4 s. Cache zone data in a context at
  the `app/layout.tsx` level (fetch once per session, refresh on write) or
  collapse it into one `/api/nav-summary` endpoint. Effort M; biggest single
  felt-quality win after the naming sweep.
  **Done 2026-09-22 (option a, frontend only).** Diagnosis corrected: AppNav sits
  in the persistent layout, so the fan-out fired once per *hard* load, not on
  every client navigation. The legacy dashboard fired a second copy, and 8 of the
  10 calls only fed door labels that render on the legacy dashboard alone.
  `ZoneDataProvider` now fetches core (overview + profile) once and door data
  only on demand, and refreshes both on records-changed. Measured against a
  counting mock backend on production builds, `/api/` requests per hard load:
  dashboard 12 → 4 (legacy variant 29 → 19), Team 24 → 16, 1:1s 12 → 4.
  Returning to the legacy dashboard drops from 18 to 8. Door labels render
  identically. Team's own 13-call load is untouched and is now the largest
  remaining fan-out.
- [x] **N-6 · Settings flashes "Needs attention" / amber "!" on all five
  sections before data arrives.** Observed live: the readiness rail and every
  section badge render the warning state during the loading gap, then flip
  to ✓. `settings/page.tsx` readiness derives from zero counts, and zero is
  what an unloaded state looks like. Gate the badges on `loaded`. Effort S.
  **Done 2026-09-22.** Readiness banner, rail badges, the editor-header pill and
  its scope box stay neutral ("Checking…") until profile, setup status and
  capacity settings have all loaded. A failed load now stays neutral beside the
  error message instead of claiming every foundation needs attention.
- [x] **N-7 · Sixteen surfaces render plain "Loading…" text; none have an
  error boundary.** `grep -rn "Loading…" frontend/app/app` → 16; `error.tsx`
  / `not-found.tsx` → 0 anywhere under `frontend/app`. A thrown render error
  in production shows Next's default white "Application error" page with no
  brand and no way back. Add `frontend/app/app/error.tsx` and
  `frontend/app/not-found.tsx` (S), and swap the plain text for the skeleton
  pattern Mission Control and 1:1s already use (S–M).
  **Done 2026-09-22.** `app/app/error.tsx` (branded, inside the app shell, with
  Try again and Back to Mission Control) and `app/not-found.tsx` added.
  Seventeen page- and section-level "Loading..." screens now use
  `components/Skeleton.tsx`. Four small inline waits stay as text: Settings'
  archived list and expectation drafts, CheckInPanel history, the Scribe thread.
- [x] **N-8 · Legacy marketing routes still ship in the Vercel app.**
  `frontend/app/(marketing)/` still serves `/`, `/pricing` ("$20/month ·
  Start free trial" with no trial mechanics behind it) and `/blog` on the
  Vercel domain. The real site is HubSpot. Anyone who lands on the Vercel
  root sees pre-brand scaffolding, and Google can index two homepages.
  Either redirect `(marketing)` routes to `www.thesamepage.xyz` in
  `next.config.js` or delete them and 301 `/` → `/app/login`. Also add
  `robots.txt` disallowing `/app/` (there is none). Effort S.
  **Done 2026-09-23.** (marketing) deleted; `/` -> /app/login, /pricing and /blog
  -> www.thesamepage.xyz; robots.txt disallows the whole app domain.
- [ ] **N-9 · Blog index copy is HubSpot default filler and the post cards
  show a stale placeholder.** Live `/blog` subtitle: "A blog focused on
  helping managers build high-performing teams provides actionable
  insights, strategies, and best practices…" — the portal's default blog
  description, an AI-tell sentence that violates `gtm/brand/voice-rules.md`.
  Under both published posts the card reads "The first pieces are being
  written. Check back shortly." Fix in HubSpot blog settings and
  `blog-index.html`. Effort S.
- [ ] **N-10 · The Privacy Policy says AI is Anthropic-only; dictation ships
  audio to OpenAI.** `gtm/site/legal.md:93` locks "AI is Anthropic only,
  first-party key" but `backend/config.py` `AI_TRANSCRIBE_MODEL` /
  `OPENAI_API_KEY` and `backend/routes/transcribe.py` send every dictation
  clip to OpenAI. Add OpenAI as a sub-processor in Privacy and Security
  pages, and revisit the four open legal questions still flagged in
  `legal.md` (AI-training clause, Supabase region, governing law). Effort S,
  but it is a truthfulness issue on a page a customer's IT team will read.

### Found while closing Block A (2026-09-23/24)

- [ ] **N-11 · Five of six marketing pages are still drafts.** About, Contact,
  Legal, Security and Terms have never been published (only Home is, as of
  2026-09-24). The nav's "Company" dropdown and the footer point at them, so
  those links render empty or unset until they go live. Legal still carries a
  "Draft, needs your decision" block (the AI-training clause) that must be
  answered before it publishes; see N-10 and `gtm/site/legal.md`. Publish as a
  set once the copy is signed off.
- [ ] **N-12 · Homepage meta description is the old positioning.** "Define
  what good looks like for every role, then see who's meeting it... built for
  the manager, not HR." It is what Google shows under the result. One line in
  HubSpot page settings; write it from the locked hero copy.
- [ ] **N-13 · The stats band promises a research page that does not exist.**
  "Every figure is dated and linked on our research page." Either build the
  page (and verify each figure against a live source, which was already an
  open item) or cut the sentence.
- [x] **N-14 · Login email is Supabase's default.** Subject "Your sign-in
  link", sender noreply@mail.app.supabase.io, footer "powered by Supabase".
  Brand the template and set a custom SMTP sender (Supabase → Auth → Emails)
  before strangers receive it. The default sender is also rate-limited.
  **Done 2026-09-24.** Custom SMTP is on: smtp.gmail.com:465 as
  ag@thesamepage.xyz, sender name "The Same Page", Google app password
  `tsp-supabase-smtp-2026-09` (Gmail caps it near 2,000 sends a day). Both
  templates from `docs/auth-emails/` are applied with their subjects. Verified
  live: a magic link requested at /app/login arrived in the Gmail inbox (not
  spam) from ag@thesamepage.xyz as "Sign in to The Same Page", and the link
  signed in. A sign-up as andrewgodlew+tspsmtp0924@gmail.com got "Confirm your
  email for The Same Page" in the inbox, and its link created the account and
  landed on an empty Mission Control (that test user can be deleted in
  Supabase → Auth → Users). Supabase's email rate limit stays at 30/hour, enough before
  launch; raise it under Auth → Rate Limits if sign-ups come in bursts.
  One oddity: the delivered mail ends with "The Same Page / Manage With
  Evidence / www.thesamepage.xyz" after the template's own footer. That
  looks like a Workspace-appended footer (Admin console → Gmail → Compliance
  → Append footer), and it lands on every login email.
- [ ] **N-15 · A 2016 portal-wide redirect sends "/" to saturdaycyclers.com**
  (HubSpot → Domains & URLs → URL redirects, from the By 2 Pedals days). Harmless
  while Home is published, since it only fires where no page exists, but it will
  hijack the homepage again if Home is ever unpublished. Delete it, or scope it to
  www.by2pedals.com. Left in place because deleting is irreversible and
  Andrew had not said to.

Where things live, learned the hard way:
- DNS for thesamepage.xyz is at **GoDaddy**, not HubSpot. Record changes need
  a text-message code to Andrew's phone.
- The marketing site's HubSpot portal is **583675**, shared with Prism Tree and
  By 2 Pedals. Per-domain settings (system pages, redirects) live under
  Settings → Content → Pages with the domain chosen at the top.
- Theme files can be pushed to HubSpot from a signed-in Chrome session through
  the CMS source-code API (`PUT /api/cms/v3/source-code/published/content/tsp-theme/<path>`),
  so a theme fix does not have to wait for `npm run upload` on the Mac.
- HubSpot lists an `error_page` template in System Pages only when it has
  `isAvailableForNewContent: true`.
- The Supabase project is on the **Free** plan (no backups; see section 7 E).

---

## 7. Production-readiness checklist

The polish list above is what makes the product feel finished. This is what
makes it safe to put a stranger's team data in. Each line is verified against
the repo on 2026-09-22; ✔ means done today, ✘ means not, ◐ means partial.
Work the ✘ rows in the order given inside each block; Block A is the gate.

### A. Front door and identity (gate — nothing else matters if these fail)

- [x] ✔ Homepage resolves to The Same Page on the primary domain (N-1)
- [x] ✔ 404 page is ours, not Prism Tree's (N-2)
- [x] ✔ Marketing header "Sign in" / "Start free" reach the app (N-3)
- [x] ✔ One canonical app URL, set in Vercel + Railway `FRONTEND_URL` +
  Supabase redirect allow-list + `header.html`; magic link round-trips
  from it (N-4)
- [x] ✔ Legacy `(marketing)` routes on the Vercel domain redirected or
  removed; `robots.txt` disallows `/app/` (N-8)
- [x] ✔ Login page says an account is created, not just "Sign in" (P1-6)

### B. Money and entitlement

Decided 2026-09-24 (Andrew): **the first 20 managers get 3 months free.**
The site says exactly that, in four places (homepage hero and closing band,
both blog templates), as a plain statement with no live counter. Every CTA is
"Start free" to app.thesamepage.xyz/app/login, so signing up claims it.

Decided the same day, behind the sentence:
- **Manager 21 onward:** a 14-day free trial, then $20/mo.
- **Day 91 (founders) / day 15 (trials):** the account goes **read-only**.
  They can still see everything, nothing new saves, and a banner asks them to
  subscribe. No data is deleted or hidden.
- **Stripe:** not before launch. Launch is a free beta with the clock and
  the read-only gate enforced. Stripe ships before the first 14-day trial
  ends. Until it does, the banner's subscribe path is "email Andrew", and he
  flips the row by hand.
- **Who counts:** managers only. An invited direct report never takes a
  founding place or gets a clock. Accounts that exist before the migration
  (Andrew's and the test accounts) are comped, with no clock, and don't count
  toward the 20.

- [x] Billing decision made and written down (P0-1), 2026-09-24.
- [x] **Record founding status and a clock per manager.** Activate the
  dormant `subscriptions` table (one row per manager, keyed on `user_id`,
  already read-only to the user under RLS, already carrying
  `stripe_customer_id` and `status in (... 'trialing', 'active' ...)`) rather
  than adding `orgs.plan`. `organizations_update_own` lets a user write their
  own org row, so a plan column there would be self-editable. The migration
  adds `founding_number int unique check (1..20)` and `trial_ends_at
  timestamptz`, plus a SECURITY DEFINER `ensure_entitlement()` that acts only
  on `auth.uid()`, skips users with an accepted invite, and on first call
  takes an advisory lock, hands out the next founding number while fewer
  than 20 exist (3 months), and otherwise gives 14 days. Existing users are
  backfilled as `active`/comped. It's called through the user's own JWT
  client, so there's no service-role on the request path. Dated migration +
  `schema.sql` edit, verified against `local_verify_stub.sql`, including a
  21-signups concurrency test.
- [x] **Read-only gate.** One FastAPI middleware (not 92 route edits)
  returns 402 on POST/PUT/PATCH/DELETE under `/api/*` when the caller's
  clock has run out. The allowlist is the entitlement endpoint and invite
  accept. `GET /api/entitlement` reports status and days left.
- [x] **Tell the user.** The app shell shows a quiet "N days left" note in
  the last 7 days and an expired banner with the subscribe path. `api.ts`
  turns a 402 into that banner instead of a generic error.
  *Built 2026-09-24:* `2026-09-24_founding_entitlement.sql`,
  `read_only_gate` in `main.py`, `<EntitlementNotice />`. See ENGINEERING.md,
  "Entitlement and the read-only gate".
- [ ] ✘ **Stripe before the first trial expires** (earliest: 21st sign-up
  + 14 days). Checkout + webhook write `subscriptions` via the service-role
  client (a webhook is not a user request path). Andrew creates the Stripe
  product and enters the bank details himself.
- [ ] Optional copy: the site says nothing about what happens after the
  first 20. Adding "Everyone else: 14 days free." would make it true for #21.

### C. Security and data isolation

- [x] ✔ RLS on every table; `SECURITY DEFINER current_org_id()` pattern
  (`docs/ENGINEERING.md` → Never inline a users subquery)
- [x] ✔ Every request path uses `get_authenticated_client()`; the service
  role client is called nowhere in `backend/routes/` (verified by grep —
  only `utils.py:133` defines it and `scripts/seed_forkcast_demo.py` uses it)
- [x] ✔ Token verification cached per process with TTL from the JWT `exp`
  (`utils.py:70–100`)
- [x] ✔ CORS restricted to `FRONTEND_URL` + localhost (`main.py:15–23`)
- [x] ✔ Rate limits on every AI-calling route (14 `@limiter.limit`
  decorators; transcribe at 30/min, the rest 10/min)
- [x] ✔ Rate limits on non-AI writes. Every POST/PUT/PATCH/DELETE without its
  own decorator gets `DEFAULT_WRITE_LIMIT` (120/min per route per IP, in
  `utils.py`); reads are not throttled. `SlowAPIMiddleware` moved before
  `CORSMiddleware` so its 429 carries CORS headers (it still sits outside the
  read-only gate). Pinned by `tests/test_rate_limits.py`.
- [x] ✔ Rotate the `ANTHROPIC_API_KEY` sitting in plaintext in `backend/.env`
  inside the Obsidian vault. Rotated 2026-09-24: production now runs on one
  service-account key, `tsp-railway-2026-09b`; the three older keys (including
  the never-used `tsp-local` that sat in the vault) are deleted and
  `backend/.env` holds no key. `OPENAI_API_KEY` and the Supabase keys were
  never in that file (blank locally, Railway only), so no rotation needed.
  The repeatable process is ENGINEERING.md → Rotating secrets. Andrew still
  deletes the key note in `Polish List Before Launch.md`.
- [ ] ✘ Migrate Supabase to `sb_publishable_…` / `sb_secret_…` keys before
  Supabase retires the legacy `anon`/`service_role` JWTs (end of 2026).
  Needs `supabase` ≥ 2.16 in `backend/requirements.txt` (2.9.1 rejects
  non-JWT keys), then Railway + Vercel values, verify, and "Disable JWT-based
  API keys". Logs nobody out. Steps in ENGINEERING.md → Rotating secrets.
- [x] ◐ Security headers on the Vercel app. `next.config.js` `headers()` now
  sends HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`,
  `Permissions-Policy` (mic for this origin only) and a CSP. The CSP is
  **Report-Only** until a signed-in walk (login, prep, dictation) shows no
  console violations; then rename the header to `Content-Security-Policy`.
- [x] ✔ `auth/callback/route.ts` only honours a `next` under `/app/` (and
  refuses `//` or a backslash); anything else goes to the dashboard. The
  invite flow's `/app/ic?invite=…` still passes.
- [ ] ◐ Supabase Auth hardening in the dashboard (not in repo, cannot
  verify here): magic-link expiry, rate limit on OTP sends, Site URL = the canonical app URL from N-4.

### D. Observability — you cannot see a production failure today

- [ ] ◐ Error monitoring. **Backend wired:** `init_sentry()` in
  `observability.py`, called from `main.py`, keyed on `SENTRY_DSN` (not
  `ENVIRONMENT`), so it does nothing until the variable exists. Errors only,
  no PII, the user id and route attached to each event. **Left for Andrew:**
  create the Sentry project and set `SENTRY_DSN` on Railway. `@sentry/nextjs`
  on the frontend is not done (it wants the same account). The `/health`
  endpoint's own comment records that the first dictation outage was
  "indistinguishable from a vendor outage at the client".
- [x] ✔ Structured logging. One JSON line per record on stdout
  (`observability.py`); every line carries the request's route and user id
  through a request-context middleware, with no change at the call site. All
  silent `except Exception:` blocks in `routes/` now log: info for the
  `.single()` lookups that are really 404s, warning for optional AI calls,
  error for failures that leave data incomplete (a Mission Control domain,
  Away's outside meetings, storage upload, extraction). The `print()` calls
  were already gone from app code (only `scripts/` prints, as a CLI should).
  `utils.py`'s JWT-shape fallback stays silent on purpose, with a comment.
- [ ] ✘ Uptime check on `/health` (Railway, Better Uptime, or a free cron
  pinger) that alerts you, not the customer.
- [ ] ✘ Product analytics. Nothing in `frontend/` emits an event. Even a
  page-view + "first prep sheet saved" pair tells you whether the golden
  path is being walked. PostHog or Vercel Analytics; one afternoon.
- [x] ✔ AI cost visibility. Every provider call in `ai_core.py` (text,
  document, tools, the OpenAI fallback, and dictation, which
  `routes/transcribe.py` calls through it) logs one `ai_call` line: provider,
  kind, model, input/output tokens, latency, plus audio bytes for dictation.
  Failures log `ai_call_failed` with the status. Filter Railway logs on
  `ai_call` to see the bill forming. No prompt, transcript or audio is ever
  logged.

### E. Data safety

- [ ] ✘ Supabase backups confirmed. Free tier has none; Pro has daily with
  7-day retention; PITR is an add-on. Decide, enable, and do one restore
  drill into a throwaway project before a customer exists.
- [ ] ✘ Schema drift check. `database/schema.sql` declares 52 tables and
  there are 31 dated migrations; the rule says both move together. Run
  `schema.sql` against `local_verify_stub.sql` once more as a clean gate,
  and diff a `pg_dump --schema-only` of production against it.
- [ ] ✘ Account deletion and data export. No route deletes a user or org
  (16 `@router.delete` handlers, all for child records); no export. For a
  product whose pitch is "you own the record", a manager needs to be able to
  take it and leave. Minimum: a documented manual path you can run in a day;
  better: `DELETE /api/settings/account` + a JSON export. Effort M.
- [ ] ✘ Sub-processor and legal pages updated for OpenAI (N-10) and the
  four open questions in `gtm/site/legal.md` answered.

### F. Reliability and performance

- [x] ✔ Nav fan-out (N-5) fixed or cached — the app currently does 11+
  round-trips to Railway per page, and Railway's single instance is the
  ceiling `utils.py:47–52` already warns about.
- [x] ✔ Backend serialised every request (found 2026-09-22 while chasing
  Team's load time). Every route was `async def` around the synchronous
  Supabase client, so one uvicorn worker ran one request's queries at a time,
  across all users, and AI calls froze the whole API for their full duration.
  Each request also rebuilt two HTTP clients, reloading the CA bundle (~140 ms
  of CPU under the GIL) and opening fresh TLS to Supabase. Handlers are now
  plain `def` on the thread pool, and per-request clients share one pooled
  transport. Measured against a fake Supabase at 80 ms per query, Team's 13
  requests: 1 user 3.5 s → 0.8 s, 3 concurrent users 10 s → 1.0 s, 10 users
  30 s → 1.7 s. `GET /api/setup-status` (7 sequential queries) is now the
  slowest single call on that page.
- [x] ✔ Railway: confirm the service is not on a sleeping/hobby plan (cold
  starts read as "the app is broken" to a first-time user); set a
  healthcheck path to `/health` and restart policy.
  **Checked 2026-09-22 in the dashboard (service `thesamepage`, project
  `divine-clarity`).** Serverless (scale-to-zero) is off, so no cold starts.
  Restart policy is On Failure with 10 retries. `/health` answers
  `{"status":"ok"}` in production. Andrew set Healthcheck Path to `/health` the
  same evening (default 300 s timeout).
- [x] ✔ Vercel: confirm production env vars (`NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_BACKEND_URL`) are set on the
  Production environment, not only Preview. The backend variable is
  `NEXT_PUBLIC_BACKEND_URL` (`lib/api.ts`), not `NEXT_PUBLIC_API_URL`.
  **Verified 2026-09-22 from the live production build**, not the dashboard.
  Signed-in `/app/team` on thesamepage-blush.vercel.app calls
  thesamepage-production.up.railway.app: 16 `/api/` requests, all 200, done
  2.1 s after navigation. An unset backend variable falls back to
  `localhost:8000` and nothing would load. Supabase auth works through the
  middleware, which needs both Supabase variables. Confirmed in the Vercel
  dashboard the same evening. `NEXT_PUBLIC_BACKEND_URL` is set on Production
  and Preview. `NEXT_PUBLIC_SUPABASE_URL` and `_ANON_KEY` come from the Supabase
  integration and are Production only, so preview deployments cannot sign in.
  That's fine for launch; add them to Preview if previews are ever used for
  testing. Domains: only thesamepage-blush.vercel.app is attached, so
  `app.thesamepage.xyz` does not resolve yet (see the custom-domain item).
- [ ] ✘ Pagination on list endpoints (`docs/ENGINEERING.md` → Open
  questions). Fine at one team; a manager who imports 40 reports and a year
  of 1:1s will feel it. Post-launch is acceptable; note it.
- [x] ✔ `frontend/app/app/error.tsx` + `not-found.tsx` (N-7).

### G. Verification and release discipline

- [x] ✔ Tests exist: `backend/tests/` has 8 modules (Scribe, Away, org
  units, Mission Control engine + routes, 1:1s, demo seed). Note
  `docs/ENGINEERING.md` → Open questions no longer says there are no tests
  or CI; that bullet now records that CI reports but doesn't gate deploys.
- [x] ✔ CI. `.github/workflows/ci.yml` runs `pytest` + `pip-audit` and
  `tsc --noEmit` + `npm audit` on every push, against a clean checkout, which
  is exactly what would have caught the half-committed change that broke main
  for seven hours. It reports; it doesn't block the Railway/Vercel deploys.
  First run happens on this push; check the Actions tab once.
- [x] ✔ Dependency audit, 2026-09-24. `pip-audit` flagged fastapi,
  starlette, python-multipart, python-dotenv, cryptography and pytest; all
  bumped and now clean. FastAPI stops at 0.136.3, because 0.137 hides routes
  from slowapi's middleware and the default write limit silently stops
  (`tests/test_rate_limits.py` catches it). `npm audit` flagged a critical
  Next.js RCE, sharp and a Next-bundled PostCSS: `next` floor raised to
  `^15.5.26` and PostCSS forced to 8.5.28 by an override, 0 vulnerabilities, and
  `next build` passes. Both audits now run in CI.
- [x] ✔ A written rollback: `docs/ENGINEERING.md` → Rolling back a bad push
  (Vercel Instant Rollback, Railway rollback, `git revert`, forward-only
  migrations run by Andrew).
- [x] ✔ Commit this file. `docs/PRELAUNCH_BACKLOG.md` is tracked.
  `Polish List Before Launch.md` and the two `gtm/research/` documents are
  still untracked, deliberately left to Andrew.

### H. Launch-day mechanics (do the week before)

- [ ] ✘ Walk the golden path on a brand-new email on the canonical domain:
  magic link → first report → first prep sheet → first wrap-up, on a phone
  and a laptop, with the browser console open. Every "Loading…" and every
  empty state on that path is the first impression.
- [ ] ✘ Seed data cleared from the production org, or a separate demo org.
  The live account today shows the Forkcast demo team (Jordan Breedlove,
  Pip Haberlin…); make sure a screenshot for the site is not also the data a
  founding member can see if invited into the wrong org.
- [ ] ✘ Founding-places form → what happens next is written down: who gets
  the email, what they reply, how the account is provisioned, and by when.
- [ ] ✘ Support path exists: a `support@` or `hello@` address that reaches
  you, linked from Settings → Your account and the marketing footer.
