# Notes Ingestion — Scoping Doc

**Scoped:** 2026-08-17 (Cowork session with Andrew) · **Status:** scoped, build not started
**Supersedes:** the Session 8 deferral ("Google Drive meeting-notes import") in SESSION_HISTORY.md

---

## 1. Problem & goal

Managers already take 1:1 notes somewhere else — Gemini (Google shops), Granola, Teams Copilot, Otter, Fireflies, plain docs. Today the only way those notes reach The Same Page is copy-paste into the Call Notes pane. That's friction on the single most important loop in the product: log what actually happened.

**Goal:** any time a note is created in an external system for a meeting between a manager and one of their direct reports, it shows up in The Same Page automatically — as a *pending 1:1 ready to review*, never as a silently auto-logged record.

**North-star UX:** manager finishes a 1:1 on Meet with Gemini notes on → 10 minutes later The Same Page shows "Gemini notes from your 1:1 with Sarah are ready" → one click lands on the existing wrap-up review screen, pre-filled → confirm → logged, commitments extracted, loop closed. The integration saves the copy-paste, not the judgment.

---

## 2. Design principles (settled this session)

1. **One pipeline, many sources.** Build the matching engine + review queue once; every note source (Google, email-in, webhook, Microsoft) is just an adapter that drops a normalized note into the same pipeline. Never build source-specific matching or review logic.
2. **Draft-then-review stays locked.** Session 8's rule — AI-extracted commitments never enter the record unseen — applies with full force to auto-ingested notes. An ingested note produces a *pending* item, and the existing wrap-up review component (`wrap-up-review.tsx`) is the landing surface. This was explicitly anticipated in Session 8: "the wrap-up review component is the shared surface for future note sources."
3. **The calendar is the join key.** Regardless of source, matching a note to a manager–DR pair uses attendee emails + meeting time. Both sides' emails are already in the system (managers via auth, DRs via `direct_reports.email` / the Session 22 invite flow).
4. **Never guess on ambiguity.** A note that doesn't cleanly match exactly one manager–DR pair goes to an "unmatched notes" holding state, not into anyone's record. Wrong-person attachment is the worst failure mode (notes are private, sensitive people-data).
5. **Ingest narrowly.** Only pull notes for meetings whose attendee set matches a known manager + DR pair. Do not hoover the manager's whole calendar/Drive. This is both a trust posture and what keeps OAuth scope review defensible.

---

## 3. Architecture

```
 Source adapters                 Core pipeline                    Existing surfaces
┌──────────────────┐   ┌──────────────────────────────┐   ┌───────────────────────────┐
│ Google (Meet API) │──▶│ inbound_notes (raw + meta)   │──▶│ pending 1:1 on planned/   │
│ Email-in address  │──▶│  → matcher (attendees+time)  │   │ new one_on_ones row       │
│ Generic webhook   │──▶│  → dedupe (source,external_id)│   │  → wrap-up review screen  │
│ MS Graph (later)  │   │  → matched / unmatched /     │   │  → /app/1-1s queue        │
└──────────────────┘   │    ignored                    │   └───────────────────────────┘
                       └──────────────────────────────┘
```

### 3a. Normalized inbound note

Every adapter reduces its source to the same shape before anything else happens:

- `source` ('google_meet' | 'email' | 'webhook' | ...), `external_id` (dedupe key — e.g. Meet conferenceRecord name, email Message-ID)
- `raw_text` (the note/transcript content), `title`, `source_url` (link back to the original doc)
- `attendee_emails[]`, `meeting_started_at`, `meeting_ended_at`
- `manager_id` (the account whose connection/address produced it)

### 3b. Matching engine (the real product work)

Given a normalized note for manager M:

1. **Pair match:** filter `attendee_emails` to non-M addresses; if exactly one matches a `direct_reports.email` under M → candidate DR. Extra attendees who match nothing (a recruiter, a skip-level) → still ambiguous → unmatched. Two DRs present → unmatched (it wasn't a 1:1).
2. **Session match:** if M has a *planned* session for that DR (prep_guide set, summary null — the Session 9 derived-status contract), attach the note to that row. Otherwise create a new `one_on_ones` row in a new **note-pending** state (see 4).
3. **Dedupe:** `(source, external_id)` unique — re-syncs and duplicate webhooks are no-ops.
4. **Unmatched inbox:** notes that fail step 1 are listed somewhere lightweight ("We received notes we couldn't match — link them or dismiss"). Manual link from here is also the escape hatch for DRs whose email in TSP ≠ their calendar email.

### 3c. Review queue

The `/app/1-1s` page (nav pass 2 — owns the 1:1 loop) gets a new top-priority triage state: **"Notes ready to review"**, above "due" and "prepped-not-run". Clicking one opens the wrap-up flow with Call Notes pre-filled from `raw_text` → existing `POST /api/one-on-ones/wrapup` extraction → existing review screen → confirm saves via the normal endpoint. Nothing downstream of the pre-fill is new code.

Also: a dismissal path ("not a 1:1 / don't log this") that marks the inbound note ignored and deletes the pending row.

---

## 4. Data model sketch

New tables (migration):

```sql
-- one row per connected external source per manager
integration_connections (
  id uuid pk, owner_id uuid → users, org_id uuid,
  provider text ('google_meet' | ...),
  access_token / refresh_token (encrypted at rest), scopes text[],
  sync_cursor jsonb,          -- e.g. last poll time, Events API subscription name
  status text ('active'|'error'|'revoked'), last_synced_at, created_at
)

-- normalized inbound notes, pre-match
inbound_notes (
  id uuid pk, owner_id uuid → users (manager), org_id uuid,
  source text, external_id text, unique(source, external_id, owner_id),
  title text, raw_text text, source_url text,
  attendee_emails text[], meeting_started_at timestamptz,
  match_status text ('matched'|'unmatched'|'ignored'),
  matched_direct_report_id uuid null, matched_one_on_one_id uuid null,
  created_at
)
```

RLS: owner-scoped (same posture as `one_on_ones.notes` — private to the manager), org via `current_org_id()` (never inline users subqueries — RLS recursion lesson).

**`one_on_ones` status contract — decision needed.** Status is derived, never stored (locked, Session 9). An ingested-but-unreviewed note is a *third* state: not planned (may have no prep_guide), not completed (no summary). Two options:

- **(a) Derive it:** planned/pending rows carry `matched` inbound note → "notes-ready" = `one_on_ones.id` referenced by an `inbound_notes.matched_one_on_one_id` where `summary` is still null. No schema change to `one_on_ones`, keeps the no-stored-status rule intact. **Recommended.**
- (b) Add a stored status column — rejected; violates the Session 9 contract and its recency-filter fixes.

With (a), the completed-only recency filters (prep route + dashboard/overview) are automatically safe: pending rows have null summary and are already excluded.

---

## 5. Phase 1 — Google native connector (Gemini notes)

Andrew's own daily case (Agriweb is a Google shop) and the best demo. Verified against current Google docs (Aug 2026):

- The **Google Meet REST API** exposes conference artifacts directly: recordings, transcripts, and **smart notes ("Notes by Gemini") — GA since April 2, 2026** (`conferenceRecords.smartNotes.get/list`). Smart notes and transcripts link to the underlying Google Doc via `DocsDestination.document` (a Docs API `documentId`).
- The **Google Workspace Events API** supports push subscriptions for Meet events, including `google.workspace.meet.smartNote.v2.fileGenerated` — i.e., a webhook-style signal the moment Gemini finishes generating the notes doc.

**Flow:**
1. Manager connects Google in Settings → Integrations (OAuth, offline access / refresh token).
2. Sync loop finds recent conference records for the user, filters to those whose participants match a manager+DR pair (participant emails via the Meet API / matched calendar event attendees).
3. For matching conferences: pull smart notes artifact → resolve `DocsDestination.document` → read doc text via **Docs API `documents.get`**. Fallback when Gemini notes weren't on: pull the transcript artifact instead (entries expire after 30 days, so sync promptly).
4. Drop the normalized note into the pipeline (§3).

**Scopes (keep minimal, avoid restricted-tier Drive):** `meetings.space.readonly` (conference records + artifacts), `documents.readonly` (read the notes doc), `calendar.events.readonly` (attendee/time matching where Meet participant data is insufficient). Avoiding `drive.readonly` matters: Drive scopes are *restricted* (annual security assessment); Meet/Docs/Calendar scopes are sensitive-tier (verification questionnaire only).

**Poll first, push later.** V1 = a scheduled sync (cron every 10–15 min per active connection, listing conference records since `sync_cursor`). The Events API push path (`smartNote.v2.fileGenerated`) requires a Google Cloud Pub/Sub topic + renewal management — real infra. Fold it in once polling proves the pipeline; 10-minute latency is fine for this use case.

**OAuth verification reality:** the app runs as "unverified" (warning screen, 100-user cap) until Google's verification passes — fine for dogfooding at Agriweb, but budget calendar time for verification before selling into other Google shops.

## 6. Phase 2 — Email-in address (the universal adapter)

Per-manager secret ingestion address (`notes-{token}@in.thesamepage.app`, via an inbound-email service à la Postmark/SendGrid Inbound Parse). Covers every tool that can share or forward by email — including Gemini's own post-meeting email, Granola shares, and humans forwarding notes. Adapter parses attendees (To/Cc + names in body where available) and timestamp; anything unparseable lands in the unmatched inbox, which is acceptable here. Secret-token address is the spam/spoofing defense; rotateable in Settings.

## 7. Phase 3 — Generic webhook + templates; Microsoft later

`POST /api/integrations/notes` with a per-connection secret: `{external_id, title, text, attendee_emails[], started_at}`. Publish Zapier/Make templates for Granola, Otter, Fireflies. Microsoft Graph (Teams/Copilot recaps) is a Phase-1-sized native build — do it when a Microsoft-shop customer exists, not before.

---

## 8. Privacy & trust posture

- Ingested notes inherit the `one_on_ones.notes` posture: private to the manager, owner-scoped RLS. ICs never see raw notes; they see whatever the existing sharing surfaces already show.
- Only meetings matching a known manager+DR pair are ever pulled or stored (§2.5). The unmatched inbox holds *received* notes (email/webhook pushes we couldn't match), not speculative pulls.
- Tokens encrypted at rest; disconnect in Settings revokes + deletes the connection row.
- Settings → Integrations copy should say exactly what is read and what is ignored — this is a differentiating trust moment, not fine print.

## 9. Open questions (for the build session)

1. **Gemini licensing:** smart notes require the org's Workspace edition to include Gemini in Meet — true at Agriweb; detect-and-degrade (transcript fallback, or email-in) for orgs without it.
2. **DR-owned notes:** if the *DR* ran Gemini notes (only meeting owner can start it), does the manager's Meet API view still expose the artifact? Verify during build with a real Agriweb 1:1; if not, the email-in path covers it.
3. **Where the unmatched inbox lives** — /app/1-1s footer section vs. Settings → Integrations. Lean /app/1-1s (it's triage).
4. **Context Engine / Scribe tie-in (later):** an ingested note is also a prime Context Engine document. V1 should *not* auto-feed it (confirm-card rule applies), but the normalized `inbound_notes` shape should be reusable as a Context Engine source later.
5. Whether the pending row should nudge (email/notification) or rely on the /app/1-1s queue passively. V1: passive queue only.

## 10. Build sequencing

- **Session A:** migration (2 tables) + matching engine + pending-state derivation + /app/1-1s "notes ready" triage row + wrap-up pre-fill entry point. Testable end-to-end with hand-inserted `inbound_notes` rows before any connector exists.
- **Session B:** Google OAuth connect flow in Settings + Meet API poll sync + Docs read + normalized drop-in. Dogfood at Agriweb.
- **Session C (later, as needed):** email-in address; then webhook+Zapier; Events API push; Microsoft Graph.

Dependency note: the "notes ready" queue assumes the /app/1-1s page exists — nav pass 2 (`docs/archive/scoping/ONE_ON_ONES_PAGE_SPEC.md`) should ship first.
