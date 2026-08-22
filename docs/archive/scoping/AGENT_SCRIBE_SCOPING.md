> **ARCHIVED — historical, not current intent.** The Scribe, built and shipped. Current behavior: `docs/systems/scribe.md`.

# The Scribe — Scoping Brief

*Conversational data entry for The Same Page. Drafted Session 32 (2026-08-12), following the chat-surface mockup review. "The Scribe" is a working name, not a brand decision.*

---

## What this is

A conversational agent the manager talks to instead of filling out forms. "One project is to build out HubSpot to support our LatAm go-to-market launch — it's connected to Activate the Army" becomes a created project, linked to the right goal, after a short back-and-forth and an explicit confirm. Forms remain fully available; the chat is a parallel path, not a replacement.

This is the **write side** of the agent layer scoped in Session 25 (`docs/archive/scoping/COO_AGENT_QUESTION_SET.md`). It ships before the consult ("COO") mode because its correctness is verifiable — either the right rows and links were created or they weren't — and every conversation that enters data makes the future consult mode smarter. Both modes will eventually share this same surface.

---

## Locked decisions (do not relitigate)

**Tools are the existing API. No new write paths.** The agent's tools are thin wrappers over the same FastAPI route handlers the UI calls. RLS and validation apply by construction; the agent can never do anything a user couldn't do by clicking. If a tool needs something the API can't do, the API gets the feature first, as a normal endpoint, then the tool wraps it.

**Draft-then-commit, always.** The agent never writes silently. It assembles a draft entity rendered as a card in the thread; conversation refines the card; nothing persists until the manager confirms. This extends the app's existing draft-then-review posture (wrap-up extraction, assessment drafts, Librarian confirm card).

**Minimum viable record + questioning restraint.** Each entity has a small required set and everything else is optional. The agent asks at most one or two clarifying questions per draft, and only for genuine forks (assignee: you or a report?). It creates with honest gaps — "No due date yet — add one anytime" — never interrogates, never fabricates.

**Entity linking rules.** High-confidence semantic match → prefilled in the draft card, visibly marked as a link. Ambiguous (multiple plausible matches) → ask, showing the candidates. No match → say so and offer to create the entity. A silently wrong link is the worst failure mode this feature has; when in doubt, ask.

**Surface: the Drawer (Option A), with command-bar summon.** Locked from the three-mockup review (`chat-surface-a-drawer.html` is the reference). Spec below.

**v1 is create + append only.** Creating and linking records, logging check-ins and commitments — all additive. Editing existing records and anything destructive is explicitly out of v1; the blast radius of a misunderstood edit is too large to take on while trust in the feature is still being earned.

---

## Surface spec — the Drawer

A persistent right-hand panel, ~400px, available on every authenticated page.

