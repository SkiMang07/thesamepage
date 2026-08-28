"use client";

// ---------------------------------------------------------------------------
// The team meeting screen (/app/team/meetings/[id]).
//
// The screen open DURING a team meeting has to answer two questions at once —
// "what were we going to cover" and "what is actually happening" — which is
// why it is two columns rather than a form: the agenda, what carried in, and
// what the team still owes on the left; a live notes pane on the right. Same
// shape as the 1:1 call screen (see docs/systems/one-on-ones.md → The call),
// deliberately, because it is the same moment in a different meeting.
//
// /app/team's MeetingsPanel keeps its inline quick log for "we already met,
// let me write it up in ten seconds." This screen is the other posture: open
// before the meeting starts and type into it while it runs.
//
// Three rules this file inherits and must not bend:
//
//   1. NOTHING IS WRITTEN UNTIL THE MANAGER CONFIRMS. The wrap-up call is a
//      pure draft; components/team/MeetingWrapUpReview.tsx is the only thing
//      that saves, and it is REUSED here rather than reimplemented — a second
//      review surface would drift from this one on exactly the rule that
//      must not drift.
//   2. A logged meeting is frozen. Its date, agenda and repeat rule are not
//      editable here, and PATCH would replace the agenda item set wholesale,
//      destroying the per-item notes written during the wrap-up. The summary
//      is the one edit that survives logging.
//   3. A commitment with no direct_report_id is the MANAGER'S OWN, not a
//      missing value — see docs/decisions/nullable-commitment-owner.md. It
//      renders as "You" and must never be filtered out.
//
// Notes autosave to localStorage, not to the server: team_meetings.raw_notes
// is only written at log time and there is no draft-notes endpoint. That
// buys back a refresh or a closed tab mid-meeting, and nothing more, so the
// pane says so in as many words rather than implying the notes are on the
// account — the same honesty posture as "we don't send calendar invites" and
// store-only team messages.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  DirectReport,
  TeamCommitment,
  TeamMeeting,
  TeamMeetingWrapUpDraft,
  TeamMember,
  getDirectReports,
  getTeam,
  getTeamCommitments,
  getTeamMeetings,
  updateCommitment,
  updateTeamMeeting,
  updateTeamMeetingSummary,
  wrapUpTeamMeeting,
} from "@/lib/api";
import MeetingWrapUpReview, { AgendaOutcome } from "@/components/team/MeetingWrapUpReview";
import PageShell from "@/components/PageShell";
import NoteField from "@/components/NoteField";
import {
  BADGE,
  BTN_GHOST,
  BTN_PRIMARY,
  BTN_PRIMARY_SM,
  BTN_SECONDARY,
  CARD_PAD,
  ERROR_TEXT,
  EYEBROW,
  INPUT,
  META,
  TEXTAREA,
} from "@/lib/tokens";

