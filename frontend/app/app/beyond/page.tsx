"use client";

// ---------------------------------------------------------------------------
// Beyond the team (/app/beyond) — conversations outside the manager's own
// team, organised around one question: where did we leave things, and what
// do we need from each other next?
//
// Four views (selected 2026-09-25, docs/design-proposals/2026-09-25-beyond-
// directions/overview-revised.png, with option A's continuity in the deeper
// views):
//   Overview             "What needs you next?" + three previews (default)
//   People               individual relationships, excluding your manager
//   My manager           your direct manager — updates, asks, decisions
//   Group conversations  meetings with several people, one record each
//
// One read, GET /api/beyond/continuity. Recorded facts and AI suggestions
// are separate kinds; a suggestion becomes a record only through its review.
// Everything is private to the manager and saving never sends anything.
// Only what these meetings PRODUCE reaches the rest of the app; there is
// deliberately no Mission Control card. See docs/systems/beyond.md.
// ---------------------------------------------------------------------------

import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import PageShell from "@/components/PageShell";
import { BeyondContinuity, OutsideRelationship, createOutsidePerson, getBeyondContinuity, refreshBeyondSuggestions } from "@/lib/api";
import { BTN_GHOST, BTN_SECONDARY, ERROR_TEXT, INPUT, META, SELECT } from "@/lib/tokens";
import { SkeletonSection } from "@/components/Skeleton";
import BeyondBrief, { SuggestionState } from "@/components/beyond/BeyondBrief";
import ContinuityCard from "@/components/beyond/ContinuityCard";
import GroupConversations from "@/components/beyond/GroupConversations";
import OverviewPreviews, { BeyondView } from "@/components/beyond/OverviewPreviews";
import { RELATIONSHIP_GROUP, RELATIONSHIP_LABEL, RELATIONSHIP_ORDER } from "./shared";

const VIEWS: [BeyondView, string][] = [
  ["overview", "Overview"],
  ["people", "People"],
  ["my-manager", "My manager"],
  ["groups", "Group conversations"],
];

