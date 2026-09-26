"use client";

// Mission Control — "Your week, in focus."
//
// Selected design: docs/design-proposals/2026-09-24-week-in-focus/ (BUILD_BRIEF.md
// + prototype-source.html). Composition, in order: editorial heading; three
// factual, clickable counts; the conversation week; follow-through by owner;
// a quiet right-hand column holding the action brief's next move (replaced by
// details when something is selected); then Goals & progress, full width.
//
// Data: GET /api/dashboard/week (backend/mission_control_week.py) for
// everything factual, GET /api/dashboard/brief for the recommendation. Every
// count on this page is the length of a list from the week payload, so a
// count and its drill-down cannot disagree.
//
// Honesty rules held here (see the brief's "Data semantics"):
//  - Meetings carry a date, not a time. Rows show preparation state, never an
//    invented start time.
//  - Status never relies on colour alone: every state has a glyph and a word.
//  - A goal percentage renders only from a recorded check-in, with that
//    check-in's date. "Progress not recorded" is not 0%. Status and
//    freshness are labelled separately.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQuickAdd } from "@/lib/quick-add-context";
import {
  GoalLevel,
  GoalStatus,
  MissionControlBrief,
  MissionControlCandidate,
  WeekCommitment,
  WeekCommitmentOwner,
  WeekCommitmentState,
  WeekConversation,
  WeekConversationState,
  WeekGoal,
  WeekInFocus as WeekData,
  getMissionControlMorningLine,
  reconcileMissionControlOutcomes,
  recordMissionControlEvents,
} from "@/lib/api";
import {
  BTN_PRIMARY_SM,
  BTN_SECONDARY,
  EYEBROW,
  IDENTITY_TEXT,
  IDENTITY_VAR,
  METER_SEGMENT,
  METER_SEGMENT_SELECTED,
  METER_SWATCH,
  STATUS_GLYPH,
  identityIndex,
} from "@/lib/tokens";
import PageShell from "@/components/PageShell";
import { SkeletonBar } from "@/components/Skeleton";
import { useZoneData } from "@/components/ZoneMap";
import {
  CandidateControls,
  CoverageNotice,
  ImpressionMap,
  eventFor,
  startOfNextLocalDay,
} from "@/components/mission-control/ActionBrief";

// ---------------------------------------------------------------------------
// Dates. The payload's dates are plain YYYY-MM-DD in the manager's week.
// ---------------------------------------------------------------------------

function parseDay(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}
function isoOf(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDays(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}
const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) => parseDay(iso).toLocaleDateString("en-US", opts);
const shortDate = (iso: string) => fmt(iso, { month: "short", day: "numeric" });
const longDate = (iso: string) => fmt(iso, { weekday: "long", month: "long", day: "numeric" });
const dayWithDate = (iso: string) => fmt(iso, { weekday: "short", month: "short", day: "numeric" });

function daysBetween(fromIso: string, toIso: string) {
  return Math.round((parseDay(toIso).getTime() - parseDay(fromIso).getTime()) / 86_400_000);
}

// is_current is derived too, so an older backend without it still reads right.
const isCurrentWeek = (w: WeekData["week"]) => w.is_current ?? (w.start <= w.today && w.today <= w.end);

/** How the page names the week it is showing, in running text. */
function weekPhrase(w: WeekData["week"]) {
  if (isCurrentWeek(w)) return "this week";
  const todayStart = isoOf(addDays(parseDay(w.today), -((parseDay(w.today).getDay() + 6) % 7)));
  const offset = daysBetween(todayStart, w.start) / 7;
  if (offset === -1) return "last week";
  if (offset === 1) return "next week";
  return `the week of ${shortDate(w.start)}`;
}

function rangeLabel(start: string, end: string) {
  const a = parseDay(start);
  const b = parseDay(end);
  const month = (d: Date) => d.toLocaleDateString("en-US", { month: "short" });
  return a.getMonth() === b.getMonth()
    ? `${month(a)} ${a.getDate()}–${b.getDate()}`
    : `${month(a)} ${a.getDate()} – ${month(b)} ${b.getDate()}`;
}

