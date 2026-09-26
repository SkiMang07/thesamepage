"use client";

// Review a possible connection (the mockup's interaction inset).
//
// An AI suggestion rests on two records, shown as the records say them —
// the excerpts are copied by the server, never model text. Three separate
// choices, none of which implies another:
//   - Add to prep: edit the wording, choose the conversation, save it as a
//     private prep item. Confirms nothing about the connection.
//   - Confirm connection: link the reviewed meeting to the goal or project
//     with a reason. No update is added and no status changes.
//   - Dismiss: hide it. Its records are untouched.
// Nothing here sends anything to anyone.

import { useState } from "react";
import Link from "next/link";
import {
  BeyondConversation,
  BeyondSuggestion,
  addBeyondPrepItem,
  connectBeyondSuggestion,
  dismissBeyondSuggestion,
} from "@/lib/api";
import { BTN_GHOST, BTN_PRIMARY_SM, BTN_SECONDARY, ERROR_TEXT, INPUT, META, SELECT } from "@/lib/tokens";
import { dayShort, dayWeekday, firstName, meetingTitle } from "@/app/app/beyond/shared";

type Receipt =
  | { kind: "added"; meeting: BeyondConversation; text: string }
  | { kind: "connected"; already: boolean };

function conversationLabel(m: BeyondConversation) {
  const title = meetingTitle({ title: m.title, kind: m.kind, people: m.people });
  return `${title} · ${m.date ? dayWeekday(m.date) : "no date yet"}`;
}

