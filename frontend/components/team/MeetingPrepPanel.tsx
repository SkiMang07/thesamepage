"use client";

// The compact, expandable preparation view for a planned team meeting — see
// meeting-prep.ts for what goes in it and why. Evidence stays separate from
// the saved agenda: nothing here is on the agenda until the manager adds it
// (through the same capture box, so they can reword it first).

import { useState } from "react";
import Link from "next/link";
import type { TeamMeeting } from "@/lib/api";
import { instantDate, isoToDateStr, shortDate } from "./dates";
import { MeetingPrep, PrepEntry, meetingLabel, onAgenda } from "./meeting-prep";
import PersonAvatar from "./PersonAvatar";

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export function prepSummary(prep: MeetingPrep): string {
  const parts: string[] = [];
  parts.push(prep.carried.length ? `${prep.carried.length} carried over` : "Nothing carried over");
  if (prep.boundary) {
    const since = shortDate(isoToDateStr(prep.boundary.at));
    parts.push(prep.changed.length ? `${plural(prep.changed.length, "change")} since ${since}` : `no recorded changes since ${since}`);
  } else {
    parts.push("no earlier logged meeting to compare");
  }
  return parts.join(" · ");
}

export default function MeetingPrepPanel({
  prep,
  meeting,
  onAddSuggestion,
  defaultOpen = false,
}: {
  prep: MeetingPrep;
  meeting: TeamMeeting;
  /** Omitted for a meeting whose agenda can't change. */
  onAddSuggestion?: (text: string) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = `prep-${meeting.id}`;

  return (
    <div className="mt-4 border-t border-hairline/70 pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="group flex w-full items-baseline justify-between gap-3 rounded-md text-left"
      >
        <span className="min-w-0">
          <span className="text-2xs font-semibold uppercase tracking-[0.12em] text-ink-muted">Preparation</span>
          <span className="ml-2 text-xs text-ink-secondary group-hover:text-ink-body">{prepSummary(prep)}</span>
        </span>
        <span className="shrink-0 text-xs text-brand group-hover:text-brand-hover">{open ? "Hide" : "Show"}</span>
      </button>

      {prep.unavailable.length > 0 && (
        <p className="mt-2 text-2xs text-amber-700">
          Couldn&apos;t load {prep.unavailable.join(", ")}, so this may be incomplete.
        </p>
      )}

      {open && (
        <div id={panelId} className="mt-3 space-y-4">
          <PrepGroup
            title="Carried over"
            empty="Nothing was carried into this meeting, and nothing from your last logged meeting is still open."
            entries={prep.carried}
            meeting={meeting}
            onAddSuggestion={onAddSuggestion}
          />

          <div>
            <PrepGroupHeading
              title="What changed"
              note={
                prep.boundary
                  ? `Since ${meetingLabel(prep.boundary.meeting)} was logged (${instantDate(prep.boundary.at)})`
                  : undefined
              }
            />
            {prep.boundary ? (
              <PrepList
                entries={prep.changed}
                empty="No check-ins, completed commitments or new commitments recorded since then."
                meeting={meeting}
                onAddSuggestion={onAddSuggestion}
              />
            ) : (
              <p className="mt-1.5 text-xs text-ink-muted">
                There&apos;s no earlier logged meeting for this team to compare against, so nothing is shown as changed.
              </p>
            )}
          </div>

          <div>
            <PrepGroupHeading title="Needs a decision" />
            <p className="mt-1.5 text-xs leading-5 text-ink-muted">
              No decision requests are recorded. If the team needs to decide something, add it to the agenda.
            </p>
          </div>

          <p className="text-2xs leading-4 text-ink-muted">
            Built from this team&apos;s meetings, commitments and goal and project check-ins. Private 1:1 notes and
            assessments are never included.
          </p>
        </div>
      )}
    </div>
  );
}

function PrepGroupHeading({ title, note }: { title: string; note?: string }) {
  return (
    <p className="text-xs font-medium text-ink-body">
      {title}
      {note && <span className="ml-2 font-normal text-ink-muted">{note}</span>}
    </p>
  );
}

function PrepGroup(props: {
  title: string;
  empty: string;
  entries: PrepEntry[];
  meeting: TeamMeeting;
  onAddSuggestion?: (text: string) => void;
}) {
  return (
    <div>
      <PrepGroupHeading title={props.title} />
      <PrepList {...props} />
    </div>
  );
}

const INITIAL = 4;

function PrepList({
  entries,
  empty,
  meeting,
  onAddSuggestion,
}: {
  entries: PrepEntry[];
  empty: string;
  meeting: TeamMeeting;
  onAddSuggestion?: (text: string) => void;
}) {
  const [all, setAll] = useState(false);
  if (entries.length === 0) return <p className="mt-1.5 text-xs text-ink-muted">{empty}</p>;
  const shown = all ? entries : entries.slice(0, INITIAL);
  return (
    <>
      <ul className="mt-1.5 divide-y divide-hairline/60">
        {shown.map((entry) => (
          <PrepRow key={entry.key} entry={entry} meeting={meeting} onAddSuggestion={onAddSuggestion} />
        ))}
      </ul>
      {entries.length > INITIAL && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-1 text-xs text-brand hover:text-brand-hover">
          {all ? "Show fewer" : `Show all ${entries.length}`}
        </button>
      )}
    </>
  );
}

function PrepRow({
  entry,
  meeting,
  onAddSuggestion,
}: {
  entry: PrepEntry;
  meeting: TeamMeeting;
  onAddSuggestion?: (text: string) => void;
}) {
  const already = entry.key.startsWith("carried-") || onAgenda(meeting, entry.suggestion);
  return (
    <li className="py-2">
      <div className="flex items-start gap-2.5">
        {entry.ownerName !== undefined && (
          <PersonAvatar id={entry.ownerId ?? null} name={entry.ownerName ?? "You"} size="xs" className="mt-0.5" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm text-ink-body">{entry.title}</p>
          <p className="mt-0.5 text-xs text-ink-muted">{entry.detail}</p>
          <details className="mt-1 text-xs">
            <summary className="cursor-pointer text-ink-secondary hover:text-ink-body">Why this?</summary>
            <p className="mt-1 leading-5 text-ink-muted">{entry.why}</p>
            <p className="mt-0.5 text-ink-muted">
              {entry.source.href ? (
                <Link href={entry.source.href} className="text-brand hover:text-brand-hover">
                  {entry.source.label} →
                </Link>
              ) : (
                entry.source.label
              )}
            </p>
          </details>
        </div>
        {onAddSuggestion &&
          (already ? (
            <span className="shrink-0 pt-0.5 text-2xs text-ink-muted">On the agenda</span>
          ) : (
            <button
              type="button"
              onClick={() => onAddSuggestion(entry.suggestion)}
              className="shrink-0 rounded px-1.5 py-0.5 text-xs text-brand hover:bg-sunken hover:text-brand-hover"
            >
              Add to agenda
            </button>
          ))}
      </div>
    </li>
  );
}
