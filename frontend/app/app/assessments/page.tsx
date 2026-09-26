"use client";

// Assessments overview — one card per person: where their period assessment
// stands, the confirmed headline of the last one, and a four-quarter strip of
// what has been assessed. Quarterly or biannual, or off-cycle when there's a
// reason; this is not a weekly rating tool, so nothing here goes "stale", empty
// quarters are neutral and nobody is ranked. A legacy rolling rating shows as
// context, never as a completed period assessment. See docs/systems/assessments.md.

import { ReactNode, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getTeamAssessments, TeamAssessmentItem } from "@/lib/api";
import PageShell from "@/components/PageShell";
import PersonAvatar from "@/components/team/PersonAvatar";
import { SkeletonSection } from "@/components/Skeleton";
import { buildYearStrip, formatDay, StripSlot } from "@/lib/assessment-periods";
import { BTN_PRIMARY_SM, BTN_SECONDARY, CARD } from "@/lib/tokens";

const STAGES: Record<string, { step: number; label: string }> = {
  picture: { step: 1, label: "Checking the picture" },
  draft: { step: 2, label: "Draft & discuss" },
  review: { step: 3, label: "Final review" },
};

const periodShort = (label: string | null | undefined) => (label || "").split(" · ")[0];

export default function AssessmentsPage() {
  const [team, setTeam] = useState<TeamAssessmentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getTeamAssessments()
      .then(setTeam)
      .catch(() => setError("Assessments couldn’t be loaded. This is a connection problem, not an empty team."))
      .finally(() => setLoading(false));
  }, []);

  const rows = useMemo(() => {
    const today = new Date();
    return team.map((r) => ({
      r,
      strip: buildYearStrip(r.reviews || [], r.latest_from_review ? null : r.assessed_at, today),
    }));
  }, [team]);

  const current = rows[0]?.strip.at(-1);
  const tally = useMemo(() => {
    const t = { completed: 0, in_progress: 0, not_started: 0 };
    for (const { strip } of rows) {
      const s = strip.at(-1)?.state;
      if (s === "completed") t.completed++;
      else if (s === "in_progress") t.in_progress++;
      else t.not_started++;
    }
    return t;
  }, [rows]);

  return (
    <PageShell maxWidth="6xl">
      <h1 className="font-serif text-[2.3rem] font-normal leading-none tracking-[-0.03em] text-ink sm:text-[2.6rem]">Assessments</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-secondary">
        Quarterly or biannual — or off-cycle when there’s a reason. AI brings the period together and drafts against each role’s expectations; you decide every judgment.
      </p>

      {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
      {loading ? (
        <SkeletonSection label="Loading assessments" variant="list" className="mt-6" />
      ) : !error && team.length === 0 ? (
        <p className="mt-6 text-ink-secondary">
          No direct reports yet.{" "}
          <Link href="/app/dashboard" className="underline hover:text-ink-body">
            Add your first one
          </Link>
          .
        </p>
      ) : (
        <>
          {current && (
            <p className="mt-5 text-sm text-ink-muted">
              {current.label} {current.year} so far:{" "}
              <span className="text-brand">{tally.completed} completed</span>
              {" · "}
              <span className={tally.in_progress ? "text-amber-700" : ""}>{tally.in_progress} in progress</span>
              {" · "}
              {tally.not_started} not started
            </p>
          )}
          <ul className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {rows.map(({ r, strip }) => (
              <PersonCard key={r.id} r={r} strip={strip} />
            ))}
          </ul>
        </>
      )}
    </PageShell>
  );
}

