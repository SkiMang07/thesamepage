"use client";

// ---------------------------------------------------------------------------
// Team meetings on /app/team — one meeting identity card and everything that
// hangs off it: the Plan → Run → Wrap up lifecycle, inline capture,
// preparation, quick log, the shared wrap-up review, and the receipt.
//
// Rules this file keeps (docs/systems/team.md → Meetings):
//   - Status comes from the server (derived from summary). A passed date
//     means "needs wrap-up", never "was run": the Run step is never shown as
//     done, because nothing records that a meeting was run.
//   - Two logging paths: the meeting screen (/app/team/meetings/[id]) runs a
//     meeting; Quick log here writes up one already held. Both assemble raw
//     notes the same way and end in MeetingWrapUpReview — nothing is written
//     until the manager confirms there.
//   - A logged meeting's date/agenda/repeat are frozen; only its summary can
//     be corrected. Deleting a planned meeting also stops its series. No
//     calendar invitation is ever sent.
//   - The receipt is built from what the server saved (the log response
//     merged into the page's records), never from the draft.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  DirectReport,
  OrgUnit,
  Project,
  TeamAgendaItem,
  TeamCommitment,
  TeamGoal,
  TeamMeeting,
  TeamMeetingLogResult,
  TeamMeetingWrapUpDraft,
  TeamMember,
  createTeamMeeting,
  deleteTeamMeeting,
  updateTeamMeeting,
  updateTeamMeetingSummary,
  wrapUpTeamMeeting,
} from "@/lib/api";
import NoteField from "@/components/NoteField";
import MeetingWrapUpReview, { AgendaOutcome } from "@/components/team/MeetingWrapUpReview";
import AgendaCapture from "@/components/team/AgendaCapture";
import MeetingPrepPanel from "@/components/team/MeetingPrepPanel";
import MeetingReceipt from "@/components/team/MeetingReceipt";
import PersonAvatar from "@/components/team/PersonAvatar";
import { derivePrep } from "@/components/team/meeting-prep";
import { deriveOutcomes, mergeLogResult } from "@/components/team/meeting-outcomes";
import { makeScope } from "@/components/team/scope";
import { dueLabel, isoToDateStr, localDateStr, longDate, mediumDate, meetingDateStr, shortDate } from "@/components/team/dates";
import {
  BTN_GHOST,
  BTN_PRIMARY,
  BTN_PRIMARY_SM,
  BTN_SECONDARY,
  ERROR_TEXT,
  INPUT,
  LABEL,
  META,
  SELECT,
} from "@/lib/tokens";

// The meeting the card is "on" by default: the soonest one not yet logged.
// Undated meetings (carry-forward with no series) sort last, so a real date
// always wins. It never looks at whether the date has passed — logging is
// what closes a meeting.
export function openMeetingsInOrder(meetings: TeamMeeting[]): TeamMeeting[] {
  return meetings
    .filter((m) => m.status !== "logged")
    .sort((a, b) => {
      if (!a.scheduled_at && !b.scheduled_at) return a.created_at < b.created_at ? -1 : 1;
      if (!a.scheduled_at) return 1;
      if (!b.scheduled_at) return -1;
      return a.scheduled_at < b.scheduled_at ? -1 : 1;
    });
}

function repeatWords(weeks: number | null): string {
  if (!weeks) return "One-off";
  return weeks === 1 ? "Weekly" : `Every ${weeks} weeks`;
}

function splitAgenda(text: string): string[] {
  return text.split("\n").map((line) => line.trim()).filter(Boolean);
}

type Stage = "plan" | "run" | "wrap";

// Which lifecycle step is current. A planned meeting with an agenda is ready
// to run; a passed, unlogged one needs wrapping up; an undated one still needs
// planning. "Done" is only claimed for Plan (an agenda is recorded).
function currentStage(m: TeamMeeting): Stage {
  if (!m.scheduled_at) return "plan";
  if (m.status === "needs_log") return "wrap";
  return m.agenda_items.length > 0 ? "run" : "plan";
}

type Receipt = { meetingId: string; result: TeamMeetingLogResult | null; note?: string };

