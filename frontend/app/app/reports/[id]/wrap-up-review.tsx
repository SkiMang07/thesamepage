"use client";

// Shared wrap-up review screen — used by the prep flow (after the call) and
// the standalone Log a 1:1 page. The AI drafts a summary + commitments from
// raw call notes; nothing is saved until the manager reviews and hits save.
//
// This is also where the meeting date is confirmed, deliberately on the
// shared surface so both entry points get it. Whatever is showing here is
// what the conversation files itself under, which is the difference between
// a 1:1 held last Tuesday landing on last Tuesday and landing on whichever
// day its workspace happened to be created.

import { useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getOneOnOneHistory, logOneOnOne, CommittedBy, WrapUpCommitment, WrapUpDraft } from "@/lib/api";
import { stashOneOnOneReceipt } from "@/lib/one-on-one-receipt";
import PageShell from "@/components/PageShell";

import NoteField from "@/components/NoteField";
type EditableCommitment = WrapUpCommitment & { key: number };
type EditableFollowUp = { key: number; text: string };

function ExpandingTextArea({
  value,
  onChange,
  placeholder,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const field = ref.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={1}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className="min-h-6 min-w-0 flex-1 resize-none overflow-hidden border-0 p-0 leading-6 text-ink-body placeholder-ink-faint focus:outline-none focus:ring-0"
    />
  );
}

