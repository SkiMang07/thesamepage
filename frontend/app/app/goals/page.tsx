"use client";

// Goals — outcomes first. The approved design is
// docs/design-proposals/2026-09-25-goals-in-view/ (BUILD_BRIEF.md +
// prototype-v2.html); current behaviour is docs/systems/goals.md.
//
// The board leads with each goal's title and success measure. Every open goal
// in the selected level and scope stays on the board; goals that need review
// sort first without hiding the healthy ones. Closed goals sit behind their
// own filter. Updates is the same check-in records, newest first. Details is
// a focused view with a way back (?goal=<id> deep-links it). Review together
// is a local, full-screen presentation of goals the manager picks.
//
// Scope is always by id — a direct report id at Individual, an org unit id at
// Team/Department — never by display name, and "Not linked" is its own
// choice, distinct from All.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PageShell from "@/components/PageShell";
import PartialLoadNotice from "@/components/PartialLoadNotice";
import { SkeletonSection } from "@/components/Skeleton";
import {
  ApiError,
  CheckIn,
  DirectReport,
  Goal,
  GoalIn,
  GoalLevel,
  GoalStatus,
  OrgUnit,
  Project,
  createGoal,
  createGoalCheckIn,
  deleteGoal,
  getDirectReports,
  getGoalUpdates,
  getGoals,
  getOrgUnits,
  getProjects,
  updateGoal,
  updateGoalStatus,
} from "@/lib/api";
import { BTN_DANGER, BTN_PRIMARY, BTN_SECONDARY, INPUT } from "@/lib/tokens";
import {
  LEVELS,
  STATUS_LABEL,
  Scope,
  allLabel,
  formatValue,
  hasNoCheckIn,
  inScope,
  isOpen,
  matchesQuery,
  meetsTarget,
  newRequestId,
  reviewReasons,
  scopeOptions,
} from "@/lib/goals";
import GoalSheet from "@/components/goals/GoalSheet";
import GoalUpdateForm, { UpdateDraft, isDraftDirty } from "@/components/goals/GoalUpdateForm";
import GoalDetail from "@/components/goals/GoalDetail";
import GoalForm from "@/components/goals/GoalForm";
import UpdatesFeed from "@/components/goals/UpdatesFeed";
import Dialog from "@/components/goals/Dialog";
import { ReviewPresentation, ReviewSetup } from "@/components/goals/ReviewTogether";

type Filter = "all" | "review" | "missing" | "closed";
type View = "board" | "updates";
type Editor = { kind: "new" } | { kind: "edit"; id: string } | null;
type Receipt = { goalId: string; title: string; detail: string; warning?: string } | null;
type Confirm = { title: string; body: string; action: string; cancel: string; danger?: boolean; run: () => void } | null;
type ParsedUpdate = { status: GoalStatus; value: number | null; completion: number | null; note: string | null };

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "review", label: "Needs review" },
  { id: "missing", label: "No check-ins" },
  { id: "closed", label: "Closed" },
];

function errorText(e: unknown, fallback: string) {
  if (e instanceof ApiError) return e.detail || fallback;
  return e instanceof Error && e.message && !e.message.startsWith("API error") ? e.message : fallback;
}

function readUrl() {
  if (typeof window === "undefined") return { level: null, scope: null, goal: null };
  const q = new URLSearchParams(window.location.search);
  const level = q.get("level");
  return {
    level: LEVELS.some((l) => l.id === level) ? (level as GoalLevel) : null,
    scope: q.get("scope"),
    goal: q.get("goal"),
  };
}

function writeUrl(params: { level: GoalLevel; scope: Scope; goal: string | null }, push: boolean) {
  const q = new URLSearchParams(window.location.search);
  q.set("level", params.level);
  if (params.scope !== "all") q.set("scope", params.scope);
  else q.delete("scope");
  if (params.goal) q.set("goal", params.goal);
  else q.delete("goal");
  const url = `${window.location.pathname}?${q.toString()}`;
  if (url === `${window.location.pathname}${window.location.search}`) return;
  window.history[push ? "pushState" : "replaceState"](null, "", url);
}

/** Board columns follow the space the board actually has, so the layout
 *  reflows when the Scribe drawer opens beside it, not just on viewport. */
