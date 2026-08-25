"use client";

// /app/1-1s is the relationship-oriented launcher for the recurring 1:1
// loop. It keeps one row per person, enough continuity to choose the right
// next action, and a direct handoff to the canonical prep or relationship
// workspace. It deliberately does not duplicate history, commitments,
// cadence settings, or private notes from the person page.
//
// Every workflow state on this page comes from GET /api/one-on-ones/overview.
// The frontend sorts, filters, and presents those fields; it does not compute
// cadence, due state, or session status independently.

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { OneOnOneOverviewItem, getOneOnOnesOverview } from "@/lib/api";
import PageShell from "@/components/PageShell";
import { SECTION_GAP } from "@/components/ZoneMap";
import {
  BTN_GHOST,
  BTN_PRIMARY,
  CARD,
  FEATURE_SURFACE,
  IDENTITY_BG,
  IDENTITY_TEXT,
  INPUT,
  identityIndex,
} from "@/lib/tokens";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatConversationDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function initialsOf(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function firstName(name: string) {
  return name.split(" ")[0] || name;
}

function isUnpreparedDue(item: OneOnOneOverviewItem) {
  return (
    item.is_due &&
    (item.planned_session === null || item.planned_session.status === "gathering")
  );
}

function isBadlyOverdue(item: OneOnOneOverviewItem) {
  return (
    isUnpreparedDue(item) &&
    (item.days_since_last === null || item.days_since_last > item.cadence_days * 2)
  );
}

function defaultSelection(items: OneOnOneOverviewItem[]) {
  const prepared = items.find((item) => item.planned_session?.status === "planned");
  if (prepared) return prepared;

  const due = items.find(isUnpreparedDue);
  if (due) return due;

  const scheduled = items
    .filter((item) => item.planned_session?.status === "scheduled")
    .sort((a, b) =>
      (a.planned_session?.scheduled_at ?? "").localeCompare(
        b.planned_session?.scheduled_at ?? ""
      )
    )[0];
  return scheduled ?? items[0] ?? null;
}

type RelationshipState = {
  label: string;
  rowMeta: string;
  rowClass: string;
  chipClass: string;
};

function relationshipState(item: OneOnOneOverviewItem): RelationshipState {
  if (item.planned_session?.status === "planned") {
    return {
      label: "Prep ready",
      rowMeta: "Prep ready",
      rowClass: "text-brand",
      chipClass: "bg-teal-50 text-teal-700",
    };
  }
  if (item.planned_session?.status === "scheduled") {
    return {
      label: "Scheduled",
      rowMeta: "Review prep",
      rowClass: "text-ink-muted",
      chipClass: "bg-sunken text-ink-secondary",
    };
  }
  if (isUnpreparedDue(item)) {
    return {
      label: item.days_since_last === null ? "First 1:1 due" : "Due now",
      rowMeta: item.days_since_last === null ? "Never met" : `${item.days_since_last} days since`,
      rowClass: isBadlyOverdue(item) ? "text-red-700" : "text-amber-700",
      chipClass: isBadlyOverdue(item)
        ? "bg-red-50 text-red-700"
        : "bg-amber-50 text-amber-700",
    };
  }
  return {
    label: "Gathering context",
    rowMeta: "Not scheduled",
    rowClass: "text-ink-muted",
    chipClass: "bg-sunken text-ink-secondary",
  };
}

function nextDateLabel(item: OneOnOneOverviewItem) {
  const session = item.planned_session;
  if (session?.scheduled_at) return formatDate(session.scheduled_at);
  if (session?.status === "planned") return "Prep ready";
  if (isUnpreparedDue(item)) return "Due now";
  return "Not scheduled";
}

function nextConversationLabel(item: OneOnOneOverviewItem) {
  const session = item.planned_session;
  if (session?.scheduled_at) return formatConversationDate(session.scheduled_at);
  if (session?.status === "planned") return "Ready for the next 1:1";
  if (isUnpreparedDue(item)) return "A 1:1 is due";
  return "Next date not scheduled";
}

function relationshipSummary(item: OneOnOneOverviewItem) {
  const session = item.planned_session;
  if (session?.status === "planned") {
    return (
      session.display_summary ||
      "The agenda is saved and ready. Open the conversation when you are ready to begin."
    );
  }
  if (session?.status === "scheduled") {
    return "This conversation is scheduled and waiting for source review. Open the workspace to confirm carry-forwards, current commitments, and goal signals before generating the agenda.";
  }
  if (isUnpreparedDue(item)) {
    return "This conversation is due. Review the context already gathering in the workspace before generating the agenda.";
  }
  return "No date is scheduled yet. Context is gathering automatically in the next-conversation workspace.";
}

function continuityCue(item: OneOnOneOverviewItem) {
  const confirmedCarryForward = item.planned_session?.carry_forward_items
    ?.map((value) => value.trim())
    .find(Boolean);
  if (confirmedCarryForward) return `Carry forward: ${confirmedCarryForward}`;
  if (item.last_completed) {
    return `Last conversation wrapped ${formatDate(item.last_completed.date)}. No carry-forward topic is confirmed.`;
  }
  return "No prior 1:1 has been logged yet.";
}

function prepHref(item: OneOnOneOverviewItem) {
  return item.planned_session?.status === "planned"
    ? `/app/reports/${item.direct_report_id}/prep?resume=${item.planned_session.id}`
    : `/app/reports/${item.direct_report_id}/prep`;
}

function roleLine(item: OneOnOneOverviewItem) {
  return [item.role_title, item.org_unit].filter(Boolean).join(" · ") || "Direct report";
}

function LoadingState() {
  return (
    <PageShell maxWidth="6xl">
      <div className="animate-pulse" role="status" aria-label="Loading 1:1 relationships">
        <div className="h-7 w-24 rounded bg-sunken" />
        <div className="mt-3 h-4 w-80 max-w-full rounded bg-sunken" />
        <div className={`${SECTION_GAP} grid gap-5 lg:grid-cols-[minmax(20rem,.9fr)_minmax(22rem,1.1fr)]`}>
          <div className="space-y-3">
            <div className="h-9 rounded-md bg-sunken" />
            <div className="h-80 rounded-xl bg-surface" />
          </div>
          <div className="order-first h-72 rounded-2xl bg-surface lg:order-none" />
        </div>
      </div>
    </PageShell>
  );
}

export default function OneOnOnesPage() {
  const [items, setItems] = useState<OneOnOneOverviewItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getOneOnOnesOverview()
      .then(setItems)
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "Failed to load")
      )
      .finally(() => setLoading(false));
  }, []);

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => a.name.localeCompare(b.name)),
    [items]
  );

  const fallbackSelection = useMemo(
    () => defaultSelection(sortedItems),
    [sortedItems]
  );
  const effectiveSelectedId =
    selectedId && sortedItems.some((item) => item.direct_report_id === selectedId)
      ? selectedId
      : fallbackSelection?.direct_report_id ?? null;

  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return sortedItems;
    return sortedItems.filter((item) => item.name.toLowerCase().includes(normalized));
  }, [query, sortedItems]);

  const selected =
    sortedItems.find((item) => item.direct_report_id === effectiveSelectedId) ?? null;
  const dueCount = items.filter(isUnpreparedDue).length;

  function handleSearch(event: ChangeEvent<HTMLInputElement>) {
    const nextQuery = event.target.value;
    setQuery(nextQuery);
    const normalized = nextQuery.trim().toLowerCase();
    const matches = sortedItems.filter((item) =>
      item.name.toLowerCase().includes(normalized)
    );
    if (
      matches.length > 0 &&
      !matches.some((item) => item.direct_report_id === effectiveSelectedId)
    ) {
      setSelectedId(matches[0].direct_report_id);
    }
  }

  if (loading) return <LoadingState />;
  if (error) {
    return (
      <PageShell maxWidth="6xl">
        <p className="text-sm text-red-700" role="alert">{error}</p>
      </PageShell>
    );
  }

  return (
    <PageShell maxWidth="6xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink">1:1s</h1>
          <p className="mt-1 text-sm text-ink-secondary">
            Keep the thread with every person. Move into the right conversation.
          </p>
        </div>
        {items.length > 0 && (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
              dueCount > 0
                ? "bg-amber-50 text-amber-700"
                : "bg-sunken text-ink-secondary"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                dueCount > 0 ? "bg-amber-500" : "bg-brand"
              }`}
            />
            {dueCount > 0 ? `${dueCount} due now` : "No one due"}
          </span>
        )}
      </div>

      {items.length === 0 ? (
        <p className={`${SECTION_GAP} text-sm text-ink-secondary`}>
          No direct reports yet.{" "}
          <Link href="/app/dashboard" className="text-brand hover:text-brand-hover">
            Add your first one from Mission Control →
          </Link>
        </p>
      ) : (
        <div className={`${SECTION_GAP} grid gap-5 lg:grid-cols-[minmax(20rem,.9fr)_minmax(22rem,1.1fr)]`}>
          <section aria-labelledby="relationship-roster-heading">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 id="relationship-roster-heading" className="text-base font-medium text-ink">
                Your team
              </h2>
              <span className="text-xs text-ink-muted">
                {filteredItems.length} relationship{filteredItems.length === 1 ? "" : "s"}
              </span>
            </div>

            <label className="sr-only" htmlFor="relationship-search">Find a person</label>
            <input
              id="relationship-search"
              type="search"
              value={query}
              onChange={handleSearch}
              placeholder="Find a person"
              autoComplete="off"
              className={`${INPUT} mb-3`}
            />

            <div className={`${CARD} overflow-hidden`}>
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(6.5rem,.65fr)] gap-3 bg-sunken px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-ink-muted sm:grid-cols-[minmax(10rem,1.2fr)_minmax(6rem,.65fr)_minmax(7rem,.85fr)]">
                <span>Person</span>
                <span className="hidden sm:block">Last</span>
                <span>Next</span>
              </div>
              <div className="divide-y divide-divider">
                {filteredItems.map((item) => {
                  const active = item.direct_report_id === effectiveSelectedId;
                  const state = relationshipState(item);
                  return (
                    <button
                      key={item.direct_report_id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setSelectedId(item.direct_report_id)}
                      className={`grid w-full grid-cols-[minmax(0,1fr)_minmax(6.5rem,.65fr)] items-center gap-3 border-l-4 px-4 py-3 text-left sm:grid-cols-[minmax(10rem,1.2fr)_minmax(6rem,.65fr)_minmax(7rem,.85fr)] ${
                        active
                          ? "border-l-brand bg-brand-tint"
                          : "border-l-transparent hover:bg-sunken"
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        <span
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${IDENTITY_TEXT} ${
                            IDENTITY_BG[identityIndex(item.direct_report_id)]
                          }`}
                        >
                          {initialsOf(item.name)}
                        </span>
                        <span className="truncate text-sm font-medium text-ink">{item.name}</span>
                      </span>
                      <span className="hidden sm:block">
                        <span className="block text-xs font-medium text-ink-body">
                          {item.last_completed ? formatDate(item.last_completed.date) : "Not yet"}
                        </span>
                        <span className="mt-0.5 block text-[11px] text-ink-muted">
                          {item.last_completed ? "Wrapped" : "No session"}
                        </span>
                      </span>
                      <span>
                        <span className="block text-xs font-medium text-ink-body">
                          {nextDateLabel(item)}
                        </span>
                        <span className={`mt-0.5 block text-[11px] ${state.rowClass}`}>
                          {state.rowMeta}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
              {filteredItems.length === 0 && (
                <p className="px-4 py-8 text-center text-sm text-ink-secondary">
                  No matching person.
                </p>
              )}
            </div>
          </section>

          {selected && (
            <aside
              key={selected.direct_report_id}
              className={`order-first overflow-hidden p-5 lg:order-none ${FEATURE_SURFACE}`}
              aria-live="polite"
            >
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${relationshipState(selected).chipClass}`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                {relationshipState(selected).label}
              </span>

              <div className="mt-4 flex items-center gap-3">
                <span
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${IDENTITY_TEXT} ${
                    IDENTITY_BG[identityIndex(selected.direct_report_id)]
                  }`}
                >
                  {initialsOf(selected.name)}
                </span>
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-semibold text-ink">{selected.name}</h2>
                  <p className="mt-0.5 truncate text-xs text-ink-secondary">{roleLine(selected)}</p>
                </div>
              </div>

              <div className="mt-5 flex items-start justify-between gap-4 border-t border-hairline pt-4">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
                    Next conversation
                  </p>
                  <p className="mt-1 text-sm font-medium text-ink">
                    {nextConversationLabel(selected)}
                  </p>
                </div>
                <p className="shrink-0 text-right text-xs text-ink-muted">
                  Last 1:1<br />
                  <span className="text-ink-body">
                    {selected.last_completed ? formatDate(selected.last_completed.date) : "Not yet"}
                  </span>
                </p>
              </div>

              <p className="mt-4 text-sm leading-6 text-ink-body">
                {relationshipSummary(selected)}
              </p>

              <div className="mt-4 border-l-4 border-brand bg-sunken px-4 py-3">
                <p className="text-xs font-medium text-ink">Keep the thread</p>
                <p className="mt-1 text-xs leading-5 text-ink-secondary">
                  {continuityCue(selected)}
                </p>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <Link href={prepHref(selected)} className={BTN_PRIMARY}>
                  {selected.planned_session?.status === "planned"
                    ? "Start 1:1 →"
                    : "Review & prepare →"}
                </Link>
                <Link
                  href={`/app/reports/${selected.direct_report_id}`}
                  className={BTN_GHOST}
                >
                  Open {firstName(selected.name)}&apos;s relationship →
                </Link>
              </div>

              <p className="mt-5 border-t border-divider pt-4 text-xs leading-5 text-ink-muted">
                History, commitments, cadence settings, and detailed notes stay in the relationship workspace.
              </p>
            </aside>
          )}
        </div>
      )}
    </PageShell>
  );
}
