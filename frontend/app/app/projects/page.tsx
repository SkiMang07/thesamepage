"use client";

// Projects — keep things moving. The page answers "what's going on across the
// work?" first (Portfolio at a glance: factual counts and a short scan,
// exceptions first), then gives each project a compact brief that keeps its
// purpose and latest recorded situation together, with updates, the dated
// record, your private next move and edits opening in place.
//
// Deliberately NOT project management: no tasks, dependencies, assignments,
// reminders or workflow. Design authority:
// docs/design-proposals/2026-09-25-projects-in-motion/BUILD_BRIEF.md.
// Behaviour: docs/systems/projects.md.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  CheckIn,
  DirectReport,
  Goal,
  OrgUnit,
  Project,
  ProjectFollowThrough,
  ProjectIn,
  ProjectStatus,
  createProject,
  createProjectCheckIn,
  deleteProject,
  getDirectReports,
  getGoals,
  getOrgUnits,
  getProjects,
  updateProject,
  updateProjectFollowThrough,
  updateProjectStatus,
} from "@/lib/api";
import PageShell from "@/components/PageShell";
import PartialLoadNotice from "@/components/PartialLoadNotice";
import { SkeletonSection } from "@/components/Skeleton";
import { useDrawer } from "@/lib/drawer-context";
import { BTN_DANGER, BTN_PRIMARY, BTN_SECONDARY, INPUT, LABEL } from "@/lib/tokens";
import {
  AttentionFilter,
  OwnerKey,
  PROJECT_STATUS_LABEL,
  PROJECT_STATUS_ORDER,
  applyAttention,
  compareProjects,
  formatDay,
  formatMoment,
  isClosed,
  matchesScope,
  overview,
  ownerKey,
  ownerName,
} from "@/lib/projects";
import { newRequestId } from "@/lib/goals";
import Dialog from "@/components/goals/Dialog";
import ProjectBrief, { Panel } from "@/components/projects/ProjectBrief";
import ProjectForm from "@/components/projects/ProjectForm";
import ProjectRecord from "@/components/projects/ProjectRecord";
import ProjectUpdateForm, { UpdateDraft, isUpdateDirty } from "@/components/projects/ProjectUpdateForm";
import FollowThroughPanel from "@/components/projects/FollowThroughPanel";
import { OverviewBand, PortfolioScan } from "@/components/projects/PortfolioOverview";
import { ReviewPlan, ReviewPresentation, ReviewSetup } from "@/components/projects/ProjectReview";
import { StatusChip } from "@/components/projects/StatusChip";
import { useOpenRecord } from "@/lib/scribeCitations";

type View = "open" | "mine" | "closed";
type Receipt = { projectId: string | null; text: string; warning?: string } | null;

/** A 4xx carries the server's reason; a 5xx or network failure gets the
 *  plain fallback (a gateway page is not a message for a manager). */
function errorText(e: unknown, fallback: string) {
  if (e instanceof ApiError && e.status < 500) return e.detail || fallback;
  return fallback;
}

