"use client";

// ---------------------------------------------------------------------------
// Log a meeting beyond the team — who, when, what kind, and the notes — then
// the wrap-up review. Backs both /app/beyond/meetings/new and an unlogged
// (draft) meeting at /app/beyond/meetings/[id].
//
// Nothing about the meeting's outputs is written until the review is
// confirmed. The meeting row itself is created the first time the manager
// drafts a write-up or saves a draft, so the notes live on the account (a
// draft meeting's notes save as they're typed) rather than in the browser.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import NoteField from "@/components/NoteField";
import PageShell from "@/components/PageShell";
import BeyondWrapUpReview from "./BeyondWrapUpReview";
import PrepPanel from "./PrepPanel";
import {
  BeyondWrapUpDraft,
  OutsideMeeting,
  OutsideMeetingDetail,
  OutsideMeetingKind,
  OutsidePerson,
  OutsideRelationship,
  createOutsideMeeting,
  createOutsidePerson,
  deleteOutsideMeeting,
  getBeyondOverview,
  getDirectReports,
  getGoals,
  getProjects,
  updateOutsideMeeting,
  wrapUpOutsideMeeting,
} from "@/lib/api";
import {
  BTN_GHOST,
  BTN_PRIMARY,
  BTN_SECONDARY,
  CARD_PAD,
  ERROR_TEXT,
  EYEBROW,
  INPUT,
  LABEL,
  META,
  SELECT,
} from "@/lib/tokens";
import { RELATIONSHIP_LABEL, RELATIONSHIP_ORDER, isoToDateStr, localDateStr } from "./shared";

const LIVE = new Set(["active", "on_track", "at_risk"]);
const EMPTY_DRAFT: BeyondWrapUpDraft = { summary: "", commitments: [], check_ins: [], report_notes: [], carry_forward_items: [] };

type Phase = "notes" | "drafting" | "review";

