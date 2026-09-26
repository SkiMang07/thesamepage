"use client";

// ---------------------------------------------------------------------------
// Wrap-up review for a meeting beyond the team. The summary, commitments and
// footer are the shared WrapUpReviewShell (the same body the team-meeting
// review uses), so there is still one review surface. What this adds is the
// routing that is specific to these meetings:
//
//   - commitments can be owed by the other person ("They owe you"),
//   - a goal or project the meeting moved gets a check-in,
//   - something said about one of your reports becomes a private,
//     secondhand note in that report's 1:1 prep,
//   - in a 1:1, topics to bring up next time carry into the next 1:1 with
//     that person (and its prep).
//
// NOTHING IS WRITTEN UNTIL THE MANAGER CONFIRMS. Every row here is editable
// and removable, and the one save goes through /log, which re-checks every
// id. Most meetings route nothing, and the empty states say so plainly.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import WrapUpReviewShell, { OwnerGroup, ReviewCommitment } from "@/components/team/WrapUpReviewShell";
import {
  BeyondDraftCheckIn,
  BeyondDraftCommitment,
  BeyondDraftReportNote,
  BeyondWrapUpDraft,
  GoalStatus,
  OutsideMeeting,
  OutsideMeetingDetail,
  logOutsideMeeting,
} from "@/lib/api";
import { BTN_GHOST, BTN_SECONDARY, EYEBROW, INPUT, LABEL, META, SELECT } from "@/lib/tokens";
import { CHECK_IN_STATUS_OPTIONS } from "./shared";
import { joinDraft } from "@/lib/aiDraftTelemetry";
import { useAiDraft } from "@/lib/useAiDraft";

type Named = { id: string; name: string };
type Titled = { id: string; title: string };

// Owner keys for the shell's picker: "" you, "r:<id>" a report, "p:<id>" an
// outside person. "p:" alone is a counterpart the draft couldn't name — the
// picker shows it as unresolved and saving waits until it's chosen.
function ownerKey(c: BeyondDraftCommitment): string {
  if (c.owner === "report" && c.direct_report_id) return `r:${c.direct_report_id}`;
  if (c.owner === "counterpart") return `p:${c.outside_person_id ?? ""}`;
  return "";
}

function fromOwnerKey(row: ReviewCommitment): BeyondDraftCommitment {
  const base = { description: row.description.trim(), due_date: row.due_date || null };
  if (row.owner.startsWith("r:")) {
    return { ...base, owner: "report", direct_report_id: row.owner.slice(2), outside_person_id: null };
  }
  if (row.owner.startsWith("p:")) {
    return { ...base, owner: "counterpart", direct_report_id: null, outside_person_id: row.owner.slice(2) || null };
  }
  return { ...base, owner: "you", direct_report_id: null, outside_person_id: null };
}

type CheckInRow = { target: string; status: GoalStatus; note: string };