function PersonCard({ r, strip }: { r: TeamAssessmentItem; strip: StripSlot[] }) {
  const open = r.open_review;
  const last = r.last_review;
  const lastFull = last ? (r.reviews || []).find((x) => x.id === last.id) : undefined;
  const lastLabel = lastFull?.rating_label ?? (r.latest_from_review ? r.latest_level_label : null);

  let body: ReactNode;
  let actions: ReactNode;

  if (open) {
    const stage = STAGES[open.stage] || STAGES.draft;
    body = (
      <>
        <p className="text-xs font-semibold uppercase tracking-[0.05em] text-amber-700">In progress · {periodShort(open.review_period)}</p>
        <div className="mt-3 flex gap-1.5" aria-hidden="true">
          {[1, 2, 3].map((i) => (
            <span key={i} className={`h-1.5 flex-1 rounded-full ${i <= stage.step ? "bg-amber-500" : "bg-divider"}`} />
          ))}
        </div>
        <p className="mt-2 text-xs text-ink-muted">
          Step {stage.step} of 3 · {stage.label} · last worked on {formatDay(open.updated_at, false)}
        </p>
        {last && (
          <p className="mt-3 text-xs text-ink-muted">
            Last completed: {periodShort(last.review_period)}
            {lastLabel ? ` · ${lastLabel}` : ""}
          </p>
        )}
      </>
    );
    actions = (
      <Link href={`/app/assessments/${r.id}/${open.id}`} className={BTN_PRIMARY_SM}>
        Resume
      </Link>
    );
  } else if (last) {
    body = (
      <>
        <p className="text-xs font-semibold uppercase tracking-[0.05em] text-brand">
          ✓ {periodShort(last.review_period)} complete · {formatDay(last.completed_at, false)}
        </p>
        {lastFull?.headline && (
          <p className="mt-2 font-serif text-[1.05rem] leading-snug text-ink">“{lastFull.headline}”</p>
        )}
        {lastLabel && <p className="mt-1.5 text-xs text-ink-muted">Overall: {lastLabel}</p>}
      </>
    );
    actions = (
      <>
        <Link href={`/app/assessments/${r.id}/${last.id}`} className={BTN_SECONDARY}>
          Open assessment
        </Link>
        <Link href={`/app/assessments/${r.id}`} className="text-sm text-ink-muted underline-offset-2 hover:text-ink hover:underline">
          Start another
        </Link>
      </>
    );
  } else {
    body = r.latest_level_label ? (
      <>
        <p className="text-xs font-semibold uppercase tracking-[0.05em] text-ink-faint">No period assessment yet</p>
        <p className="mt-2 text-sm text-ink-secondary">
          Older rating: {r.latest_level_label} · {formatDay(r.assessed_at, false)}
        </p>
        <p className="text-xs text-ink-faint">Not a period assessment</p>
      </>
    ) : (
      <>
        <p className="text-xs font-semibold uppercase tracking-[0.05em] text-ink-faint">No assessments yet</p>
        <p className="mt-2 text-sm text-ink-secondary">AI gathers what’s on record for the period you pick. You decide every judgment.</p>
      </>
    );
    actions = (
      <Link href={`/app/assessments/${r.id}`} className={BTN_PRIMARY_SM}>
        Start assessment
      </Link>
    );
  }

  return (
    <li className={`${CARD} flex flex-col gap-4 p-5`}>
      <div className="flex items-center gap-3">
        <PersonAvatar id={r.id} name={r.name} size="lg" />
        <div className="min-w-0">
          <Link href={`/app/assessments/${r.id}`} className="block truncate font-medium text-ink hover:underline">
            {r.name}
          </Link>
          {r.role_title && <p className="truncate text-sm text-ink-muted">{r.role_title}</p>}
        </div>
      </div>
      <div className="flex-1">{body}</div>
      <div className="flex flex-wrap items-center gap-3">{actions}</div>
      <YearStrip slots={strip} />
    </li>
  );
}

const SLOT_TEXT: Record<StripSlot["state"], string> = {
  completed: "completed",
  in_progress: "in progress",
  legacy: "older rating (not a period assessment)",
  none: "not assessed",
};

function YearStrip({ slots }: { slots: StripSlot[] }) {
  const first = slots[0];
  const lastSlot = slots[slots.length - 1];
  const span =
    first.year === lastSlot.year
      ? String(lastSlot.year)
      : `${first.label} ’${String(first.year).slice(2)} – ${lastSlot.label} ’${String(lastSlot.year).slice(2)}`;
  const summary = slots
    .map((s) => `${s.label} ${s.year}: ${SLOT_TEXT[s.state]}${s.offCycle ? `, plus an off-cycle assessment ${SLOT_TEXT[s.offCycle]}` : ""}`)
    .join("; ");

  return (
    <div className="flex items-end border-t border-divider pt-3" role="img" aria-label={`Last four quarters — ${summary}`}>
      <div className="flex items-start">
        {slots.map((s, i) => (
          <div key={`${s.year}-${s.quarter}`} className="relative flex w-9 flex-col items-center gap-1" title={`${s.label} ${s.year} · ${SLOT_TEXT[s.state]}${s.offCycle ? " · off-cycle assessment" : ""}`}>
            {/* A biannual (one assessment across two quarters) is drawn joined. */}
            {s.joinsNext && i < slots.length - 1 && (
              <span aria-hidden="true" className="absolute left-1/2 top-[5px] h-[3px] w-9 bg-brand/70" />
            )}
            <span className="relative flex h-3.5 items-center">
              <Dot state={s.state} />
              {s.offCycle && (
                <span
                  aria-hidden="true"
                  className={`absolute -right-2 -top-0.5 h-1.5 w-1.5 rotate-45 ${s.offCycle === "completed" ? "bg-brand" : "bg-amber-500"}`}
                />
              )}
            </span>
            <span className={`text-2xs ${s.current ? "font-semibold text-brand" : "text-ink-faint"}`}>{s.label}</span>
          </div>
        ))}
      </div>
      <span className="ml-auto pb-0.5 text-2xs text-ink-faint">{span}</span>
    </div>
  );
}

function Dot({ state }: { state: StripSlot["state"] }) {
  const base = "relative block h-3 w-3 rounded-full";
  if (state === "completed") return <span className={`${base} bg-brand`} />;
  if (state === "in_progress") return <span className={`${base} border-2 border-amber-500 bg-amber-500/25`} />;
  if (state === "legacy") return <span className={`${base} border-[1.5px] border-ink-faint`} />;
  return <span className={`${base} bg-divider`} />;
}