export default function SuggestionReview({
  suggestion,
  upcoming,
  onChanged,
  onDismissed,
}: {
  suggestion: BeyondSuggestion;
  upcoming: BeyondConversation[];
  // Re-read the page's data after a save.
  onChanged: () => void;
  onDismissed: () => void;
}) {
  const s = suggestion;
  const person = s.person;
  // The person's own upcoming conversations first, then everything else.
  const ordered = [
    ...upcoming.filter((m) => person && m.people.some((p) => p.id === person.id)),
    ...upcoming.filter((m) => !person || !m.people.some((p) => p.id === person.id)),
  ];
  const [text, setText] = useState(s.suggested_prep ?? s.title);
  // No default: the manager chooses where this goes.
  const [target, setTarget] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [note, setNote] = useState(s.reason);
  const [busy, setBusy] = useState<"add" | "connect" | "dismiss" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const added = receipts.find((r) => r.kind === "added") as Extract<Receipt, { kind: "added" }> | undefined;
  const connected = receipts.find((r) => r.kind === "connected") as Extract<Receipt, { kind: "connected" }> | undefined;

  const src = s.source.meeting;
  const srcTitle = meetingTitle({ title: src.title, kind: src.kind, people: src.people });
  const targetHref = s.target.type === "goal" ? "/app/goals" : "/app/projects";

  async function addToPrep() {
    const meeting = upcoming.find((m) => m.id === target);
    if (!meeting || !text.trim()) return;
    setBusy("add");
    setError(null);
    try {
      await addBeyondPrepItem(meeting.id, { text: text.trim(), suggestionId: s.id });
      setReceipts((r) => [...r, { kind: "added", meeting, text: text.trim() }]);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save it to prep");
    } finally {
      setBusy(null);
    }
  }

  async function connect() {
    setBusy("connect");
    setError(null);
    try {
      const res = await connectBeyondSuggestion(s.id, note.trim() || null);
      setReceipts((r) => [...r, { kind: "connected", already: res.already }]);
      setConnecting(false);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't confirm the connection");
    } finally {
      setBusy(null);
    }
  }

  async function dismiss() {
    setBusy("dismiss");
    setError(null);
    try {
      await dismissBeyondSuggestion(s.id);
      onDismissed();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't dismiss it");
      setBusy(null);
    }
  }

  return (
    <div className="mt-3 rounded-lg border-l-2 border-blue-600 bg-sunken p-4" aria-label="Review a possible connection">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="min-w-0">
          <Link href={`/app/beyond/meetings/${src.id}`} className="text-sm font-medium text-brand hover:text-brand-hover">
            {src.kind === "group" ? "Group meeting" : "Meeting"} · {srcTitle}
            {src.date ? `, ${dayShort(src.date)}` : ""} ↗
          </Link>
          <p className="mt-1 text-sm text-ink-body">{s.source.excerpt}</p>
          <p className={`${META} mt-0.5`}>{s.source.type === "commitment" ? "Recorded commitment, still open" : "Reviewed write-up"}</p>
        </div>
        <div className="min-w-0">
          <Link href={targetHref} className="text-sm font-medium text-brand hover:text-brand-hover">
            {s.target.type === "goal" ? "Goal" : "Project"} · {s.target.title} ↗
          </Link>
          <p className="mt-1 text-sm text-ink-body">
            {s.target.excerpt || <span className="text-ink-muted">Only the title is on the {s.target.type} record.</span>}
          </p>
        </div>
      </div>

      <div className="mt-4 border-t border-divider pt-3">
        <p className="text-2xs font-semibold uppercase tracking-wide text-blue-700">Why it may matter · AI suggestion</p>
        <p className="mt-1 text-sm text-ink-body">{s.reason}</p>
      </div>

      {!added && (
        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-secondary" htmlFor={`prep-${s.id}`}>
              Suggested prep — edit it to say it your way
            </label>
            <input id={`prep-${s.id}`} value={text} onChange={(e) => setText(e.target.value)} maxLength={500} className={INPUT} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-secondary" htmlFor={`target-${s.id}`}>
              Add it to which conversation?
            </label>
            {ordered.length ? (
              <select id={`target-${s.id}`} value={target} onChange={(e) => setTarget(e.target.value)} className={SELECT}>
                <option value="">Choose a conversation</option>
                {ordered.map((m) => (
                  <option key={m.id} value={m.id}>
                    {conversationLabel(m)}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-sm text-ink-secondary">
                No upcoming conversation is on record.{" "}
                {person ? (
                  <Link href={`/app/beyond/meetings/new?person=${person.id}&plan=1`} className="text-brand hover:text-brand-hover">
                    Plan a 1:1 with {firstName(person.name)} →
                  </Link>
                ) : (
                  <Link href="/app/beyond/meetings/new?plan=1" className="text-brand hover:text-brand-hover">
                    Plan a conversation →
                  </Link>
                )}
              </p>
            )}
          </div>
        </div>
      )}

      {added && (
        <p className="mt-4 rounded-md bg-brand-tint px-3 py-2 text-sm text-ink" role="status">
          Saved to your {dayShort(added.meeting.date) || "next"} {added.meeting.kind === "group" ? "group meeting" : "conversation"}
          {added.meeting.people[0] && added.meeting.kind === "one_on_one" ? ` with ${firstName(added.meeting.people[0].name)}` : ""}: “
          {added.text}”. Private — nothing was sent. The {s.target.type} is unchanged; confirming the connection is optional.{" "}
          <Link href={`/app/beyond/meetings/${added.meeting.id}`} className="text-brand hover:text-brand-hover">
            Open that conversation →
          </Link>
        </p>
      )}
      {connected && (
        <p className="mt-3 rounded-md bg-brand-tint px-3 py-2 text-sm text-ink" role="status">
          {connected.already ? "Already connected." : "Connected."} {srcTitle} now shows on {s.target.title}&apos;s record. No
          update was added and its status didn&apos;t change.
        </p>
      )}

      {connecting && !connected && (
        <div className="mt-4 rounded-md border border-hairline bg-surface p-3">
          <p className="text-sm text-ink">
            Connect <span className="font-medium">{srcTitle}</span> to <span className="font-medium">{s.target.title}</span>?
          </p>
          <label className="mb-1 mt-2 block text-xs font-medium text-ink-secondary" htmlFor={`note-${s.id}`}>
            Why they connect (shown on the {s.target.type}&apos;s record)
          </label>
          <input id={`note-${s.id}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={400} className={INPUT} />
          <p className={`${META} mt-1`}>This records where the context came from. It doesn&apos;t add an update or change any status.</p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={connect} disabled={busy !== null} className={BTN_PRIMARY_SM}>
              {busy === "connect" ? "Connecting..." : "Confirm connection"}
            </button>
            <button type="button" onClick={() => setConnecting(false)} className={BTN_GHOST}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className={`${ERROR_TEXT} mt-3`}>{error}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {!added && (
          <button type="button" onClick={addToPrep} disabled={busy !== null || !target || !text.trim()} className={BTN_PRIMARY_SM}>
            {busy === "add" ? "Saving..." : "Add to prep"}
          </button>
        )}
        {!connected && !connecting && (
          <button type="button" onClick={() => setConnecting(true)} disabled={busy !== null} className={BTN_SECONDARY}>
            Confirm connection…
          </button>
        )}
        {!added && !connected && (
          <button type="button" onClick={dismiss} disabled={busy !== null} className={BTN_GHOST}>
            {busy === "dismiss" ? "Dismissing..." : "Dismiss"}
          </button>
        )}
      </div>
      <p className={`${META} mt-3`}>Possible link only. Review the sources before accepting. Saving never sends anything.</p>
    </div>
  );
}