function useMeasuredWidth<T extends HTMLElement>() {
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

export default function BeyondPage() {
  // useSearchParams (for ?view=) needs a Suspense boundary.
  return (
    <Suspense fallback={<PageShell maxWidth="8xl"><SkeletonSection label="Loading beyond the team" variant="cards" /></PageShell>}>
      <Beyond />
    </Suspense>
  );
}

function Beyond() {
  const router = useRouter();
  const params = useSearchParams();
  const requested = params.get("view") as BeyondView | null;
  const [view, setView] = useState<BeyondView>(VIEWS.some(([v]) => v === requested) ? (requested as BeyondView) : "overview");
  const [data, setData] = useState<BeyondContinuity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [suggestionState, setSuggestionState] = useState<SuggestionState>("idle");
  const refreshedOnce = useRef(false);
  // The Scribe drawer narrows the content column without changing the
  // viewport, so the layout follows the width it actually has.
  const [rootRef, width] = useMeasuredWidth<HTMLDivElement>();

  const load = useCallback(() => {
    return getBeyondContinuity()
      .then((d) => {
        setData(d);
        setError(null);
        return d;
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Couldn't load your conversations beyond the team");
        return null;
      });
  }, []);

  useEffect(() => {
    load().then((d) => {
      // Ask for suggestions once per visit, after the recorded brief is on
      // screen. The server only calls the model when the reviewed records
      // changed; a failure leaves every recorded item in place.
      if (!d || refreshedOnce.current) return;
      refreshedOnce.current = true;
      if (!d.suggestions_available) {
        setSuggestionState("unavailable");
        return;
      }
      setSuggestionState("checking");
      refreshBeyondSuggestions()
        .then((r) => {
          setSuggestionState(r.ai_failed ? "failed" : r.available ? "idle" : "unavailable");
          if (r.added) load();
        })
        .catch(() => setSuggestionState("failed"));
    });
  }, [load]);

  function choose(next: BeyondView) {
    setView(next);
    router.replace(next === "overview" ? "/app/beyond" : `/app/beyond?view=${next}`, { scroll: false });
  }

  function onTabKey(e: React.KeyboardEvent, index: number) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = VIEWS[(index + (e.key === "ArrowRight" ? 1 : VIEWS.length - 1)) % VIEWS.length][0];
    choose(next);
    document.getElementById(`beyond-tab-${next}`)?.focus();
  }

  const refresh = useCallback(() => {
    load();
  }, [load]);

  const people = (data?.people ?? []).filter((p) => p.relationship !== "manager");
  const managers = (data?.people ?? []).filter((p) => p.relationship === "manager");
  const threeColumns = width >= 900;

  return (
    // Same frame as Goals and Assessments: the 8xl shell with a 1510px inner
    // column, so the page uses the width Team and Assessments do.
    <PageShell maxWidth="8xl">
      <div ref={rootRef} className="mx-auto max-w-[1510px]">
        <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <h1 className="font-serif text-[2.6rem] font-normal leading-none tracking-[-0.03em] text-ink sm:text-[3.05rem]">
              Beyond the team
            </h1>
            <p className="mt-2.5 text-base text-ink-secondary">Keep the conversations going. Move the work forward.</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <p className={META}>Private to you</p>
            <Link href="/app/beyond/meetings/new" className={BTN_SECONDARY}>
              Log a meeting
            </Link>
          </div>
        </header>

        <div role="tablist" aria-label="Beyond the team views" className="mt-6 flex gap-1 overflow-x-auto border-b border-hairline pb-3 sm:gap-2">
          {VIEWS.map(([value, label], index) => (
            <button
              key={value}
              id={`beyond-tab-${value}`}
              type="button"
              role="tab"
              aria-selected={view === value}
              aria-controls={`beyond-panel-${value}`}
              tabIndex={view === value ? 0 : -1}
              onClick={() => choose(value)}
              onKeyDown={(e) => onTabKey(e, index)}
              className={`shrink-0 whitespace-nowrap rounded-md px-4 py-2 text-sm transition-colors motion-reduce:transition-none ${
                view === value ? "bg-brand-tint font-medium text-brand" : "text-ink-secondary hover:bg-sunken hover:text-ink"
              }`}
            >
              {label}
              {value === "people" && data ? <span className="ml-1.5 text-xs text-ink-muted">{people.length}</span> : null}
              {value === "groups" && data ? <span className="ml-1.5 text-xs text-ink-muted">{data.groups.length}</span> : null}
            </button>
          ))}
        </div>

        {error && (
          <div className="mt-5" role="alert">
            <p className={ERROR_TEXT}>{error}. This doesn&apos;t mean there&apos;s nothing here.</p>
            <button type="button" onClick={refresh} className={`${BTN_SECONDARY} mt-2`}>
              Try again
            </button>
          </div>
        )}
        {data && !data.prep_items_available && (
          <p role="status" className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">
            Saved thoughts couldn&apos;t load, so none are shown and adding them is paused. Everything else is up to date.
          </p>
        )}

        {!data && !error ? (
          <SkeletonSection label="Loading your conversations beyond the team" variant="cards" className="mt-8" />
        ) : data ? (
          <>
            <div id="beyond-panel-overview" role="tabpanel" aria-labelledby="beyond-tab-overview" hidden={view !== "overview"} className="pt-6">
              <BeyondBrief
                brief={data.brief}
                more={data.brief_more}
                suggestions={data.suggestions}
                upcoming={data.upcoming}
                suggestionState={suggestionState}
                suggestionsAvailable={data.suggestions_available}
                onChanged={refresh}
              />
              <div className="mt-10 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-serif text-[1.6rem] font-normal leading-tight tracking-[-0.02em] text-ink">
                  Across your conversations
                </h2>
                <p className={META}>A place to pick things back up</p>
              </div>
              <div className="mt-4">
                <OverviewPreviews
                  people={people}
                  managers={managers}
                  groups={data.groups}
                  columns={threeColumns ? 3 : 1}
                  onOpen={choose}
                />
              </div>
              <p className={`${META} mt-8`}>
                Private to you · Saving never sends · No inferred progress or relationship health · AI suggestions are not
                reviewed facts
              </p>
            </div>

            <div id="beyond-panel-people" role="tabpanel" aria-labelledby="beyond-tab-people" hidden={view !== "people"} className="pt-6">
              <PeopleView data={data} people={people} onChanged={refresh} />
            </div>

            <div id="beyond-panel-my-manager" role="tabpanel" aria-labelledby="beyond-tab-my-manager" hidden={view !== "my-manager"} className="pt-6">
              <ManagerView data={data} managers={managers} onChanged={refresh} />
            </div>

            <div id="beyond-panel-groups" role="tabpanel" aria-labelledby="beyond-tab-groups" hidden={view !== "groups"} className="pt-6">
              <GroupConversations groups={data.groups} prepItemsAvailable={data.prep_items_available} onChanged={refresh} />
            </div>
          </>
        ) : null}
      </div>
    </PageShell>
  );
}

// Soonest next conversation first; then the most recently met; then the rest.
function byContinuity<T extends { next_meeting: { date: string | null } | null; last_met: string | null; name: string }>(a: T, b: T) {
  const an = a.next_meeting ? a.next_meeting.date ?? "9998" : null;
  const bn = b.next_meeting ? b.next_meeting.date ?? "9998" : null;
  if (an && bn) return an.localeCompare(bn);
  if (an) return -1;
  if (bn) return 1;
  if (a.last_met && b.last_met) return b.last_met.localeCompare(a.last_met);
  if (a.last_met) return -1;
  if (b.last_met) return 1;
  return a.name.localeCompare(b.name);
}

