# Team — implementation brief for Claude

## Authorization and design authority

Andrew selected the Team concept on September 25, 2026 and requested an implementation handoff to Claude, including the subsequent meeting-experience improvements. Implement the redesign in the existing application. This is a Team task, separate from Mission Control implementation.

The selected visual and interaction reference is `prototype.html` in this folder. It contains its own HTML, CSS, and JavaScript; there is no separate Team `prototype-source.html`. Open it in a browser and inspect its source. It works as a standalone file without the temporary localhost preview server.

`EXPLORATION.md` records the original assessment, observed account evidence, scope findings, and prototype limitations. This brief supersedes its original unapproved status. The three improvements below are requested additions to the selected direction; they have not been visually prototyped. Integrate them with the same restrained design language rather than treating the old prototype as an exhaustive interaction specification.

Do not modify or overwrite a separate Mission Control handoff in `docs/HANDOFF.md`. That file was absent during the design exploration; do not assume it is still absent. Preserve unrelated and concurrent changes, including shell and Mission Control changes. Do not commit, push, deploy, seed production, or change live account records as part of this implementation request. Validate writes against local/test data.

## Read and inspect first

1. `CLAUDE.md`, `docs/DESIGN.md`, `docs/systems/brand.md`, and `docs/systems/team.md`.
2. This brief, `EXPLORATION.md`, and `prototype.html`.
3. `docs/design-proposals/2026-09-24-week-in-focus/BUILD_BRIEF.md`, `prototype-source.html`, and clickable `prototype.html` for the selected Mission Control visual direction. The Team prototype owns Team composition; do not duplicate the Mission Control dashboard.
4. `gtm/personas/new-manager.md` and `gtm/brand/voice-rules.md` for the audience and wording. The target includes first-time managers and managers within roughly their first five years.
5. Current Team implementation, the canonical meeting screen, meeting review components, shared shell/tokens, and the relevant API contracts. Read `docs/ENGINEERING.md` before backend/API changes, and targeted subsystem docs when needed (for example check-ins, development, org-scoping, and nullable commitment ownership).

Likely entry points, to verify against the current checkout:

- `frontend/app/app/team/page.tsx`
- `frontend/app/app/team/meetings/[id]/page.tsx`
- `frontend/components/team/MeetingWrapUpReview.tsx`
- `frontend/components/team/WrapUpReviewShell.tsx`
- `frontend/components/PageShell.tsx`, `ZoneMap.tsx`, and existing shell components
- `frontend/lib/api.ts`, `frontend/lib/tokens.ts`, `frontend/app/globals.css`
- `backend/routes/team.py`, relevant commitment/project/goal routes, and `database/schema.sql`

Start with a short implementation assessment identifying reusable components and any real data-contract gaps, then proceed with the supported work. Resolve ordinary implementation choices autonomously. Surface material new storage, privacy, or product-scope decisions with a concrete proposal; do not silently broaden this task into a new subsystem.

## Product purpose and experience

Team helps the manager understand and support the team as a unit: prepare and run collective conversations, see shared work and its owners, and carry decisions into follow-through. Andrew wants the product to feel useful enough that managers look forward to opening it and capturing things there.

The desired payoff is preparedness, easy capture, and visible follow-through. The visual direction is editorial, human, calm, and engaging. Keep purposeful whitespace, teal/carbon surfaces, readable typography, names and avatars, and short summaries that expand into evidence. Suggestions remain secondary. Avoid motivational taglines, gamification, decorative charts, fabricated health scores, and oversized recommendation banners.

## Selected page composition

- Existing app shell and navigation, with global Quick add, Scribe, account actions, and current logo. The prototype's simplified shell is not a replacement specification.
- Editorial Team heading with selected scope, concise manager-only privacy language, and early human presence through the roster preview. All teams remains the default; use actual led-team choices.
- Compact in-page navigation to meetings, shared work, commitments, and people.
- Team meeting identity card: actual team/date/repeat state, compact agenda preview, explicit Plan → Run → Wrap up lifecycle, a state-appropriate primary action, and access to every open meeting and history. Never show a completed Run step merely because the date passed.
- Quiet Must-knows and training focus alongside the meeting area. Edit each scope's private text block in place.
- Shared work: exception-first goals/projects, expanding to real updates, explicitly connected work, named owners, and supporting records. Healthy/neutral and standalone work remain reachable. Do not mislabel a standalone project as deficient.
- Commitments: ordered by due date with explicit overdue/due/undated states, three initial rows and an accurate expansion count, ownership filters, source drill-downs, and real completion actions. Counts must reconcile with visible/expanded records.
- Compact full roster with each person's canonical Relationship Desk as primary destination. Keep secondary work context, private update records, and account access under Team details.