export default function WrapUpReview({
  directReportId,
  reportName,
  rawNotes,
  draft,
  onBack,
  backLabel,
  oneOnOneId,
  initialMeetingDate,
  separateOccurrence = false,
  willRecur = false,
}: {
  directReportId: string;
  reportName: string;
  rawNotes: string;
  draft: WrapUpDraft;
  onBack: () => void;
  backLabel: string;
  // Set when this meeting was prepped (the planned one_on_ones row's id) —
  // saving fills in that row instead of creating a new one. Omitted for
  // ad-hoc logs from the standalone Log a 1:1 flow.
  oneOnOneId?: string;
  // YYYY-MM-DD. The prep flow passes the date already on the sheet; the Log
  // flow passes the day the manager picked. Editable here either way.
  initialMeetingDate: string;
  // The manager said this was a different conversation from the one they
  // have prep saved for, so it logs as its own occurrence.
  separateOccurrence?: boolean;
  willRecur?: boolean;
}) {
  const router = useRouter();
  const [summary, setSummary] = useState(draft.summary);
  const [meetingDate, setMeetingDate] = useState(initialMeetingDate);
  const [commitments, setCommitments] = useState<EditableCommitment[]>(
    draft.commitments.map((c, i) => ({ ...c, key: i }))
  );
  const [nextKey, setNextKey] = useState(draft.commitments.length);
  const [followUps, setFollowUps] = useState<EditableFollowUp[]>(
    (draft.follow_up_items ?? []).map((text, i) => ({ key: i, text }))
  );
  const [nextFollowUpKey, setNextFollowUpKey] = useState(draft.follow_up_items?.length ?? 0);
  // One line to open the next 1:1 with. Drafted, never required: clearing
  // it saves nothing.
  const [openingLine, setOpeningLine] = useState(draft.opening_line ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const firstName = reportName.split(" ")[0] || "Them";

  function updateCommitment(key: number, patch: Partial<WrapUpCommitment>) {
    setCommitments((cs) => cs.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  }

  function addCommitment() {
    setCommitments((cs) => [
      ...cs,
      { key: nextKey, description: "", committed_by: "manager", due_date: null },
    ]);
    setNextKey((k) => k + 1);
  }

  // A synchronous guard as well as the disabled button: two fast clicks can
  // both run before React re-renders the button disabled.
  const savingRef = useRef(false);

  async function handleSave() {
    if (!summary.trim() || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    const submittedSummary = summary.trim();
    const startedAt = Date.now();
    try {
      const result = await logOneOnOne({
        direct_report_id: directReportId,
        summary: submittedSummary,
        notes: rawNotes,
        meeting_date: meetingDate || null,
        separate_occurrence: separateOccurrence,
        new_commitments: commitments
          .map(({ key: _key, ...c }) => ({ ...c, description: c.description.trim() }))
          .filter((c) => c.description),
        carry_forward_items: followUps.map((item) => item.text.trim()).filter(Boolean),
        opening_line: openingLine.trim() || null,
        one_on_one_id: oneOnOneId,
      });
      // The receipt on the person page renders exactly what the server says
      // it saved. The review stays put until then; nothing here is cleared.
      stashOneOnOneReceipt({ ...result, personId: directReportId });
      router.push(`/app/reports/${directReportId}?logged=${result.meeting.id}`);
    } catch (e) {
      // The server undoes a partially written log before it answers with an
      // error, so a failure normally means nothing was saved. The exception
      // is a save that succeeded but whose answer never arrived (a dropped
      // connection). Check before inviting a retry that would log it twice.
      const recorded = await findRecordedMeeting(submittedSummary, startedAt);
      if (recorded) {
        router.push(`/app/reports/${directReportId}?logged=${recorded}&reconciled=1`);
        return;
      }
      // The raw API error isn't actionable. What is: the review is intact.
      console.error("[wrap-up] save failed", e instanceof Error ? e.name : "error");
      setError("Couldn't save this meeting. Your review is still here — try again.");
      savingRef.current = false;
      setSaving(false);
    }
  }

  // A completed meeting for this person with exactly this reviewed summary,
  // logged since this save began. Returns its id, or null when there is none
  // or the check itself could not run (then the error stays and the manager
  // decides; nothing is assumed saved).
  async function findRecordedMeeting(submittedSummary: string, startedAt: number): Promise<string | null> {
    try {
      const history = await getOneOnOneHistory(directReportId);
      const match = history.find(
        (session) =>
          session.status === "completed" &&
          (session.summary ?? "").trim() === submittedSummary &&
          session.logged_at != null &&
          new Date(session.logged_at).getTime() >= startedAt - 60_000
      );
      return match?.id ?? null;
    } catch {
      return null;
    }
  }

  function WhoToggle({ c }: { c: EditableCommitment }) {
    const base = "rounded-full px-3 py-1 text-xs font-medium";
    const on = "bg-brand text-on-brand";
    const off = "bg-sunken text-ink-secondary hover:bg-carbon-200";
    const set = (committed_by: CommittedBy) => updateCommitment(c.key, { committed_by });
    return (
      <div className="flex gap-1">
        <button type="button" onClick={() => set("manager")} className={`${base} ${c.committed_by === "manager" ? on : off}`}>
          You
        </button>
        <button type="button" onClick={() => set("direct_report")} className={`${base} ${c.committed_by === "direct_report" ? on : off}`}>
          {firstName}
        </button>
      </div>
    );
  }

  return (
    <PageShell maxWidth="2xl">
      <button onClick={onBack} className="text-sm text-ink-secondary hover:underline">
        ← {backLabel}
      </button>
      <h1 className="mt-4 text-2xl font-semibold">Review before saving</h1>
      <p className="mt-2 text-ink-secondary">
        Drafted from your notes — fix anything that&apos;s off. The summary shows up in
        history and next time you prep; commitments get tracked until resolved.
      </p>

      <div className="mt-8">
        <label htmlFor="wrap-up-meeting-date" className="block text-sm font-medium text-ink-body">
          Meeting date{" "}
          <span className="font-normal text-ink-muted">— the day you actually talked</span>
        </label>
        <input
          id="wrap-up-meeting-date"
          type="date"
          value={meetingDate}
          onChange={(e) => setMeetingDate(e.target.value)}
          className="mt-2 rounded-md border border-control px-3 py-2 text-sm text-ink-body focus:border-brand focus:outline-none"
        />
        <p className="mt-1 text-xs text-ink-muted">
          This is where the conversation files itself in history, and what the
          next prep sheet counts from. Change it if you are catching up on a
          conversation from an earlier day.
        </p>
      </div>

      <div className="mt-8">
        <label className="block text-sm font-medium text-ink-body">Summary</label>
        {!draft.summary && (
          <p className="mt-1 text-sm text-amber-700">
            Couldn&apos;t draft a summary from these notes — write a quick one below.
          </p>
        )}
        <NoteField
          value={summary}
          onChange={setSummary}
          rows={5}
          className="mt-2"
        />
      </div>

      <div className="mt-8">
        <p className="block text-sm font-medium text-ink-body">
          Open next time with{" "}
          <span className="font-normal text-ink-muted">— one line to start the next 1:1</span>
        </p>
        <p className="mt-1 text-xs text-ink-muted">
          {draft.opening_line
            ? "Drafted from what was left open. Edit it, or clear it to keep nothing."
            : "Nothing stood out to open with. Write one if you want it waiting next time."}
        </p>
        <div className="mt-3 flex items-start gap-3 rounded-lg border border-hairline px-4 py-3">
          <ExpandingTextArea
            value={openingLine}
            onChange={setOpeningLine}
            placeholder={`How would you like to start with ${firstName} next time?`}
            ariaLabel="Opening line for the next 1:1"
          />
          {openingLine && (
            <button
              type="button"
              onClick={() => setOpeningLine("")}
              className="text-ink-faint hover:text-ink-secondary"
              title="Clear"
            >
              ×
            </button>
          )}
        </div>
      </div>

      <div className="mt-8">
        <p className="block text-sm font-medium text-ink-body">
          Carry into the next 1:1{" "}
          <span className="font-normal text-ink-muted">— unresolved topics worth revisiting</span>
        </p>
        <p className="mt-1 text-xs text-ink-muted">
          These are suggestions from your notes. Confirm, edit, or remove them before saving.
        </p>

        {followUps.length === 0 && (
          <p className="mt-3 text-sm text-ink-secondary">
            Nothing was clearly left open. Add a topic if you want it waiting next time.
          </p>
        )}

        <ul className="mt-3 space-y-2">
          {followUps.map((item) => (
            <li key={item.key} className="flex items-start gap-3 rounded-lg border border-hairline px-4 py-3">
              <ExpandingTextArea
                value={item.text}
                onChange={(text) =>
                  setFollowUps((items) =>
                    items.map((current) =>
                      current.key === item.key ? { ...current, text } : current
                    )
                  )
                }
                placeholder="What should you revisit next time?"
                ariaLabel="Follow-up topic"
              />
              <button
                type="button"
                onClick={() => setFollowUps((items) => items.filter((current) => current.key !== item.key))}
                className="text-ink-faint hover:text-ink-secondary"
                title="Remove"
              >
                ×
              </button>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={() => {
            setFollowUps((items) => [...items, { key: nextFollowUpKey, text: "" }]);
            setNextFollowUpKey((key) => key + 1);
          }}
          className="mt-3 text-sm text-ink-secondary hover:underline"
        >
          + Add follow-up topic
        </button>
        <p className="mt-2 text-xs text-ink-muted">
          {willRecur
            ? "Saving completes this meeting and adds these topics to the next scheduled 1:1."
            : "Saving completes this meeting and adds these topics to the next 1:1 workspace."}
        </p>
      </div>

      <div className="mt-8">
        <p className="block text-sm font-medium text-ink-body">
          Commitments{" "}
          <span className="font-normal text-ink-muted">— who owes what by when</span>
        </p>

        {commitments.length === 0 && (
          <p className="mt-3 text-sm text-ink-secondary">
            None picked up from the notes. Add one below if something was agreed.
          </p>
        )}

        <ul className="mt-3 space-y-3">
          {commitments.map((c) => (
            <li key={c.key} className="rounded-lg border border-hairline px-4 py-3">
              <div className="flex items-start gap-3">
                <ExpandingTextArea
                  value={c.description}
                  onChange={(description) => updateCommitment(c.key, { description })}
                  placeholder="What was agreed?"
                  ariaLabel="Commitment description"
                />
                <button
                  type="button"
                  onClick={() => setCommitments((cs) => cs.filter((x) => x.key !== c.key))}
                  className="text-ink-faint hover:text-ink-secondary"
                  title="Remove"
                >
                  ×
                </button>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <WhoToggle c={c} />
                <input
                  type="date"
                  value={c.due_date ?? ""}
                  onChange={(e) => updateCommitment(c.key, { due_date: e.target.value || null })}
                  className="rounded-md border border-hairline px-2 py-1 text-xs text-ink-secondary focus:border-control focus:outline-none"
                />
              </div>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={addCommitment}
          className="mt-3 text-sm text-ink-secondary hover:underline"
        >
          + Add commitment
        </button>
      </div>

      {error && <p className="mt-4 text-sm text-red-700">{error}</p>}

      <button
        onClick={handleSave}
        disabled={saving || !summary.trim()}
        className="mt-8 w-full rounded-md bg-brand px-4 py-3 font-medium text-on-brand hover:bg-brand-hover disabled:opacity-40"
      >
        {saving ? "Saving…" : "Save meeting"}
      </button>
    </PageShell>
  );
}