function AddPerson({
  defaultRelationship,
  onAdded,
  label = "Add a person",
}: {
  defaultRelationship: OutsideRelationship;
  onAdded: () => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [relationship, setRelationship] = useState<OutsideRelationship>(defaultRelationship);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    if (!name.trim()) return;
    try {
      await createOutsidePerson({ name: name.trim(), relationship });
      setName("");
      setOpen(false);
      setError(null);
      onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add person");
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={BTN_GHOST}>
        + {label}
      </button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-control p-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
        className={`${INPUT} min-w-40 flex-1`}
        placeholder="Name"
        aria-label="Name"
        autoFocus
      />
      <select
        value={relationship}
        onChange={(e) => setRelationship(e.target.value as OutsideRelationship)}
        className={`${SELECT} !w-44`}
        aria-label="Relationship"
      >
        {RELATIONSHIP_ORDER.map((r) => (
          <option key={r} value={r}>
            {RELATIONSHIP_LABEL[r]}
          </option>
        ))}
      </select>
      <button type="button" onClick={add} className={BTN_SECONDARY}>
        Add
      </button>
      <button type="button" onClick={() => setOpen(false)} className={BTN_GHOST}>
        Cancel
      </button>
      {error && <p className={`${ERROR_TEXT} w-full`}>{error}</p>}
    </div>
  );
}

function PeopleView({
  data,
  people,
  onChanged,
}: {
  data: BeyondContinuity;
  people: BeyondContinuity["people"];
  onChanged: () => void;
}) {
  const [filter, setFilter] = useState<OutsideRelationship | "all">("all");
  const relationships = RELATIONSHIP_ORDER.filter((r) => r !== "manager" && people.some((p) => p.relationship === r));
  const shown = people.filter((p) => filter === "all" || p.relationship === filter).sort(byContinuity);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by relationship">
          {relationships.length > 1 &&
            (["all", ...relationships] as (OutsideRelationship | "all")[]).map((r) => {
              const count = r === "all" ? people.length : people.filter((p) => p.relationship === r).length;
              return (
                <button
                  key={r}
                  type="button"
                  aria-pressed={filter === r}
                  onClick={() => setFilter(r)}
                  className={`rounded-full border px-3 py-1 text-xs ${
                    filter === r ? "border-brand bg-brand-tint text-brand" : "border-hairline text-ink-secondary hover:bg-sunken"
                  }`}
                >
                  {r === "all" ? "Everyone" : RELATIONSHIP_GROUP[r]} · {count}
                </button>
              );
            })}
        </div>
        <AddPerson defaultRelationship="peer" onAdded={onChanged} />
      </div>
      <p className={`${META} mt-3`}>
        Peers, skip-levels, indirect reports and partners. Your manager has their own view. Commitments from group
        meetings show here too, on the person they belong to.
      </p>

      {shown.length === 0 ? (
        <p className="mt-6 text-sm text-ink-secondary">
          No one here yet. Add a peer or partner, or log a meeting and add people as you go.
        </p>
      ) : (
        <div className="mt-5 space-y-4">
          {shown.map((p) => (
            <ContinuityCard key={p.id} person={p} prepItemsAvailable={data.prep_items_available} onChanged={onChanged} />
          ))}
        </div>
      )}
    </div>
  );
}

function ManagerView({
  data,
  managers,
  onChanged,
}: {
  data: BeyondContinuity;
  managers: BeyondContinuity["people"];
  onChanged: () => void;
}) {
  return (
    <div>
      <p className="max-w-3xl text-sm text-ink-secondary">
        Your team update, what you need from your manager, and the decisions still open between you. Prep here is a
        team update built from your goals, projects and what moved — work only, never assessments of individual people.
        Skip-level conversations live under People.
      </p>
      {managers.length > 1 && (
        <p role="status" className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">
          {managers.length} people are marked as your manager. If one of them isn&apos;t, change their relationship on
          their page.
        </p>
      )}
      {managers.length === 0 ? (
        <div className="mt-6">
          <p className="text-sm text-ink-secondary">
            No one is marked as your manager yet. Add them to keep your updates, asks and decisions with them in one place.
          </p>
          <div className="mt-3">
            <AddPerson defaultRelationship="manager" onAdded={onChanged} label="Add your manager" />
          </div>
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          {[...managers].sort(byContinuity).map((p) => (
            <ContinuityCard key={p.id} person={p} prepItemsAvailable={data.prep_items_available} onChanged={onChanged} manager />
          ))}
        </div>
      )}
    </div>
  );
}