/** Content width, so layout follows the space the page actually has — it
 *  reflows when the Scribe drawer opens, not only on viewport changes. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(node);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [reports, setReports] = useState<DirectReport[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [orgUnits, setOrgUnits] = useState<OrgUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [partial, setPartial] = useState<string[]>([]);

  const [view, setView] = useState<View>("open");
  const [owner, setOwner] = useState<OwnerKey>("all");
  const [query, setQuery] = useState("");
  const [attention, setAttention] = useState<AttentionFilter>("all");
  const [showAll, setShowAll] = useState(false);

  const [panels, setPanels] = useState<Record<string, Panel | null>>({});
  const [updateDrafts, setUpdateDrafts] = useState<Record<string, UpdateDraft>>({});
  const [followDrafts, setFollowDrafts] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);
  const [formDirty, setFormDirty] = useState(false);
  const [recordVersion, setRecordVersion] = useState<Record<string, number>>({});
  const [receipt, setReceipt] = useState<Receipt>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Project | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [reviewSetup, setReviewSetup] = useState(false);
  const [review, setReview] = useState<ReviewPlan | null>(null);
  const [busyStatus, setBusyStatus] = useState<string | null>(null);

  const headings = useRef(new Map<string, HTMLHeadingElement>());
  const reviewButton = useRef<HTMLButtonElement>(null);
  const { ref: widthRef, width } = useWidth();
  const { setPageContext } = useDrawer();
  const wide = width >= 780;
  const scanWide = width >= 860;

  // --- load ------------------------------------------------------------------
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const [p, r, g, ou] = await Promise.allSettled([getProjects(), getDirectReports(), getGoals(), getOrgUnits()]);
    if (p.status === "rejected") {
      setLoadError(errorText(p.reason, "Check your connection and try again."));
      setLoading(false);
      return;
    }
    setProjects(p.value);
    const failed: string[] = [];
    if (r.status === "fulfilled") setReports(r.value);
    else failed.push("your reports (owner choices)");
    if (g.status === "fulfilled") setGoals(g.value);
    else failed.push("goals (goal choices)");
    if (ou.status === "fulfilled") setOrgUnits(ou.value);
    else failed.push("teams (team choices)");
    setPartial(failed);
    setLoading(false);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  /** Re-read the list after a confirmed write. Returns false on failure so
   *  the caller can say the page may be behind — never re-send the write. */
  const refresh = useCallback(async () => {
    try {
      setProjects(await getProjects());
      return true;
    } catch {
      return false;
    }
  }, []);

  const vocabulary = useMemo(() => reports.map((r) => r.name).join(", "), [reports]);

  // --- unsaved edits ---------------------------------------------------------
  const hasUnsaved =
    formDirty ||
    Object.entries(updateDrafts).some(([id, d]) => {
      const p = projects.find((x) => x.id === id);
      return p ? isUpdateDirty(d, p) : false;
    }) ||
    Object.values(followDrafts).some((t) => t.trim() !== "");
  useEffect(() => {
    if (!hasUnsaved) return;
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [hasUnsaved]);

  // --- derived ---------------------------------------------------------------
  const scoped = useMemo(() => projects.filter((p) => matchesScope(p, owner, query)), [projects, owner, query]);
  const counts = useMemo(() => overview(scoped), [scoped]);
  const openScoped = useMemo(() => scoped.filter((p) => !isClosed(p)).sort((a, b) => compareProjects(a, b)), [scoped]);
  const openShown = useMemo(() => applyAttention(openScoped, attention), [openScoped, attention]);
  const closedShown = useMemo(
    () => scoped.filter(isClosed).sort((a, b) => (b.last_check_in_at ?? b.created_at).localeCompare(a.last_check_in_at ?? a.created_at)),
    [scoped],
  );
  const mineShown = useMemo(
    () =>
      scoped
        .filter((p) => p.next_move?.status === "open")
        .sort((a, b) => Number(isClosed(a)) - Number(isClosed(b)) || compareProjects(a, b)),
    [scoped],
  );
  const nextMovesUnknown = scoped.some((p) => p.next_move_available === false);
  const ownerOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of projects) seen.set(ownerKey(p), ownerName(p));
    return [...seen.entries()].sort((a, b) => (a[0] === "you" ? -1 : b[0] === "you" ? 1 : a[1].localeCompare(b[1])));
  }, [projects]);
  const briefs = view === "open" ? openShown : view === "closed" ? closedShown : [];
  const scopeActive = owner !== "all" || query.trim() !== "" || attention !== "all";
  const ownerLabel = owner === "all" ? null : ownerOptions.find(([k]) => k === owner)?.[1] ?? "Unknown owner";
  const focused = projects.find((p) => p.id === focusedId) ?? null;

  useEffect(() => {
    setPageContext(
      focused
        ? { label: `Projects page — selected project: ${focused.title}`, entity_type: "project", entity_id: focused.id }
        : { label: "Projects page — project portfolio" },
    );
  }, [focused, setPageContext]);
  useEffect(() => () => setPageContext(null), [setPageContext]);

  // --- navigation -------------------------------------------------------------
  function resetScope() {
    setOwner("all");
    setQuery("");
    setAttention("all");
  }

  function setPanel(id: string, panel: Panel | null) {
    setPanels((cur) => ({ ...cur, [id]: panel }));
    if (panel) setFocusedId(id);
    if (panel === "update") {
      setUpdateDrafts((cur) => {
        if (cur[id]) return cur;
        const p = projects.find((x) => x.id === id);
        return p ? { ...cur, [id]: { status: p.status, completion: "", note: "", requestId: newRequestId() } } : cur;
      });
    }
  }

  const goToBrief = useCallback((id: string, panel?: Panel) => {
    setFocusedId(id);
    if (panel) setPanels((cur) => ({ ...cur, [id]: panel }));
    // Two frames: a view or panel change must commit before the brief exists.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const heading = headings.current.get(id);
        if (!heading) return;
        heading.closest("article")?.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
        heading.focus({ preventScroll: true });
      }),
    );
  }, []);

  /** From My follow-through (or a receipt): open the project where it lives. */
  function openProject(p: Project, panel: Panel = "follow") {
    resetScope();
    setView(isClosed(p) ? "closed" : "open");
    goToBrief(p.id, panel);
  }

  /** A Scribe citation: /app/projects?project=<id> on load, or the chip's
   *  event while the page is already open. Opens the brief, no panel. */
  function openCited(id: string) {
    const p = projects.find((x) => x.id === id);
    if (!p) {
      setPageError("That project isn't in your projects. It may have been deleted.");
      return;
    }
    resetScope();
    setView(isClosed(p) ? "closed" : "open");
    goToBrief(p.id);
  }
  useOpenRecord("project", openCited);
  const deepLinkRead = useRef(false);
  useEffect(() => {
    if (loading || loadError || deepLinkRead.current) return;
    deepLinkRead.current = true;
    const id = new URLSearchParams(window.location.search).get("project");
    if (id) openCited(id);
    // openCited reads the loaded list; run once, right after the first load.
  }, [loading, loadError]);

  function flash(id: string) {
    setSavedId(id);
    window.setTimeout(() => setSavedId((cur) => (cur === id ? null : cur)), 1400);
  }

  // --- writes -----------------------------------------------------------------
  async function saveUpdate(p: Project, parsed: { status: ProjectStatus; progress: number | null; note: string | null }) {
    const draft = updateDrafts[p.id];
    let saved: CheckIn;
    try {
      saved = await createProjectCheckIn(p.id, { ...parsed, client_request_id: draft?.requestId ?? newRequestId() });
    } catch (e) {
      // A 4xx wrote nothing, so the next try is a new request. A network
      // failure or 5xx might have saved: keep the key so a retry returns it.
      if (e instanceof ApiError && e.status < 500) {
        setUpdateDrafts((cur) => (cur[p.id] ? { ...cur, [p.id]: { ...cur[p.id], requestId: newRequestId() } } : cur));
      }
      throw new Error(errorText(e, "The update wasn't saved. Your entries are still here — check your connection and try again."));
    }
    // Saved. From here on a failure is a refresh failure — never re-send.
    setUpdateDrafts((cur) => {
      const next = { ...cur };
      delete next[p.id];
      return next;
    });
    setPanels((cur) => ({ ...cur, [p.id]: "record" }));
    setRecordVersion((cur) => ({ ...cur, [p.id]: (cur[p.id] ?? 0) + 1 }));
    const bits = ["Update saved to the record."];
    if (saved.progress != null) bits.push(`${saved.progress}% completion recorded.`);
    if (saved.status !== p.status) bits.push(`Status is now ${PROJECT_STATUS_LABEL[saved.status].toLowerCase()}.`);
    const ok = await refresh();
    if (!ok) {
      setProjects((cur) =>
        cur.map((x) =>
          x.id === p.id
            ? {
                ...x,
                status: saved.status,
                last_check_in_at: saved.created_at,
                last_check_in_note: saved.note,
                last_check_in_status: saved.status,
                ...(saved.progress != null ? { progress: saved.progress, progress_at: saved.created_at } : {}),
              }
            : x,
        ),
      );
    }
    if (isClosed({ status: saved.status }) !== isClosed(p)) setView(isClosed({ status: saved.status }) ? "closed" : "open");
    setReceipt({
      projectId: p.id,
      text: `${p.title}: ${bits.join(" ")} Nothing was sent.`,
      warning: ok ? undefined : "The page couldn’t refresh, so some counts may be behind. The update is saved — don’t record it again. Reload to catch up.",
    });
    flash(p.id);
    goToBrief(p.id);
  }

  async function setStatusOnly(p: Project, status: ProjectStatus) {
    if (status === p.status) return;
    setBusyStatus(p.id);
    setPageError(null);
    try {
      const updated = await updateProjectStatus(p.id, status);
      // PATCH returns base columns; keep the enrichment already loaded.
      setProjects((cur) => cur.map((x) => (x.id === p.id ? { ...x, status: updated.status } : x)));
      setReceipt({ projectId: p.id, text: `${p.title}: status set to ${PROJECT_STATUS_LABEL[updated.status].toLowerCase()}. No dated update was added.` });
      if (isClosed(updated) !== isClosed(p)) {
        setView(isClosed(updated) ? "closed" : "open");
        goToBrief(p.id, "details");
      }
    } catch (e) {
      setPageError(errorText(e, "The status wasn't changed. Try again."));
    } finally {
      setBusyStatus(null);
    }
  }

  async function submitProject(body: ProjectIn, existing?: Project) {
    const saved = existing ? await updateProject(existing.id, body) : await createProject(body);
    const ok = await refresh();
    if (!ok) {
      // Keep enrichment (latest update, next move) that the base row lacks.
      setProjects((cur) =>
        existing ? cur.map((x) => (x.id === saved.id ? { ...x, ...saved } : x)) : [{ ...saved, next_move: null, next_move_available: true }, ...cur],
      );
    }
    setFormDirty(false);
    if (existing) setPanels((cur) => ({ ...cur, [saved.id]: "details" }));
    else setCreating(false);
    resetScope();
    setView(isClosed(saved) ? "closed" : "open");
    setReceipt({
      projectId: saved.id,
      text: existing ? `${saved.title}: changes saved. No dated update was added.` : `${saved.title} created. Record an update whenever there’s news.`,
      warning: ok ? undefined : "The page couldn’t refresh. Your project is saved — reload to see everything current.",
    });
    flash(saved.id);
    goToBrief(saved.id);
  }

  async function runDelete() {
    const p = confirmDelete;
    if (!p || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteProject(p.id);
      setProjects((cur) => cur.filter((x) => x.id !== p.id));
      setUpdateDrafts((cur) => {
        const next = { ...cur };
        delete next[p.id];
        return next;
      });
      setFollowDrafts((cur) => {
        const next = { ...cur };
        delete next[p.id];
        return next;
      });
      setFocusedId((id) => (id === p.id ? null : id));
      setConfirmDelete(null);
      setReceipt({ projectId: null, text: `${p.title} was deleted, with its updates and your next moves.` });
    } catch (e) {
      setDeleteError(errorText(e, "The project wasn't deleted. Try again."));
    } finally {
      setDeleting(false);
    }
  }

  function applyFollow(p: Project, open: ProjectFollowThrough | null, text: string) {
    setProjects((cur) => cur.map((x) => (x.id === p.id ? { ...x, next_move: open, next_move_available: true } : x)));
    setReceipt({ projectId: p.id, text: `${p.title}: ${text}` });
  }

  async function markDoneFromList(p: Project) {
    if (!p.next_move) return;
    setPageError(null);
    try {
      await updateProjectFollowThrough(p.next_move.id, { status: "done" });
      applyFollow(p, null, "next move marked done. Project status is unchanged.");
    } catch (e) {
      setPageError(errorText(e, "That wasn't marked done. Try again."));
    }
  }

  const onFormDirty = useCallback((d: boolean) => setFormDirty(d), []);

  // --- render helpers -----------------------------------------------------------
  function panelContent(p: Project, panel: Panel) {
    if (panel === "update") {
      const draft = updateDrafts[p.id] ?? { status: p.status, completion: "", note: "", requestId: newRequestId() };
      return (
        <ProjectUpdateForm
          project={p}
          draft={draft}
          onDraftChange={(d) => setUpdateDrafts((cur) => ({ ...cur, [p.id]: d }))}
          onSubmit={(parsed) => saveUpdate(p, parsed)}
          onCancel={() => setPanel(p.id, null)}
          vocabulary={vocabulary}
        />
      );
    }
    if (panel === "record") {
      return (
        <div>
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-semibold text-ink">The record</h3>
            <span className="text-xs text-ink-muted">Newest first · exact notes and the status recorded with each</span>
          </div>
          <ProjectRecord projectId={p.id} version={recordVersion[p.id] ?? 0} />
        </div>
      );
    }
    if (panel === "follow") {
      return (
        <FollowThroughPanel
          project={p}
          draft={followDrafts[p.id]}
          onDraftChange={(t) =>
            setFollowDrafts((cur) => {
              const next = { ...cur };
              if (t === undefined) delete next[p.id];
              else next[p.id] = t;
              return next;
            })
          }
          onChanged={(open, text) => applyFollow(p, open, text)}
          onClose={() => setPanel(p.id, null)}
          vocabulary={vocabulary}
        />
      );
    }
    if (panel === "edit") {
      return (
        <div>
          <button type="button" onClick={() => setPanel(p.id, "details")} className="text-sm text-brand hover:text-brand-hover">
            ← Back to details
          </button>
          <h3 className="mb-3 mt-2 text-sm font-semibold text-ink">Edit project</h3>
          <ProjectForm
            project={p}
            reports={reports}
            goals={goals}
            orgUnits={orgUnits}
            vocabulary={vocabulary}
            onSubmit={(body) => submitProject(body, p)}
            onCancel={() => setPanel(p.id, "details")}
            onDirtyChange={onFormDirty}
          />
        </div>
      );
    }
    // details
    return (
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-ink-muted">Owner</dt>
          <dd className="text-ink-body">{ownerName(p)}</dd>
          <dt className="text-ink-muted">Team</dt>
          <dd className="text-ink-body">{p.org_unit_name ?? "No team assigned"}</dd>
          <dt className="text-ink-muted">Goal</dt>
          <dd className="text-ink-body">{p.goal_id ? p.goal_title ?? "A goal you can’t see here" : "Standalone — no goal required"}</dd>
          <dt className="text-ink-muted">Due</dt>
          <dd className="text-ink-body">{p.due_date ? formatDay(p.due_date) : "No due date"}</dd>
          <dt className="text-ink-muted">Created</dt>
          <dd className="text-ink-body">{formatMoment(p.created_at)}</dd>
          {p.description && (
            <>
              <dt className="text-ink-muted">Purpose</dt>
              <dd className="whitespace-pre-wrap break-words text-ink-body">{p.description}</dd>
            </>
          )}
        </dl>
        <div className="flex flex-col gap-3 sm:w-56">
          <div>
            <label htmlFor={`project-${p.id}-status-only`} className={LABEL}>
              Status · changes it without a dated update
            </label>
            <select
              id={`project-${p.id}-status-only`}
              value={p.status}
              disabled={busyStatus === p.id}
              onChange={(e) => setStatusOnly(p, e.target.value as ProjectStatus)}
              className={INPUT}
            >
              {PROJECT_STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {PROJECT_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
          <button type="button" onClick={() => setPanel(p.id, "edit")} className={BTN_SECONDARY}>
            Edit project
          </button>
          <button
            type="button"
            onClick={() => {
              setDeleteError(null);
              setConfirmDelete(p);
            }}
            className="text-left text-sm text-red-700 hover:underline"
          >
            Delete project…
          </button>
        </div>
      </div>
    );
  }

  const tabs: { id: View; label: string; count: number | null }[] = [
    { id: "open", label: "Open projects", count: null },
    { id: "mine", label: "My follow-through", count: nextMovesUnknown ? null : mineShown.length },
    { id: "closed", label: "Closed", count: closedShown.length },
  ];
  const filterLabel =
    attention === "attention" ? "At risk / past due" : attention === "missing" ? "Missing a recent update" : "All open projects";
  const reviewChoices = view === "mine" ? mineShown : briefs;

  // --- render -------------------------------------------------------------------
  return (
    <PageShell maxWidth="8xl">
      <div ref={widthRef} className="mx-auto max-w-[1400px]">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
          <div>
            <h1 className="font-serif text-[2.3rem] font-normal leading-none tracking-[-0.03em] text-ink sm:text-[2.6rem]">Projects</h1>
            <p className="mt-2 text-sm text-ink-secondary">Keep things moving — what matters, what’s changed, your next move.</p>
          </div>
          {!loading && !loadError && (
            <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-end">
              {projects.length > 0 && (
              <button
                ref={reviewButton}
                type="button"
                onClick={() => (reviewChoices.length ? setReviewSetup(true) : setPageError("There are no projects in this view to review."))}
                className={`${BTN_SECONDARY} py-2`}
              >
                Prepare a review
              </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setCreating(true);
                  setFocusedId(null);
                  requestAnimationFrame(() => document.getElementById("project-new")?.scrollIntoView({ block: "start" }));
                }}
                className={BTN_PRIMARY}
              >
                + New project
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
        <div aria-live="polite">
          {receipt && (
            <div className="mt-4 flex flex-wrap items-start justify-between gap-3 rounded-lg border-l-2 border-brand bg-brand-tint px-4 py-2.5 text-sm text-ink-body animate-fade-in motion-reduce:animate-none">
              <div className="min-w-0">
                <p>{receipt.text}</p>
                {receipt.warning && <p className="mt-1 text-amber-700">{receipt.warning}</p>}
              </div>
              <button type="button" onClick={() => setReceipt(null)} className="text-xs text-ink-muted hover:text-ink">
                Dismiss
              </button>
            </div>
          )}
        </div>

        {loading ? (
          <SkeletonSection label="Loading projects" variant="cards" className="mt-6" />
        ) : loadError ? (
          <div role="alert" className="mt-6 rounded-xl bg-surface p-6">
            <h2 className="font-serif text-2xl text-ink">Projects couldn’t be loaded.</h2>
            <p className="mt-2 text-sm text-ink-secondary">This is a connection problem, not an empty portfolio. Nothing was changed. {loadError}</p>
            <button type="button" onClick={() => void load()} className={`${BTN_SECONDARY} mt-4`}>
              Try again
            </button>
          </div>
        ) : (
          <>
            {creating && (
              <section id="project-new" aria-labelledby="project-new-title" className="mt-5 scroll-mt-24 rounded-xl border border-hairline bg-surface p-5">
                <h2 id="project-new-title" className="mb-4 font-serif text-[1.6rem] font-normal text-ink">
                  A project worth keeping in view
                </h2>
                <ProjectForm
                  reports={reports}
                  goals={goals}
                  orgUnits={orgUnits}
                  vocabulary={vocabulary}
                  onSubmit={(body) => submitProject(body)}
                  onCancel={() => {
                    setCreating(false);
                    setFormDirty(false);
                  }}
                  onDirtyChange={onFormDirty}
                />
              </section>
            )}

            {projects.length === 0 ? (
              !creating && (
                <div className="mt-6 rounded-xl border border-hairline bg-surface p-8">
                  <h2 className="font-serif text-2xl text-ink">Start with work worth keeping in view.</h2>
                  <p className="mt-2 max-w-xl text-sm text-ink-secondary">
                    Keep each project’s purpose and latest situation together. A project can stand on its own — a goal connection is optional.
                  </p>
                  <button type="button" onClick={() => setCreating(true)} className={`${BTN_PRIMARY} mt-4`}>
                    + New project
                  </button>
                </div>
              )
            ) : (
              <>
                {/* View + scope */}
                <div className="mt-6 flex flex-col gap-3 border-b border-hairline md:flex-row md:items-end md:justify-between">
                  <nav aria-label="Project view" className="-mb-px flex gap-5 overflow-x-auto">
                    {tabs.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        aria-pressed={view === t.id}
                        onClick={() => setView(t.id)}
                        className={`shrink-0 border-b-2 pb-2.5 text-[0.92rem] ${
                          view === t.id ? "border-brand text-brand" : "border-transparent text-ink-secondary hover:text-ink"
                        }`}
                      >
                        {t.label}
                        {t.count != null && <span className="ml-1.5 text-xs text-ink-muted">{t.count}</span>}
                      </button>
                    ))}
                  </nav>
                  <div className="mb-2.5 flex flex-wrap items-center gap-2">
                    <label htmlFor="projects-search" className="sr-only">
                      Find a project
                    </label>
                    <input
                      id="projects-search"
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Find a project…"
                      className={`${INPUT} w-full py-1.5 text-xs sm:w-48`}
                    />
                    <label htmlFor="projects-owner" className="sr-only">
                      Project owner
                    </label>
                    <select
                      id="projects-owner"
                      value={owner}
                      onChange={(e) => setOwner(e.target.value)}
                      className={`${INPUT} w-full py-1.5 text-xs sm:w-44`}
                    >
                      <option value="all">All owners</option>
                      {ownerOptions.map(([k, name]) => (
                        <option key={k} value={k}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {scopeActive && (
                  <p className="mt-2.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-muted">
                    <span>
                      Showing{ownerLabel ? ` ${ownerLabel}’s projects` : " all owners"}
                      {query.trim() ? ` matching “${query.trim()}”` : ""}
                      {view === "open" && attention !== "all" ? ` · ${filterLabel.toLowerCase()}` : ""}
                    </span>
                    <button type="button" onClick={resetScope} className="font-medium text-brand hover:text-brand-hover">
                      Reset
                    </button>
                  </p>
                )}

                {view === "open" && (
                  <>
                    <OverviewBand
                      counts={counts}
                      filter={attention}
                      width={width}
                      onFilter={(f) => {
                        setAttention(f);
                        setShowAll(false);
                      }}
                      onNextMoves={() => setView("mine")}
                    />
                    {(width < 520 || (counts.attention > 0 && counts.missing > 0)) && (
                      <p className="mt-1.5 text-2xs text-ink-muted">
                        {width < 520 ? "Missing an update: none yet, or none in 14 days — missing context, not risk. " : ""}
                        {counts.attention > 0 && counts.missing > 0 ? "Counts can overlap — one project can be at risk and missing an update." : ""}
                      </p>
                    )}
                    <PortfolioScan
                      rows={openShown}
                      total={openScoped.length}
                      showAll={showAll}
                      onShowAll={setShowAll}
                      onGo={(id) => goToBrief(id)}
                      wide={scanWide}
                      filterLabel={filterLabel}
                    />
                  </>
                )}

                {view === "mine" && (
                  <section aria-labelledby="mine-title" className="mt-5">
                    <h2 id="mine-title" className="text-sm font-semibold text-ink">
                      {nextMovesUnknown ? "Your open next moves" : `${mineShown.length} open next move${mineShown.length === 1 ? "" : "s"}`}
                      <span className="font-normal text-ink-muted"> · private to you, never assigned or sent</span>
                    </h2>
                    {nextMovesUnknown && (
                      <p role="alert" className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">
                        Your next moves couldn’t be loaded, so this list may be incomplete.{" "}
                        <button type="button" onClick={() => void refresh()} className="underline">
                          Try again
                        </button>
                      </p>
                    )}
                    {mineShown.length === 0 ? (
                      !nextMovesUnknown && (
                        <p className="mt-3 rounded-xl border border-hairline bg-surface p-6 text-sm text-ink-secondary">
                          Nothing waiting on you here. Only next moves you record yourself appear — an empty list doesn’t mean every project is healthy.
                        </p>
                      )
                    ) : (
                      <ul className="mt-3 divide-y divide-divider overflow-hidden rounded-xl border border-hairline bg-surface">
                        {mineShown.map((p) => (
                          <li key={p.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                            <div className="min-w-0">
                              <p className="break-words text-sm font-medium text-ink">{p.next_move!.body}</p>
                              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-muted">
                                <span>
                                  For <span className="text-ink-body">{p.title}</span> · owner {ownerName(p)}
                                </span>
                                {isClosed(p) && <StatusChip status={p.status} />}
                                {isClosed(p) && <span>Project closed</span>}
                              </p>
                            </div>
                            <div className="flex shrink-0 gap-2">
                              <button type="button" onClick={() => openProject(p)} className={BTN_SECONDARY}>
                                Open project
                              </button>
                              <button type="button" onClick={() => void markDoneFromList(p)} className={BTN_SECONDARY}>
                                Mark done
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                )}

                {view !== "mine" && (
                  <section aria-labelledby="briefs-title" className="mt-6">
                    <h2 id="briefs-title" className="mb-2.5 text-sm font-semibold text-ink">
                      {view === "closed"
                        ? `${briefs.length} closed project${briefs.length === 1 ? "" : "s"}`
                        : `Project briefs · ${briefs.length}`}
                      {view === "open" && attention !== "all" && <span className="font-normal text-ink-muted"> · {filterLabel.toLowerCase()}</span>}
                    </h2>
                    {briefs.length === 0 ? (
                      <div className="rounded-xl border border-hairline bg-surface p-6 text-sm text-ink-secondary">
                        {view === "closed" ? "No closed projects in this view." : "No open projects match."}{" "}
                        {scopeActive && (
                          <button type="button" onClick={resetScope} className="font-medium text-brand hover:text-brand-hover">
                            Reset filters
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {briefs.map((p) => {
                          const panel = panels[p.id] ?? null;
                          const draft = updateDrafts[p.id];
                          return (
                            <ProjectBrief
                              key={p.id}
                              ref={(el) => {
                                if (el) headings.current.set(p.id, el);
                                else headings.current.delete(p.id);
                              }}
                              project={p}
                              panel={panel}
                              wide={wide}
                              justSaved={savedId === p.id}
                              hasDraft={!!draft && isUpdateDirty(draft, p)}
                              onPanel={(next) => setPanel(p.id, next)}
                            >
                              {panel ? panelContent(p, panel) : null}
                            </ProjectBrief>
                          );
                        })}
                      </div>
                    )}
                  </section>
                )}
              </>
            )}
            <p className="mt-8 text-2xs text-ink-muted">Private manager workspace · Saving never sends, shares or notifies anyone.</p>
          </>
        )}
      </div>

      {confirmDelete && (
        <Dialog title="Delete this project?" onClose={() => !deleting && setConfirmDelete(null)}>
          <p className="text-sm text-ink-body">{confirmDelete.title}</p>
          <p className="mt-2 text-sm text-ink-secondary">Its dated updates and your next moves on it are deleted too. This can’t be undone.</p>
          <div role="alert">{deleteError && <p className="mt-3 text-sm text-red-700">{deleteError}</p>}</div>
          <div className="mt-5 flex items-center gap-3">
            <button type="button" onClick={() => void runDelete()} disabled={deleting} className={BTN_DANGER}>
              {deleting ? "Deleting..." : "Delete project"}
            </button>
            <button type="button" onClick={() => setConfirmDelete(null)} disabled={deleting} className="text-sm text-ink-secondary hover:text-ink" data-autofocus>
              Keep project
            </button>
          </div>
        </Dialog>
      )}

      {reviewSetup && (
        <ReviewSetup
          choices={reviewChoices}
          scopeName={[
            view === "open" ? filterLabel : view === "closed" ? "Closed projects" : "Projects with your open next moves",
            ownerLabel ? `owner ${ownerLabel}` : null,
            query.trim() ? `matching “${query.trim()}”` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          onCancel={() => setReviewSetup(false)}
          onStart={(plan) => {
            setReviewSetup(false);
            setReview(plan);
          }}
        />
      )}
      {review && (
        <ReviewPresentation
          projects={projects}
          plan={review}
          onExit={() => {
            setReview(null);
            requestAnimationFrame(() => reviewButton.current?.focus());
          }}
        />
      )}
    </PageShell>
  );
}
