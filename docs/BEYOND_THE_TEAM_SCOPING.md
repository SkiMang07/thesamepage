# Beyond the Team — Scoping Doc

**Scoped:** 2026-09-22 (Cowork session with Andrew) · **Status:** Phase 1 built
(current state in `docs/systems/beyond.md`); Phase 2 not started

---

## 1. Problem & goal

A manager's week is not only their own team. They have a 1:1 with their boss, a
skip-level with their boss's boss, conversations with indirect reports, peer
managers' team meetings, cross-functional project meetings. Today The Same Page
has nowhere to put any of it, so the decisions, asks and feedback from those
rooms never reach the goals, commitments and 1:1 prep they affect.

**Goal:** a clearly signposted space where a manager logs meetings outside their
own team, keeps a running record with the people they meet, and — only where a
meeting actually touches their team — routes what came out of it into the
surfaces they already use.

**The guardrail:** the core product stays about managing your own team. This
space is a real nav item, not hidden, but its *outputs* are what reach the rest of
the app. It never gets its own Mission Control card.

---

## 2. Decisions (settled this session)

1. **Its own space, in the nav.** Andrew's call: hiding it behind a quick action
   makes it hard to find, and the meeting types are broad and frequent enough to
   earn a home. Label **"Beyond the team"**, route `/app/beyond`, placed in the
   **People** group after Assessments (`NAV_GROUPS` in `components/ZoneMap.tsx`).
   Rejected labels: "Meetings" (collides with team meetings), "Stakeholders"
   (corporate, against `gtm/brand/voice-rules.md`), "Leadership & peers" (drops
   project meetings), "Other meetings" (accurate but empty).
2. **In scope:** 1:1s with your boss and skip-level, indirect reports, peers;
   peer managers' team meetings; cross-functional and project meetings. A meeting
   can have nothing to do with your team — it still gets logged, it just doesn't
   route anywhere.
3. **Organised by people, not only by meetings.** A small list of the people you
   meet outside your team, so "Priya" opens to every meeting, open item and
   commitment between you — the same idea as the person page for a report.
4. **Reuse, don't fork.** Logging uses the same notes pane, dictation
   (`NoteField`) and draft-then-review wrap-up pattern as 1:1s and team meetings.
   Phase 2 series and prep mirror `one_on_one_series` and the prep flow.
5. **Phased.** Phase 1: the space, the people list, logged meetings and the
   routing. Phase 2: recurring meetings with prep, starting with the 1:1 with your
   own boss.

---

## 3. Phase 1 — the space, people, logged meetings

### 3a. Data model

All tables owner-scoped (`owner_id = auth.uid()`), the same flat RLS as
`one_on_ones`. **No IC-visible policy on any of them** — nothing here is ever
readable through an IC login.

```sql
-- people you meet outside your team
outside_people (
  id, org_id, owner_id,
  name text not null,
  relationship text check (relationship in
    ('manager','skip_level','indirect_report','peer','cross_functional','other')),
  role_title text, email text,          -- email reserved for notes-ingestion matching
  notes text,                           -- private
  archived_at timestamptz,              -- archive, not delete (same as direct_reports)
  created_at
)

-- one row per meeting
outside_meetings (
  id, org_id, owner_id,
  title text,                           -- "Q4 pricing working group"
  kind text check (kind in ('one_on_one','group')),
  scheduled_at timestamptz,             -- noon-UTC date, per decisions/meeting-date-is-scheduled-at.md
  notes text,                           -- raw notes, private
  summary text,                         -- confirmed write-up
  logged_at timestamptz,
  created_at
)

-- who was there (a group meeting can have several; a 1:1 has one)
outside_meeting_people (meeting_id, person_id, primary key (meeting_id, person_id))

-- what a meeting touched on your team (confirmed in review)
outside_meeting_links (
  meeting_id,
  goal_id uuid null, project_id uuid null, direct_report_id uuid null,
  note text,                            -- the line that justifies the link
  check (num_nonnulls(goal_id, project_id, direct_report_id) = 1)
)
```

Plus: add `'outside_meeting'` to the `commitments.source_type` check.

Per hard rule 4: a dated migration in `database/migrations/` plus the matching
`schema.sql` edit, verified against `local_verify_stub.sql`.