function initialsOf(name: string) {
  const parts = name.replace(/[^\p{L}\p{N}\s'’-]/gu, " ").split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "·";
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

const KIND_LABEL: Record<WeekConversation["kind"], string> = {
  one_on_one: "1:1",
  team_meeting: "Team meeting",
  outside_one_on_one: "1:1 beyond the team",
  outside_group: "Group meeting beyond the team",
};

const isGroup = (c: WeekConversation) => c.kind === "team_meeting" || c.kind === "outside_group";

const STATE_GLYPH: Record<WeekConversationState, string> = {
  completed: "✓",
  prep_saved: "•",
  to_prepare: "○",
  not_logged: "△",
};
const STATE_TONE: Record<WeekConversationState, string> = {
  completed: "text-brand",
  prep_saved: "text-ink-muted",
  to_prepare: "text-amber-600",
  not_logged: "text-amber-600",
};
function stateShort(c: WeekConversation) {
  if (c.state === "completed") return "Done";
  if (c.state === "not_logged") return "Not logged";
  if (c.state === "prep_saved") return c.kind === "team_meeting" ? "Agenda" : "Prepped";
  return c.kind === "team_meeting" ? "No agenda" : "To prep";
}
function stateLong(c: WeekConversation) {
  if (c.state === "completed") return "Completed";
  if (c.state === "not_logged") return "Date has passed · not logged yet";
  if (c.state === "prep_saved") return c.kind === "team_meeting" ? "Agenda set" : "Preparation saved";
  return c.kind === "team_meeting" ? "No agenda yet" : "Not yet prepared";
}
function primaryActionLabel(c: WeekConversation) {
  if (c.kind !== "one_on_one") return "Open meeting";
  if (c.state === "completed") return "Open conversation history";
  if (c.state === "prep_saved") return "Open preparation";
  if (c.state === "not_logged") return "Wrap up & log";
  return "Review & prepare";
}
function primaryActionHref(c: WeekConversation) {
  // A past, unlogged 1:1 is finished from the person page's Wrap up & log.
  if (c.kind === "one_on_one" && c.state === "not_logged" && c.person_href) return c.person_href;
  return c.href;
}

const COMMITMENT_STATE_LABEL: Record<WeekCommitmentState, string> = {
  completed: "Completed",
  due: "Due this week",
  overdue: "Overdue",
};
const STATES: WeekCommitmentState[] = ["completed", "due", "overdue"];

const STATUS_LABEL: Record<GoalStatus, string> = {
  active: "Active",
  on_track: "On track",
  at_risk: "At risk",
  completed: "Completed",
  cancelled: "Cancelled",
};
const STATUS_TONE: Record<GoalStatus, string> = {
  active: "text-ink-muted",
  on_track: "text-brand",
  at_risk: "text-amber-600",
  completed: "text-brand",
  cancelled: "text-ink-muted",
};

const TIER_LABEL: Record<GoalLevel, string> = {
  company: "Company",
  department: "Department",
  team: "Team",
  individual: "Individual",
};
const GOAL_CARD_LIMIT = 6;

// ---------------------------------------------------------------------------
// Layout: measured, not viewport-based, so the Scribe drawer (which narrows
// the content column without changing the viewport) reflows the page too.
// ---------------------------------------------------------------------------

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(1200);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

// ---------------------------------------------------------------------------
// Person identity. A direct report wears the colour the rest of the app's
// chrome gives them (the roster AppNav and the person pages read), so the
// same person is the same colour here. Someone outside the team, who isn't
// on that roster, gets a stable colour from their name.
// ---------------------------------------------------------------------------

type ColorFor = (c: WeekConversation) => string | null;

function useIdentityColors(): ColorFor {
  const { roster } = useZoneData();
  return useMemo(() => {
    const byId = new Map(roster.map((p) => [p.id, p.color]));
    return (c: WeekConversation) => {
      if (isGroup(c)) return null;
      if (c.direct_report_id) return byId.get(c.direct_report_id) ?? IDENTITY_VAR[identityIndex(c.direct_report_id)];
      return IDENTITY_VAR[identityIndex(c.title.toLowerCase())];
    };
  }, [roster]);
}

type Selection =
  | { type: "home" }
  | { type: "conversation"; id: string }
  | { type: "records"; owner: WeekCommitmentOwner | "all"; state: WeekCommitmentState }
  | { type: "completed_conversations" }
  | { type: "unscheduled" };

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function WeekInFocus({
  brief,
  briefFailed,
  week,
  weekFailed,
  weekLoading = false,
  updatedAt = null,
  onRefresh,
  onRetryBrief,
  onRetryWeek,
  onWeekOf,
  onLegacy,
}: {
  brief: MissionControlBrief | null;
  briefFailed: boolean;
  week: WeekData | null;
  weekFailed: boolean;
  weekLoading?: boolean;
  updatedAt?: Date | null;
  onRefresh: () => void;
  onRetryBrief: () => void;
  onRetryWeek: () => void;
  onWeekOf?: (day: string | null) => void;
  onLegacy: () => void;
}) {
  const [rootRef, rootWidth] = useWidth<HTMLDivElement>();
  const [selection, setSelection] = useState<Selection>({ type: "home" });
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const triggerRef = useRef<HTMLElement | null>(null);
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const colorFor = useIdentityColors();

  // Two columns once the main column can still hold five ~92px day columns
  // beside the side panel; below that the side panel moves under the counts.
  const twoColumn = rootWidth >= 860;
  const sideWidth = rootWidth >= 1200 ? "20rem" : "17rem";

  // Stale selection after a refresh or a week change (a record disappeared)
  // falls back home.
  useEffect(() => {
    if (selection.type === "conversation" && week && !week.conversations.some((c) => c.id === selection.id)) {
      setSelection({ type: "home" });
    }
    if (selection.type === "unscheduled" && week && week.unscheduled_due.length === 0) {
      setSelection({ type: "home" });
    }
  }, [week, selection]);
  useEffect(() => setOpenDay(null), [week?.week.start]);

  // B3 — the morning line. Cached per day server-side; written on the first
  // load that needs it. Failure just means no line.
  const [morningLine, setMorningLine] = useState<string | null>(null);
  useEffect(() => {
    const state = brief?.morning_line;
    if (!state) return setMorningLine(null);
    if (state.status === "ready") return setMorningLine(state.text);
    let live = true;
    getMissionControlMorningLine(state.fingerprint)
      .then((r) => live && setMorningLine(r.text))
      .catch(() => live && setMorningLine(null));
    return () => {
      live = false;
    };
  }, [brief?.brief_id]); // morning_line is fixed within a brief

  const select = useCallback((next: Selection, trigger?: HTMLElement | null) => {
    triggerRef.current = trigger ?? (document.activeElement as HTMLElement | null);
    setSelection(next);
  }, []);

  const closeDetail = useCallback(() => {
    setSelection({ type: "home" });
    const trigger = triggerRef.current;
    window.requestAnimationFrame(() => {
      if (trigger && document.body.contains(trigger)) trigger.focus();
    });
  }, []);

  useEffect(() => {
    // preventScroll: the column is sticky, so the details are already in view
    // beside whatever was clicked. A plain focus() scrolled the page to the top.
    if (selection.type !== "home") detailHeadingRef.current?.focus({ preventScroll: true });
  }, [selection]);

  // Brief impressions + downstream reconciliation — unchanged semantics from
  // the action brief: one impression per surfaced candidate per brief.
  const candidates = useMemo(
    () => (brief ? [brief.primary, ...brief.secondary].filter((c): c is MissionControlCandidate => !!c) : []),
    [brief]
  );
  const [impressions, setImpressions] = useState<ImpressionMap>({});
  useEffect(() => {
    if (!brief || !candidates.length) return;
    let cancelled = false;
    recordMissionControlEvents(candidates.map((c) => eventFor(brief, c, "impression")))
      .then((result) => {
        if (cancelled) return;
        const map: ImpressionMap = {};
        candidates.forEach((c, i) => { map[c.candidate_key] = result.events[i]?.id; });
        setImpressions(map);
      })
      .catch(() => undefined);
    reconcileMissionControlOutcomes().catch(() => undefined);
    return () => { cancelled = true; };
  }, [brief?.brief_id]); // candidates are immutable within a brief

  const [stale, setStale] = useState(false);
  useEffect(() => {
    if (!brief) return;
    const staleAt = new Date(brief.stale_after).getTime();
    setStale(Date.now() >= staleAt);
    const timer = window.setTimeout(() => setStale(true), Math.max(0, staleAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [brief?.stale_after]);

  function disposed(message: string) {
    setToast(message);
    window.setTimeout(onRefresh, 700);
  }

  const coverageGaps = useMemo(() => {
    const names: Record<string, string> = {
      one_on_ones: "1:1s", cadence: "1:1 cadence", team_meetings: "team meetings", outside_meetings: "meetings beyond the team",
      commitments: "commitments", goals: "goals", people: "people", check_ins: "check-ins", conversations: "conversations",
      projects: "projects", expectations: "expectations", capacity: "capacity", feedback: "your earlier responses",
    };
    const gaps = new Set<string>();
    Object.entries(brief?.coverage ?? {}).forEach(([k, v]) => v !== "ok" && gaps.add(names[k] ?? k.replace("_", " ")));
    Object.entries(week?.coverage ?? {}).forEach(([k, v]) => v !== "ok" && gaps.add(names[k] ?? k.replace("_", " ")));
    return Array.from(gaps);
  }, [brief?.coverage, week?.coverage]);

  const ok = (domain: string) => week?.coverage?.[domain] === "ok";

  // Today, from the payload when it's here (the manager's own date), else
  // the browser's. The eyebrow is the date, not the page's name: the sidebar
  // already says where you are.
  const todayIso = week?.week.today ?? isoOf(new Date());

  // Week arrows move by seven days from the week shown. Back to the current
  // week sends null, so the page asks for "now" rather than a fixed date.
  // stepWeek(0) returns to the current week.
  const stepWeek = (by: number) => {
    if (!week || !onWeekOf) return;
    if (by === 0) return onWeekOf(null);
    const target = isoOf(addDays(parseDay(week.week.start), by * 7));
    const currentStart = isoOf(addDays(parseDay(week.week.today), -((parseDay(week.week.today).getDay() + 6) % 7)));
    onWeekOf(target === currentStart ? null : target);
  };

  // The next move / details column. Beside the week in two-column mode; in
  // one column it comes straight after the counts, not below Follow-through,
  // so a narrow window or an open Scribe drawer does not bury it.
  const side = (
    <aside
      className={twoColumn ? "min-w-0 border-l border-hairline pl-6" : "min-w-0"}
      aria-label="Next move and selected details"
    >
      <div
        // Sticky in two-column mode so a drill-down opened from low on the
        // page (Follow-through) shows its details beside the click.
        className={twoColumn ? "sticky top-[72px] -ml-1 max-h-[calc(100vh-88px)] overflow-y-auto pl-1 pr-1" : undefined}
        onKeyDown={(e) => {
          if (e.key === "Escape" && selection.type !== "home") closeDetail();
        }}
      >
        {/* Keyed on the selection so each swap replays a short fade: the
            column changes in place, and the fade says it did. */}
        <div key={selection.type === "home" ? "home" : JSON.stringify(selection)} className="animate-fade-in motion-reduce:animate-none">
          {selection.type === "home" || !week ? (
            <NextMove
              brief={brief}
              briefFailed={briefFailed}
              impressions={impressions}
              onDisposed={disposed}
              onRetry={onRetryBrief}
              onLegacy={onLegacy}
              onRefresh={onRefresh}
              setToast={setToast}
            />
          ) : (
            <Detail
              week={week}
              selection={selection}
              headingRef={detailHeadingRef}
              colorFor={colorFor}
              onClose={closeDetail}
              onSelect={select}
            />
          )}
        </div>
      </div>
    </aside>
  );

  return (
    <PageShell maxWidth="8xl">
      <div ref={rootRef}>
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <p className={EYEBROW}>
              <time dateTime={todayIso}>{longDate(todayIso)}</time>
            </p>
            <h1 className="mt-2 font-serif text-[2rem] font-normal leading-[1.14] tracking-[-0.035em] text-ink sm:text-[2.45rem]">
              Your week, in focus.
            </h1>
            {morningLine && (
              <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-ink-secondary">
                {morningLine}
                <span className="ml-2 whitespace-nowrap text-2xs text-ink-muted">Written by The Same Page from today’s moves</span>
              </p>
            )}
          </div>
          <p className="mt-0.5 shrink-0 text-right text-2xs text-ink-muted" aria-live="polite">
            {weekLoading ? (
              "Updating…"
            ) : (
              <>
                {updatedAt && (
                  <>
                    <span className="hidden sm:inline">Updated </span>
                    {updatedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                    <span aria-hidden="true"> · </span>
                  </>
                )}
                <button type="button" onClick={onRefresh} className="rounded text-ink-secondary hover:text-ink">
                  Refresh
                </button>
              </>
            )}
          </p>
        </div>

        {stale && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-hairline bg-surface px-4 py-3" role="status">
            <p className="text-sm text-ink-secondary">This brief is more than 24 hours old. Refresh when you want to check for changes.</p>
            <button type="button" onClick={onRefresh} className="text-xs font-medium text-brand hover:text-brand-hover">Refresh brief</button>
          </div>
        )}
        <CoverageNotice domains={coverageGaps} />
        {toast && <p className="mb-4 text-sm text-brand" aria-live="polite">{toast}</p>}

        <div
          className="grid gap-8"
          style={{ gridTemplateColumns: twoColumn ? `minmax(0,1fr) ${sideWidth}` : "minmax(0,1fr)" }}
        >
          <div className="min-w-0">
            {weekFailed || !week ? (
              <>
                <WeekUnavailable onRetry={onRetryWeek} />
                {!twoColumn && <div className="mt-8">{side}</div>}
              </>
            ) : (
              <div aria-busy={weekLoading} className={`transition-opacity motion-reduce:transition-none ${weekLoading ? "opacity-60" : ""}`}>
                <Metrics week={week} ok={ok} selection={selection} onSelect={select} stacked={rootWidth < 460} />
                {!twoColumn && <div className="mb-8 border-b border-hairline pb-8">{side}</div>}
                <ConversationWeek
                  week={week}
                  ok={ok("one_on_ones") && ok("team_meetings") && ok("outside_meetings")}
                  selection={selection}
                  openDay={openDay}
                  colorFor={colorFor}
                  onOpenDay={setOpenDay}
                  onSelect={select}
                  onStepWeek={onWeekOf ? stepWeek : undefined}
                  stepping={weekLoading}
                />
                <FollowThrough week={week} ok={ok("commitments")} selection={selection} onSelect={select} />
              </div>
            )}
          </div>

          {twoColumn && side}
        </div>

        {week && !weekFailed && (
          <GoalsProgress week={week} ok={ok("goals")} width={rootWidth} onRetry={onRetryWeek} />
        )}
      </div>
    </PageShell>
  );
}

function WeekUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <section className="rounded-lg bg-surface px-5 py-6" role="alert">
      <h2 className="text-base font-medium text-ink">The week couldn’t be loaded.</h2>
      <p className="mt-1 text-sm text-ink-secondary">No counts are shown rather than showing zeros that might not be true.</p>
      <button type="button" onClick={onRetry} className={`mt-3 ${BTN_SECONDARY}`}>Try again</button>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

function Metrics({
  week,
  ok,
  selection,
  onSelect,
  stacked,
}: {
  week: WeekData;
  ok: (domain: string) => boolean;
  selection: Selection;
  onSelect: (s: Selection, trigger?: HTMLElement | null) => void;
  stacked: boolean;
}) {
  const conversationsOk = ok("one_on_ones") && ok("team_meetings") && ok("outside_meetings");
  const completedConversations = week.conversations.filter((c) => c.state === "completed").length;
  const completedCommitments = week.commitments.filter((c) => c.state === "completed").length;
  const overdue = week.commitments.filter((c) => c.state === "overdue");
  const overdueOwners = new Set(overdue.map((c) => c.owner_name)).size;
  const phrase = weekPhrase(week.week);
  const current = isCurrentWeek(week.week);

  const stat = "min-w-0 rounded-md px-1.5 py-1 text-left transition hover:bg-surface aria-pressed:bg-surface";
  const num = "block text-[1.85rem] font-medium leading-tight tracking-[-0.02em] tabular-nums sm:text-[2.1rem]";
  const pressed = (s: Selection) =>
    selection.type === s.type && (s.type !== "records" || (selection.type === "records" && selection.owner === s.owner && selection.state === s.state));

  return (
    <section aria-label={`Recorded activity, ${phrase}`} className="mb-8 border-b border-hairline pb-8">
      {/* -mx-1.5 cancels each button's px-1.5, so the numbers sit on the
          column's left edge like every heading below them. On this inner
          grid, not the section, so the rule underneath stays flush. */}
      <div className={`-mx-1.5 grid gap-2 ${stacked ? "grid-cols-1" : "grid-cols-3"}`}>
      <button
        type="button"
        className={stat}
        aria-pressed={pressed({ type: "completed_conversations" })}
        disabled={!conversationsOk}
        onClick={(e) => onSelect({ type: "completed_conversations" }, e.currentTarget)}
      >
        <span className={`${num} text-ink`}>
          {conversationsOk ? completedConversations : "—"}
          {conversationsOk && completedConversations > 0 && <span className="ml-1 font-sans text-xl text-brand" aria-hidden="true">✓</span>}
        </span>
        <span className="mt-1 block text-xs text-ink">Conversations completed</span>
        <span className="mt-0.5 block text-2xs text-ink-muted">
          {!conversationsOk ? "Couldn’t load" : week.conversations.length ? `of ${week.conversations.length} dated ${phrase}` : `Nothing dated ${phrase}`}
        </span>
      </button>
      <button
        type="button"
        className={stat}
        aria-pressed={pressed({ type: "records", owner: "all", state: "completed" })}
        disabled={!ok("commitments")}
        onClick={(e) => onSelect({ type: "records", owner: "all", state: "completed" }, e.currentTarget)}
      >
        <span className={`${num} text-ink`}>{ok("commitments") ? completedCommitments : "—"}</span>
        <span className="mt-1 block text-xs text-ink">Commitments completed</span>
        <span className="mt-0.5 block text-2xs text-ink-muted">{ok("commitments") ? `by you and your team ${phrase}` : "Couldn’t load"}</span>
      </button>
      <button
        type="button"
        className={stat}
        aria-pressed={pressed({ type: "records", owner: "all", state: "overdue" })}
        disabled={!ok("commitments")}
        onClick={(e) => onSelect({ type: "records", owner: "all", state: "overdue" }, e.currentTarget)}
      >
        <span className={`${num} ${ok("commitments") && overdue.length > 0 ? "text-amber-600" : "text-ink"}`}>
          {ok("commitments") ? overdue.length : "—"}
        </span>
        <span className="mt-1 block text-xs text-ink">Overdue commitments</span>
        <span className="mt-0.5 block text-2xs text-ink-muted">
          {!ok("commitments")
            ? "Couldn’t load"
            : !overdue.length
              ? week.week.start <= week.week.today && !current ? `Nothing left open from ${phrase}` : "Nothing overdue"
              : current ? `across ${plural(overdueOwners, "owner")}` : `still open from ${phrase}`}
        </span>
      </button>
    </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Conversation week
// ---------------------------------------------------------------------------

const VISIBLE_PER_DAY = 4;

function Avatar({ c, color, size = "sm" }: { c: WeekConversation; color: string | null; size?: "sm" | "md" | "lg" }) {
  // text-2xs (11px) is the floor, so the row avatar is 22px: two 11px
  // initials overflowed the old 20px circle.
  const dims = size === "lg" ? "h-11 w-11 text-sm" : size === "md" ? "h-6 w-6 text-2xs" : "h-[22px] w-[22px] text-2xs leading-none tracking-[-0.03em]";
  const group = isGroup(c);
  const text = !group
    ? initialsOf(c.title)
    : c.kind === "team_meeting"
      ? initialsOf(c.subtitle || "Team")
      : c.participants.length > 0
        ? String(Math.min(c.participants.length, 9))
        : initialsOf(c.title);
  return (
    <span
      aria-hidden="true"
      // People in their identity colour; groups stay neutral carbon squares,
      // so a meeting never looks like a person.
      className={`grid shrink-0 place-items-center font-semibold ${dims} ${group ? "rounded-md" : "rounded-full"} ${
        color ? IDENTITY_TEXT : "bg-carbon-300 text-ink"
      }`}
      style={color ? { background: color } : undefined}
    >
      {text}
    </span>
  );
}

function rowName(c: WeekConversation, dupFirstNames: Set<string>) {
  if (isGroup(c)) return c.kind === "team_meeting" ? (c.subtitle ? `${c.subtitle} team` : "Team meeting") : c.title;
  const parts = c.title.split(/\s+/);
  const first = parts[0];
  if (parts.length > 1 && dupFirstNames.has(first.toLowerCase())) return `${first} ${parts[parts.length - 1][0]}.`;
  return first;
}

function ConversationWeek({
  week,
  ok,
  selection,
  openDay,
  colorFor,
  onOpenDay,
  onSelect,
  onStepWeek,
  stepping,
}: {
  week: WeekData;
  ok: boolean;
  selection: Selection;
  openDay: string | null;
  colorFor: ColorFor;
  onOpenDay: (day: string | null) => void;
  onSelect: (s: Selection, trigger?: HTMLElement | null) => void;
  onStepWeek?: (by: number) => void;
  stepping: boolean;
}) {
  const [gridRef, gridWidth] = useWidth<HTMLDivElement>();
  const current = isCurrentWeek(week.week);
  const start = parseDay(week.week.start);
  const byDay = useMemo(() => {
    const map = new Map<string, WeekConversation[]>();
    week.conversations.forEach((c) => map.set(c.date, [...(map.get(c.date) ?? []), c]));
    return map;
  }, [week.conversations]);

  // Monday–Friday always; a weekend day appears only when something is on it.
  const days = Array.from({ length: 7 }, (_, i) => isoOf(addDays(start, i))).filter(
    (iso, i) => i < 5 || (byDay.get(iso)?.length ?? 0) > 0
  );
  const shownEnd = days[days.length - 1];

  const dupFirstNames = useMemo(() => {
    const counts = new Map<string, Set<string>>();
    week.conversations.filter((c) => !isGroup(c)).forEach((c) => {
      const first = c.title.split(/\s+/)[0].toLowerCase();
      counts.set(first, new Set([...(counts.get(first) ?? []), c.title]));
    });
    return new Set(Array.from(counts.entries()).filter(([, names]) => names.size > 1).map(([f]) => f));
  }, [week.conversations]);

  const columns = gridWidth >= 92 * days.length;
  const statesPresent = new Set(week.conversations.map((c) => c.state));
  const open = openDay ? byDay.get(openDay) ?? [] : [];

  return (
    <section aria-labelledby="conversation-week-heading" className="mb-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 id="conversation-week-heading" className="text-[17px] font-medium text-ink">Your conversation week</h2>
        <div className="flex items-center gap-1 text-2xs text-ink-muted">
          {onStepWeek && !current && (
            <button
              type="button"
              onClick={() => onStepWeek(0)}
              disabled={stepping}
              className="mr-2 rounded text-brand hover:text-brand-hover disabled:opacity-50"
            >
              Back to this week
            </button>
          )}
          {onStepWeek && (
            <button
              type="button"
              onClick={() => onStepWeek(-1)}
              disabled={stepping}
              aria-label="Previous week"
              className="grid h-7 w-7 place-items-center rounded-md text-sm text-ink-secondary hover:bg-surface hover:text-ink disabled:opacity-50"
            >
              <span aria-hidden="true">‹</span>
            </button>
          )}
          <span className="min-w-[4.75rem] text-center tabular-nums" aria-live="polite">
            <span className="sr-only">Showing </span>
            {rangeLabel(week.week.start, shownEnd)}
          </span>
          {onStepWeek && (
            <button
              type="button"
              onClick={() => onStepWeek(1)}
              disabled={stepping}
              aria-label="Next week"
              className="grid h-7 w-7 place-items-center rounded-md text-sm text-ink-secondary hover:bg-surface hover:text-ink disabled:opacity-50"
            >
              <span aria-hidden="true">›</span>
            </button>
          )}
        </div>
      </div>

      {!ok ? (
        <p className="rounded-lg bg-surface px-4 py-5 text-sm text-ink-secondary">
          Some meetings couldn’t be loaded, so the calendar isn’t shown.
        </p>
      ) : (
        <>
          <div
            ref={gridRef}
            role="list"
            aria-label="Dated conversations by day"
            className="grid gap-1.5"
            style={{ gridTemplateColumns: columns ? `repeat(${days.length}, minmax(0,1fr))` : "minmax(0,1fr)" }}
          >
            {days.map((iso) => {
              const items = byDay.get(iso) ?? [];
              const isToday = iso === week.week.today;
              const hidden = items.length - VISIBLE_PER_DAY;
              return (
                <div
                  key={iso}
                  role="listitem"
                  aria-label={`${longDate(iso)}${isToday ? ", today" : ""}: ${plural(items.length, "conversation")}`}
                  // Today is marked by a teal top rule, not a tinted column:
                  // a tint read as "selected", and teal fill is reserved for that.
                  className={`min-w-0 rounded-lg bg-surface px-1.5 py-2.5 ${isToday ? "rounded-t-sm border-t-2 border-brand" : ""}`}
                >
                  <div className={`mb-1.5 flex items-center justify-between gap-1 border-b border-hairline px-1 pb-2 text-2xs tracking-[0.03em] ${isToday ? "text-brand" : "text-ink-muted"}`}>
                    <time dateTime={iso} className="whitespace-nowrap uppercase">
                      {fmt(iso, { weekday: "short" })} {parseDay(iso).getDate()}
                      {isToday && <span className="sr-only">, today</span>}
                    </time>
                    <span aria-hidden="true">{items.length}</span>
                  </div>
                  {items.length === 0 && <p className="px-1 py-2 text-2xs text-ink-muted">Nothing dated</p>}
                  {items.slice(0, VISIBLE_PER_DAY).map((c) => (
                    <ConversationRow key={c.id} c={c} color={colorFor(c)} name={rowName(c, dupFirstNames)} pressed={selection.type === "conversation" && selection.id === c.id} onSelect={onSelect} />
                  ))}
                  {hidden > 0 && (
                    <button
                      type="button"
                      aria-expanded={openDay === iso}
                      aria-controls="day-agenda"
                      onClick={() => onOpenDay(openDay === iso ? null : iso)}
                      className="mt-1 w-full rounded border-t border-hairline px-0.5 py-2 text-left text-2xs text-brand hover:text-brand-hover"
                    >
                      View all {items.length} (+{hidden})
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1 text-2xs text-ink-muted" aria-label="Legend">
            <span><span className="text-brand">✓</span> Completed</span>
            <span>• Prep or agenda saved</span>
            <span><span className="text-amber-600">○</span> To prepare</span>
            {statesPresent.has("not_logged") && <span><span className="text-amber-600">△</span> Date passed, not logged</span>}
            {/* Said to screen readers, which hear "Monday" with no time and
                might wonder; sighted users see no time and don't. */}
            <span className="sr-only">Meetings are dated by day; times aren’t recorded.</span>
          </div>

          {openDay && open.length > 0 && (
            <div id="day-agenda" className="mt-4 rounded-lg bg-surface p-4" aria-live="polite">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="text-[15px] font-medium text-ink">{longDate(openDay)}</h3>
                <button type="button" onClick={() => onOpenDay(null)} aria-label="Close day agenda" className="rounded px-1.5 text-xl leading-none text-ink-muted hover:text-ink">×</button>
              </div>
              {open.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={(e) => onSelect({ type: "conversation", id: c.id }, e.currentTarget)}
                  className="flex w-full items-center gap-2.5 border-t border-divider py-2.5 text-left text-xs hover:bg-sunken/40"
                >
                  <Avatar c={c} color={colorFor(c)} size="md" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-ink">{c.title}</span>
                    <span className="block text-2xs text-ink-muted">
                      {KIND_LABEL[c.kind]} · <span className={STATE_TONE[c.state]}>{STATE_GLYPH[c.state]}</span> {stateLong(c)}
                    </span>
                  </span>
                  <span aria-hidden="true" className="text-ink-muted">→</span>
                </button>
              ))}
            </div>
          )}

          {current && week.unscheduled_due.length > 0 && ok && (
            // One line, not a second calendar: the cadence detail for each
            // person opens in the side column like every other drill-down.
            <p className="mt-4 text-xs leading-relaxed text-ink-muted">
              <button
                type="button"
                aria-pressed={selection.type === "unscheduled"}
                onClick={(e) => onSelect({ type: "unscheduled" }, e.currentTarget)}
                className="rounded text-ink-body underline decoration-control underline-offset-4 hover:text-ink"
              >
                {plural(week.unscheduled_due.length, "person", "people")} due by cadence, no date set
              </button>
              {": "}
              {week.unscheduled_due.map((p, i) => (
                <span key={p.direct_report_id}>
                  {i > 0 && ", "}
                  <Link href={p.href} className="text-brand hover:text-brand-hover">{p.name}</Link>
                </span>
              ))}
            </p>
          )}
        </>
      )}
    </section>
  );
}

function ConversationRow({
  c,
  color,
  name,
  pressed,
  onSelect,
}: {
  c: WeekConversation;
  color: string | null;
  name: string;
  pressed: boolean;
  onSelect: (s: Selection, trigger?: HTMLElement | null) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={`${c.title}, ${KIND_LABEL[c.kind]}, ${longDate(c.date)}, ${stateLong(c)}`}
      onClick={(e) => onSelect({ type: "conversation", id: c.id }, e.currentTarget)}
      className={`grid min-h-[50px] w-full grid-cols-[22px_minmax(0,1fr)] items-start gap-1.5 rounded-md px-0.5 py-2 text-left transition ${
        pressed ? "bg-brand-tint ring-1 ring-inset ring-brand/50" : "hover:bg-carbon-300/60"
      }`}
    >
      <Avatar c={c} color={color} />
      <span className="min-w-0">
        <span className="block truncate text-2xs text-ink">{name}</span>
        <span className={`mt-0.5 block whitespace-nowrap text-2xs ${STATE_TONE[c.state]}`}>
          {STATE_GLYPH[c.state]} {stateShort(c)}
        </span>
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Follow-through
// ---------------------------------------------------------------------------

function FollowThrough({
  week,
  ok,
  selection,
  onSelect,
}: {
  week: WeekData;
  ok: boolean;
  selection: Selection;
  onSelect: (s: Selection, trigger?: HTMLElement | null) => void;
}) {
  const groups: { owner: WeekCommitmentOwner; label: string; noun: string }[] = [
    { owner: "mine", label: "Mine", noun: "my" },
    { owner: "team", label: "My team", noun: "team" },
  ];
  const undated = week.undated_open_commitments.mine + week.undated_open_commitments.team;
  const phrase = weekPhrase(week.week);
  const current = isCurrentWeek(week.week);

  return (
    <section aria-labelledby="follow-through-heading">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 id="follow-through-heading" className="text-[17px] font-medium text-ink">Follow-through</h2>
        <span className="text-2xs text-ink-muted">
          {current ? "Done and due this week, plus anything overdue" : `Done or due ${phrase}, as of today`}
        </span>
      </div>
      {!ok ? (
        <p className="rounded-lg bg-surface px-4 py-5 text-sm text-ink-secondary">Commitments couldn’t be loaded, so no counts are shown.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-2xs text-ink-muted">
            {STATES.map((s) => (
              <span key={s} className="inline-flex items-center gap-1">
                <span className={`inline-block h-2 w-2 rounded-[2px] ${METER_SWATCH[s]}`} aria-hidden="true" />
                {COMMITMENT_STATE_LABEL[s]}
              </span>
            ))}
          </div>
          {groups.map((g) => {
            const counts = Object.fromEntries(
              STATES.map((s) => [s, week.commitments.filter((c) => c.owner === g.owner && c.state === s).length])
            ) as Record<WeekCommitmentState, number>;
            const total = counts.completed + counts.due + counts.overdue;
            return (
              <div key={g.owner} className="mt-4">
                <div className="mb-2 flex justify-between text-xs">
                  <span className="text-ink">{g.label}</span>
                  <span className="text-2xs text-ink-muted">{plural(total, "commitment")}</span>
                </div>
                {total === 0 ? (
                  <p className="rounded-[3px] bg-surface px-3 py-1.5 text-2xs text-ink-muted">
                    Nothing completed, due, or overdue {phrase}.
                  </p>
                ) : (
                  <div
                    role="group"
                    className="flex h-7 gap-[3px]"
                    aria-label={`${g.label}: ${counts.completed} completed, ${counts.due} due this week, ${counts.overdue} overdue`}
                  >
                    {STATES.filter((s) => counts[s] > 0).map((s) => {
                      const active = selection.type === "records" && selection.owner === g.owner && selection.state === s;
                      return (
                        <button
                          key={s}
                          type="button"
                          aria-pressed={active}
                          aria-label={`View ${counts[s]} ${g.noun} ${COMMITMENT_STATE_LABEL[s].toLowerCase()} commitment${counts[s] === 1 ? "" : "s"}`}
                          onClick={(e) => onSelect({ type: "records", owner: g.owner, state: s }, e.currentTarget)}
                          style={{ flexGrow: counts[s], flexBasis: 0 }}
                          className={`min-w-[22px] rounded-[3px] text-2xs font-medium transition-colors ${active ? METER_SEGMENT_SELECTED[s] : METER_SEGMENT[s]}`}
                        >
                          {counts[s]}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          <p className="mt-4 text-2xs text-ink-muted">
            Each bar shows the split within its group. Select a segment to see its commitments.
            {undated > 0 && ` ${plural(undated, "open commitment")} with no due date ${undated === 1 ? "isn’t" : "aren’t"} counted here.`}
          </p>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Right-hand column: the next move (home) or details
// ---------------------------------------------------------------------------

function NextMove({
  brief,
  briefFailed,
  impressions,
  onDisposed,
  onRetry,
  onLegacy,
  onRefresh,
  setToast,
}: {
  brief: MissionControlBrief | null;
  briefFailed: boolean;
  impressions: ImpressionMap;
  onDisposed: (message: string) => void;
  onRetry: () => void;
  onLegacy: () => void;
  onRefresh: () => void;
  setToast: (message: string) => void;
}) {
  const { open: openQuickAdd } = useQuickAdd();

  if (briefFailed) {
    return (
      <div role="alert">
        <p className={EYEBROW}>Your next move</p>
        <p className="mt-3 text-[15px] font-medium text-ink">Recommendations couldn’t be checked.</p>
        <p className="mt-1.5 text-xs leading-relaxed text-ink-secondary">No all-clear or recommendation has been inferred.</p>
        <div className="mt-3 flex flex-wrap gap-3">
          <button type="button" onClick={onRetry} className="text-xs font-medium text-brand hover:text-brand-hover">Try again</button>
          <button type="button" onClick={onLegacy} className="text-xs text-ink-muted hover:text-ink-secondary">Open previous dashboard</button>
        </div>
      </div>
    );
  }
  if (!brief) {
    return (
      <div className="animate-pulse" role="status" aria-label="Loading your next move">
        <div className="h-3 w-24 rounded bg-sunken" />
        <div className="mt-4 h-5 w-48 rounded bg-sunken" />
        <div className="mt-3 h-12 rounded bg-sunken" />
      </div>
    );
  }

  async function dismissOptionalContext() {
    if (!brief?.optional_context || !brief.primary) return;
    const candidate: MissionControlCandidate = {
      ...brief.primary,
      candidate_key: brief.optional_context.candidate_key,
      evidence_fingerprint: brief.optional_context.evidence_fingerprint,
      candidate_type: "early_role_grounding",
      rank: 1,
    };
    await recordMissionControlEvents([eventFor(brief, candidate, "setup_dismissed_today", undefined, startOfNextLocalDay())]);
    setToast("Dismissed until tomorrow. No setup record was changed.");
    window.setTimeout(onRefresh, 700);
  }

  const primary = brief.primary;
  const watch = brief.secondary.slice(0, 2);
  const hasMore = watch.length > 0 || !!brief.optional_context;

  return (
    <>
      {/* Dividers sit only BETWEEN blocks. The column's own edge (a rule
          in one-column mode, the border-l beside the week) closes it, so a
          trailing border here drew a double line. */}
      <div className={hasMore ? "border-b border-hairline pb-4" : ""}>
        <p className={EYEBROW}>{brief.mode === "empty" ? "Start here" : primary ? "Your next move" : brief.mode === "all_clear" ? "All clear" : "Your next move"}</p>
        {brief.mode === "empty" ? (
          <>
            <p className="mb-1.5 mt-3 text-[17px] font-medium leading-snug text-ink">Add your first direct report.</p>
            <p className="text-xs leading-relaxed text-ink-secondary">The Same Page needs one real working relationship before it can suggest a next move.</p>
            <button type="button" onClick={openQuickAdd} className={`mt-3 ${BTN_PRIMARY_SM}`}>Add a direct report</button>
          </>
        ) : primary ? (
          <>
            <p className="mb-1.5 mt-3 text-[17px] font-medium leading-snug text-ink">{primary.title}</p>
            <p className="text-xs leading-relaxed text-ink-secondary">{primary.explanation}</p>
            <CandidateControls
              key={primary.candidate_key}
              variant="quiet"
              brief={brief}
              candidate={primary}
              impressionId={impressions[primary.candidate_key]}
              onDisposed={onDisposed}
            />
          </>
        ) : (
          <>
            <p className="mb-1.5 mt-3 text-[17px] font-medium leading-snug text-ink">{brief.truth_signal.title}</p>
            <p className="text-xs leading-relaxed text-ink-secondary">{brief.truth_signal.detail}</p>
            {brief.mode === "partial" && (
              <button type="button" onClick={onRefresh} className="mt-3 text-xs font-medium text-brand hover:text-brand-hover">Try again</button>
            )}
          </>
        )}
      </div>

      {hasMore && (
        <div className="pt-4">
          <p className={EYEBROW}>Keep in view</p>
          {watch.map((candidate) => (
            <div key={candidate.candidate_key} className="border-b border-hairline py-4 text-xs last:border-b-0 last:pb-0">
              <p className="text-ink">{candidate.title}</p>
              {candidate.evidence[0] && (
                <p className="mt-1 text-2xs text-ink-muted">{candidate.evidence[0].label} · {candidate.evidence[0].freshness}</p>
              )}
              <CandidateControls
                key={candidate.candidate_key}
                variant="quiet"
                brief={brief}
                candidate={candidate}
                impressionId={impressions[candidate.candidate_key]}
                onDisposed={onDisposed}
              />
            </div>
          ))}
          {brief.optional_context && (
            <div className="border-b border-hairline py-4 text-xs last:border-b-0 last:pb-0">
              <p className="text-ink">{brief.optional_context.title}</p>
              <p className="mt-1 text-2xs text-ink-muted">{brief.optional_context.detail}</p>
              <div className="mt-2 flex gap-4">
                <Link href={brief.optional_context.href} className="text-xs font-medium text-brand hover:text-brand-hover">Add role →</Link>
                <button type="button" onClick={dismissOptionalContext} className="text-xs text-ink-muted hover:text-ink-secondary">Dismiss for today</button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function DetailHead({ label, onClose }: { label: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className={EYEBROW}>{label}</span>
      <button type="button" onClick={onClose} aria-label="Close details" className="rounded px-1.5 text-xl leading-none text-ink-muted hover:text-ink">×</button>
    </div>
  );
}

function TrailItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="relative mb-5 text-xs">
      <span aria-hidden="true" className="absolute -left-[20px] top-1 h-[9px] w-[9px] rounded-full bg-brand" />
      <p className="text-ink">{label}</p>
      <div className="mt-1.5 text-2xs leading-relaxed text-ink-muted">{children}</div>
    </div>
  );
}

function Detail({
  week,
  selection,
  headingRef,
  colorFor,
  onClose,
  onSelect,
}: {
  week: WeekData;
  selection: Exclude<Selection, { type: "home" }>;
  headingRef: React.RefObject<HTMLHeadingElement>;
  colorFor: ColorFor;
  onClose: () => void;
  onSelect: (s: Selection, trigger?: HTMLElement | null) => void;
}) {
  const h3 = "mb-2 mt-3.5 font-serif text-[1.55rem] font-normal leading-tight text-ink focus:outline-none";

  if (selection.type === "conversation") {
    const c = week.conversations.find((item) => item.id === selection.id);
    if (!c) return null;
    const open = c.direct_report_id ? week.open_commitments_by_report[c.direct_report_id] ?? [] : [];
    const linkedGoals = c.direct_report_id
      ? week.goals.filter((g) => g.level === "individual" && g.direct_report_id === c.direct_report_id).slice(0, 2)
      : [];
    return (
      <section aria-labelledby="detail-heading" className="text-sm">
        <DetailHead label="Conversation" onClose={onClose} />
        <div className="mt-4"><Avatar c={c} color={colorFor(c)} size="lg" /></div>
        <h3 id="detail-heading" ref={headingRef} tabIndex={-1} className={h3}>{c.title}</h3>
        <p className="text-xs leading-relaxed text-ink-secondary">
          {longDate(c.date)} · {KIND_LABEL[c.kind]}
          {c.subtitle && c.kind === "one_on_one" && <><br />{c.subtitle}</>}
          {c.participants.length > 1 && <><br />With {c.participants.join(", ")}</>}
          <br />
          <span className={STATE_TONE[c.state]}>{STATE_GLYPH[c.state]} {stateLong(c)}</span>
        </p>

        <div className="ml-1 mt-6 border-l border-hairline pl-4">
          {c.summary && <TrailItem label="What was recorded">{c.summary}</TrailItem>}
          {c.agenda.length > 0 && (
            <TrailItem label={c.kind === "team_meeting" ? "Agenda" : "Prepared agenda"}>
              <ol className="space-y-0.5">
                {c.agenda.map((item, i) => <li key={i}>{String(i + 1).padStart(2, "0")}&nbsp;&nbsp;{item}</li>)}
              </ol>
            </TrailItem>
          )}
          {!c.summary && c.agenda.length === 0 && c.carry_forward_count > 0 && (
            <TrailItem label="Gathered for this conversation">{plural(c.carry_forward_count, "carry-forward topic")} from the last wrap-up</TrailItem>
          )}
          {open.length > 0 && (
            <TrailItem label="Open commitments">
              <ul className="space-y-1">
                {open.map((item) =>
                  item.more ? (
                    <li key={item.id}>+{item.more} more on the person page</li>
                  ) : (
                    <li key={item.id}>
                      {item.title}
                      <span className="text-ink-faint"> · </span>
                      {item.owner_name}{item.due_date ? `, due ${shortDate(item.due_date)}` : ""}
                    </li>
                  )
                )}
              </ul>
            </TrailItem>
          )}
          {linkedGoals.length > 0 && (
            <TrailItem label={linkedGoals.length === 1 ? "Their goal" : "Their goals"}>
              <ul className="space-y-1">
                {linkedGoals.map((g) => (
                  <li key={g.id}>
                    {g.title}
                    {g.progress !== null && <span> · {g.progress}% recorded {shortDate(g.progress_at!)}</span>}
                  </li>
                ))}
              </ul>
            </TrailItem>
          )}
          {!c.summary && c.agenda.length === 0 && c.carry_forward_count === 0 && open.length === 0 && linkedGoals.length === 0 && (
            <TrailItem label="Nothing gathered yet">Preparation pulls in open commitments, carry-forward topics and notes when you start it.</TrailItem>
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link href={primaryActionHref(c)} className={BTN_PRIMARY_SM}>{primaryActionLabel(c)}</Link>
          {c.person_href && primaryActionHref(c) !== c.person_href && (
            <Link href={c.person_href} className="text-xs text-brand hover:text-brand-hover">Person page →</Link>
          )}
        </div>
      </section>
    );
  }

  if (selection.type === "unscheduled") {
    return (
      <section aria-labelledby="detail-heading">
        <DetailHead label="Due by cadence" onClose={onClose} />
        <h3 id="detail-heading" ref={headingRef} tabIndex={-1} className={h3}>No date set</h3>
        <p className="text-xs text-ink-secondary">
          Due for a 1:1 by their cadence, with no upcoming date. They join the calendar once a date is chosen.
        </p>
        <ul className="mt-2">
          {week.unscheduled_due.map((p) => (
            <li key={p.direct_report_id} className="border-b border-hairline py-3 text-xs">
              <Link href={p.href} className="text-ink hover:text-brand">{p.name}</Link>
              <span className="mt-1 block text-2xs text-ink-muted">
                {p.days_since_last === null ? "No 1:1 yet" : `${p.days_since_last} days since last 1:1`}
                {p.cadence_days
                  ? ` · every ${p.cadence_days} days${p.cadence_source === "custom" ? " (custom)" : p.cadence_source === "org" ? " (org default)" : " (default)"}`
                  : ""}
              </span>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  if (selection.type === "completed_conversations") {
    const done = week.conversations.filter((c) => c.state === "completed");
    return (
      <section aria-labelledby="detail-heading">
        <DetailHead label="This week" onClose={onClose} />
        <h3 id="detail-heading" ref={headingRef} tabIndex={-1} className={h3}>Completed conversations</h3>
        <p className="text-xs text-ink-secondary">
          {done.length} of {plural(week.conversations.length, "conversation")} dated {rangeLabel(week.week.start, week.week.end)}.
        </p>
        {done.length === 0 && <p className="mt-4 text-xs text-ink-muted">None written up yet this week.</p>}
        <ul className="mt-2">
          {done.map((c) => (
            <li key={c.id} className="border-b border-hairline py-3 text-xs">
              <button
                type="button"
                onClick={(e) => onSelect({ type: "conversation", id: c.id }, e.currentTarget)}
                className="rounded text-left text-brand hover:text-brand-hover"
              >
                {c.title} →
              </button>
              <span className="mt-1 block text-2xs text-ink-muted">{dayWithDate(c.date)} · {KIND_LABEL[c.kind]}</span>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  const records = week.commitments.filter(
    (c) => c.state === selection.state && (selection.owner === "all" || c.owner === selection.owner)
  );
  // Overdue reads oldest first: the longest-waiting promise is the one most
  // likely to be costing trust. (The payload's order is by due date already;
  // this makes it a rule of the page rather than an accident of the API.)
  if (selection.state === "overdue") {
    records.sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") || a.title.localeCompare(b.title));
  }
  const scope = selection.owner === "all" ? "You and your team" : selection.owner === "mine" ? "Your commitments" : "Your team’s commitments";
  return (
    <section aria-labelledby="detail-heading">
      <DetailHead label="Follow-through" onClose={onClose} />
      <h3 id="detail-heading" ref={headingRef} tabIndex={-1} className={h3}>{COMMITMENT_STATE_LABEL[selection.state]}</h3>
      <p className="text-xs text-ink-secondary">{scope} · {plural(records.length, "commitment")}</p>
      {records.length === 0 && <p className="mt-4 text-xs text-ink-muted">None.</p>}
      <ul className="mt-2">
        {records.map((c) => <RecordRow key={c.id} c={c} today={week.week.today} />)}
      </ul>
    </section>
  );
}

function overdueAge(dueIso: string, todayIso: string) {
  const days = daysBetween(dueIso, todayIso);
  if (days >= 14) return `${Math.floor(days / 7)} weeks overdue`;
  return `${plural(days, "day")} overdue`;
}

function RecordRow({ c, today }: { c: WeekCommitment; today: string }) {
  const when =
    c.state === "completed" && c.completed_at
      ? `Completed ${dayWithDate(c.completed_at.slice(0, 10))}`
      : c.state === "overdue" && c.due_date
        ? `${overdueAge(c.due_date, today)} · was due ${shortDate(c.due_date)}`
        : c.due_date
          ? `Due ${dayWithDate(c.due_date)}`
          : "";
  return (
    <li className="border-b border-hairline py-3 text-xs">
      <Link href={c.href} className="text-ink hover:text-brand">{c.title}</Link>
      <span className="mt-1 block text-2xs text-ink-muted">
        {c.owner_name}
        {c.about_name && ` · with ${c.about_name}`}
        {when && ` · `}
        <span className={c.state === "overdue" ? "text-amber-600" : ""}>{when}</span>
      </span>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Goals & progress
// ---------------------------------------------------------------------------

function GoalsProgress({
  week,
  ok,
  width,
  onRetry,
}: {
  week: WeekData;
  ok: boolean;
  width: number;
  onRetry: () => void;
}) {
  const byLevel = useMemo(() => {
    const map: Record<GoalLevel, WeekGoal[]> = { company: [], department: [], team: [], individual: [] };
    week.goals.forEach((g) => map[g.level].push(g));
    return map;
  }, [week.goals]);

  // Department appears only when such goals exist — the design's three tiers
  // stay the default, without hiding real department goals.
  const tiers: GoalLevel[] = byLevel.department.length ? ["company", "department", "team", "individual"] : ["company", "team", "individual"];
  const peopleWithGoals = useMemo(
    () => week.reports.filter((r) => byLevel.individual.some((g) => g.direct_report_id === r.id)),
    [week.reports, byLevel.individual]
  );

  // Company is the default only when it has goals; otherwise the first tier
  // that does, so a manager with only team goals doesn't land on an empty tab.
  const defaultTier = (["company", "team", "department", "individual"] as GoalLevel[]).find((t) => byLevel[t].length) ?? "company";
  const [tier, setTier] = useState<GoalLevel>(defaultTier);
  const [person, setPerson] = useState<string>(peopleWithGoals[0]?.id ?? week.reports[0]?.id ?? "");
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    if (!person || !week.reports.some((r) => r.id === person)) setPerson(peopleWithGoals[0]?.id ?? week.reports[0]?.id ?? "");
  }, [week.reports, peopleWithGoals, person]);

  const list = tier === "individual" ? byLevel.individual.filter((g) => g.direct_report_id === person) : byLevel[tier];
  const shown = list.slice(0, GOAL_CARD_LIMIT);
  const goal = shown.find((g) => g.id === selected) ?? null;
  const cols = width >= 820 ? 3 : width >= 520 ? 2 : 1;
  const personName = week.reports.find((r) => r.id === person)?.name;

  function changeTier(next: GoalLevel) {
    setTier(next);
    setSelected(null);
  }

  return (
    <section aria-labelledby="goals-heading" className="mt-8 border-t border-hairline pt-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <h2 id="goals-heading" className="text-[17px] font-medium text-ink">Goals &amp; progress</h2>
        {ok && (
          <div className="flex flex-wrap items-center gap-2.5">
            <div role="group" aria-label="Goal level" className="flex max-w-full flex-wrap gap-[3px] rounded-lg bg-surface p-[3px]">
              {tiers.map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={tier === t}
                  onClick={() => changeTier(t)}
                  className={`rounded-md px-3 py-1.5 text-xs ${tier === t ? "bg-brand-tint text-brand" : "text-ink-muted hover:text-ink-secondary"}`}
                >
                  {TIER_LABEL[t]}
                </button>
              ))}
            </div>
            {tier === "individual" && week.reports.length > 0 && (
              <label className="flex items-center gap-2 text-xs text-ink-muted">
                Person
                <select
                  value={person}
                  onChange={(e) => { setPerson(e.target.value); setSelected(null); }}
                  className="w-44 truncate rounded-md border border-control bg-sunken px-2 py-1.5 text-xs text-ink"
                >
                  {week.reports.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}{byLevel.individual.some((g) => g.direct_report_id === r.id) ? "" : " (no goals)"}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}
      </div>

      {!ok ? (
        <div className="rounded-lg bg-surface px-4 py-5 text-sm text-ink-secondary" role="alert">
          Goals couldn’t be loaded. No progress is shown rather than a guess.
          <button type="button" onClick={onRetry} className="ml-3 text-xs font-medium text-brand hover:text-brand-hover">Try again</button>
        </div>
      ) : list.length === 0 ? (
        <p className="rounded-lg bg-surface px-4 py-5 text-sm text-ink-secondary">
          {tier === "individual"
            ? week.reports.length === 0
              ? "No direct reports yet."
              : `No active individual goals for ${personName ?? "this person"}.`
            : `No active ${TIER_LABEL[tier].toLowerCase()} goals.`}{" "}
          <Link href="/app/goals" className="text-brand hover:text-brand-hover">Open Goals →</Link>
        </p>
      ) : (
        <>
          <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
            {shown.map((g) => (
              <GoalCard key={g.id} g={g} pressed={selected === g.id} onClick={() => setSelected(selected === g.id ? null : g.id)} />
            ))}
          </div>
          {goal && <GoalDetail g={goal} tier={tier} wide={cols > 1} onClose={() => setSelected(null)} />}
          <p className="mt-4 text-2xs text-ink-muted">
            Latest recorded check-ins · Select a goal for its update and linked work.
            {list.length > shown.length && (
              <>
                {" "}Showing {shown.length} of {list.length}, attention first.{" "}
                <Link href="/app/goals" className="text-brand hover:text-brand-hover">View all on Goals →</Link>
              </>
            )}
          </p>
        </>
      )}
    </section>
  );
}

function freshnessText(g: WeekGoal) {
  if (!g.last_check_in_at) return "No check-in yet";
  if (g.progress !== null && g.progress_at && g.progress_at !== g.last_check_in_at) {
    return `${g.progress}% recorded ${shortDate(g.progress_at)} · latest check-in ${shortDate(g.last_check_in_at)}`;
  }
  if (g.progress === null) return `Checked in ${shortDate(g.last_check_in_at)} · no % recorded`;
  return `Checked in ${shortDate(g.last_check_in_at)}`;
}

function GoalCard({ g, pressed, onClick }: { g: WeekGoal; pressed: boolean; onClick: () => void }) {
  const staleWithHistory = g.stale && g.last_check_in_at;
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-controls="goal-detail"
      onClick={onClick}
      className={`min-w-0 rounded-[9px] border bg-surface p-4 text-left transition hover:bg-elevated ${pressed ? "border-brand" : "border-transparent"}`}
    >
      <span className={`line-clamp-2 block text-sm leading-snug text-ink ${g.progress !== null ? "mb-4 min-h-[2.6rem]" : "mb-3"}`}>{g.title}</span>
      {g.progress !== null ? (
        <>
          <span className="mb-2.5 block text-[1.6rem] font-medium leading-tight tracking-[-0.02em] tabular-nums text-ink">
            {g.progress}% <span className="font-sans text-2xs text-ink-muted">complete</span>
          </span>
          <span className="mb-3.5 block h-[5px] overflow-hidden rounded bg-sunken" role="img" aria-label={`${g.progress} percent complete, recorded ${shortDate(g.progress_at!)}`}>
            <span className={`block h-full rounded ${g.status === "at_risk" ? "bg-amber-500" : "bg-brand"}`} style={{ width: `${g.progress}%` }} />
          </span>
        </>
      ) : (
        <span className="mb-2 block text-xs text-ink-muted">Progress not recorded</span>
      )}
      <span className="block text-2xs text-ink-muted">{freshnessText(g)}</span>
      <span className="mt-1.5 block text-2xs">
        <span className={STATUS_TONE[g.status]}>
          <span aria-hidden="true">{STATUS_GLYPH[g.status]} </span>{STATUS_LABEL[g.status]}
        </span>
        {staleWithHistory && (
          <span className="text-amber-600"> · Check-in is {g.days_since_check_in} days old</span>
        )}
        {g.level !== "individual" && g.org_unit_name && <span className="text-ink-muted"> · {g.org_unit_name}</span>}
      </span>
    </button>
  );
}

function GoalDetail({ g, tier, wide, onClose }: { g: WeekGoal; tier: GoalLevel; wide: boolean; onClose: () => void }) {
  const owner = g.direct_report_name ?? g.org_unit_name ?? "You";
  return (
    <div id="goal-detail" className="mt-4 rounded-[9px] bg-surface p-5" aria-live="polite">
      <div className="flex items-center justify-between">
        <span className={EYEBROW}>{TIER_LABEL[tier]} goal · {owner}</span>
        <button type="button" onClick={onClose} aria-label="Close goal details" className="rounded px-1.5 text-xl leading-none text-ink-muted hover:text-ink">×</button>
      </div>
      <h3 className="mb-4 mt-2.5 font-serif text-[1.4rem] font-normal leading-tight text-ink">{g.title}</h3>
      <div className={`grid gap-6 ${wide ? "grid-cols-[1.1fr_1fr]" : "grid-cols-1"}`}>
        <div className="text-xs leading-relaxed">
          <p className={EYEBROW}>{g.last_check_in_at ? `Latest check-in · ${shortDate(g.last_check_in_at)}` : "First check-in needed"}</p>
          <p className="mt-2 text-ink-secondary">
            {g.last_check_in_at
              ? g.last_check_in_note || "No note on this check-in."
              : "No check-in has been recorded for this goal yet."}
          </p>
          <p className="mt-2 text-ink-secondary">
            {g.progress !== null
              ? `${g.progress}% complete, as recorded in the check-in on ${shortDate(g.progress_at!)}.`
              : "No percentage has been recorded. It stays “not recorded” rather than showing 0%."}
            {g.trend === "up" && " Up from the check-in before."}
            {g.trend === "down" && " Down from the check-in before."}
          </p>
          {g.success_metrics && <p className="mt-2 text-ink-muted">Measured by: {g.success_metrics}</p>}
          {g.due_date && <p className="mt-2 text-ink-muted">Due {dayWithDate(g.due_date)}</p>}
        </div>
        <div className="text-xs">
          <p className={EYEBROW}>Linked work</p>
          {g.projects.length === 0 && g.commitments.length === 0 ? (
            <p className="mt-2 text-ink-muted">No projects or commitments are linked to this goal.</p>
          ) : (
            <ul className="mt-2 list-disc space-y-1 pl-4 text-ink-muted">
              {g.projects.map((p) => (
                <li key={p.id}>
                  <Link href="/app/projects" className="text-ink-secondary hover:text-brand">{p.title}</Link>
                  <span> · Project, {STATUS_LABEL[p.status].toLowerCase()}</span>
                </li>
              ))}
              {g.commitments.map((c) => (
                <li key={c.id}>
                  {c.title} · {c.owner_name}{c.due_date ? `, due ${shortDate(c.due_date)}` : ""}
                </li>
              ))}
            </ul>
          )}
          <Link href="/app/goals" className="mt-3 inline-block text-xs text-brand hover:text-brand-hover">Open in Goals →</Link>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading: the page's own shape, measured the same way as the page (two
// columns at 860px of content width), so nothing jumps when data lands.
// ---------------------------------------------------------------------------

export function WeekInFocusSkeleton() {
  const [ref, width] = useWidth<HTMLDivElement>();
  const twoColumn = width >= 860;
  const sideWidth = width >= 1200 ? "20rem" : "17rem";
  // Same rule as the week grid: columns while five days get 92px each.
  const mainWidth = twoColumn ? width - (width >= 1200 ? 320 : 272) - 32 : width;
  const dayColumns = mainWidth >= 92 * 5;
  const cols = width >= 820 ? 3 : width >= 520 ? 2 : 1;

  const nextMove = (
    <div className="space-y-3">
      <SkeletonBar className="h-3 w-24" />
      <SkeletonBar className="h-5 w-4/5" />
      <SkeletonBar className="h-3 w-full" />
      <SkeletonBar className="h-3 w-2/3" />
    </div>
  );

  return (
    <PageShell maxWidth="8xl">
      <div ref={ref} className="animate-pulse motion-reduce:animate-none" role="status" aria-label="Loading Mission Control">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <SkeletonBar className="h-3 w-40" />
            <SkeletonBar className="mt-3 h-9 w-72 max-w-full" />
          </div>
          <SkeletonBar className="mt-0.5 h-3 w-24" />
        </div>
        <div className="grid gap-8" style={{ gridTemplateColumns: twoColumn ? `minmax(0,1fr) ${sideWidth}` : "minmax(0,1fr)" }}>
          <div className="min-w-0">
            <div className={`mb-8 grid gap-2 border-b border-hairline pb-8 ${width < 460 ? "grid-cols-1" : "grid-cols-3"}`}>
              {[0, 1, 2].map((i) => (
                <div key={i} className="space-y-2">
                  <SkeletonBar className="h-8 w-12" />
                  <SkeletonBar className="h-3 w-32 max-w-full" />
                  <SkeletonBar className="h-2.5 w-24 max-w-full" />
                </div>
              ))}
            </div>
            {!twoColumn && <div className="mb-8 border-b border-hairline pb-8">{nextMove}</div>}
            <div className="mb-8">
              <div className="mb-4 flex justify-between">
                <SkeletonBar className="h-4 w-44" />
                <SkeletonBar className="h-3 w-24" />
              </div>
              <div className="grid gap-1.5" style={{ gridTemplateColumns: dayColumns ? "repeat(5, minmax(0,1fr))" : "minmax(0,1fr)" }}>
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className={`rounded-lg bg-surface px-2.5 py-2.5 ${dayColumns ? "h-40" : "h-24"}`}>
                    <SkeletonBar className="h-2.5 w-12" />
                    <SkeletonBar className="mt-5 h-3 w-3/4" />
                    <SkeletonBar className="mt-3 h-3 w-2/3" />
                  </div>
                ))}
              </div>
            </div>
            <SkeletonBar className="mb-4 h-4 w-28" />
            <div className="space-y-4">
              <div className="h-7 rounded-[3px] bg-surface" />
              <div className="h-7 rounded-[3px] bg-surface" />
            </div>
          </div>
          {twoColumn && <div className="border-l border-hairline pl-6">{nextMove}</div>}
        </div>
        <div className="mt-8 border-t border-hairline pt-8">
          <SkeletonBar className="mb-4 h-4 w-36" />
          <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
            {Array.from({ length: cols }, (_, i) => <div key={i} className="h-32 rounded-[9px] bg-surface" />)}
          </div>
        </div>
      </div>
    </PageShell>
  );
}
