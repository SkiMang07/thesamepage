"use client";

// The report's read-only copy of a 1:1 transcript (build plan session 4).
//
// The server only returns it once the call has ended, and returns every gap
// as start and end only: nothing here can tell a pause from an off-the-record
// stretch or a stop, and nothing tries to. Every gap reads the same neutral
// "Not transcribed · N min". Labels are turned round for the reader: their
// own track is "You", the manager's is the manager's first name. A line the
// manager's mic alone heard names nobody, so it carries no label.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getCallTranscript, type CallTranscriptDetail } from "@/lib/api";
import { buildReportTranscript } from "@/lib/report-transcript";

export default function ReportTranscriptPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<CallTranscriptDetail | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    getCallTranscript(id)
      .then((t) => live && setData(t))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [id]);

  const manager = data?.manager_first_name || "Your manager";
  const view = data ? buildReportTranscript(data, manager) : null;
  const date = data
    ? new Date(data.started_at).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })
    : "";

  return (
    <main className="mx-auto max-w-2xl px-5 py-12 sm:px-6">
      <Link href="/app/ic" className="text-sm text-brand hover:text-brand-hover">
        ← Your 1:1s
      </Link>
      {failed && !data && (
        <p className="mt-6 text-ink-body">This transcript isn&apos;t available. It may have been deleted, or the call is still going.</p>
      )}
      {!data && !failed && <div className="mt-6 h-40 animate-pulse rounded-xl bg-sunken motion-reduce:animate-none" />}
      {data && view && (
        <>
          <h1 className="mt-4 font-serif text-3xl font-normal leading-tight text-ink">
            Your 1:1 with {data.manager_first_name || "your manager"}
          </h1>
          <p className="mt-1 text-sm text-ink-secondary">
            {date} · machine transcript · read only
          </p>
          {view.note && <p className="mt-4 rounded-md bg-sunken px-3 py-2 text-sm text-ink-secondary">{view.note}</p>}
          {view.items.length === 0 ? (
            <p className="mt-8 text-ink-secondary">Nothing was transcribed in this call.</p>
          ) : (
            <ol className="mt-8 space-y-3">
              {view.items.map((it, i) =>
                it.type === "gap" ? (
                  <li key={`g${i}`} className="flex items-center gap-3 py-1 text-xs text-ink-muted">
                    <span aria-hidden className="flex-1 border-t border-dashed border-ink-faint" />
                    {it.label}
                    <span aria-hidden className="flex-1 border-t border-dashed border-ink-faint" />
                  </li>
                ) : (
                  <li key={`l${i}`} className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-3 text-sm leading-6">
                    <span className="pt-px text-xs tabular-nums text-ink-muted">{it.clock}</span>
                    <p className="text-ink-body">
                      {it.speaker && <span className="mr-1.5 font-semibold text-ink">{it.speaker}</span>}
                      {it.text}
                    </p>
                  </li>
                ),
              )}
            </ol>
          )}
          <p className="mt-10 text-xs text-ink-muted">
            Transcribed by machine from the call&apos;s audio, so some words may be wrong. The audio itself was discarded once it was
            transcribed.
          </p>
        </>
      )}
    </main>
  );
}
