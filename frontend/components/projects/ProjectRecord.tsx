"use client";

// The dated record for one project, loaded on demand when opened. Each entry
// shows its full note, the status recorded with it and only a percentage that
// entry itself recorded. A confirmed Beyond meeting links to that meeting.
// A failed load is "unavailable", never "no updates".

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { getBeyondLinks, getProjectCheckIns, type BeyondLinkHistoryItem, type CheckIn } from "@/lib/api";
import { BTN_SECONDARY } from "@/lib/tokens";
import { formatMoment } from "@/lib/projects";
import { StatusChip } from "./StatusChip";

type State =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; entries: CheckIn[]; meetings: Map<string, BeyondLinkHistoryItem> };

export default function ProjectRecord({ projectId, version }: { projectId: string; version: number }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(() => {
    let live = true;
    setState({ kind: "loading" });
    Promise.all([getProjectCheckIns(projectId), getBeyondLinks({ projectId }).catch(() => [] as BeyondLinkHistoryItem[])])
      .then(([entries, links]) => {
        if (!live) return;
        setState({ kind: "ready", entries, meetings: new Map(links.map((l) => [l.meeting_id, l])) });
      })
      .catch(() => live && setState({ kind: "error" }));
    return () => {
      live = false;
    };
  }, [projectId]);

  useEffect(() => load(), [load, version]);

  if (state.kind === "loading") {
    return <p className="text-sm text-ink-muted" role="status">Loading the record…</p>;
  }
  if (state.kind === "error") {
    return (
      <div role="alert">
        <p className="text-sm text-red-700">The record couldn’t load. This doesn’t mean there are no updates.</p>
        <button type="button" onClick={load} className={`${BTN_SECONDARY} mt-3`}>
          Try again
        </button>
      </div>
    );
  }
  if (!state.entries.length) {
    return <p className="text-sm text-ink-muted">No updates recorded yet. The first one starts the record.</p>;
  }
  return (
    <ol className="space-y-4">
      {state.entries.map((ci) => {
        const meeting = ci.source_type === "outside_meeting" && ci.source_id ? state.meetings.get(ci.source_id) : undefined;
        return (
          <li key={ci.id} className="grid grid-cols-1 gap-1 sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:gap-4">
            <time dateTime={ci.created_at} className="pt-0.5 text-xs text-ink-muted">
              {formatMoment(ci.created_at)}
            </time>
            <div className="min-w-0 border-l border-control pl-4">
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip status={ci.status} />
                {ci.progress != null && <span className="text-xs text-ink-secondary">{ci.progress}% completion</span>}
              </div>
              <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-6 text-ink-body">
                {ci.note || <span className="text-ink-muted">Status recorded without a note.</span>}
              </p>
              {ci.source_type === "outside_meeting" && ci.source_id && (
                <Link href={`/app/beyond/meetings/${ci.source_id}`} className="mt-1 inline-block text-xs text-brand hover:text-brand-hover">
                  From a meeting beyond the team{meeting?.meeting_title ? `: ${meeting.meeting_title}` : ""} ↗
                </Link>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