export default function BeyondWrapUpReview({
  meeting,
  reports,
  goals,
  projects,
  rawNotes,
  draft,
  onBack,
  onSaved,
}: {
  meeting: OutsideMeeting;
  reports: Named[];
  goals: Titled[];
  projects: Titled[];
  rawNotes: string;
  draft: BeyondWrapUpDraft;
  onBack: () => void;
  onSaved: (meeting: OutsideMeetingDetail & { next_meeting_id?: string | null }) => void;
}) {
  const [summary, setSummary] = useState(draft.summary);
  const [meetingDate, setMeetingDate] = useState(meeting.meeting_date ? meeting.meeting_date.slice(0, 10) : "");
  const [commitments, setCommitments] = useState<ReviewCommitment[]>(() =>
    draft.commitments.map((c) => ({ description: c.description, owner: ownerKey(c), due_date: c.due_date }))
  );
  const [checkIns, setCheckIns] = useState<CheckInRow[]>(() =>
    draft.check_ins.map((c) => ({
      target: c.goal_id ? `g:${c.goal_id}` : `pr:${c.project_id}`,
      status: c.status,
      note: c.note ?? "",
    }))
  );
  const [reportNotes, setReportNotes] = useState<BeyondDraftReportNote[]>(draft.report_notes);
  const isOneOnOne = meeting.kind === "one_on_one" && meeting.people.length === 1;
  // Starts from what the model suggests. Topics carried INTO this meeting
  // are listed above it so the manager can re-add any that are still open.
  const [carry, setCarry] = useState<string[]>(draft.carry_forward_items ?? []);
  const [newCarry, setNewCarry] = useState("");

  function addCarry() {
    const text = newCarry.trim();
    if (!text) return;
    setCarry((rows) => (rows.some((r) => r.toLowerCase() === text.toLowerCase()) ? rows : [...rows, text]));
    setNewCarry("");
  }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // E7: how much of the AI's draft survives review. Enums and counts only.
  const telemetry = useAiDraft("beyond_wrapup");
  useEffect(() => {
    telemetry.start({
      text: joinDraft([
        draft.summary,
        ...draft.commitments.map((c) => c.description),
        ...draft.check_ins.map((c) => c.note),
        ...draft.report_notes.map((n) => n.note),
        ...(draft.carry_forward_items ?? []),
      ]),
      items: draft.commitments.map((c) => c.description),
    });
  }, [draft, telemetry]);

  function handleBack() {
    telemetry.discard();
    onBack();
  }

  const ownerGroups: OwnerGroup[] = [
    { label: "Your team", options: reports.map((r) => ({ value: `r:${r.id}`, label: r.name })) },
    {
      label: "They owe you",
      options: meeting.people.map((p) => ({ value: `p:${p.id}`, label: p.name })),
    },
  ].filter((g) => g.options.length > 0);

  const liveCommitments = commitments.filter((c) => c.description.trim());
  const unresolved = liveCommitments.some((c) => c.owner === "p:");
  const incompleteRouting =
    checkIns.some((c) => !c.target) || reportNotes.some((n) => !n.direct_report_id || !n.note.trim());
  const canSave = !unresolved && !incompleteRouting;

  function updateCheckIn(i: number, patch: Partial<CheckInRow>) {
    setCheckIns((rows) => rows.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  }

  function updateReportNote(i: number, patch: Partial<BeyondDraftReportNote>) {
    setReportNotes((rows) => rows.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  }

  async function save() {
    if (!summary.trim() || saving || !canSave) return;
    setSaving(true);
    setError(null);
    try {
      const checkInBodies: BeyondDraftCheckIn[] = checkIns.map((c) => ({
        goal_id: c.target.startsWith("g:") ? c.target.slice(2) : null,
        project_id: c.target.startsWith("pr:") ? c.target.slice(3) : null,
        status: c.status,
        note: c.note.trim() || null,
      }));
      const result = await logOutsideMeeting(meeting.id, {
        summary: summary.trim(),
        rawNotes,
        meetingDate: meetingDate || null,
        commitments: liveCommitments.map(fromOwnerKey),
        checkIns: checkInBodies,
        reportNotes: reportNotes.map((n) => ({ direct_report_id: n.direct_report_id, note: n.note.trim() })),
        carryForwardItems: isOneOnOne ? carry : [],
      });
      telemetry.accept({
        text: joinDraft([
          summary,
          ...commitments.map((c) => c.description),
          ...checkIns.map((c) => c.note),
          ...reportNotes.map((n) => n.note),
          ...(isOneOnOne ? carry : []),
        ]),
        items: commitments.map((c) => c.description),
      });
      onSaved(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save meeting");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-hairline bg-surface px-4 py-3">
        <div>
          <label className={LABEL} htmlFor="beyond-review-date">
            Meeting date
          </label>
          <input
            id="beyond-review-date"
            type="date"
            value={meetingDate}
            onChange={(e) => setMeetingDate(e.target.value)}
            className={`${INPUT} !w-auto`}
          />
        </div>
        <p className={`${META} pb-2`}>The day it happened, not the day you&apos;re writing it up.</p>
      </div>

      <WrapUpReviewShell
        summary={summary}
        onSummaryChange={setSummary}
        summaryPlaceholder="What was decided, asked, or changed..."
        commitments={commitments}
        onCommitmentsChange={setCommitments}
        ownerGroups={ownerGroups}
        commitmentsTitle="Commitments"
        unresolvedOwnerLabel="They owe you — pick who"
        saving={saving}
        error={
          error ??
          (unresolved
            ? "Pick who owes each commitment before saving."
            : incompleteRouting
              ? "Finish or remove the unfinished rows below before saving."
              : null)
        }
        canSave={canSave}
        saveLabel="Save meeting"
        onBack={handleBack}
        onSave={save}
      >
        <div className="mt-5">
          <div className="flex items-center justify-between">
            <p className={EYEBROW}>Goals and projects this moved</p>
            {goals.length + projects.length > 0 && (
              <button
                type="button"
                onClick={() => setCheckIns((rows) => [...rows, { target: "", status: "on_track", note: "" }])}
                className={BTN_GHOST}
              >
                Add
              </button>
            )}
          </div>
          {checkIns.length === 0 ? (
            <p className={`${META} mt-2`}>
              {goals.length + projects.length === 0
                ? "You have no live goals or projects for this to update."
                : "Nothing here changes one of your goals or projects."}
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {checkIns.map((c, i) => (
                <li key={i} className="rounded-lg border border-hairline bg-sunken px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={c.target}
                      onChange={(e) => updateCheckIn(i, { target: e.target.value })}
                      className={`${SELECT} !w-64 truncate bg-surface`}
                      aria-label="Goal or project"
                    >
                      <option value="" disabled>
                        Pick a goal or project
                      </option>
                      {goals.length > 0 && (
                        <optgroup label="Goals">
                          {goals.map((g) => (
                            <option key={g.id} value={`g:${g.id}`}>
                              {g.title}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {projects.length > 0 && (
                        <optgroup label="Projects">
                          {projects.map((p) => (
                            <option key={p.id} value={`pr:${p.id}`}>
                              {p.title}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                    <select
                      value={c.status}
                      onChange={(e) => updateCheckIn(i, { status: e.target.value as GoalStatus })}
                      className={`${SELECT} !w-36 bg-surface`}
                      aria-label="Status now"
                    >
                      {CHECK_IN_STATUS_OPTIONS.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setCheckIns((rows) => rows.filter((_, j) => j !== i))}
                      className={`${BTN_GHOST} ml-auto`}
                    >
                      Remove
                    </button>
                  </div>
                  <input
                    value={c.note}
                    onChange={(e) => updateCheckIn(i, { note: e.target.value })}
                    className={`${INPUT} mt-2 bg-surface`}
                    placeholder="What changed, in one line"
                    aria-label="Check-in note"
                  />
                </li>
              ))}
            </ul>
          )}
          {checkIns.length > 0 && (
            <p className={`${META} mt-1.5`}>Each one is saved as a check-in, and its status becomes the item&apos;s status.</p>
          )}
        </div>

        <div className="mt-5">
          <div className="flex items-center justify-between">
            <p className={EYEBROW}>About your reports</p>
            {reports.length > 0 && (
              <button
                type="button"
                onClick={() => setReportNotes((rows) => [...rows, { direct_report_id: "", note: "" }])}
                className={BTN_GHOST}
              >
                Add
              </button>
            )}
          </div>
          {reportNotes.length === 0 ? (
            <p className={`${META} mt-2`}>Nothing was said about anyone on your team.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {reportNotes.map((n, i) => (
                <li key={i} className="rounded-lg border border-hairline bg-sunken px-3 py-2">
                  <div className="flex items-center gap-2">
                    <select
                      value={n.direct_report_id}
                      onChange={(e) => updateReportNote(i, { direct_report_id: e.target.value })}
                      className={`${SELECT} !w-48 bg-surface`}
                      aria-label="Report"
                    >
                      <option value="" disabled>
                        Who is it about?
                      </option>
                      {reports.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setReportNotes((rows) => rows.filter((_, j) => j !== i))}
                      className={`${BTN_GHOST} ml-auto`}
                    >
                      Remove
                    </button>
                  </div>
                  <input
                    value={n.note}
                    onChange={(e) => updateReportNote(i, { note: e.target.value })}
                    className={`${INPUT} mt-2 bg-surface`}
                    placeholder="Who said what, e.g. “Priya said the demo landed well”"
                    aria-label="Note"
                  />
                </li>
              ))}
            </ul>
          )}
          {reportNotes.length > 0 && (
            <p className={`${META} mt-1.5`}>
              Only you see these. They show in that person&apos;s 1:1 prep as something you heard, not as fact.
            </p>
          )}
        </div>

        {isOneOnOne && (
          <div className="mt-5">
            <p className={EYEBROW}>Bring up next time</p>
            {meeting.carry_forward_items.length > 0 && (
              <p className={`${META} mt-1`}>
                Carried into this one: {meeting.carry_forward_items.join("; ")}. Add any that are still open.
              </p>
            )}
            {carry.length === 0 ? (
              <p className={`${META} mt-2`}>Nothing carrying forward.</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {carry.map((item) => (
                  <li
                    key={item}
                    className="flex items-center gap-2 rounded-lg border border-hairline bg-sunken px-3 py-1.5 text-sm"
                  >
                    <span className="flex-1">{item}</span>
                    <button
                      type="button"
                      onClick={() => setCarry((rows) => rows.filter((r) => r !== item))}
                      className={BTN_GHOST}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2 flex gap-2">
              <input
                value={newCarry}
                onChange={(e) => setNewCarry(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCarry();
                  }
                }}
                className={INPUT}
                placeholder={`Something to raise with ${meeting.people[0]?.name.split(" ")[0] ?? "them"} next time...`}
                aria-label="Add a topic for next time"
              />
              <button type="button" onClick={addCarry} className={BTN_SECONDARY}>
                Add
              </button>
            </div>
            <p className={`${META} mt-1.5`}>These go on your next 1:1 with them and into its prep.</p>
          </div>
        )}
      </WrapUpReviewShell>
    </div>
  );
}