export default function MeetingEditor({
  existing,
  initialPersonId,
  plan = false,
  onLogged,
  onDeleted,
}: {
  existing?: OutsideMeeting;
  initialPersonId?: string | null;
  // Planning a future 1:1 rather than logging one that happened.
  plan?: boolean;
  onLogged: (meeting: OutsideMeetingDetail & { next_meeting_id?: string | null }) => void;
  onDeleted?: () => void;
}) {
  const [people, setPeople] = useState<OutsidePerson[]>([]);
  const [reports, setReports] = useState<{ id: string; name: string }[]>([]);
  const [goals, setGoals] = useState<{ id: string; title: string }[]>([]);
  const [projects, setProjects] = useState<{ id: string; title: string }[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [meeting, setMeeting] = useState<OutsideMeeting | null>(existing ?? null);
  const [title, setTitle] = useState(existing?.title ?? "");
  const [date, setDate] = useState(() => {
    if (existing) return isoToDateStr(existing.meeting_date);
    if (plan) {
      const d = new Date();
      d.setDate(d.getDate() + 7);
      return localDateStr(d);
    }
    return localDateStr();
  });
  const [kind, setKind] = useState<OutsideMeetingKind>(existing?.kind ?? "one_on_one");
  const [personIds, setPersonIds] = useState<string[]>(
    existing ? existing.people.map((p) => p.id) : initialPersonId ? [initialPersonId] : []
  );
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [repeat, setRepeat] = useState<number | null>(existing?.recurrence_weeks ?? null);
  const [carried, setCarried] = useState<string[]>(existing?.carry_forward_items ?? []);
  const [notesState, setNotesState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const [phase, setPhase] = useState<Phase>("notes");
  const [draft, setDraft] = useState<BeyondWrapUpDraft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRelationship, setNewRelationship] = useState<OutsideRelationship>("peer");

  useEffect(() => {
    Promise.all([getBeyondOverview(), getDirectReports(), getGoals(), getProjects()])
      .then(([overview, drs, gs, ps]) => {
        setPeople(overview.people);
        setReports(drs.map((r) => ({ id: r.id, name: r.name })));
        setGoals(gs.filter((g) => LIVE.has(g.status)).map((g) => ({ id: g.id, title: g.title })));
        setProjects(ps.filter((p) => LIVE.has(p.status)).map((p) => ({ id: p.id, title: p.title })));
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : "Failed to load"));
  }, []);

  // A draft meeting's notes save as they're typed, so a closed tab doesn't
  // lose them. A brand-new meeting has no row yet; its notes are saved with
  // it on "Save draft" or "Draft the write-up".
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (!meeting) return;
    setNotesState("saving");
    const timer = setTimeout(() => {
      updateOutsideMeeting(meeting.id, { notes })
        .then(() => setNotesState("saved"))
        .catch(() => setNotesState("error"));
    }, 1200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes]);

  function setKindKeepingPeople(next: OutsideMeetingKind) {
    setKind(next);
    if (next === "one_on_one" && personIds.length > 1) setPersonIds(personIds.slice(0, 1));
    // Only a 1:1 repeats; the server stops the rule when kind changes.
    if (next === "group") setRepeat(null);
  }

  async function changeRepeat(weeks: number | null) {
    setError(null);
    if (weeks && !date) {
      setError("Pick a date first — a repeating 1:1 counts on from it.");
      return;
    }
    const previous = repeat;
    setRepeat(weeks);
    if (!meeting) return; // saved with the meeting
    try {
      const updated = await updateOutsideMeeting(
        meeting.id,
        weeks ? { recurrenceWeeks: weeks, scheduledAt: date, kind, personIds } : { clearRecurrence: true }
      );
      setMeeting(updated);
    } catch (e) {
      setRepeat(previous);
      setError(e instanceof Error ? e.message : "Couldn't change the repeat");
    }
  }

  async function removeCarried(item: string) {
    const next = carried.filter((c) => c !== item);
    setCarried(next);
    if (meeting) {
      try {
        setMeeting(await updateOutsideMeeting(meeting.id, { carryForwardItems: next }));
      } catch {
        setCarried(carried);
      }
    }
  }

  function togglePerson(id: string) {
    setPersonIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  async function addPerson() {
    const name = newName.trim();
    if (!name) return;
    try {
      const created = await createOutsidePerson({ name, relationship: newRelationship });
      setPeople((rows) => [...rows, created]);
      setPersonIds((ids) => (kind === "one_on_one" ? [created.id] : [...ids, created.id]));
      setNewName("");
      setAdding(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add person");
    }
  }

  function validationError(): string | null {
    if (kind === "one_on_one" && personIds.length !== 1) return "Pick who the 1:1 was with.";
    return null;
  }

  // Create the row the first time, otherwise bring its details up to date.
  // An undated next 1:1 stays undated until the manager picks a date.
  async function persist(): Promise<OutsideMeeting> {
    if (meeting) {
      const updated = await updateOutsideMeeting(meeting.id, {
        title: title.trim(),
        kind,
        scheduledAt: date || undefined,
        personIds,
        notes,
      });
      setMeeting(updated);
      return updated;
    }
    const created = await createOutsideMeeting({
      title: title.trim() || null,
      kind,
      scheduledAt: date || localDateStr(),
      personIds,
      notes,
      recurrenceWeeks: kind === "one_on_one" ? repeat : null,
    });
    setMeeting(created);
    return created;
  }

  async function startWrapUp(useAI: boolean) {
    const invalid = validationError();
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    setPhase("drafting");
    try {
      const saved = await persist();
      // An empty draft is a valid outcome — the review becomes "write it
      // yourself" rather than a dead end.
      const next = useAI && notes.trim() ? await wrapUpOutsideMeeting(saved.id, notes) : EMPTY_DRAFT;
      setDraft(next);
      setPhase("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to draft the write-up");
      setPhase("notes");
    }
  }

  async function saveDraft() {
    const invalid = validationError();
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    try {
      const saved = await persist();
      setNotesState("saved");
      if (!existing) window.location.assign(`/app/beyond/meetings/${saved.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    }
  }

  async function discard() {
    if (!meeting) return;
    try {
      await deleteOutsideMeeting(meeting.id);
      onDeleted?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  }

  const activePeople = people.filter((p) => !p.archived_at || personIds.includes(p.id));
  const sortedPeople = [...activePeople].sort(
    (a, b) =>
      RELATIONSHIP_ORDER.indexOf(a.relationship) - RELATIONSHIP_ORDER.indexOf(b.relationship) ||
      a.name.localeCompare(b.name)
  );

  const withName = sortedPeople.find((p) => p.id === personIds[0])?.name ?? meeting?.people[0]?.name;
  const isUpcoming = meeting?.status === "upcoming";
  const canPrep = !!meeting && meeting.status !== "logged" && meeting.kind === "one_on_one" && meeting.people.length === 1;
  const heading = isUpcoming && withName
    ? `Next 1:1 with ${withName}`
    : existing
      ? "Finish writing this up"
      : plan
        ? "Plan a 1:1"
        : "Log a meeting";

  if (phase === "review" && meeting) {
    return (
      <PageShell maxWidth="3xl">
        <Link href="/app/beyond" className={`${META} hover:text-ink`}>
          ← Beyond the team
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">{title.trim() || "Write it up"}</h1>
        <div className="mt-5">
          <BeyondWrapUpReview
            meeting={{
              ...meeting,
              carry_forward_items: carried,
              people: sortedPeople.filter((p) => personIds.includes(p.id)),
            }}
            reports={reports}
            goals={goals}
            projects={projects}
            rawNotes={notes}
            draft={draft}
            onBack={() => setPhase("notes")}
            onSaved={onLogged}
          />
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell maxWidth="6xl">
      <Link href="/app/beyond" className={`${META} hover:text-ink`}>
        ← Beyond the team
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">{heading}</h1>
      <p className="mt-1 text-sm text-ink-secondary">
        {isUpcoming
          ? `${date ? new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) : "No date yet"}${
              repeat ? ` · repeats ${repeat === 1 ? "weekly" : `every ${repeat} weeks`}` : ""
            }. Prepare now; write it up after.`
          : "A meeting outside your own team. What comes out of it only reaches the rest of the app once you confirm it."}
      </p>
      {loadError && <p className={`${ERROR_TEXT} mt-3`}>{loadError}</p>}

      {canPrep && meeting && (
        <div className="mt-5">
          <PrepPanel meeting={{ ...meeting, carry_forward_items: carried }} onPrepared={(m) => setMeeting(m)} />
        </div>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-[320px_1fr]">
        <div className={`${CARD_PAD} space-y-4 self-start`}>
          <div>
            <p className={LABEL}>Kind</p>
            <div className="flex gap-2" role="group" aria-label="Kind of meeting">
              {(["one_on_one", "group"] as OutsideMeetingKind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={kind === k}
                  onClick={() => setKindKeepingPeople(k)}
                  className={kind === k ? BTN_PRIMARY : BTN_SECONDARY}
                >
                  {k === "one_on_one" ? "1:1" : "Group"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className={LABEL}>{kind === "one_on_one" ? "With" : "Who was there"}</p>
            {sortedPeople.length === 0 && !adding ? (
              <p className={META}>No one here yet. Add the first person below.</p>
            ) : kind === "one_on_one" ? (
              <select
                value={personIds[0] ?? ""}
                onChange={(e) => setPersonIds(e.target.value ? [e.target.value] : [])}
                className={SELECT}
                aria-label="Who the 1:1 was with"
              >
                <option value="">Pick someone</option>
                {sortedPeople.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {RELATIONSHIP_LABEL[p.relationship]}
                  </option>
                ))}
              </select>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {sortedPeople.map((p) => {
                  const on = personIds.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => togglePerson(p.id)}
                      className={`rounded-full border px-2.5 py-1 text-xs ${
                        on ? "border-brand bg-brand-tint text-ink" : "border-hairline text-ink-secondary hover:bg-sunken"
                      }`}
                    >
                      {p.name}
                    </button>
                  );
                })}
              </div>
            )}
            {adding ? (
              <div className="mt-2 space-y-2 rounded-lg border border-dashed border-control p-2">
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addPerson();
                    }
                  }}
                  className={INPUT}
                  placeholder="Name"
                  aria-label="New person's name"
                  autoFocus
                />
                <select
                  value={newRelationship}
                  onChange={(e) => setNewRelationship(e.target.value as OutsideRelationship)}
                  className={SELECT}
                  aria-label="Relationship"
                >
                  {RELATIONSHIP_ORDER.map((r) => (
                    <option key={r} value={r}>
                      {RELATIONSHIP_LABEL[r]}
                    </option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <button type="button" onClick={addPerson} className={BTN_SECONDARY}>
                    Add
                  </button>
                  <button type="button" onClick={() => setAdding(false)} className={BTN_GHOST}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setAdding(true)} className={`${BTN_GHOST} mt-1.5`}>
                + Add someone new
              </button>
            )}
          </div>

          <div>
            <label className={LABEL} htmlFor="beyond-title">
              Title <span className="text-ink-faint">(optional)</span>
            </label>
            <input
              id="beyond-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={INPUT}
              placeholder={kind === "one_on_one" ? "Weekly 1:1" : "Q4 pricing working group"}
            />
          </div>

          <div>
            <label className={LABEL} htmlFor="beyond-date">
              Date
            </label>
            <input
              id="beyond-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={`${INPUT} !w-auto`}
            />
          </div>

          {kind === "one_on_one" && (
            <div>
              <label className={LABEL} htmlFor="beyond-repeat">
                Repeat
              </label>
              <select
                id="beyond-repeat"
                value={repeat ?? ""}
                onChange={(e) => changeRepeat(e.target.value ? Number(e.target.value) : null)}
                className={`${SELECT} !w-44`}
              >
                <option value="">Doesn&apos;t repeat</option>
                <option value="1">Every week</option>
                <option value="2">Every 2 weeks</option>
                <option value="3">Every 3 weeks</option>
                <option value="4">Every 4 weeks</option>
              </select>
              <p className={`${META} mt-1`}>
                Logging it sets up the next one. Nothing is sent to anyone&apos;s calendar.
              </p>
            </div>
          )}

          {existing && (
            <button type="button" onClick={discard} className={`${BTN_GHOST} text-ink-muted`}>
              {isUpcoming ? (repeat ? "Cancel this 1:1 and stop repeating" : "Cancel this meeting") : "Delete this draft"}
            </button>
          )}
        </div>

        <div className={CARD_PAD}>
          <div className="flex items-center justify-between">
            <p className={EYEBROW}>Notes</p>
            <p className={META}>
              {!meeting
                ? "Saved when you save the draft or write it up"
                : notesState === "saving"
                  ? "Saving..."
                  : notesState === "error"
                    ? "Couldn't save — keep this tab open"
                    : "Saved to this meeting"}
            </p>
          </div>
          {carried.length > 0 && (
            <div className="mt-2 rounded-lg border border-hairline bg-sunken px-3 py-2">
              <p className={`${META} font-medium`}>Carried from last time</p>
              <ul className="mt-1 space-y-1">
                {carried.map((item) => (
                  <li key={item} className="flex items-center gap-2 text-sm text-ink-body">
                    <span className="flex-1">{item}</span>
                    <button type="button" onClick={() => removeCarried(item)} className={BTN_GHOST} aria-label={`Drop ${item}`}>
                      Drop
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <NoteField
            value={notes}
            onChange={setNotes}
            rows={16}
            className="mt-2 text-sm"
            placeholder="What was said, what was decided, who's doing what. Type, paste a transcript, or dictate."
          />
          {error && <p className={`${ERROR_TEXT} mt-3`}>{error}</p>}
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            {plan && !existing ? (
              <button type="button" onClick={saveDraft} className={BTN_PRIMARY}>
                Save and prepare
              </button>
            ) : (
            <>
            <button type="button" onClick={saveDraft} className={BTN_GHOST} disabled={phase === "drafting"}>
              Save draft
            </button>
            <button
              type="button"
              onClick={() => startWrapUp(false)}
              className={BTN_SECONDARY}
              disabled={phase === "drafting"}
            >
              Write it up myself
            </button>
            <button
              type="button"
              onClick={() => startWrapUp(true)}
              className={BTN_PRIMARY}
              disabled={phase === "drafting" || !notes.trim()}
            >
              {phase === "drafting" ? "Drafting..." : "Draft the write-up"}
            </button>
            </>
            )}
          </div>
        </div>
      </div>
    </PageShell>
  );
}