export default function TeamMeetingsSection({
  meetings,
  allMeetings,
  setMeetings,
  commitments,
  setCommitments,
  goals,
  projects,
  members,
  directReports,
  orgUnits,
  selectedTeamId,
  unavailable,
  onRefresh,
  narrow,
}: {
  /** Meetings in the selected scope. */
  meetings: TeamMeeting[];
  /** Every meeting — lineage and "last logged meeting" look across scopes. */
  allMeetings: TeamMeeting[];
  setMeetings: React.Dispatch<React.SetStateAction<TeamMeeting[]>>;
  commitments: TeamCommitment[];
  setCommitments: React.Dispatch<React.SetStateAction<TeamCommitment[]>>;
  goals: TeamGoal[];
  projects: Project[];
  members: TeamMember[];
  directReports: DirectReport[];
  orgUnits: OrgUnit[];
  selectedTeamId: string | null;
  /** Sources that failed to load, for preparation's honesty line. */
  unavailable: string[];
  onRefresh: () => Promise<void>;
  narrow: boolean;
}) {
  const open = useMemo(() => openMeetingsInOrder(meetings), [meetings]);
  const logged = useMemo(
    () =>
      meetings
        .filter((m) => m.status === "logged")
        .sort((a, b) => ((a.scheduled_at ?? a.created_at) < (b.scheduled_at ?? b.created_at) ? 1 : -1)),
    [meetings]
  );

  const [focusId, setFocusId] = useState<string | null>(null);
  const [mode, setMode] = useState<"idle" | "plan" | "edit" | "log" | "review">("idle");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [captureSeed, setCaptureSeed] = useState<string | null>(null);
  const [showAllAgenda, setShowAllAgenda] = useState(false);
  const [historySelected, setHistorySelected] = useState<TeamMeeting | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formDate, setFormDate] = useState("");
  const [formAgenda, setFormAgenda] = useState("");
  const [formRepeat, setFormRepeat] = useState<number | "">("");
  const [formSaving, setFormSaving] = useState(false);

  const [outcomes, setOutcomes] = useState<AgendaOutcome[]>([]);
  const [extraNotes, setExtraNotes] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [draft, setDraft] = useState<TeamMeetingWrapUpDraft | null>(null);

  const focus = open.find((m) => m.id === focusId) ?? open[0] ?? null;

  // A new scope is a different set of meetings: drop any half-finished
  // form, quick log or receipt that belonged to the previous one.
  useEffect(() => {
    setFocusId(null);
    setMode("idle");
    setReceipt(null);
    setDraft(null);
    setError(null);
    setShowAllAgenda(false);
  }, [selectedTeamId]);

  const unitName = (id: string | null) =>
    id ? orgUnits.find((u) => u.id === id)?.name ?? "Team" : "All teams";

  const prep = useMemo(() => {
    if (!focus) return null;
    return derivePrep({
      meeting: focus,
      meetings: allMeetings,
      commitments,
      goals,
      projects,
      scope: makeScope(focus.org_unit_id, orgUnits, directReports),
      unavailable,
    });
  }, [focus, allMeetings, commitments, goals, projects, orgUnits, directReports, unavailable]);

  function resetWork() {
    setMode("idle");
    setDraft(null);
    setExtraNotes("");
    setOutcomes([]);
    setError(null);
  }

  function openPlan() {
    setFormDate("");
    setFormAgenda("");
    setFormRepeat("");
    setError(null);
    setReceipt(null);
    setMode("plan");
  }

  function openEdit(m: TeamMeeting) {
    setFormDate(m.scheduled_at ? isoToDateStr(m.scheduled_at) : "");
    setFormAgenda(m.agenda_items.map((i) => i.item).join("\n"));
    setFormRepeat(m.recurrence_weeks ?? "");
    setError(null);
    setMode("edit");
  }

  function openLog(m: TeamMeeting) {
    setOutcomes(m.agenda_items.map((i) => ({ id: i.id, covered: true, notes: "" })));
    setExtraNotes("");
    setDraft(null);
    setError(null);
    setReceipt(null);
    setMode("log");
  }

  async function savePlan() {
    if (!formDate || formSaving) return;
    setFormSaving(true);
    setError(null);
    try {
      const created = await createTeamMeeting({
        scheduledAt: formDate,
        agendaItems: splitAgenda(formAgenda),
        orgUnitId: selectedTeamId,
        recurrenceWeeks: formRepeat === "" ? null : Number(formRepeat),
      });
      setMeetings((rows) => [created, ...rows]);
      setFocusId(created.id);
      resetWork();
    } catch (e) {
      setError(e instanceof Error ? "Couldn't plan the meeting. Nothing was saved — try again." : "Couldn't plan the meeting.");
    } finally {
      setFormSaving(false);
    }
  }

  async function saveEdit() {
    if (!focus || formSaving) return;
    setFormSaving(true);
    setError(null);
    try {
      const updated = await updateTeamMeeting(focus.id, {
        scheduledAt: formDate || null,
        agendaItems: splitAgenda(formAgenda),
        recurrenceWeeks: formRepeat === "" ? null : Number(formRepeat),
        clearRecurrence: formRepeat === "",
      });
      setMeetings((rows) => rows.map((m) => (m.id === updated.id ? updated : m)));
      resetWork();
    } catch (e) {
      setError(e instanceof Error ? "Couldn't save the plan. Your changes are still here — try again." : "Couldn't save the plan.");
    } finally {
      setFormSaving(false);
    }
  }

  async function removeMeeting(m: TeamMeeting) {
    await deleteTeamMeeting(m.id);
    setMeetings((rows) => rows.filter((row) => row.id !== m.id));
    setConfirmingDelete(false);
    setFocusId(null);
    resetWork();
  }

  function onItemAdded(meetingId: string, item: TeamAgendaItem) {
    setMeetings((rows) =>
      rows.map((m) =>
        m.id === meetingId && !m.agenda_items.some((i) => i.id === item.id)
          ? { ...m, agenda_items: [...m.agenda_items, item] }
          : m
      )
    );
  }

  // Same assembly as the meeting screen, so both paths hand the extractor
  // identically shaped notes: each item that has notes, headed by the item,
  // then anything off-agenda.
  function assembleRawNotes(m: TeamMeeting) {
    const parts = m.agenda_items
      .map((item) => {
        const outcome = outcomes.find((o) => o.id === item.id);
        if (!outcome?.notes.trim()) return null;
        return `${item.item}:\n${outcome.notes.trim()}`;
      })
      .filter(Boolean) as string[];
    if (extraNotes.trim()) parts.push(`Other:\n${extraNotes.trim()}`);
    return parts.join("\n\n");
  }

  async function runWrapUp(m: TeamMeeting) {
    const rawNotes = assembleRawNotes(m);
    if (!rawNotes.trim() || extracting) return;
    setExtracting(true);
    setError(null);
    try {
      setDraft(await wrapUpTeamMeeting(m.id, rawNotes));
      setMode("review");
    } catch (e) {
      setError(e instanceof Error ? "Couldn't draft the wrap-up. Your notes are still here — try again." : "Couldn't draft the wrap-up.");
    } finally {
      setExtracting(false);
    }
  }

  function onLogged(result: TeamMeetingLogResult) {
    setMeetings((rows) => mergeLogResult(rows, [], result).meetings);
    setCommitments((rows) => mergeLogResult([], rows, result).commitments);
    setReceipt({ meetingId: result.meeting.id, result });
    setFocusId(null);
    resetWork();
    // Then read back the stored records, so the receipt and every count on the
    // page reflect what the server holds rather than only what it returned.
    void onRefresh();
  }

  async function onAlreadyLogged(meetingId: string) {
    await onRefresh();
    setReceipt({
      meetingId,
      result: null,
      note: "This meeting was already logged, so nothing was saved a second time. This is what the first save stored.",
    });
    setFocusId(null);
    resetWork();
  }

  const receiptMeeting = receipt ? allMeetings.find((m) => m.id === receipt.meetingId) ?? null : null;
  const receiptOutcomes =
    receipt && receiptMeeting && receiptMeeting.status === "logged"
      ? deriveOutcomes(receiptMeeting, allMeetings, commitments, receipt.result)
      : null;

  const others = focus ? open.filter((m) => m.id !== focus.id) : [];

  return (
    <section id="team-meetings" aria-labelledby="team-meetings-heading" className="scroll-mt-6">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 id="team-meetings-heading" className="font-serif text-[1.6rem] font-normal leading-tight tracking-[-0.01em] text-ink">
          Team meetings
        </h2>
        {mode === "idle" && (
          <button type="button" onClick={openPlan} className="text-sm text-brand hover:text-brand-hover">
            + Plan a meeting
          </button>
        )}
      </div>
      {focus ? (
        <MeetingCard
          meeting={focus}
          scopeName={unitName(focus.org_unit_id)}
          busy={mode !== "idle"}
          showAllAgenda={showAllAgenda}
          onToggleAgenda={() => setShowAllAgenda((v) => !v)}
          onPrimary={() => {
            const stage = currentStage(focus);
            if (!focus.scheduled_at) openEdit(focus);
            else if (stage === "wrap") openLog(focus);
          }}
          capture={
            <AgendaCapture
              meeting={focus}
              onAdded={(item) => onItemAdded(focus.id, item)}
              seed={captureSeed}
              onSeedConsumed={() => setCaptureSeed(null)}
            />
          }
          prep={
            prep ? (
              <MeetingPrepPanel
                prep={prep}
                meeting={focus}
                onAddSuggestion={(text) => setCaptureSeed(text)}
              />
            ) : null
          }
        />
      ) : (
        <div className="rounded-2xl border border-dashed border-control px-6 py-7">
          <p className="font-serif text-2xl font-normal text-ink">No meeting planned</p>
          <p className="mt-2 text-sm text-ink-muted">
            {selectedTeamId === null ? "No open team meetings." : `No open meetings for ${unitName(selectedTeamId)}.`} Plan
            one to start an agenda the team can add to.
          </p>
          {mode === "idle" && (
            <button type="button" onClick={openPlan} className={`${BTN_PRIMARY} mt-4`}>
              Plan a meeting
            </button>
          )}
        </div>
      )}

      {focus && mode === "idle" && (
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
          {focus.scheduled_at && currentStage(focus) !== "run" && (
            <Link href={`/app/team/meetings/${focus.id}`} className="py-1 text-brand hover:text-brand-hover">
              Open meeting screen →
            </Link>
          )}
          {currentStage(focus) !== "wrap" && (
            <button type="button" onClick={() => openLog(focus)} className="py-1 text-brand hover:text-brand-hover">
              Quick log
            </button>
          )}
          <button type="button" onClick={() => openEdit(focus)} className="py-1 text-brand hover:text-brand-hover">
            Edit plan
          </button>
          <button type="button" onClick={() => setConfirmingDelete(true)} className="py-1 text-ink-secondary hover:text-ink">
            Delete
          </button>
          {others.length > 0 && (
            <OtherMeetings meetings={others} unitName={unitName} onSelect={(id) => setFocusId(id)} />
          )}
        </div>
      )}

      {(mode === "plan" || mode === "edit") && (
        <Panel title={mode === "plan" ? "Plan a meeting" : "Edit the plan"} eyebrow={mode === "plan" ? unitName(selectedTeamId) : focus ? unitName(focus.org_unit_id) : undefined} onClose={resetWork}>
          <div className={`grid gap-5 ${narrow ? "" : "sm:grid-cols-2"}`}>
            <div>
              <label className={LABEL} htmlFor="meeting-date">Meeting date</label>
              <input id="meeting-date" type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)} className={INPUT} />
              <label className={`${LABEL} mt-3`} htmlFor="meeting-repeat">Repeat</label>
              <select
                id="meeting-repeat"
                value={formRepeat}
                onChange={(e) => setFormRepeat(e.target.value === "" ? "" : Number(e.target.value))}
                className={`${SELECT} !w-auto`}
              >
                <option value="">Doesn&apos;t repeat</option>
                <option value={1}>Every week</option>
                <option value={2}>Every 2 weeks</option>
                <option value={3}>Every 3 weeks</option>
                <option value={4}>Every 4 weeks</option>
              </select>
              <p className={`${META} mt-2`}>The Same Page doesn&apos;t send calendar invites.</p>
            </div>
            <div>
              <label className={LABEL} htmlFor="meeting-agenda">Agenda — one item per line</label>
              <NoteField
                id="meeting-agenda"
                value={formAgenda}
                onChange={setFormAgenda}
                rows={6}
                className="text-sm"
                placeholder={"Update on the handoff checklist\nHiring plan for Q4"}
              />
              {mode === "edit" && (
                <p className={`${META} mt-1`}>Lines you don&apos;t change keep their notes and where they carried from.</p>
              )}
            </div>
          </div>
          {error && <p className={`${ERROR_TEXT} mt-3`}>{error}</p>}
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button type="button" onClick={resetWork} className={BTN_SECONDARY} disabled={formSaving}>Cancel</button>
            <button
              type="button"
              onClick={mode === "plan" ? savePlan : saveEdit}
              disabled={formSaving || !formDate}
              className={BTN_PRIMARY_SM}
            >
              {formSaving ? "Saving…" : mode === "plan" ? "Plan meeting" : "Save plan"}
            </button>
          </div>
        </Panel>
      )}

      {mode === "log" && focus && (
        <Panel
          title="Wrap up the meeting"
          eyebrow={`${unitName(focus.org_unit_id)} · ${focus.scheduled_at ? mediumDate(isoToDateStr(focus.scheduled_at)) : "Undated"}`}
          onClose={resetWork}
        >
          <p className="text-sm text-ink-muted">
            Note what happened against each item. Untick anything you didn&apos;t get to — it&apos;s offered as carry-forward.
            These notes aren&apos;t saved until you confirm the wrap-up.
          </p>
          <div className={`mt-4 grid gap-6 ${narrow ? "" : "md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]"}`}>
            <div className="space-y-4">
              {focus.agenda_items.length === 0 && <p className={META}>No agenda — use the notes box for what happened.</p>}
              {focus.agenda_items.map((item) => {
                const outcome = outcomes.find((o) => o.id === item.id);
                return (
                  <div key={item.id}>
                    <label className="flex items-start gap-2 text-sm font-medium text-ink-body">
                      <input
                        type="checkbox"
                        checked={outcome?.covered ?? false}
                        onChange={(e) =>
                          setOutcomes((rows) => rows.map((o) => (o.id === item.id ? { ...o, covered: e.target.checked } : o)))
                        }
                        className="mt-1 h-3.5 w-3.5 shrink-0 rounded border-control accent-brand"
                      />
                      <span className="flex-1">
                        {item.item}
                        {!outcome?.covered && (
                          <span className="ml-2 rounded-full border border-hairline px-1.5 text-2xs font-normal text-ink-muted">carries forward</span>
                        )}
                      </span>
                    </label>
                    {outcome?.covered && (
                      <NoteField
                        value={outcome.notes}
                        onChange={(v: string) => setOutcomes((rows) => rows.map((o) => (o.id === item.id ? { ...o, notes: v } : o)))}
                        rows={2}
                        className="mt-1.5 text-sm"
                        placeholder="What was said or agreed…"
                        aria-label={`Notes for ${item.item}`}
                      />
                    )}
                  </div>
                );
              })}
            </div>
            <div>
              <label className={LABEL} htmlFor="meeting-other">{focus.agenda_items.length > 0 ? "Anything else" : "Notes"}</label>
              <NoteField
                id="meeting-other"
                value={extraNotes}
                onChange={setExtraNotes}
                rows={6}
                className="text-sm"
                placeholder="Off-agenda notes, or paste from a recorder…"
              />
            </div>
          </div>
          {error && <p className={`${ERROR_TEXT} mt-3`}>{error}</p>}
          <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
            <span className={META}>You&apos;ll review the summary and every commitment before anything is saved.</span>
            <button type="button" onClick={resetWork} className={BTN_SECONDARY} disabled={extracting}>Cancel</button>
            <button
              type="button"
              onClick={() => runWrapUp(focus)}
              disabled={extracting || !assembleRawNotes(focus).trim()}
              className={BTN_PRIMARY_SM}
            >
              {extracting ? "Drafting…" : "Review wrap-up →"}
            </button>
          </div>
        </Panel>
      )}

      {mode === "review" && focus && draft && (
        <div className="mt-4">
          <MeetingWrapUpReview
            meeting={focus}
            members={members.map((m) => ({ id: m.id, name: m.name }))}
            rawNotes={assembleRawNotes(focus)}
            draft={draft}
            outcomes={outcomes}
            onBack={() => setMode("log")}
            onSaved={onLogged}
            onAlreadyLogged={() => onAlreadyLogged(focus.id)}
          />
        </div>
      )}

      {receiptOutcomes && mode === "idle" && (
        <div className="mt-4">
          <MeetingReceipt
            outcomes={receiptOutcomes}
            note={receipt?.note}
            recordHref={`/app/team/meetings/${receiptOutcomes.meeting.id}`}
            commitmentsHref="#team-commitments"
            onDismiss={() => setReceipt(null)}
          />
        </div>
      )}

      {logged.length > 0 && (
        <details className="mt-5 text-sm">
          <summary className="cursor-pointer text-ink-secondary hover:text-ink-body">
            Meeting history <span className="font-sans tabular-nums text-ink-muted">({logged.length})</span>
          </summary>
          <ul className="mt-2 divide-y divide-hairline border-y border-hairline">
            {logged.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => setHistorySelected(m)}
                  className="flex w-full items-baseline gap-3 px-1 py-2.5 text-left hover:bg-sunken"
                >
                  <span className="w-24 shrink-0 text-xs text-ink-muted">
                    {m.scheduled_at ? mediumDate(isoToDateStr(m.scheduled_at)) : "Undated"}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-ink-body">{m.summary}</span>
                  <span className="hidden shrink-0 text-xs text-ink-muted sm:inline">{unitName(m.org_unit_id)}</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {historySelected && (
        <LoggedMeetingModal
          meeting={historySelected}
          scopeName={unitName(historySelected.org_unit_id)}
          allMeetings={allMeetings}
          commitments={commitments}
          onClose={() => setHistorySelected(null)}
          onSaved={(updated) => {
            setMeetings((rows) => rows.map((m) => (m.id === updated.id ? updated : m)));
            setHistorySelected(updated);
          }}
        />
      )}

      {confirmingDelete && focus && (
        <DeleteMeetingModal meeting={focus} onClose={() => setConfirmingDelete(false)} onConfirm={() => removeMeeting(focus)} />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

function MeetingCard({
  meeting,
  scopeName,
  busy,
  showAllAgenda,
  onToggleAgenda,
  onPrimary,
  capture,
  prep,
}: {
  meeting: TeamMeeting;
  scopeName: string;
  busy: boolean;
  showAllAgenda: boolean;
  onToggleAgenda: () => void;
  onPrimary: () => void;
  capture: React.ReactNode;
  prep: React.ReactNode;
}) {
  const stage = currentStage(meeting);
  const date = meetingDateStr(meeting.scheduled_at);
  const items = meeting.agenda_items;
  const preview = showAllAgenda ? items : items.slice(0, 3);
  const chip =
    !date
      ? { text: "Needs a date", attention: true }
      : meeting.status === "needs_log"
        ? { text: "Needs wrap-up", attention: true }
        : { text: date === localDateStr() ? "Today" : "Planned", attention: false };

  const steps: { key: Stage; label: string }[] = [
    { key: "plan", label: "Plan" },
    { key: "run", label: "Run" },
    { key: "wrap", label: "Wrap up" },
  ];

  return (
    <article
      aria-labelledby={`meeting-${meeting.id}-title`}
      className="rounded-2xl bg-feature px-5 py-5 ring-1 ring-inset ring-hairline/60 sm:px-6 sm:py-6"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-2xs font-medium uppercase tracking-[0.14em] text-ink-muted">
          {scopeName} · {repeatWords(meeting.recurrence_weeks)}
        </p>
        <span
          className={`shrink-0 rounded border px-2 py-0.5 text-2xs ${
            chip.attention ? "border-amber-500/50 text-amber-700" : "border-hairline text-ink-muted"
          }`}
        >
          {chip.text}
        </span>
      </div>

      <h3 id={`meeting-${meeting.id}-title`} className="mt-3 font-serif text-[1.55rem] font-normal leading-tight tracking-[-0.01em] text-ink sm:text-[1.7rem]">
        {date ? longDate(date) : "Date not set yet"}
      </h3>
      <p className="mt-1.5 text-xs text-ink-muted">
        {date ? "Team meeting · no start time recorded" : "Created to hold what carried forward — give it a date"}
      </p>

      <ol className="mt-4 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs" aria-label="Meeting steps">
        {steps.map((s, i) => {
          const current = s.key === stage;
          const planned = s.key === "plan" && items.length > 0 && stage !== "plan";
          return (
            <li key={s.key} className="flex items-center gap-2.5">
              {i > 0 && <span className="text-ink-faint" aria-hidden="true">→</span>}
              <span
                aria-current={current ? "step" : undefined}
                className={
                  current
                    ? stage === "wrap" || (stage === "plan" && !date)
                      ? "font-medium text-amber-700"
                      : "font-medium text-brand"
                    : "text-ink-muted"
                }
              >
                {i + 1} {s.label}
                {planned && <span className="ml-1 text-ink-muted" aria-label="agenda recorded">✓</span>}
              </span>
            </li>
          );
        })}
      </ol>

      {items.length > 0 ? (
        <ol className="mt-4 space-y-2">
          {preview.map((item, i) => (
            <li key={item.id} className="flex items-baseline gap-3 text-sm text-ink-body">
              <span className="w-6 shrink-0 font-sans text-xs tabular-nums text-ink-muted">{String(i + 1).padStart(2, "0")}</span>
              <span className="min-w-0">
                {item.item}
                {item.carried_from_item_id && (
                  <span className="ml-2 rounded border border-hairline px-1.5 py-px text-2xs text-ink-muted">carried</span>
                )}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-4 text-sm text-ink-muted">No agenda yet.</p>
      )}

      {capture}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        {stage === "run" ? (
          <Link href={`/app/team/meetings/${meeting.id}`} className={`${BTN_PRIMARY} ${busy ? "pointer-events-none opacity-50" : ""}`} aria-disabled={busy}>
            Open meeting
          </Link>
        ) : stage === "wrap" ? (
          <button type="button" onClick={onPrimary} disabled={busy} className={BTN_PRIMARY}>
            Wrap up meeting
          </button>
        ) : !date ? (
          <button type="button" onClick={onPrimary} disabled={busy} className={BTN_PRIMARY}>
            Set a date
          </button>
        ) : (
          <Link href={`/app/team/meetings/${meeting.id}`} className={`${BTN_PRIMARY} ${busy ? "pointer-events-none opacity-50" : ""}`} aria-disabled={busy}>
            Open meeting
          </Link>
        )}
        {items.length > 3 && (
          <button type="button" onClick={onToggleAgenda} aria-expanded={showAllAgenda} className="text-sm text-brand hover:text-brand-hover">
            {showAllAgenda ? "Show fewer agenda items" : `View all ${items.length} agenda items →`}
          </button>
        )}
      </div>

      {prep}
    </article>
  );
}

function OtherMeetings({
  meetings,
  unitName,
  onSelect,
}: {
  meetings: TeamMeeting[];
  unitName: (id: string | null) => string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="py-1 text-brand hover:text-brand-hover">
        {meetings.length} other open meeting{meetings.length === 1 ? "" : "s"} {open ? "▴" : "→"}
      </button>
      {open && (
        <ul className="mt-1 w-full min-w-[16rem] divide-y divide-hairline rounded-lg border border-hairline bg-surface">
          {meetings.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => {
                  onSelect(m.id);
                  setOpen(false);
                }}
                className="flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-sunken"
              >
                <span className="text-ink-body">{m.scheduled_at ? mediumDate(isoToDateStr(m.scheduled_at)) : "Undated"}</span>
                <span className="text-xs text-ink-muted">
                  {unitName(m.org_unit_id)}
                  {m.status === "needs_log" ? " · needs wrap-up" : !m.scheduled_at ? " · needs a date" : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Panel({
  title,
  eyebrow,
  onClose,
  children,
}: {
  title: string;
  eyebrow?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="mt-4 rounded-xl border border-hairline bg-surface px-5 py-5 sm:px-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          {eyebrow && <p className="text-2xs uppercase tracking-[0.14em] text-ink-muted">{eyebrow}</p>}
          <h3 className="mt-1 font-serif text-xl font-normal text-ink">{title}</h3>
        </div>
        <button type="button" onClick={onClose} aria-label={`Close ${title.toLowerCase()}`} className="rounded px-2 py-1 text-ink-muted hover:bg-sunken hover:text-ink">
          ✕
        </button>
      </div>
      {children}
    </section>
  );
}

// A small modal rather than a bare window.confirm, matching how settings
// confirms an archive.
function DeleteMeetingModal({
  meeting,
  onClose,
  onConfirm,
}: {
  meeting: TeamMeeting;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setDeleting(true);
    setError(null);
    try {
      await onConfirm();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete meeting");
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 px-4 pt-24" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Delete meeting" className="w-full max-w-sm rounded-xl bg-elevated p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-medium text-ink">
          Delete {meeting.scheduled_at ? mediumDate(isoToDateStr(meeting.scheduled_at)) : "this undated meeting"}?
        </h3>
        <p className="mt-2 text-sm text-ink-secondary">
          The agenda goes with it, including anything that carried forward into it.
          {meeting.recurrence_weeks
            ? " This also stops the meeting repeating — logged meetings and their commitments stay."
            : " Logged meetings and their commitments stay."}
        </p>
        {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={BTN_GHOST} disabled={deleting}>Cancel</button>
          <button
            type="button"
            onClick={confirm}
            disabled={deleting}
            className="rounded-md bg-red-600 px-4 py-2 text-sm text-on-critical hover:bg-red-500 disabled:opacity-50"
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

// One logged meeting: summary (the one editable field), per-item outcomes,
// and what came out of it — read from the saved records.
function LoggedMeetingModal({
  meeting,
  scopeName,
  allMeetings,
  commitments,
  onClose,
  onSaved,
}: {
  meeting: TeamMeeting;
  scopeName: string;
  allMeetings: TeamMeeting[];
  commitments: TeamCommitment[];
  onClose: () => void;
  onSaved: (meeting: TeamMeeting) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(meeting.summary ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const outcomes = deriveOutcomes(meeting, allMeetings, commitments);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save() {
    if (!text.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      onSaved(await updateTeamMeetingSummary(meeting.id, text.trim()));
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? "Couldn't save the summary. Your text is still here." : "Couldn't save the summary.");
    } finally {
      setSaving(false);
    }
  }

  const date = meetingDateStr(meeting.scheduled_at);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Logged meeting"
        className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-xl bg-elevated p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-2xs uppercase tracking-[0.14em] text-ink-muted">{scopeName} · Logged</p>
            <h3 className="mt-1 font-serif text-xl font-normal text-ink">{date ? longDate(date) : "Undated meeting"}</h3>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded px-2 py-1 text-ink-muted hover:bg-sunken hover:text-ink">
            ✕
          </button>
        </div>

        <div className="mt-4 flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-ink-body">Reviewed summary</p>
          {!editing && (
            <div className="flex gap-1">
              <Link href={`/app/team/meetings/${meeting.id}`} className={BTN_GHOST}>Open full record</Link>
              <button type="button" onClick={() => { setText(meeting.summary ?? ""); setEditing(true); }} className={BTN_GHOST}>
                Edit
              </button>
            </div>
          )}
        </div>
        {editing ? (
          <div className="mt-2">
            <NoteField value={text} onChange={setText} rows={5} className="text-sm" aria-label="Summary" />
            {error && <p className={`${ERROR_TEXT} mt-2`}>{error}</p>}
            <div className="mt-2 flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(false)} className={BTN_SECONDARY} disabled={saving}>Cancel</button>
              <button type="button" onClick={save} disabled={saving || !text.trim()} className={BTN_PRIMARY_SM}>
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        ) : (
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink-secondary">{meeting.summary}</p>
        )}

        {meeting.agenda_items.length > 0 && (
          <div className="mt-5">
            <p className="text-xs font-medium text-ink-body">Agenda</p>
            <ul className="mt-2 space-y-2">
              {meeting.agenda_items.map((item) => (
                <li key={item.id} className="rounded-lg bg-sunken px-3 py-2">
                  <p className="text-sm text-ink-body">
                    <span className="mr-1.5 text-ink-muted" aria-hidden="true">{item.covered ? "✓" : "○"}</span>
                    {item.item}
                    {!item.covered && <span className="ml-2 text-2xs text-ink-muted">not covered</span>}
                  </p>
                  {item.notes && <p className="mt-1 whitespace-pre-wrap text-xs text-ink-secondary">{item.notes}</p>}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-5">
          <p className="text-xs font-medium text-ink-body">
            Commitments from this meeting <span className="font-sans tabular-nums text-ink-muted">· {outcomes.commitments.length}</span>
          </p>
          {outcomes.commitments.length === 0 ? (
            <p className="mt-1.5 text-xs text-ink-muted">None were saved from this meeting.</p>
          ) : (
            <ul className="mt-1.5 space-y-1.5">
              {outcomes.commitments.map((c) => (
                <li key={c.id} className="flex items-start gap-2 text-sm text-ink-body">
                  <PersonAvatar id={c.direct_report_id ?? null} name={c.direct_report_name ?? "You"} size="xs" className="mt-0.5" />
                  <span className="min-w-0">
                    {c.description}
                    <span className="block text-xs text-ink-muted">
                      {c.direct_report_name ?? "You"} · {c.status === "open" ? dueLabel(c.due_date) : c.status === "done" ? "Done" : "Dropped"}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {outcomes.carried.length > 0 && (
            <p className="mt-3 text-xs text-ink-muted">
              Carried forward: {outcomes.carried.map((c) => c.text).join("; ")}
              {outcomes.next?.scheduled_at ? ` → ${shortDate(isoToDateStr(outcomes.next.scheduled_at))}` : outcomes.next ? " → a meeting that needs a date" : ""}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