function useColumns() {
  const ref = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(3);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      setCols(w >= 1020 ? 3 : w >= 600 ? 2 : 1);
    });
    ro.observe(node);
    return () => ro.disconnect();
  });
  return { ref, cols };
}

const scopeId = (level: GoalLevel, scope: Scope, forLevels: GoalLevel[]) =>
  forLevels.includes(level) && scope !== "all" && scope !== "none" ? scope : undefined;

export default function GoalsPage() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [reports, setReports] = useState<DirectReport[]>([]);
  const [orgUnits, setOrgUnits] = useState<OrgUnit[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [partial, setPartial] = useState<string[]>([]);
  const [pageError, setPageError] = useState<string | null>(null);

  const [level, setLevel] = useState<GoalLevel>("individual");
  const [scope, setScope] = useState<Scope>("all");
  const [view, setView] = useState<View>("board");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor>(null);
  const [goalFormDirty, setGoalFormDirty] = useState(false);

  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, UpdateDraft>>({});
  const [receipt, setReceipt] = useState<Receipt>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);

  const [feed, setFeed] = useState<CheckIn[] | null>(null);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [feedVersion, setFeedVersion] = useState(0);

  const [confirm, setConfirm] = useState<Confirm>(null);
  const [reviewSetup, setReviewSetup] = useState(false);
  const [presenting, setPresenting] = useState<{ ids: string[]; showStatus: boolean } | null>(null);

  const updateButtons = useRef(new Map<string, HTMLButtonElement>());
  const reviewButton = useRef<HTMLButtonElement>(null);
  const { ref: boardRef, cols } = useColumns();

  // --- load ---------------------------------------------------------------
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const [g, r, ou, p] = await Promise.allSettled([getGoals(), getDirectReports(), getOrgUnits(), getProjects()]);
    if (g.status === "rejected") {
      setLoadError(errorText(g.reason, "Goals couldn't be loaded."));
      setLoading(false);
      return;
    }
    const failed: string[] = [];
    setGoals(g.value);
    if (r.status === "fulfilled") setReports(r.value);
    else failed.push("people");
    if (ou.status === "fulfilled") setOrgUnits(ou.value);
    else failed.push("teams and departments");
    if (p.status === "fulfilled") setProjects(p.value);
    else failed.push("linked projects");
    setPartial(failed);
    const url = readUrl();
    const deep = url.goal ? g.value.find((x) => x.id === url.goal) : undefined;
    // Land on the deep-linked goal's level, the URL's level, or the first
    // level that has goals (Individual when there are none anywhere).
    const firstPopulated = LEVELS.find((l) => g.value.some((x) => x.level === l.id))?.id ?? "individual";
    setLevel(deep?.level ?? url.level ?? firstPopulated);
    setScope(deep ? "all" : url.scope ?? "all");
    if (deep) setDetailId(deep.id);
    else if (url.goal) setPageError("That goal isn't in your goals. It may have been deleted.");
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // --- unsaved edits ------------------------------------------------------
  const dirtyDraftIds = useMemo(
    () =>
      Object.entries(drafts)
        .filter(([id, d]) => {
          const goal = goals.find((g) => g.id === id);
          return goal ? isDraftDirty(d, goal) : false;
        })
        .map(([id]) => id),
    [drafts, goals],
  );
  const hasUnsaved = dirtyDraftIds.length > 0 || (editor !== null && goalFormDirty);
  const unsavedRef = useRef(hasUnsaved);
  unsavedRef.current = hasUnsaved;

  useEffect(() => {
    if (!hasUnsaved) return;
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [hasUnsaved]);

  const discardAll = useCallback(() => {
    setDrafts({});
    setUpdatingId(null);
    setEditor(null);
    setGoalFormDirty(false);
  }, []);

  /** Run a navigation, asking first if it would throw away typed work. */
  const guard = useCallback(
    (fn: () => void) => {
      if (!unsavedRef.current) {
        discardAll();
        fn();
        return;
      }
      setConfirm({
        title: "Leave these edits?",
        body: "You have an update or goal edit that hasn't been saved. Leaving discards it.",
        action: "Discard edits",
        cancel: "Keep editing",
        run: () => {
          discardAll();
          fn();
        },
      });
    },
    [discardAll],
  );

  // Browser back/forward moves between the board and a goal's Details.
  useEffect(() => {
    const onPop = () => {
      const url = readUrl();
      discardAll();
      setDetailId(url.goal);
      if (url.level) setLevel(url.level);
      setScope(url.scope ?? "all");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [discardAll]);

  // --- derived --------------------------------------------------------------
  const goalsById = useMemo(() => new Map(goals.map((g) => [g.id, g])), [goals]);
  const options = useMemo(() => scopeOptions(level, goals, reports, orgUnits), [level, goals, reports, orgUnits]);
  // A scope id that no longer has goals (deleted, or a stale link) falls back to All.
  const effectiveScope: Scope = level === "company" || options.some((o) => o.id === scope) ? scope : "all";
  const scopeName = options.find((o) => o.id === effectiveScope)?.label ?? allLabel(level);
  const scoped = useMemo(() => goals.filter((g) => inScope(g, level, effectiveScope)), [goals, level, effectiveScope]);
  const openGoals = scoped.filter(isOpen);
  const closedGoals = scoped.filter((g) => !isOpen(g));
  const passesFilter = useCallback(
    (g: Goal) =>
      matchesQuery(g, query) &&
      (filter === "all"
        ? isOpen(g)
        : filter === "closed"
          ? !isOpen(g)
          : filter === "review"
            ? reviewReasons(g).length > 0
            : hasNoCheckIn(g)),
    [filter, query],
  );
  // Exceptions lead; healthy goals stay on the board in their usual order.
  const exceptionsFirst = (list: Goal[]) =>
    list
      .map((g, i) => ({ g, i, r: reviewReasons(g).length > 0 ? 0 : 1 }))
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .map((x) => x.g);
  const shown = useMemo(() => exceptionsFirst(scoped.filter(passesFilter)), [scoped, passesFilter]);
  const connections = useCallback(
    (g: Goal) =>
      (g.parent_goal_id ? 1 : 0) +
      goals.filter((c) => c.parent_goal_id === g.id).length +
      projects.filter((p) => p.goal_id === g.id).length,
    [goals, projects],
  );
  const vocabulary = useMemo(() => reports.map((r) => r.name).join(", "), [reports]);
  const detailGoal = detailId ? goalsById.get(detailId) ?? null : null;
  const editingGoal = editor?.kind === "edit" ? goalsById.get(editor.id) ?? null : null;
  const focused = !!detailGoal || editor !== null;

  // Keep the URL in step so a refresh or a shared link lands in the same place.
  useEffect(() => {
    if (!loading && !loadError) writeUrl({ level, scope: effectiveScope, goal: detailGoal ? detailGoal.id : null }, false);
  }, [level, effectiveScope, detailGoal, loading, loadError]);

  // --- Updates feed ---------------------------------------------------------
  useEffect(() => {
    if (view !== "updates" || loading || loadError) return;
    let live = true;
    setFeed(null);
    setFeedError(null);
    getGoalUpdates({
      level,
      directReportId: scopeId(level, effectiveScope, ["individual"]),
      orgUnitId: scopeId(level, effectiveScope, ["team", "department"]),
      unassociated: level !== "company" && effectiveScope === "none",
      closed: filter === "closed",
    })
      .then((rows) => live && setFeed(rows))
      .catch((e) => live && setFeedError(errorText(e, "Please try again.")));
    return () => {
      live = false;
    };
  }, [view, level, effectiveScope, filter, feedVersion, loading, loadError]);

  const feedRows = useMemo(
    () =>
      (feed ?? []).filter((ci) => {
        const g = ci.goal_id ? goalsById.get(ci.goal_id) : undefined;
        if (!g) return true;
        return filter === "closed" ? matchesQuery(g, query) : passesFilter(g);
      }),
    [feed, goalsById, filter, query, passesFilter],
  );

  // --- actions ----------------------------------------------------------------
  function selectLevel(next: GoalLevel) {
    if (next === level) return;
    guard(() => {
      setLevel(next);
      setScope("all");
      setReceipt(null);
      setDetailId(null);
    });
  }

  function selectScope(next: Scope) {
    guard(() => {
      setScope(next);
      setReceipt(null);
      setDetailId(null);
    });
  }

  function openDetail(id: string) {
    const g = goalsById.get(id);
    guard(() => {
      const nextLevel = g?.level ?? level;
      const nextScope = nextLevel !== level ? "all" : effectiveScope;
      if (nextLevel !== level) {
        setLevel(nextLevel);
        setScope("all");
      }
      setDetailId(id);
      writeUrl({ level: nextLevel, scope: nextScope, goal: id }, true);
      window.scrollTo({ top: 0 });
    });
  }

  function backToBoard() {
    const from = detailId;
    guard(() => {
      setDetailId(null);
      writeUrl({ level, scope: effectiveScope, goal: null }, true);
      if (from) {
        requestAnimationFrame(() => {
          const el = document.getElementById(`goal-${from}-title`)?.querySelector("button");
          el?.focus({ preventScroll: true });
          el?.scrollIntoView({ block: "center" });
        });
      }
    });
  }

  function startUpdate(goal: Goal) {
    if (updatingId === goal.id) return;
    const open = () => {
      setReceipt(null);
      setUpdatingId(goal.id);
      setDrafts((cur) =>
        cur[goal.id]
          ? cur
          : { ...cur, [goal.id]: { status: goal.status, value: "", completion: "", note: "", requestId: newRequestId() } },
      );
    };
    if (updatingId && dirtyDraftIds.includes(updatingId)) guard(open);
    else open();
  }

  function cancelUpdate(goalId: string) {
    const goal = goalsById.get(goalId);
    const draft = drafts[goalId];
    const close = () => {
      setUpdatingId(null);
      setDrafts((cur) => {
        const next = { ...cur };
        delete next[goalId];
        return next;
      });
      requestAnimationFrame(() => updateButtons.current.get(goalId)?.focus());
    };
    if (goal && draft && isDraftDirty(draft, goal)) {
      setConfirm({
        title: "Discard this update?",
        body: "What you typed for this goal will be lost.",
        action: "Discard update",
        cancel: "Keep editing",
        run: close,
      });
    } else close();
  }

  async function saveUpdate(goal: Goal, parsed: ParsedUpdate) {
    const draft = drafts[goal.id];
    let saved: CheckIn;
    try {
      saved = await createGoalCheckIn(goal.id, {
        status: parsed.status,
        progress: parsed.completion,
        measured_value: parsed.value,
        note: parsed.note,
        client_request_id: draft?.requestId ?? newRequestId(),
      });
    } catch (e) {
      // A 4xx means nothing was written, so the next try is a new request.
      // A network failure or 5xx might have saved: keep the key so a retry
      // returns that row instead of adding a second one.
      if (e instanceof ApiError && e.status < 500 && draft) {
        setDrafts((cur) => (cur[goal.id] ? { ...cur, [goal.id]: { ...cur[goal.id], requestId: newRequestId() } } : cur));
      }
      throw new Error(errorText(e, "The update wasn't saved. Check your connection and try again."));
    }

    // Saved. From here on a failure is a refresh failure — never re-send.
    setDrafts((cur) => {
      const next = { ...cur };
      delete next[goal.id];
      return next;
    });
    setUpdatingId(null);
    const bits: string[] = [];
    if (saved.measured_value != null && goal.measure) {
      bits.push(`${formatValue(saved.measured_value, goal.measure)} recorded.`);
      if (meetsTarget(saved.measured_value, goal.measure)) bits.push("Recorded value meets the current target.");
    }
    if (saved.progress != null) bits.push(`${saved.progress}% completion recorded.`);
    if (saved.status !== goal.status) bits.push(`Status is now ${STATUS_LABEL[saved.status].toLowerCase()}.`);
    let warning: string | undefined;
    try {
      setGoals(await getGoals());
    } catch {
      warning = "The board couldn't refresh, so it may not show this update yet. Reload the page to see it.";
      setGoals((cur) =>
        cur.map((g) =>
          g.id === goal.id
            ? { ...g, status: saved.status, last_check_in_at: saved.created_at, last_check_in_note: saved.note, last_check_in_status: saved.status }
            : g,
        ),
      );
    }
    setReceipt({ goalId: goal.id, title: goal.title, detail: bits.join(" "), warning });
    setSavedId(goal.id);
    setHistoryVersion((v) => v + 1);
    setFeedVersion((v) => v + 1);
    window.setTimeout(() => setSavedId((id) => (id === goal.id ? null : id)), 1400);
    requestAnimationFrame(() => updateButtons.current.get(goal.id)?.focus());
  }

  async function setStatus(goalId: string, status: GoalStatus) {
    const updated = await updateGoalStatus(goalId, status);
    // PATCH returns base columns only; keep the enrichment already loaded.
    setGoals((cur) => cur.map((g) => (g.id === goalId ? { ...g, status: updated.status } : g)));
  }

  async function submitGoal(body: GoalIn) {
    const saved = editor?.kind === "edit" ? await updateGoal(editor.id, body) : await createGoal(body);
    setGoals((cur) =>
      cur.some((g) => g.id === saved.id) ? cur.map((g) => (g.id === saved.id ? { ...g, ...saved } : g)) : [saved, ...cur],
    );
    const wasNew = editor?.kind !== "edit";
    setGoalFormDirty(false);
    setEditor(null);
    const nextScope = saved.level !== level ? "all" : effectiveScope;
    if (saved.level !== level) {
      setLevel(saved.level);
      setScope("all");
    }
    setDetailId(saved.id);
    writeUrl({ level: saved.level, scope: nextScope, goal: saved.id }, wasNew);
  }

  function requestDelete(goal: Goal) {
    const children = goals.filter((g) => g.parent_goal_id === goal.id).length;
    setConfirm({
      title: "Delete this goal?",
      body: `“${goal.title}” and its update history will be deleted.${
        children ? ` ${children} linked goal${children === 1 ? "" : "s"} will stay, without this parent.` : ""
      } This can't be undone.`,
      action: "Delete goal",
      cancel: "Cancel",
      danger: true,
      run: async () => {
        try {
          await deleteGoal(goal.id);
          setGoals((cur) =>
            cur.filter((g) => g.id !== goal.id).map((g) => (g.parent_goal_id === goal.id ? { ...g, parent_goal_id: null } : g)),
          );
          setDetailId(null);
          setEditor(null);
          writeUrl({ level, scope: effectiveScope, goal: null }, false);
        } catch (e) {
          setPageError(errorText(e, "The goal wasn't deleted."));
        }
      },
    });
  }

  function newGoal() {
    guard(() => {
      setDetailId(null);
      setEditor({ kind: "new" });
      window.scrollTo({ top: 0 });
    });
  }

  function leaveEditor() {
    const back = editor?.kind === "edit" ? editor.id : null;
    guard(() => setDetailId(back));
  }

  const renderUpdateForm = (goal: Goal) =>
    updatingId === goal.id && drafts[goal.id] ? (
      <GoalUpdateForm
        goal={goal}
        draft={drafts[goal.id]}
        onDraftChange={(d) => setDrafts((cur) => ({ ...cur, [goal.id]: d }))}
        onSubmit={(parsed) => saveUpdate(goal, parsed)}
        onCancel={() => cancelUpdate(goal.id)}
        vocabulary={vocabulary}
      />
    ) : null;

  const registerUpdateButton = (id: string) => (el: HTMLButtonElement | null) => {
    if (el) updateButtons.current.set(id, el);
    else updateButtons.current.delete(id);
  };

  const presentGoals = presenting ? presenting.ids.map((id) => goalsById.get(id)).filter((g): g is Goal => !!g) : [];

  // --- render -------------------------------------------------------------------
  return (
    <PageShell maxWidth="8xl">
      <div className="mx-auto max-w-[1510px]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-serif text-[2.6rem] font-normal leading-none tracking-[-0.03em] text-ink sm:text-[3.05rem]">
              Goals
            </h1>
            <p className="mt-2.5 text-sm text-ink-secondary">What we&apos;re working toward.</p>
          </div>
          {!loading && !loadError && (
            <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-end">
              <button
                ref={reviewButton}
                type="button"
                onClick={() =>
                  guard(() =>
                    openGoals.length ? setReviewSetup(true) : setPageError("There are no open goals in this scope to review."),
                  )
                }
                className={`${BTN_SECONDARY} inline-flex items-center gap-2 py-2`}
              >
                <span aria-hidden className="text-base leading-none">▣</span>
                Review together
              </button>
              <button type="button" onClick={newGoal} className={BTN_PRIMARY}>
                + New goal
              </button>
            </div>
          )}
        </div>

        {pageError && (
          <p role="alert" className="mt-4 flex flex-wrap items-baseline gap-3 text-sm text-red-700">
            {pageError}
            <button type="button" onClick={() => setPageError(null)} className="text-xs text-ink-muted underline">
              Dismiss
            </button>
          </p>
        )}
        <PartialLoadNotice failed={partial} className="mt-4" />

        {loading ? (
          <SkeletonSection label="Loading goals" variant="cards" className="mt-8" />
        ) : loadError ? (
          <div role="alert" className="mt-8 rounded-xl bg-surface p-6">
            <h2 className="font-serif text-2xl text-ink">Goals couldn&apos;t be loaded.</h2>
            <p className="mt-2 text-sm text-ink-secondary">Nothing was changed. {loadError}</p>
            <button type="button" onClick={load} className={`${BTN_SECONDARY} mt-4`}>
              Try again
            </button>
          </div>
        ) : focused ? (
          <div className="mt-6">
            {editor ? (
              <section aria-labelledby="goal-editor-title" className="mx-auto w-full max-w-[900px] rounded-xl bg-surface p-5 sm:p-7">
                <button type="button" onClick={leaveEditor} className="text-sm text-brand hover:text-brand-hover">
                  ← {editor.kind === "edit" ? "Back to goal" : "Back to goals"}
                </button>
                <h2 id="goal-editor-title" className="mb-5 mt-4 font-serif text-[1.9rem] font-normal text-ink">
                  {editor.kind === "edit" ? "Edit goal" : "New goal"}
                </h2>
                {editor.kind === "edit" && !editingGoal ? (
                  <p className="text-sm text-ink-muted">This goal is no longer available.</p>
                ) : (
                  <GoalForm
                    key={editor.kind === "edit" ? editor.id : "new"}
                    goal={editingGoal}
                    defaults={{
                      level,
                      orgUnitId: scopeId(level, effectiveScope, ["team", "department"]),
                      directReportId: scopeId(level, effectiveScope, ["individual"]),
                    }}
                    reports={reports}
                    orgUnits={orgUnits}
                    allGoals={goals}
                    onSubmit={submitGoal}
                    onCancel={leaveEditor}
                    onDirtyChange={setGoalFormDirty}
                    vocabulary={vocabulary}
                  />
                )}
              </section>
            ) : detailGoal ? (
              <>
                {receipt && receipt.goalId === detailGoal.id && (
                  <div className="mx-auto max-w-[900px]" aria-live="polite">
                    <SavedReceipt receipt={receipt} onDismiss={() => setReceipt(null)} />
                  </div>
                )}
                <GoalDetail
                  goal={detailGoal}
                  allGoals={goals}
                  projects={projects}
                  historyVersion={historyVersion}
                  onBack={backToBoard}
                  onSetStatus={(s) => setStatus(detailGoal.id, s)}
                  onOpenGoal={openDetail}
                  onEdit={() => guard(() => setEditor({ kind: "edit", id: detailGoal.id }))}
                  onDelete={() => requestDelete(detailGoal)}
                  updateForm={renderUpdateForm(detailGoal)}
                  onAddUpdate={() => startUpdate(detailGoal)}
                  updateButtonRef={registerUpdateButton(detailGoal.id)}
                />
              </>
            ) : null}
          </div>
        ) : (
          <>
            {/* Level + scope */}
            <div className="mt-7 flex flex-col gap-3 border-b border-hairline sm:flex-row sm:items-end sm:justify-between">
              <nav aria-label="Goal level" className="-mb-px flex gap-4 overflow-x-auto sm:gap-6">
                {LEVELS.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    aria-pressed={level === l.id}
                    onClick={() => selectLevel(l.id)}
                    className={`shrink-0 border-b-2 pb-3 text-[0.9rem] sm:text-[0.95rem] ${
                      level === l.id ? "border-brand text-brand" : "border-transparent text-ink-secondary hover:text-ink"
                    }`}
                  >
                    {l.label}
                  </button>
                ))}
              </nav>
              {level !== "company" && options.length > 1 && (
                <select
                  aria-label="Goal scope"
                  value={effectiveScope}
                  onChange={(e) => selectScope(e.target.value)}
                  className={`${INPUT} mb-3 w-full py-1.5 text-xs sm:w-56`}
                >
                  {options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* View, filters, search */}
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <div className="inline-flex gap-0.5 rounded-lg border border-hairline bg-surface p-[3px]" role="group" aria-label="View">
                {(["board", "updates"] as View[]).map((v) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={view === v}
                    onClick={() => {
                      setView(v);
                      setReceipt(null);
                    }}
                    className={`rounded-md px-3 py-1.5 text-xs ${view === v ? "bg-elevated text-ink" : "text-ink-muted hover:text-ink"}`}
                  >
                    {v === "board" ? "Goals" : "Updates"}
                  </button>
                ))}
              </div>
              <div className="order-3 flex w-full flex-wrap gap-1 sm:order-none sm:w-auto" role="group" aria-label="Filter goals">
                {FILTERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    aria-pressed={filter === f.id}
                    onClick={() => setFilter(f.id)}
                    className={`rounded-md border px-2.5 py-1.5 text-2xs ${
                      filter === f.id ? "border-control text-ink" : "border-transparent text-ink-secondary hover:text-ink"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <input
                type="search"
                aria-label="Find a goal"
                placeholder="Find a goal..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className={`${INPUT} min-w-0 flex-1 py-1.5 text-xs sm:ml-auto sm:w-44 sm:flex-none`}
              />
            </div>

            <div className="mt-6 flex items-baseline justify-between gap-3">
              <h2 className="font-serif text-2xl font-normal text-ink">
                {view === "updates"
                  ? "Recent updates"
                  : effectiveScope === "all"
                    ? `${LEVELS.find((l) => l.id === level)?.label} goals`
                    : scopeName}
              </h2>
              {view === "board" && (
                <span className="shrink-0 text-xs text-ink-muted">
                  {filter === "closed"
                    ? `${shown.length} closed`
                    : filter === "all"
                      ? `${shown.length} open`
                      : `${shown.length} of ${openGoals.length} open`}
                </span>
              )}
            </div>

            <div className="mt-4" aria-live="polite">
              {receipt && <SavedReceipt receipt={receipt} onDismiss={() => setReceipt(null)} />}
            </div>

            {view === "updates" ? (
              feedError ? (
                <div role="alert" className="max-w-[870px] border-t border-hairline py-8">
                  <p className="text-sm text-red-700">Updates couldn&apos;t be loaded. {feedError}</p>
                  <button type="button" onClick={() => setFeedVersion((v) => v + 1)} className={`${BTN_SECONDARY} mt-3`}>
                    Try again
                  </button>
                </div>
              ) : feed === null ? (
                <SkeletonSection label="Loading updates" variant="cards" />
              ) : (
                <UpdatesFeed rows={feedRows} goalsById={goalsById} onOpenGoal={openDetail} closed={filter === "closed"} />
              )
            ) : (
              <div ref={boardRef}>
                {shown.length === 0 ? (
                  <EmptyBoard
                    level={level}
                    anyGoals={goals.length > 0}
                    scopedCount={scoped.length}
                    filter={filter}
                    query={query}
                    onNew={newGoal}
                    onClear={() => {
                      setFilter("all");
                      setQuery("");
                    }}
                  />
                ) : (
                  <div className="grid gap-5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
                    {shown.map((g) => {
                      const editing = updatingId === g.id && !!drafts[g.id];
                      return (
                        <div
                          key={g.id}
                          className="flex min-w-0 flex-col [&>article]:flex-1"
                          style={editing && cols > 1 ? { gridColumn: `span ${Math.min(2, cols)}` } : undefined}
                        >
                          <GoalSheet
                            goal={g}
                            connections={connections(g)}
                            editing={editing}
                            justSaved={savedId === g.id}
                            onOpen={() => openDetail(g.id)}
                            onAddUpdate={() => startUpdate(g)}
                            updateButtonRef={registerUpdateButton(g.id)}
                            form={renderUpdateForm(g)}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
                {filter !== "closed" && closedGoals.length > 0 && (
                  <div className="mt-7 border-t border-hairline pt-5">
                    <button type="button" onClick={() => setFilter("closed")} className="text-sm text-brand hover:text-brand-hover">
                      {closedGoals.length} closed goal{closedGoals.length === 1 ? "" : "s"} →
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {confirm && (
        <Dialog title={confirm.title} onClose={() => setConfirm(null)}>
          <p className="text-sm text-ink-body">{confirm.body}</p>
          <div className="mt-5 flex items-center gap-3">
            <button type="button" data-autofocus onClick={() => setConfirm(null)} className={BTN_SECONDARY}>
              {confirm.cancel}
            </button>
            <button
              type="button"
              onClick={() => {
                const run = confirm.run;
                setConfirm(null);
                run();
              }}
              className={confirm.danger ? BTN_DANGER : "text-sm text-ink-secondary hover:text-ink"}
            >
              {confirm.action}
            </button>
          </div>
        </Dialog>
      )}

      {reviewSetup && (
        <ReviewSetup
          choices={exceptionsFirst(openGoals)}
          scopeName={scopeName}
          onCancel={() => setReviewSetup(false)}
          onStart={(ids, showStatus) => {
            setReviewSetup(false);
            setPresenting({ ids, showStatus });
          }}
        />
      )}
      {presenting && presentGoals.length > 0 && (
        <ReviewPresentation
          goals={presentGoals}
          showStatus={presenting.showStatus}
          onExit={() => {
            setPresenting(null);
            requestAnimationFrame(() => reviewButton.current?.focus());
          }}
        />
      )}
    </PageShell>
  );
}

function SavedReceipt({ receipt, onDismiss }: { receipt: NonNullable<Receipt>; onDismiss: () => void }) {
  return (
    <div role="status" className="mb-5 flex items-start gap-4 rounded-lg border border-teal-300 bg-brand-tint px-4 py-3.5 text-sm">
      <div className="min-w-0 flex-1">
        <p className="text-ink-body">
          <strong className="font-medium text-brand">Update saved.</strong> “{receipt.title}”{receipt.detail ? ` · ${receipt.detail}` : ""}
        </p>
        {receipt.warning && <p className="mt-1 text-xs text-amber-700">{receipt.warning}</p>}
      </div>
      <button type="button" onClick={onDismiss} aria-label="Dismiss" className="text-xs text-ink-muted hover:text-ink">
        ✕
      </button>
    </div>
  );
}

function EmptyBoard({
  level,
  anyGoals,
  scopedCount,
  filter,
  query,
  onNew,
  onClear,
}: {
  level: GoalLevel;
  anyGoals: boolean;
  scopedCount: number;
  filter: Filter;
  query: string;
  onNew: () => void;
  onClear: () => void;
}) {
  const levelName = LEVELS.find((l) => l.id === level)?.label.toLowerCase();
  let title: string;
  let body: string;
  let action: "new" | "clear" = "new";
  if (!anyGoals) {
    title = "No goals yet.";
    body = "Write down what your team is working toward and how you'll know it worked.";
  } else if (scopedCount === 0) {
    title = `No ${levelName} goals here yet.`;
    body = "Add one, or pick another level above.";
  } else if (query) {
    title = "No matching goals.";
    body = "Nothing in this scope matches that search.";
    action = "clear";
  } else if (filter === "review") {
    title = "Nothing needs review.";
    body = "No open goal here is at risk, past due, or without a recent check-in.";
    action = "clear";
  } else if (filter === "missing") {
    title = "Every open goal has a check-in.";
    body = "Nothing here is waiting for its first update.";
    action = "clear";
  } else if (filter === "closed") {
    title = "No closed goals here.";
    body = "Completed and cancelled goals will appear here.";
    action = "clear";
  } else {
    title = "No open goals here.";
    body = "Every goal in this scope is completed or cancelled.";
  }
  return (
    <div className="rounded-xl bg-surface px-6 py-10">
      <h3 className="font-serif text-2xl text-ink">{title}</h3>
      <p className="mt-2 text-sm text-ink-secondary">{body}</p>
      <button type="button" onClick={action === "new" ? onNew : onClear} className={`${action === "new" ? BTN_PRIMARY : BTN_SECONDARY} mt-5`}>
        {action === "new" ? "+ New goal" : "Show all open goals"}
      </button>
    </div>
  );
}