**Indirect reports are `outside_people`, not links to `direct_reports`.** Their
`direct_reports` row belongs to another manager and is owner-scoped, so you can't
read it. Linking through `led_org_unit_ids()` is a possible later step; not now.

### 3b. Wrap-up: what gets routed

`POST /api/beyond/meetings/{id}/wrapup` is a pure AI call through `ai_core.py` —
**nothing is written**. It returns a draft of:

| Draft item | Lands in, on confirm |
|---|---|
| Summary | `outside_meetings.summary` |
| Commitments you (or your team) now own | `commitments`, `source_type='outside_meeting'`, `source_id` = meeting. Null `direct_report_id` = yours (`decisions/nullable-commitment-owner.md`) |
| Something that moves a goal or initiative | a **draft check-in** on that goal/project (status + note) plus an `outside_meeting_links` row |
| Something said about one of your reports | an `outside_meeting_links` row with `direct_report_id` + note |

`POST /api/beyond/meetings/{id}/log` is the confirmed write. The review step
reuses `MeetingWrapUpReview` (or a thin wrapper around it) rather than a third
review surface. Extraction failure returns an empty draft, never an error.

The extractor only proposes goals, projects and reports the manager actually has,
passed in as a list — it never invents a link. Anything it can't match stays in
the summary.

### 3c. How it reaches the rest of the app

- **Report prep.** `_build_prep_prompt()` gains an optional block of recent
  `outside_meeting_links` for that report, framed as **secondhand** ("Priya
  mentioned in the pricing meeting that…"), never as fact. Private to the manager.
- **Goal / project pages.** Linked meetings appear in that item's history.
- **Commitments.** Show wherever manager-owned commitments already show.
- **Mission Control.** Nothing new. It sees these meetings only through what
  they produce (an overdue commitment, an at-risk goal).

### 3d. The page (`/app/beyond`)

- **People** — your outside people, grouped by relationship, each with last
  met date and open items. Click through to a person view: meeting history,
  commitments between you, links to your team.
- **Recent meetings** — reverse-chronological, with a "Log a meeting" action.
- **Log a meeting** — title, date, who (pick from people or add inline), kind,
  notes pane with dictation, then wrap-up review.
- Nav door state: `last Sep 18` / `nothing logged yet`.

---

## 4. Phase 2 — recurring meetings and prep

Start with the 1:1 with your own boss; the same machinery then covers skip-level
and standing peer 1:1s.

- `outside_meeting_series` mirroring `one_on_one_series` (1–4 week interval,
  anchor, timezone, active), keyed by `(owner_id, person_id)`. Rollover and
  carry-forward behave like 1:1s.
- **Prep for managing up** is the real payoff: the prep for your boss 1:1 is
  built from your team's own data — goals and initiatives at risk, check-in
  movement since last time, commitments you owe them, things carried from last
  time. The product already knows the state of your team; this turns it into
  your update.
- The Away feature's shift-forward logic should include these series.

---

## 5. Out of scope (for now)

- A Mission Control card for this space.
- Linking indirect reports to another manager's `direct_reports` rows.
- Calendar sync or auto-creating meetings.
- A Scribe tool for logging these by conversation — a natural follow-up once
  Phase 1 ships.

---

## 6. Ties to other work

- **Notes ingestion** (`docs/NOTES_INGESTION_SCOPING.md`): the unmatched inbox
  can offer "Log as a meeting beyond the team" instead of only link-or-dismiss.
  `outside_people.email` is what would let those match automatically later.
- **Context Engine:** not wired in Phase 1. Phase 2 prep may want it.

---

## 7. Open questions — resolved 2026-09-22

Andrew took the lean on all three.

1. **Things *they* owe you → extend commitments.** `committed_by` gains
   `'counterpart'`, with `commitments.outside_person_id` naming who. One list to
   work. Consequence: a counterpart row has a null `direct_report_id`, which
   every "null means yours" reader must exclude — see `docs/systems/beyond.md`.
2. **Check-ins from meetings → add the columns.** Nullable `check_ins.source_type`
   / `source_id`, same shape as commitments.
3. **Person view → own route.** `/app/beyond/people/[id]` shipped in Phase 1.
