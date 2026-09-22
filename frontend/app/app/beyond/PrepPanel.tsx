"use client";

// ---------------------------------------------------------------------------
// Prep for an upcoming 1:1 beyond the team.
//
// Shaped by relationship: with your boss or skip-level it's your team
// update (what's at risk, what moved, what you need from them); with
// anyone else it's what's open between the two of you.
//
// The sources are shown before preparing so the manager can see exactly
// what goes in — and what doesn't. Team data is WORK, NOT PEOPLE: goals,
// projects, check-ins and commitments between you. Never assessments, 1:1
// notes, development plans or secondhand notes about your reports.
//
// The sheet is kept on the meeting, the same posture as 1:1 prep: something
// to talk from, not a record. A failed regenerate keeps the previous sheet.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import NoteField from "@/components/NoteField";
import {
  BeyondPrepSources,
  OutsideMeeting,
  getOutsideMeetingPrepSources,
  prepareOutsideMeeting,
} from "@/lib/api";
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, CARD_PAD, ERROR_TEXT, EYEBROW, META } from "@/lib/tokens";
import { shortDate } from "./shared";

const STATUS_WORD: Record<string, string> = {
  at_risk: "at risk",
  on_track: "on track",
  active: "active",
  completed: "done",
  cancelled: "cancelled",
};

export default function PrepPanel({
  meeting,
  onPrepared,
}: {
  meeting: OutsideMeeting;
  onPrepared: (meeting: OutsideMeeting) => void;
}) {
  const [sources, setSources] = useState<BeyondPrepSources | null>(null);
  const [sourcesError, setSourcesError] = useState(false);
  const [showSources, setShowSources] = useState(!meeting.prep_guide);
  const [notes, setNotes] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getOutsideMeetingPrepSources(meeting.id)
      .then(setSources)
      .catch(() => setSourcesError(true));
  }, [meeting.id, meeting.carry_forward_items.length]);

  async function prepare() {
    setPreparing(true);
    setError(null);
    try {
      onPrepared(await prepareOutsideMeeting(meeting.id, notes.trim() || null));
      setShowSources(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't prepare this 1:1");
    } finally {
      setPreparing(false);
    }
  }

  const person = meeting.people[0];
  const first = person?.name.split(" ")[0] ?? "them";
  const teamUpdate = sources ? sources.shape === "team_update" : ["manager", "skip_level"].includes(person?.relationship ?? "");
  const guide = meeting.prep_guide;
  const atRisk = sources ? [...sources.goals, ...sources.projects].filter((w) => w.status === "at_risk") : [];

  return (
    <section className={CARD_PAD}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className={EYEBROW}>{teamUpdate ? `Your update for ${first}` : `Prep: what's open with ${first}`}</p>
        {guide && <p className={META}>Prepared {shortDate(guide.prepared_at)}</p>}
      </div>

      {guide && (
        <div className="mt-3 space-y-4">
          {guide.situation_summary && <p className="text-sm text-ink-body">{guide.situation_summary}</p>}
          <ol className="space-y-3">
            {guide.agenda_items.map((item, i) => (
              <li key={i} className="rounded-lg border border-hairline bg-sunken px-3 py-2">
                <p className="text-sm font-medium text-ink">
                  {i + 1}. {item.title}
                </p>
                {item.rationale && <p className={`${META} mt-0.5`}>{item.rationale}</p>}
                {item.talking_points.length > 0 && (
                  <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-sm text-ink-secondary">
                    {item.talking_points.map((t, j) => (
                      <li key={j}>{t}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
          {guide.asks.length > 0 && (
            <div>
              <p className={`${META} font-medium`}>What you need from {first}</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-ink-body">
                {guide.asks.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className={guide ? "mt-4 border-t border-divider pt-3" : "mt-2"}>
        {sourcesError ? (
          <p className={META}>Couldn&apos;t load what this draws on. You can still prepare.</p>
        ) : !sources ? (
          <p className={META}>Gathering...</p>
        ) : (
          <>
            <button type="button" onClick={() => setShowSources((v) => !v)} className={`${META} hover:text-ink`}>
              {showSources ? "▾" : "▸"} Draws on:{" "}
              {[
                sources.last_meeting ? `last 1:1 (${shortDate(sources.last_meeting.date + "T12:00:00Z")})` : "no earlier 1:1",
                sources.carried.length && `${sources.carried.length} carried`,
                sources.you_owe.length && `you owe ${sources.you_owe.length}`,
                sources.they_owe.length && `${first} owes ${sources.they_owe.length}`,
                teamUpdate && `${sources.goals.length + sources.projects.length} live goals & projects`,
                teamUpdate && atRisk.length > 0 && `${atRisk.length} at risk`,
                teamUpdate && `${sources.moved.length} check-ins since ${shortDate(sources.since + "T12:00:00Z")}`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </button>
            {showSources && (
              <div className="mt-2 grid gap-3 text-sm sm:grid-cols-2">
                <SourceList title="Carried from last time" items={sources.carried} />
                <SourceList
                  title={`You owe ${first}`}
                  items={sources.you_owe.map((c) => c.description + (c.due_date ? ` · due ${shortDate(c.due_date + "T12:00:00Z")}` : ""))}
                />
                <SourceList
                  title={`${first} owes you`}
                  items={sources.they_owe.map((c) => c.description + (c.due_date ? ` · due ${shortDate(c.due_date + "T12:00:00Z")}` : ""))}
                />
                {teamUpdate && (
                  <SourceList
                    title="Goals & projects"
                    items={[...sources.goals, ...sources.projects].map(
                      (w) => `${w.title} · ${STATUS_WORD[w.status] ?? w.status}${w.progress != null ? ` · ${w.progress}%` : ""}`
                    )}
                  />
                )}
                {teamUpdate && (
                  <SourceList
                    title="What moved"
                    items={sources.moved.map((m) => `${m.item} → ${STATUS_WORD[m.status] ?? m.status}${m.note ? `: ${m.note}` : ""}`)}
                  />
                )}
                <SourceList
                  title="From other meetings beyond the team"
                  items={sources.heard.map((h) => `${h.item ? `${h.item}: ` : ""}${h.note}`)}
                />
                {teamUpdate && (
                  <p className={`${META} sm:col-span-2`}>
                    Work only. Nothing about individual people on your team goes into this — no assessments, 1:1 notes
                    or things you heard about them.
                  </p>
                )}
              </div>
            )}
          </>
        )}

        <div className="mt-3">
          <NoteField
            value={notes}
            onChange={setNotes}
            rows={2}
            className="text-sm"
            placeholder={`Anything else you want to raise with ${first}?`}
          />
        </div>
        {error && <p className={`${ERROR_TEXT} mt-2`}>{error}</p>}
        <div className="mt-2 flex justify-end gap-2">
          {guide && showSources && (
            <button type="button" onClick={() => setShowSources(false)} className={BTN_GHOST}>
              Hide sources
            </button>
          )}
          <button type="button" onClick={prepare} disabled={preparing} className={guide ? BTN_SECONDARY : BTN_PRIMARY}>
            {preparing ? "Preparing..." : guide ? "Prepare again" : `Prepare for ${first}`}
          </button>
        </div>
      </div>
    </section>
  );
}

function SourceList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className={`${META} font-medium`}>{title}</p>
      {items.length === 0 ? (
        <p className="text-xs text-ink-faint">None</p>
      ) : (
        <ul className="mt-0.5 space-y-0.5 text-xs text-ink-secondary">
          {items.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