Adapt sizes and spacing to the actual shell. Preserve the reference's visual hierarchy rather than copying raw CSS or inserting an iframe.

## Addition 1: a meeting that feels prepared

Enrich preparation with a compact, expandable view of:

- What carried over: actual carried agenda items with their provenance.
- What changed: relevant recorded updates since a clearly identified boundary, preferably the prior logged meeting for the same scope when supported.
- What needs a decision: explicitly recorded requests/blockers or manager-selected topics. Do not infer a decision request from every overdue commitment or invent new health judgments.

Each entry needs a source, a date when available, and an explanation of why it is shown that can be inspected. Keep evidence separate from the saved agenda. Let the manager choose whether to add an item, avoid duplicates, and preserve source relationships where supported. Existing carried-forward agenda items must not be inserted a second time.

Use deterministic existing records where possible. If no prior meeting or suitable event timestamp is available, label the actual basis or omit the comparison; do not claim something changed when only a current state is known. Source failure is different from no new items. Do not expose private 1:1, assessment, or Relationship Desk content in a team-meeting agenda automatically. AI suggestions, if used, stay draft-then-review through the existing AI layer.

The current prototype demonstrates an agenda, not this richer preparation view. Build the addition as a compact extension, keeping the meeting primary and evidence available on demand. If durable decision records are not supported, use existing agenda/notes/summary records honestly rather than inventing a decision database.

## Addition 2: easy capture in context

Provide an inline “Add something to discuss…” entry in the planned meeting workspace. The manager should be able to enter a thought and add it without completing a multi-field form. Person/work association is optional, only when existing data contracts support it; capture must work without those associations.

Persist the actual agenda item using the existing API path, show a truthful saving/saved/failure state, retain the text if saving fails, and keep focus ready for the next entry. Do not report success before the write succeeds. Prevent duplicate submissions. Respect frozen agendas on logged meetings, and avoid replacing agenda item identities or losing in-progress notes through wholesale agenda updates.

Do not label existing browser-only draft notes as synced to the account. Preserve the distinction between a persisted agenda item, local in-progress meeting notes, an AI draft, and a confirmed logged record. Use restrained feedback and motion that respects reduced-motion preferences.

## Addition 3: visible meeting outcomes

After the manager reviews and confirms wrap-up, show a compact, inspectable receipt of what was actually saved:

- Decisions captured in the reviewed summary or other existing supported record, clearly labeled as such.
- Confirmed commitments and their owners/due dates, including You for manager-owned items.
- Items carried forward and the resulting next meeting/date or undated planning requirement.

Build this receipt from the successful server response and refreshed records. Avoid making extra writes to manufacture a receipt. Never count unchecked draft commitments, discarded AI text, or proposed decisions as recorded outcomes. Preserve the existing summary correction flow and actual series rollover. Provide useful links to the logged meeting, resulting commitments, and next occurrence.

Do not introduce unsupported standalone decision objects. If decisions are only part of the summary, show that reviewed summary with an honest label and source. Failed confirmation must retain the draft and never display a success receipt. Handle retries without creating duplicate commitments or next meetings.

Names and avatars should also appear in agenda/work details where a real association exists. A shared owner or similar wording alone is not evidence of a goal/project/commitment link.

## Data, scope, privacy, and integrity

All names, dates, counts, statuses, connections, and records in the prototype are either fictional fixtures or a partial, dated account snapshot. Neither dataset belongs in production components. Do not ship the dataset selector, preview labels, demo dialogs, sample AI draft, fake dates, or local-only save behavior.

The exploration found a discrepancy between Team documentation and current filter code. Recheck the latest implementation before editing. At inspection, the page used:

| Object | Existing behavior to preserve |
|---|---|
| Scope menu | Caller’s led org units; All teams default |
| People | Caller’s own direct reports; exact selected org unit, not descendants |
| Projects | Selected unit plus ancestors; null-team projects only under All teams |
| Goals | Company goals always visible; otherwise selected unit plus ancestors; null-team non-company goals are not universal |
| Commitments | Explicit team first, fallback to assignee's team; neither means All teams only; null assignee means You |
| Meetings | Exact team plus null-team/all-teams meetings; no parent cascade |
| Must-knows and training focus | Separate exact-scope text blocks, including All teams |

The subsystem prose described broader null-team behavior in places. Do not broaden access or change team membership semantics to match that prose during this visual redesign. Preserve correct current behavior and document the discrepancy or align docs with verified behavior. An inherited goal/project does not authorize fetching an out-of-scope person's private records or commitments.

All Team content stays manager-only. Private updates remain store-only; invitation creation does not send email. Must-knows are private manager context, not a team announcement. Preserve auth/RLS and all `CLAUDE.md` hard rules: authenticated client, central API layer, central AI layer, and review before AI writes.

Use actual check-ins for any percentages or historical charts. Distinguish no recorded progress from 0%, and stale recorded values from current ones. No average team score, invented activity, inferred meeting times, or inferred links. Charts are optional; the chosen concept does not need them.

## Preserve the complete meeting lifecycle

Keep the canonical meeting screen for running a meeting and quick log on Team for recording a meeting already held. Both must use the shared review implementation, item-level notes/coverage, off-agenda notes, editable reviewed summary and commitments, and carry-forward choices.

Preserve browser-local draft-note recovery and its truthful copy. Agenda/date/repeat freeze after logging; summary correction remains allowed. Logged meetings cannot be deleted; deleting a planned meeting also stops its series. Dates do not alone determine completion. Recurrence remains 1–4 weeks and anchors to the prior scheduled date, skipping past occurrences. Carry-forward merges into an existing suitable open occurrence or creates an undated one when appropriate. Scheduling sends no invitation.

The prototype does not implement actual persistence, series rollover, deletion, auth, or complete canonical destination flows. Those limitations must not become implementation omissions. Use real application behavior for them.

## Validation and delivery

Implement in the existing React/Next.js structure with shared components and semantic tokens. Reuse existing capabilities before adding API surface. If a necessary schema change is proposed, follow the project migration/schema/local-verification rules; do not apply migrations to production in this task.

Check the rendered result against the prototype at desktop sizes around 1440px and 1024px, narrow/mobile widths, and with Scribe open. Check long names, large rosters, multiple open meetings, expanded records, and keyboard focus through updates. Use readable contrast and text labels for status, not color alone.

Use meaningful tests for changed behavior, especially:

- Every scope rule above, All teams versus a selected team, parent inheritance labels, null ownership/team, and clearing incompatible selections.
- No cross-manager or unintended cross-team evidence exposure; scope-sensitive caches and drafts reset or remain keyed correctly.
- Counts and drill-downs agree; no double-counting linked work or stale counts after writes.
- Inline capture succeeds, preserves text on failure, avoids duplicate submissions, and does not alter logged agendas or orphan notes.
- Preparation sources are correctly dated, deduplicated, scoped, and optional; no invented “changed” or “decision needed” claims.
- Draft review does not save; confirmation saves only reviewed included items; failure retains drafts; retries and rollover do not duplicate records.
- Post-meeting outcomes match stored records and link to the real resulting occurrence.
- Empty, loading, partial-error, undated, no-check-in, and stale-check-in states stay distinguishable.

Run the repository's relevant build/type/lint and targeted tests. Validate the write paths in a safe local/test environment, never against Andrew's live records just to exercise the UI. If credentials or test infrastructure prevent a check, report exactly what remains unverified.

After implementation, update the relevant canonical Team/design documentation to reflect shipped code, preserving superseded durable content per project rules. Keep this proposal as the design reference. Summarize what changed, how it was verified, and any real limitations or open decisions. Do not claim the three new refinements were already shown in the original prototype. Do not commit, push, or deploy unless separately requested.