// Local (not UTC) YYYY-MM-DD. scheduled_at is a timestamp encoded at noon
// UTC; parsing a bare date string through new Date() treats it as UTC
// midnight, which reads as "yesterday" anywhere west of Greenwich. Same
// three helpers /app/team keeps locally — they travel with the pages that
// render dates rather than being a shared module nobody would find.
function localDateStr(d: Date = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isoToDateStr(iso: string) {
  return localDateStr(new Date(iso));
}

function formatMeetingDate(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function formatShortDate(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function isOverdue(dateStr: string) {
  return dateStr < localDateStr();
}

function repeatLabel(weeks: number) {
  return weeks === 1 ? "Repeats weekly" : `Repeats every ${weeks} weeks`;
}

// --- notes autosave ---------------------------------------------------------
// Keyed by meeting so two open meetings don't overwrite each other, and
// cleared the moment the meeting is logged — a draft that outlives the record
// it belongs to is worse than no draft. Every access is wrapped: localStorage
// throws outright in some privacy modes, and losing the autosave is not a
// reason to take the meeting screen down.

type StoredNotes = {
  extraNotes: string;
  outcomes: AgendaOutcome[];
};

function notesKey(meetingId: string) {
  return `tsp.meeting-notes.${meetingId}`;
}

function readStoredNotes(meetingId: string): StoredNotes | null {
  try {
    const raw = window.localStorage.getItem(notesKey(meetingId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredNotes;
    if (typeof parsed?.extraNotes !== "string" || !Array.isArray(parsed?.outcomes)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStoredNotes(meetingId: string, value: StoredNotes) {
  try {
    window.localStorage.setItem(notesKey(meetingId), JSON.stringify(value));
  } catch {
    /* private mode, quota, no storage — the pane still works, it just won't survive a refresh */
  }
}

function clearStoredNotes(meetingId: string) {
  try {
    window.localStorage.removeItem(notesKey(meetingId));
  } catch {
    /* nothing to do */
  }
}

export default function TeamMeetingPage() {
  const { id } = useParams<{ id: string }>();

  const [meeting, setMeeting] = useState<TeamMeeting | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [directReports, setDirectReports] = useState<DirectReport[]>([]);
  const [commitments, setCommitments] = useState<TeamCommitment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [outcomes, setOutcomes] = useState<AgendaOutcome[]>([]);
  const [extraNotes, setExtraNotes] = useState("");
  const [draft, setDraft] = useState<TeamMeetingWrapUpDraft | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [nextMeeting, setNextMeeting] = useState<TeamMeeting | null>(null);
  const [justLogged, setJustLogged] = useState(false);

  // Set once the fetched meeting has seeded the notes state, so the autosave
  // effect can tell "the manager typed something" apart from "we just
  // restored what they typed last time."
  const hydrated = useRef(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getTeamMeetings(), getTeam(), getDirectReports(), getTeamCommitments()])
      .then(([allMeetings, team, reports, teamCommitments]) => {
        if (cancelled) return;
        const found = allMeetings.find((m) => m.id === id) ?? null;
        setMeeting(found);
        setMembers(team);
        setDirectReports(reports);
        setCommitments(teamCommitments);
        if (found && found.status !== "logged") {
          const stored = readStoredNotes(found.id);
          const storedById = new Map((stored?.outcomes ?? []).map((o) => [o.id, o]));
          // Seeded from the agenda, not from storage, so an item added or
          // removed since the last visit is reflected — restored notes are
          // merged onto the CURRENT agenda by item id.
          setOutcomes(
            found.agenda_items.map((item) => ({
              id: item.id,
              covered: storedById.get(item.id)?.covered ?? true,
              notes: storedById.get(item.id)?.notes ?? "",
            }))
          );
          setExtraNotes(stored?.extraNotes ?? "");
          if (stored) setSaveState("saved");
          hydrated.current = true;
        }
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Failed to load this meeting");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Debounced so a fast typist isn't writing to storage on every keystroke.
  useEffect(() => {
    if (!hydrated.current || !meeting || meeting.status === "logged") return;
    setSaveState("saving");
    const timer = setTimeout(() => {
      writeStoredNotes(meeting.id, { extraNotes, outcomes });
      setSaveState("saved");
    }, 600);
    return () => clearTimeout(timer);
  }, [extraNotes, outcomes, meeting]);

  const orgUnitById = new Map(directReports.map((dr) => [dr.id, dr.org_unit_id]));

  // Whose names the owner picker offers. A meeting with a null org_unit_id
  // applies to every team, so it offers everyone — same convention as a null
  // org_unit_id callout.
  const scopedMembers =
    meeting?.org_unit_id == null
      ? members
      : members.filter((m) => orgUnitById.get(m.id) === meeting.org_unit_id);

  // A null direct_report_id is the manager's own commitment and has no team
  // to derive, so it shows under every meeting — never filter it out.
  const openCommitments = commitments
    .filter((c) => c.status === "open")
    .filter(
      (c) =>
        meeting?.org_unit_id == null ||
        c.direct_report_id == null ||
        orgUnitById.get(c.direct_report_id) === meeting.org_unit_id
    )
    .sort((a, b) => {
      if (a.due_date === b.due_date) return 0;
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return a.due_date < b.due_date ? -1 : 1;
    });

  // What the wrap-up actually reads: every agenda item that has notes, headed
  // by the item so the model knows which topic it belongs to, plus whatever
  // came up off-agenda. Same assembly as the quick-log path, so the two
  // routes hand the extractor identically shaped notes.
  function assembleRawNotes(current: TeamMeeting) {
    const parts = current.agenda_items
      .map((item) => {
        const outcome = outcomes.find((o) => o.id === item.id);
        if (!outcome?.notes.trim()) return null;
        return `${item.item}:\n${outcome.notes.trim()}`;
      })
      .filter(Boolean) as string[];
    if (extraNotes.trim()) parts.push(`Other:\n${extraNotes.trim()}`);
    return parts.join("\n\n");
  }

  async function runWrapUp(current: TeamMeeting) {
    const rawNotes = assembleRawNotes(current);
    if (!rawNotes.trim() || extracting) return;
    setExtracting(true);
    setError(null);
    try {
      setDraft(await wrapUpTeamMeeting(current.id, rawNotes));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to draft the wrap-up");
    } finally {
      setExtracting(false);
    }
  }

  function onLogged(result: { meeting: TeamMeeting; next_meeting: TeamMeeting | null }) {
    clearStoredNotes(result.meeting.id);
    setMeeting(result.meeting);
    setNextMeeting(result.next_meeting);
    setJustLogged(true);
    setDraft(null);
  }

  if (loading) {
    return (
      <PageShell maxWidth="6xl">
        <p className="text-ink-secondary">Loading...</p>
      </PageShell>
    );
  }

  if (loadError || !meeting) {
    return (
      <PageShell maxWidth="6xl">
        <Link href="/app/team" className="text-sm text-ink-secondary hover:underline">
          ← Team
        </Link>
        <p className={`${ERROR_TEXT} mt-6`}>
          {loadError ?? "That meeting doesn't exist, or it isn't one of yours."}
        </p>
      </PageShell>
    );
  }

  const dateStr = meeting.scheduled_at ? isoToDateStr(meeting.scheduled_at) : null;
  const coveredCount = outcomes.filter((o) => o.covered).length;
  const carriedCount = meeting.agenda_items.filter((i) => i.carried_from_item_id).length;

  const header = (
    <>
      <Link href="/app/team" className="text-sm text-ink-secondary hover:underline">
        ← Team
      </Link>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            {dateStr ? formatMeetingDate(dateStr) : "Team meeting"}
          </h1>
          <p className="mt-1 text-sm text-ink-secondary">
            Team meeting
            {meeting.recurrence_weeks ? ` · ${repeatLabel(meeting.recurrence_weeks)}` : ""}
          </p>
        </div>
        <StatusChip status={meeting.status} />
      </div>
    </>
  );

  // -------------------------------------------------------------------------
  // Review — the confirm step. Full width and alone on the screen: the
  // agenda and the notes have already done their job, and what is left is
  // reading what will be written before it is written.
  // -------------------------------------------------------------------------
  if (draft) {
    return (
      <PageShell maxWidth="6xl">
        {header}
        <div className="mt-6 max-w-3xl">
          <MeetingWrapUpReview
            meeting={meeting}
            members={scopedMembers.map((m) => ({ id: m.id, name: m.name }))}
            rawNotes={assembleRawNotes(meeting)}
            draft={draft}
            outcomes={outcomes}
            onBack={() => setDraft(null)}
            onSaved={onLogged}
          />
        </div>
      </PageShell>
    );
  }

  // -------------------------------------------------------------------------
  // Logged — the record. Everything is frozen except the wording of the
  // summary, which destroys nothing to correct.
  // -------------------------------------------------------------------------
  if (meeting.status === "logged") {
    return (
      <PageShell maxWidth="6xl">
        {header}

        {justLogged && (
          <div className="mt-6 rounded-xl border border-hairline bg-brand-tint px-4 py-3">
            <p className="text-sm font-medium text-ink">Meeting logged.</p>
            {nextMeeting ? (
              <p className="mt-1 text-sm text-ink-body">
                {nextMeeting.scheduled_at
                  ? `Your next one is set for ${formatMeetingDate(isoToDateStr(nextMeeting.scheduled_at))}`
                  : "Anything you carried forward is waiting on a meeting that still needs a date"}
                {" — "}
                <Link
                  href={`/app/team/meetings/${nextMeeting.id}`}
                  className="underline hover:text-ink"
                >
                  open it
                </Link>
                .
              </p>
            ) : (
              <p className={`${META} mt-1`}>
                No follow-up meeting was created — nothing carried forward and this one doesn&apos;t
                repeat.
              </p>
            )}
          </div>
        )}

        <div className="mt-6 space-y-4">
          <SummaryCard meeting={meeting} onSaved={setMeeting} />

          <div className={CARD_PAD}>
            <p className={EYEBROW}>What was covered</p>
            {meeting.agenda_items.length === 0 ? (
              <p className={`${META} mt-2`}>This meeting had no agenda.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {meeting.agenda_items.map((item) => (
                  <li key={item.id} className="border-l-2 border-hairline pl-3">
                    <p className="text-sm font-medium text-ink-body">
                      <span className="mr-1.5 text-ink-muted">{item.covered ? "✓" : "○"}</span>
                      {item.item}
                      {!item.covered && (
                        <span className={`${BADGE} ml-2 bg-sunken font-normal text-ink-muted`}>
                          not covered
                        </span>
                      )}
                    </p>
                    {item.notes && (
                      <p className="mt-1 whitespace-pre-wrap text-sm text-ink-secondary">
                        {item.notes}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {meeting.raw_notes && (
            <details className={CARD_PAD}>
              <summary className={`${EYEBROW} cursor-pointer`}>Your raw notes</summary>
              <p className="mt-3 whitespace-pre-wrap text-sm text-ink-secondary">
                {meeting.raw_notes}
              </p>
            </details>
          )}
        </div>
      </PageShell>
    );
  }

  // -------------------------------------------------------------------------
  // Open — the meeting itself. Agenda, what carried in and what's still owed
  // on the left; what's actually happening on the right.
  // -------------------------------------------------------------------------
  return (
    <PageShell maxWidth="6xl">
      {header}

      {!dateStr && <UndatedNotice meetingId={meeting.id} onSaved={setMeeting} />}

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        {/* Left — what you planned to cover, and what the team already owes */}
        <div className="space-y-4">
          <div className={CARD_PAD}>
            <div className="flex items-center justify-between gap-2">
              <p className={EYEBROW}>Agenda</p>
              {meeting.agenda_items.length > 0 && (
                <p className={META}>
                  {coveredCount} of {meeting.agenda_items.length} covered
                </p>
              )}
            </div>
            {carriedCount > 0 && (
              <p className={`${META} mt-1`}>
                {carriedCount === 1
                  ? "1 item carried in from your last meeting."
                  : `${carriedCount} items carried in from your last meeting.`}
              </p>
            )}

            {meeting.agenda_items.length === 0 ? (
              <p className={`${META} mt-3`}>
                No agenda for this one — type what happens in the notes and the wrap-up will still
                pull out the commitments.
              </p>
            ) : (
              <div className="mt-3 space-y-4">
                {meeting.agenda_items.map((item) => {
                  const outcome = outcomes.find((o) => o.id === item.id);
                  return (
                    <div key={item.id}>
                      <label className="flex items-start gap-2 text-sm font-medium text-ink-body">
                        <input
                          type="checkbox"
                          checked={outcome?.covered ?? false}
                          onChange={(e) =>
                            setOutcomes((rows) =>
                              rows.map((o) =>
                                o.id === item.id ? { ...o, covered: e.target.checked } : o
                              )
                            )
                          }
                          className="mt-1 h-3.5 w-3.5 shrink-0 rounded border-control"
                        />
                        <span className="flex-1">
                          {item.item}
                          {item.carried_from_item_id && (
                            <span
                              className={`${BADGE} ml-2 border border-hairline font-normal text-ink-muted`}
                            >
                              carried
                            </span>
                          )}
                          {!outcome?.covered && (
                            <span className={`${BADGE} ml-2 bg-sunken font-normal text-ink-muted`}>
                              carries forward
                            </span>
                          )}
                        </span>
                      </label>
                      {outcome?.covered && (
                        <NoteField
                          value={outcome.notes}
                          onChange={(v: string) =>
                            setOutcomes((rows) =>
                              rows.map((o) =>
                                o.id === item.id ? { ...o, notes: v } : o
                              )
                            )
                          }
                          rows={2}
                          className="mt-1.5 text-sm"
                          placeholder="What was said..."
                          aria-label={`Notes for ${item.item}`}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className={CARD_PAD}>
            <div className="flex items-center justify-between gap-2">
              <p className={EYEBROW}>Open team commitments</p>
              {openCommitments.length > 0 && <p className={META}>{openCommitments.length}</p>}
            </div>
            {openCommitments.length === 0 ? (
              <p className={`${META} mt-2`}>Nothing outstanding from previous meetings.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {openCommitments.map((c) => (
                  <CommitmentRow
                    key={c.id}
                    commitment={c}
                    onResolved={(updated) =>
                      setCommitments((rows) =>
                        rows.map((row) => (row.id === updated.id ? updated : row))
                      )
                    }
                  />
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Right — what's actually happening, live */}
        <div className="lg:sticky lg:top-8 lg:self-start">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold">Meeting notes</h2>
            <span className={META}>
              {saveState === "saving" ? "Saving..." : saveState === "saved" ? "Saved" : ""}
            </span>
          </div>
          <p className={`${META} mt-1`}>
            Type as you go, or paste from whatever you record with. Notes are held in this browser
            until you log the meeting — they aren&apos;t saved to your account yet, and won&apos;t
            follow you to another device.
          </p>
          <NoteField
            value={extraNotes}
            onChange={setExtraNotes}
            rows={16}
            className="mt-3 text-sm"
            placeholder={
              "– Pipeline is thin for Q4, whole team flagged it\n– I'll get the hiring req open with recruiting this week\n– Dana will own the QBR deck"
            }
            aria-label="Meeting notes"
          />
          {error && <p className={`${ERROR_TEXT} mt-2`}>{error}</p>}
          <button
            type="button"
            onClick={() => runWrapUp(meeting)}
            disabled={extracting || !assembleRawNotes(meeting).trim()}
            className={`${BTN_PRIMARY} mt-3 w-full`}
          >
            {extracting ? "Drafting..." : "Wrap up & log →"}
          </button>
          <p className={`${META} mt-2`}>
            You&apos;ll review the summary and every commitment before anything is saved.
          </p>
        </div>
      </div>
    </PageShell>
  );
}

function StatusChip({ status }: { status: TeamMeeting["status"] }) {
  if (status === "logged") {
    return <span className={`${BADGE} bg-brand text-on-brand`}>Logged</span>;
  }
  if (status === "needs_log") {
    return <span className={`${BADGE} bg-amber-50 text-amber-700`}>Needs logging</span>;
  }
  return <span className={`${BADGE} bg-sunken text-ink-secondary`}>Not logged yet</span>;
}

// A meeting with no date is the carry-forward shell the backend creates when
// items carried but there was no series to roll forward — the one case where
// this screen can be a dead end, so it offers the fix rather than sending the
// manager back to /app/team for it. Date only: the repeat rule re-anchors a
// series, which belongs with the rest of the agenda edit.
function UndatedNotice({
  meetingId,
  onSaved,
}: {
  meetingId: string;
  onSaved: (meeting: TeamMeeting) => void;
}) {
  const [date, setDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!date || saving) return;
    setSaving(true);
    setError(null);
    try {
      onSaved(await updateTeamMeeting(meetingId, { scheduledAt: date }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to set the date");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-6 rounded-xl border border-dashed border-hairline px-4 py-3">
      <p className={EYEBROW}>This meeting has no date yet</p>
      <p className={`${META} mt-1`}>
        It was created to hold what carried forward from your last meeting. Give it a date so it
        sorts with the rest.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className={`${INPUT} w-auto`}
          aria-label="Meeting date"
        />
        <button type="button" onClick={save} disabled={!date || saving} className={BTN_SECONDARY}>
          {saving ? "Saving..." : "Set date"}
        </button>
      </div>
      {error && <p className={`${ERROR_TEXT} mt-2`}>{error}</p>}
      <p className={`${META} mt-1`}>The Same Page doesn&apos;t send calendar invites.</p>
    </div>
  );
}

function CommitmentRow({
  commitment,
  onResolved,
}: {
  commitment: TeamCommitment;
  onResolved: (updated: TeamCommitment) => void;
}) {
  const [saving, setSaving] = useState(false);

  async function markDone() {
    if (saving) return;
    setSaving(true);
    try {
      onResolved(await updateCommitment(commitment.id, "done"));
    } finally {
      setSaving(false);
    }
  }

  const overdue = commitment.due_date ? isOverdue(commitment.due_date) : false;

  return (
    <li className="flex items-start justify-between gap-2 rounded-lg border border-hairline bg-sunken px-3 py-2">
      <div className="min-w-0">
        <p className="text-sm text-ink-body">{commitment.description}</p>
        <p className={META}>
          {/* A null direct report is the manager's own commitment — see
              docs/decisions/nullable-commitment-owner.md. */}
          {commitment.direct_report_name ?? "You"}
          {commitment.due_date && (
            <span className={overdue ? "text-amber-700" : undefined}>
              {" · "}
              {overdue ? "Overdue " : "Due "}
              {formatShortDate(commitment.due_date)}
            </span>
          )}
        </p>
      </div>
      <button type="button" onClick={markDone} disabled={saving} className={BTN_GHOST}>
        {saving ? "Saving..." : "Done"}
      </button>
    </li>
  );
}

// The one edit a logged meeting accepts. updateTeamMeetingSummary sends the
// summary alone rather than the shared PATCH body, whose nulls would read as
// "clear the date and the repeat rule" — and whose agenda replacement would
// destroy the per-item notes below.
function SummaryCard({
  meeting,
  onSaved,
}: {
  meeting: TeamMeeting;
  onSaved: (meeting: TeamMeeting) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(meeting.summary ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!text.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      onSaved(await updateTeamMeetingSummary(meeting.id, text.trim()));
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save the summary");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={CARD_PAD}>
      <div className="flex items-center justify-between gap-2">
        <p className={EYEBROW}>Summary</p>
        {!editing && (
          <button
            type="button"
            onClick={() => {
              setText(meeting.summary ?? "");
              setEditing(true);
            }}
            className={BTN_GHOST}
          >
            Edit
          </button>
        )}
      </div>

      {editing ? (
        <>
          <NoteField
            value={text}
            onChange={setText}
            rows={5}
            className="mt-2 text-sm"
            aria-label="Meeting summary"
          />
          {error && <p className={`${ERROR_TEXT} mt-2`}>{error}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className={BTN_SECONDARY}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving || !text.trim()}
              className={BTN_PRIMARY_SM}
            >
              {saving ? "Saving..." : "Save summary"}
            </button>
          </div>
        </>
      ) : (
        <p className="mt-2 whitespace-pre-wrap text-sm text-ink-body">{meeting.summary}</p>
      )}
    </div>
  );
}