- **Open:** header button (✦, right of the nav) and a keyboard shortcut that opens the drawer with the composer focused — one keystroke from anywhere to talking. Proposed: `⌘J` (`⌘K` is conventionally search/command-palette; keep it free for a future palette). `Esc` closes.
- **Persistence:** the thread survives navigation between pages, and open/closed state persists per session. Closing the drawer never discards an unconfirmed draft — reopening shows it where you left off.
- **Layout behavior:** content reflows beside the drawer (not an overlay), matching the mockup. Mission Control's 3-column grid should degrade to acceptable at laptop width with the drawer open — verify at 1280px during build.
- **Composer:** placeholder copy does the teaching: "Tell me what's happening — I'll keep the pages up to date." Hint line: shortcut + "Nothing saves until you confirm."
- **Page context:** the agent knows what page the drawer is open over and may use it to resolve references ("give *him* a commitment" while on Jordan's page), but must state the resolution in the draft card, never apply it invisibly.

### The draft card

One card per pending entity, rendered inline in the thread:

- Header: entity type + a "Draft — not saved" badge (amber, matching the app's existing needs-attention convention).
- Fields: filled values plain; **resolved links** in the green linked style with the matched record's real name (so a wrong match is visible before confirm); **empty optionals** in muted text ("none yet"), never nagged about.
- Actions: **Confirm** (primary, names the action — "Create project"), **Edit details** (flips fields to inline inputs — the escape hatch when talking is slower than typing), **Discard**.
- After confirm: card collapses to a one-line receipt with a link to the created record — "✓ Project created · View in Projects" — plus **Undo** for a grace window (undo of a create is a delete of a record nothing else references yet; cheap and safe).
- Multi-entity utterances ("create the project and give Jordan a commitment to own discovery") produce one card per entity, confirmed independently.

---

## v1 verb set

Six verbs, all create/append, all mapping to existing endpoints:

1. **Create project** — title required; optional: linked goal, assignee (self or DR), due date, description, success-metric text, status (default active).
2. **Create goal** — title + level required (if level is unstated, ask — it's a real fork with four options); optional: description, success metric, linked DR for individual goals, period.
3. **Link project ↔ goal** — for projects that exist or are in-draft.
4. **Log a check-in** — on a goal or initiative: status and/or %, one-line note. Uses the Session 26 check-in primitive; this is the "update goal progress" case and likely the highest-frequency verb long-term.
5. **Add a commitment** — direct report required (or team-level flag), text required; optional due date, source.
6. **Add a direct report** — name required; optional role/team assignment via existing pickers' endpoints.

Explicitly out of v1: edits to existing records, deletes, assessments (has its own scored draft flow), meeting notes/callouts (candidate for v1.1 — they're append-only text and would be easy), anything in Settings, Context Engine uploads, and consult-mode questions (the agent answers "I can't advise yet — soon" politely rather than improvising).

*Slot schemas above are from product docs; verify required/optional against `schema.sql` and the actual route signatures in the build session before locking each MVR.*

---

## Entity linking spec

- Candidate pool: same-org records of the target type, via existing list endpoints (RLS-scoped for free).
- Matching: name/semantic similarity — exact ≻ substring ≻ semantic. The model doing the matching sees candidate names + levels/status as tool output and picks with a stated confidence; it does not free-associate.
- High confidence → prefill, marked. Ambiguous → ask with candidates as tappable options ("Which goal? · Onboard 2 new AU Support Reps · Improve Onboarding Efficiency"). None → "I don't see a goal like that — create it?" (which spawns a second draft card, per multi-entity rule).
- People resolution uses the roster (small N, first-name matching is usually decisive); page context may break ties but must be surfaced.

---

## Architecture sketch

- **One new endpoint:** `POST /api/assistant/message` — takes the thread + new utterance, runs a server-side Claude tool-use loop, returns agent text + zero or more draft-entity payloads. Same pattern as existing AI routes (prep generation, wrap-up extraction): Claude-native, server-side, no client-side keys.
- **Tools:** an allowlist of read tools (list goals/projects/reports/org-units — for linking) and *zero* direct write tools. The model's "write" is emitting a structured draft payload; the actual write happens only when the client calls the normal existing endpoint (`POST /api/projects` etc.) on confirm. This is the cleanest enforcement of both locked rules: the model literally cannot write, and confirms go through the exact code path the forms use.
- **Thread persistence:** a small `assistant_messages` table (org-scoped RLS, same pattern as `team_messages`) so the drawer's thread survives reloads and devices. Drafts live in the thread as message payloads until confirmed/discarded; no separate drafts table.
- **Date parsing** ("end of Q3", "next Friday") happens in the model with today's date in the prompt; the resolved absolute date must appear in the draft card — the card is where hallucinated dates get caught.

---

## Eval set (write before any UI)

Fifteen utterances with expected outcomes, run against the agent loop via script in the first build session. The point: the agent's behavior is specified by examples before it exists, same eval-first approach as the COO question set.

1. The flagship: "One project is to build out HubSpot to support our LatAm GTM launch, connected to Activate the Army." → project draft, goal linked high-confidence, one clarifier (assignee).
2. Same, plus "assign it to me, due end of Q3" → no clarifiers, date resolved to Sep 30.
3. "Add a goal for the team: cut onboarding time to 14 days by December." → goal draft, level=team inferred from "for the team", success metric captured.
4. "New goal: improve NRR." → level unstated → asks which level (the legitimate clarifier case).
5. "Link the HubSpot project to the onboarding goal." → ambiguous ("Improve Onboarding Efficiency" vs "Onboard 2 new AU Support Reps") → asks with candidates.
6. "Log a check-in on Activate the Army — we're at 40%, on track, LatAm hiring closed." → check-in draft with %, status, note.
7. "Jordan committed to drafting the discovery doc by Friday." → commitment draft on Jordan, date resolved.
8. "Leah's taking PTO the last week of August." → time off is NOT in the verb set → agent says it can't do that yet and points to the DR page. (Or: promote time off into the verb set — decide during scoping review.)
9. "Add a project for the Q4 offsite, connected to the culture goal." → no matching goal → offers to create it → two draft cards on acceptance.
10. "Create a project to migrate billing and give Leah a commitment to own the vendor eval." → multi-entity: two cards.
11. On Jordan's DR page: "add a commitment for him to shadow two AU calls." → page-context resolution to Jordan, stated in the card.
12. "Delete the Value Engine goal." → out of scope; polite refusal, points at the Goals page.
13. "How is Jordan doing?" → consult-mode question; polite "not yet."
14. "Mark Onboard New US CSMs at 50%" phrased as an edit → recognized as a check-in (verb 4), not an edit.
15. Vague: "we had a good week." → no entity extractable → agent asks one open question, does not invent a draft.

Pass = correct draft payload(s) or correct clarifier/refusal; a wrong link or invented field anywhere is a fail even if the rest is right.

---

## Proposed session sequence

**S1 — Agent loop + eval harness (no UI).** `POST /api/assistant/message`, read tools, draft-payload schema, the 15-utterance eval running as a script with pass/fail output. Exit: ≥13/15 passing, failures understood.

**S2 — Drawer UI + confirm flow.** The drawer (toggle, shortcut, reflow, persistence), thread rendering, draft card with confirm→existing-endpoint writes, receipts + undo. Exit: flagship utterance works end-to-end in the browser against live data.

**S3 — Hardening + dogfood.** Multi-entity, ambiguity UX, page context, edit-in-card, thread persistence table, then a real week of Andrew entering everything through the drawer. Exit: dogfood verdict on what v1.1 needs (likely: meeting notes/callouts verb, time off verb, first edit verbs).

Verification standard per session follows the house pattern: real-Postgres tests for anything schema-touching, `tsc`/`next build` clean, and — per the Session 31 lesson — at least the flagship path exercised in a real browser against live Supabase before calling it done.

---

## Open questions (decide at S1 kickoff, none block the sequence)

1. Naming: does the manager talk to "The Same Page," or does the scribe get a persona? (The Librarian precedent says personas work in this app — but two named characters is approaching the metaphor budget. Recommendation: it's just "The Same Page" for now.)
2. Time off + meeting notes: promote into v1's verb set (both are easy appends) or hold for v1.1? (Recommendation: hold — six verbs is already a real surface to verify.)
3. Undo window: fixed grace period vs. undo-until-navigate. (Recommendation: until the receipt scrolls away or 5 minutes, whichever first — decide by feel in S2.)
4. Does the drawer answer *any* read questions in v1 ("what goals do I have?") since the read tools exist anyway? (Recommendation: yes to trivial lists — it feels broken to refuse — but no analysis/judgment; that's the COO's job later.)
