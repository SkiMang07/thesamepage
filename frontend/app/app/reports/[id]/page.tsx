"use client";

// ---------------------------------------------------------------------------
// Relationship Desk (/app/reports/[id]) — understanding and supporting one
// person over time. Selected design: docs/design-proposals/
// 2026-09-25-relationship-continuity/ (prototype.html is the visual reference).
//
//   Identity, then four views: Relationship (default) / Work / Growth /
//   Private notes.
//   Relationship: the last reviewed conversation connected to the next one,
//   a capture field directly below, follow-through grouped by owner beside
//   it, compact work/growth previews, and a searchable timeline of past
//   conversations. After a reviewed log, a receipt of what was saved.
//
// Preparing, running, logging and scheduling a 1:1 stay on the canonical
// /prep and /log workspaces; this page previews and hands off. Capture notes
// are temporary inputs to the next preparation. Private notes are persistent,
// manager-only records and never flow into prep automatically. Nothing on
// this page is shared with the person.
// ---------------------------------------------------------------------------

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useDrawer } from "@/lib/drawer-context";
import {
  getDirectReport,
  getOneOnOneHistory,
  getCommitments,
  getGoals,
  getProjects,
  getCapacityProfile,
  getCapacitySettings,
  getCapacityOverview,
  getTimeOff,
  setCapacityProfile,
  createTimeOff,
  deleteTimeOff,
  updateCommitment,
  getScorecard,
  getProfile,
  assignReportCadence,
  assignReportRole,
  getRoleFamilies,
  getRoleLevels,
  getOrgUnits,
  getDevelopmentPlan,
  getCaptureNotes,
  createCaptureNote,
  deleteCaptureNote,
  DirectReport,
  OneOnOne,
  Commitment,
  Goal,
  Project,
  CapacitySettings,
  CapacityOverviewItem,
  TimeOffEntry,
  TimeOffType,
  Scorecard,
  RoleFamily,
  RoleLevel,
  OrgUnit,
  DevelopmentBundle,
  CaptureNote,
} from "@/lib/api";
import PageShell from "@/components/PageShell";
import { GroupedRoleSelect, orgUnitLabel, roleLabel } from "@/components/RolePicker";
import { BTN_SECONDARY, EYEBROW } from "@/lib/tokens";
import { deriveOneOnOneSuggestions } from "@/lib/one-on-one-workspace";
import { PageSkeleton } from "@/components/Skeleton";
import PartialLoadNotice from "@/components/PartialLoadNotice";
import { createSectionLoader } from "@/lib/sectionLoader";
import PersonAvatar from "@/components/team/PersonAvatar";
import { addDaysStr, localDateStr } from "@/components/team/dates";
import { takeOneOnOneReceipt, type OneOnOneReceiptStash } from "@/lib/one-on-one-receipt";
import ConversationPanel from "@/components/relationship/ConversationPanel";
import CaptureBox from "@/components/relationship/CaptureBox";
import FollowThrough from "@/components/relationship/FollowThrough";
import PastConversations from "@/components/relationship/PastConversations";
import OneOnOneReceipt, { type ReceiptView } from "@/components/relationship/OneOnOneReceipt";
import { DeskPreviews, WorkView } from "@/components/relationship/WorkViews";
import {
  cadenceTruth,
  commitmentsFromSession,
  firstName,
  recordedWorkUpdates,
  sessionDate,
  updatesSince,
} from "@/components/relationship/desk";
import { AssessmentCard, DevelopmentSection, ExpectationChips, SettingsDrawer } from "./person-sections";

type View = "relationship" | "work" | "growth" | "private";
const VIEWS: [View, string][] = [
  ["relationship", "Relationship"],
  ["work", "Work"],
  ["growth", "Growth"],
  ["private", "Private notes"],
];

// Section labels, shared by the loader and the per-section failure checks.
const S = {
  history: "1:1 history",
  commitments: "commitments",
  goals: "goals",
  projects: "projects",
  capacity: "capacity",
  capacityDefaults: "capacity defaults",
  capacityWeek: "this week's capacity",
  timeOff: "time off",
  assessments: "assessments",
  cadence: "your 1:1 cadence default",
  roleLevels: "role levels",
  roleFamilies: "role families",
  teams: "teams",
  development: "development plan",
  captures: "capture notes",
} as const;

export default function ReportDetailPage() {
  // useSearchParams (for ?logged=) needs a Suspense boundary.
  return (
    <Suspense fallback={<PageSkeleton label="Loading this person" variant="columns" maxWidth="7xl" />}>
      <RelationshipDesk />
    </Suspense>
  );
}

function RelationshipDesk() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const loggedId = searchParams.get("logged");
  const reconciledParam = searchParams.get("reconciled") === "1";
  const { setPageContext, isOpen: scribeOpen } = useDrawer();

  const [report, setReport] = useState<DirectReport | null>(null);
  const [history, setHistory] = useState<OneOnOne[]>([]);
  const [commitments, setCommitments] = useState<Commitment[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [commitmentError, setCommitmentError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Person settings drawer — cadence, capacity, time off.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [capacitySettings, setCapacitySettings] = useState<CapacitySettings | null>(null);
  const [contractedHours, setContractedHours] = useState<string>("");
  const [utilizationPct, setUtilizationPct] = useState<string>("");
  const [offDaysPerYear, setOffDaysPerYear] = useState<string>("");
  const [savingCapacity, setSavingCapacity] = useState(false);
  const [capacitySaved, setCapacitySaved] = useState(false);
  const [timeOff, setTimeOff] = useState<TimeOffEntry[]>([]);
  const [addingTimeOff, setAddingTimeOff] = useState(false);
  const [toStart, setToStart] = useState("");
  const [toEnd, setToEnd] = useState("");
  const [toType, setToType] = useState<TimeOffType>("pto");
  const [capacityOverview, setCapacityOverview] = useState<CapacityOverviewItem[]>([]);
  const [orgCadenceDays, setOrgCadenceDays] = useState<number>(21);
  const [cadenceDays, setCadenceDays] = useState<string>("");
  const [savingCadence, setSavingCadence] = useState(false);
  const [cadenceSaved, setCadenceSaved] = useState(false);

  // Growth — assessment summary (scored on its own page), development, and
  // expectations with inline role assignment.
  const [scorecard, setScorecard] = useState<Scorecard | null>(null);
  const [devBundle, setDevBundle] = useState<DevelopmentBundle | null>(null);
  const [roleLevels, setRoleLevels] = useState<RoleLevel[]>([]);
  const [roleFamilies, setRoleFamilies] = useState<RoleFamily[]>([]);
  const [assigningRole, setAssigningRole] = useState(false);
  const [orgUnits, setOrgUnits] = useState<OrgUnit[]>([]);

  // Capture notes — the next preparation's inbox; /prep consumes them.
  const [captures, setCaptures] = useState<CaptureNote[]>([]);
  const [removingCaptureId, setRemovingCaptureId] = useState<string | null>(null);

  const [loadFailures, setLoadFailures] = useState<string[]>([]);
  const [view, setView] = useState<View>("relationship");
  const [openConversationId, setOpenConversationId] = useState<string | null>(null);
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);

  // Receipt for a just-confirmed log (see lib/one-on-one-receipt.ts).
  const [receipt, setReceipt] = useState<ReceiptView | null>(null);
  const [receiptRefreshFailed, setReceiptRefreshFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const stashRef = useRef<OneOnOneReceiptStash | null>(null);
  const stashTakenRef = useRef(false);
  const receiptHeadingFocused = useRef<string | null>(null);
  const [loadedVersion, setLoadedVersion] = useState(0);

  useEffect(() => {
    return () => setPageContext(null);
  }, [setPageContext]);

  // Every section loads independently; only the person is essential.
  const loadAll = useCallback(async () => {
    const today = localDateStr();
    const weekEnd = addDaysStr(today, 6);
    const { optional, failed } = createSectionLoader();
    const [dr, h, c, g, p, cp, cs, cov, to, sc, prof, rls, rfs, ous, dev, caps] = await Promise.all([
      getDirectReport(id),
      optional(S.history, getOneOnOneHistory(id), []),
      optional(S.commitments, getCommitments({ directReportId: id }), []),
      optional(S.goals, getGoals({ directReportId: id }), []),
      optional(S.projects, getProjects({ directReportId: id }), []),
      optional(S.capacity, getCapacityProfile(id), null),
      optional(S.capacityDefaults, getCapacitySettings(), null),
      optional(S.capacityWeek, getCapacityOverview(today, weekEnd), []),
      optional(S.timeOff, getTimeOff(id), []),
      optional(S.assessments, getScorecard(id), null),
      optional(S.cadence, getProfile(), null),
      optional(S.roleLevels, getRoleLevels(), []),
      optional(S.roleFamilies, getRoleFamilies(), []),
      optional(S.teams, getOrgUnits(), []),
      optional(S.development, getDevelopmentPlan(id), null),
      optional(S.captures, getCaptureNotes(id), []),
    ]);
    return { dr, h, c, g, p, cp, cs, cov, to, sc, prof, rls, rfs, ous, dev, caps, failures: failed() };
  }, [id]);

  type Loaded = Awaited<ReturnType<typeof loadAll>>;

  const applyLoaded = useCallback(
    (data: Loaded) => {
      const { dr, h, c, g, p, cp, cs, cov, to, sc, prof, rls, rfs, ous, dev, caps, failures } = data;
      setReport(dr);
      setPageContext({ label: `${dr.name}'s direct report page`, entity_type: "direct_report", entity_id: dr.id });
      setHistory(h);
      setCommitments(c);
      setGoals(g);
      setProjects(p);
      if (cp) {
        setContractedHours(cp.contracted_hours_per_week?.toString() ?? "");
        setUtilizationPct(cp.target_utilization_pct?.toString() ?? "");
        setOffDaysPerYear(cp.off_days_per_year?.toString() ?? "");
      }
      setCapacitySettings(cs);
      setCapacityOverview(cov);
      setTimeOff(to);
      setScorecard(sc);
      if (prof) setOrgCadenceDays(prof.one_on_one_cadence_days);
      setCadenceDays(dr.one_on_one_cadence_days != null ? String(dr.one_on_one_cadence_days) : "");
      setRoleLevels(rls);
      setRoleFamilies(rfs);
      setOrgUnits(ous);
      setDevBundle(dev);
      setCaptures(caps);
      setLoadFailures(failures);
    },
    [setPageContext]
  );

  useEffect(() => {
    let cancelled = false;
    loadAll()
      .then((data) => {
        if (cancelled) return;
        applyLoaded(data);
        setLoadedVersion((v) => v + 1);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Couldn't load this person."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [loadAll, applyLoaded]);

  // Receipt reconciliation: shown only for a meeting this manager's own
  // history contains as completed. The stashed save response (when we just
  // navigated from the review) supplies the confirmed topics and the exact
  // saved rows; otherwise the receipt is rebuilt from persisted records.
  useEffect(() => {
    if (loadedVersion === 0) return;
    if (!loggedId) {
      setReceipt(null);
      return;
    }
    if (!stashTakenRef.current) {
      stashTakenRef.current = true;
      stashRef.current = takeOneOnOneReceipt(id, loggedId);
    }
    const stash = stashRef.current;
    const historyFailed = loadFailures.includes(S.history);
    const recorded = history.find((s) => s.id === loggedId && s.status === "completed");
    if (stash && (recorded || historyFailed)) {
      setReceipt({
        meeting: stash.meeting,
        // An older backend (mid-deploy) returns no saved rows or topics:
        // fall back to the linked records and "not recorded" rather than break.
        commitments: stash.commitments ?? commitmentsFromSession(commitments, stash.meeting.id),
        carried: stash.carry_forward_items ?? null,
        next: stash.next_session,
        reconciled: false,
      });
    } else if (recorded && recorded.id === history.find((s) => s.status === "completed")?.id) {
      // Rebuilt only for the latest conversation: its successor is the
      // current unfinished occurrence. For an older one the records can't
      // say what that save produced, so no receipt is shown.
      setReceipt({
        meeting: recorded,
        commitments: commitmentsFromSession(commitments, recorded.id),
        carried: null,
        next: history.find((s) => s.status !== "completed") ?? null,
        reconciled: reconciledParam,
      });
    } else {
      // Nothing this manager can verify: no receipt, and drop the param.
      setReceipt(null);
      if (!historyFailed) router.replace(`/app/reports/${id}`, { scroll: false });
      return;
    }
    setReceiptRefreshFailed(historyFailed || loadFailures.includes(S.commitments));
  }, [loadedVersion, loggedId, reconciledParam, id, history, commitments, loadFailures, router]);

  // Retry the reads after a save whose refresh failed — never the write.
  async function retryRefresh() {
    setRefreshing(true);
    try {
      const data = await loadAll();
      applyLoaded(data);
      setLoadedVersion((v) => v + 1);
    } catch {
      setReceiptRefreshFailed(true);
    } finally {
      setRefreshing(false);
    }
  }

  // Move focus to a new receipt once, so it is announced and in view.
  useEffect(() => {
    if (!receipt || receiptHeadingFocused.current === receipt.meeting.id) return;
    receiptHeadingFocused.current = receipt.meeting.id;
    requestAnimationFrame(() => document.getElementById("receipt-heading")?.focus());
  }, [receipt]);

  // Scroll to a conversation opened from a receipt or commitment source.
  useEffect(() => {
    if (!scrollTarget) return;
    const frame = requestAnimationFrame(() => {
      const el = document.getElementById(`conversation-${scrollTarget}`);
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      el?.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
      el?.querySelector<HTMLButtonElement>("button[aria-expanded]")?.focus({ preventScroll: true });
      setScrollTarget(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [scrollTarget]);

  function openConversation(sessionId: string) {
    setView("relationship");
    setOpenConversationId(sessionId);
    setScrollTarget(sessionId);
  }

  function dismissReceipt() {
    setReceipt(null);
    stashRef.current = null;
    router.replace(`/app/reports/${id}`, { scroll: false });
  }

  function showCommitments() {
    const heading = document.getElementById("follow-through-heading");
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    heading?.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
    heading?.focus({ preventScroll: true });
  }

  async function refreshDevBundle() {
    const fresh = await getDevelopmentPlan(id);
    setDevBundle(fresh);
    return fresh;
  }

  async function assignRole(roleLevelId: string) {
    if (!report || assigningRole) return;
    setAssigningRole(true);
    try {
      await assignReportRole(report.id, report, roleLevelId || null);
      setReport(await getDirectReport(report.id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to assign role");
    } finally {
      setAssigningRole(false);
    }
  }

  async function saveCadence(e: React.FormEvent) {
    e.preventDefault();
    if (!report) return;
    setSavingCadence(true);
    setCadenceSaved(false);
    try {
      const parsed = cadenceDays.trim() ? parseInt(cadenceDays, 10) : null;
      const updated = await assignReportCadence(id, report, parsed);
      setReport(updated);
      setCadenceDays(updated.one_on_one_cadence_days != null ? String(updated.one_on_one_cadence_days) : "");
      setCadenceSaved(true);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save 1:1 cadence");
    } finally {
      setSavingCadence(false);
    }
  }

  async function saveCapacityProfile(e: React.FormEvent) {
    e.preventDefault();
    setSavingCapacity(true);
    setCapacitySaved(false);
    try {
      await setCapacityProfile(id, {
        contracted_hours_per_week: contractedHours.trim() ? parseFloat(contractedHours) : null,
        target_utilization_pct: utilizationPct.trim() ? parseFloat(utilizationPct) : null,
        off_days_per_year: offDaysPerYear.trim() ? parseFloat(offDaysPerYear) : null,
      });
      setCapacitySaved(true);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save capacity");
    } finally {
      setSavingCapacity(false);
    }
  }

  async function addTimeOff(e: React.FormEvent) {
    e.preventDefault();
    if (!toStart || !toEnd || addingTimeOff) return;
    setAddingTimeOff(true);
    try {
      const created = await createTimeOff({ direct_report_id: id, start_date: toStart, end_date: toEnd, type: toType });
      setTimeOff((ts) => [created, ...ts]);
      setToStart("");
      setToEnd("");
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add time off");
    } finally {
      setAddingTimeOff(false);
    }
  }

  async function removeTimeOff(entryId: string) {
    try {
      await deleteTimeOff(entryId);
      setTimeOff((ts) => ts.filter((t) => t.id !== entryId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove time off");
    }
  }

  async function setStatus(commitmentId: string, status: Commitment["status"]): Promise<boolean> {
    setUpdatingId(commitmentId);
    setCommitmentError(null);
    try {
      const updated = await updateCommitment(commitmentId, status);
      setCommitments((cs) => cs.map((c) => (c.id === commitmentId ? { ...c, ...updated } : c)));
      return true;
    } catch {
      setCommitmentError("Couldn't update that commitment, so nothing changed. Try again.");
      return false;
    } finally {
      setUpdatingId(null);
    }
  }

  async function saveCapture(content: string) {
    const created = await createCaptureNote(id, content);
    setCaptures((cs) => [created, ...cs]);
  }

  async function removeCapture(captureId: string) {
    setRemovingCaptureId(captureId);
    try {
      await deleteCaptureNote(captureId);
      setCaptures((cs) => cs.filter((c) => c.id !== captureId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove that kept thought");
    } finally {
      setRemovingCaptureId(null);
    }
  }

  function onTabKey(e: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const keys: Record<string, number> = {
      ArrowRight: (index + 1) % VIEWS.length,
      ArrowLeft: (index - 1 + VIEWS.length) % VIEWS.length,
      Home: 0,
      End: VIEWS.length - 1,
    };
    if (!(e.key in keys)) return;
    e.preventDefault();
    const next = VIEWS[keys[e.key]][0];
    setView(next);
    document.getElementById(`desk-tab-${next}`)?.focus();
  }

  if (loading && !report) return <PageSkeleton label="Loading this person" variant="columns" maxWidth="7xl" />;
  if (error && !report) return <p className="p-8 text-red-700">{error}</p>;
  if (!report) return null;

  const first = firstName(report.name);
  const failed = (label: string) => loadFailures.includes(label);
  const completed = history.filter((s) => s.status === "completed");
  const lastCompleted = completed[0] ?? null;
  // The single unfinished next occurrence (gathering, scheduled or planned).
  const nextSession = history.find((s) => s.status !== "completed") ?? null;
  const openCount = commitments.filter((c) => c.status === "open").length;

  const customCadence = cadenceDays.trim() !== "";
  const resolvedCadence = customCadence ? parseInt(cadenceDays, 10) : orgCadenceDays;
  const cadence = cadenceTruth(sessionDate(lastCompleted), resolvedCadence, customCadence);

  const workUpdates = recordedWorkUpdates(goals, projects);
  const workSince = updatesSince(workUpdates, sessionDate(lastCompleted));
  const signals = deriveOneOnOneSuggestions({ goals, planText: devBundle?.development_plan.plan_text });

  const roleLevel = roleLevels.find((r) => r.id === report.role_level_id);
  const orgUnit = orgUnits.find((u) => u.id === report.org_unit_id);
  const capacityItem = capacityOverview.find((c) => c.direct_report_id === id);

  const twoColumn = scribeOpen
    ? "min-[1400px]:grid-cols-[minmax(0,1.6fr)_minmax(17rem,1fr)]"
    : "lg:grid-cols-[minmax(0,1.6fr)_minmax(17rem,1fr)]";

  return (
    <PageShell maxWidth="7xl">
      <div className="flex items-center justify-between text-xs">
        <Link href="/app/team" className="text-brand hover:text-brand-hover">← Team</Link>
        <span className="text-ink-muted">Relationship Desk</span>
      </div>

      {/* Identity */}
      <header className="mt-6 flex flex-wrap items-start justify-between gap-5">
        <div className="flex min-w-0 items-center gap-4">
          <PersonAvatar id={report.id} name={report.name} size="xl" />
          <div className="min-w-0">
            <h1 className="break-words font-serif text-[2.1rem] font-normal leading-[1.1] tracking-[-0.02em] text-ink sm:text-[2.75rem]">
              {report.name}
            </h1>
            <p className="mt-1.5 text-sm text-ink-secondary">
              {roleLevel ? roleLabel(roleLevel) : report.role_title ?? "No role assigned"}
              {orgUnit && ` · ${orgUnitLabel(orgUnit)}`}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button type="button" onClick={() => setSettingsOpen(true)} className={BTN_SECONDARY}>
            Person settings
          </button>
          <Link href={`/app/reports/${id}/log`} className={BTN_SECONDARY}>
            Log a 1:1
          </Link>
        </div>
      </header>
      {report.notes && <p className="mt-3 max-w-3xl whitespace-pre-wrap text-sm text-ink-secondary">{report.notes}</p>}
      <p className="mt-3 text-xs text-ink-muted">
        Only you can see this page. Saving here doesn&apos;t send anything to {first}.
      </p>

      {error && <p className="mt-4 text-sm text-red-700" role="alert">{error}</p>}
      <PartialLoadNotice failed={loadFailures} className="mt-4" />

      {/* Views */}
      <div role="tablist" aria-label={`${first}'s Relationship Desk`} className="mt-7 flex gap-6 overflow-x-auto border-b border-hairline sm:gap-7">
        {VIEWS.map(([value, label], index) => (
          <button
            key={value}
            id={`desk-tab-${value}`}
            type="button"
            role="tab"
            aria-selected={view === value}
            aria-controls={`desk-panel-${value}`}
            tabIndex={view === value ? 0 : -1}
            onClick={() => setView(value)}
            onKeyDown={(e) => onTabKey(e, index)}
            className={`-mb-px shrink-0 whitespace-nowrap border-b-2 py-3 text-sm transition-colors motion-reduce:transition-none ${
              view === value ? "border-brand text-brand" : "border-transparent text-ink-secondary hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Relationship */}
      <div id="desk-panel-relationship" role="tabpanel" aria-labelledby="desk-tab-relationship" hidden={view !== "relationship"} className="pt-7">
        {receipt && (
          <OneOnOneReceipt
            receipt={receipt}
            personId={id}
            personName={report.name}
            refreshFailed={receiptRefreshFailed}
            retrying={refreshing}
            onRetryRefresh={retryRefresh}
            onDismiss={dismissReceipt}
            onViewConversation={() => openConversation(receipt.meeting.id)}
          />
        )}

        <div className={`grid gap-9 ${twoColumn}`}>
          <div className="min-w-0">
            <ConversationPanel
              personId={id}
              personFirstName={first}
              lastCompleted={lastCompleted}
              historyFailed={failed(S.history)}
              next={nextSession}
              cadence={cadence}
              captures={captures}
              capturesFailed={failed(S.captures)}
              onRemoveCapture={removeCapture}
              removingCaptureId={removingCaptureId}
              workUpdates={workUpdates}
              workSince={workSince}
              workFailed={failed(S.goals) || failed(S.projects)}
              signals={signals}
              openCommitmentCount={openCount}
              commitmentsFailed={failed(S.commitments)}
              onReadLastSummary={() => lastCompleted && openConversation(lastCompleted.id)}
              onShowCommitments={showCommitments}
            />
            <CaptureBox personFirstName={first} onSave={saveCapture} />
          </div>
          <div className="min-w-0">
            <FollowThrough
              personId={id}
              personName={report.name}
              commitments={commitments}
              completedSessions={completed}
              failed={failed(S.commitments)}
              historyFailed={failed(S.history)}
              updatingId={updatingId}
              error={commitmentError}
              onSetStatus={setStatus}
              onOpenConversation={openConversation}
            />
          </div>
        </div>

        <div className="mt-10">
          <DeskPreviews
            personName={report.name}
            goals={goals}
            projects={projects}
            workFailed={failed(S.goals) || failed(S.projects)}
            development={devBundle}
            developmentFailed={failed(S.development)}
            onOpenWork={() => setView("work")}
            onOpenGrowth={() => setView("growth")}
          />
          <PastConversations
            sessions={completed}
            commitments={commitments}
            commitmentsFailed={failed(S.commitments)}
            personName={report.name}
            openId={openConversationId}
            onToggle={setOpenConversationId}
            failed={failed(S.history)}
          />
        </div>
      </div>

      {/* Work */}
      <div id="desk-panel-work" role="tabpanel" aria-labelledby="desk-tab-work" hidden={view !== "work"} className="pt-7">
        <WorkView
          personName={report.name}
          goals={goals}
          projects={projects}
          goalsFailed={failed(S.goals)}
          projectsFailed={failed(S.projects)}
          capacity={capacityItem}
          capacityFailed={failed(S.capacityWeek)}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      </div>

      {/* Growth — assessment summary, development, expectations */}
      <div id="desk-panel-growth" role="tabpanel" aria-labelledby="desk-tab-growth" hidden={view !== "growth"} className="pt-7">
        <div className="grid gap-5 lg:grid-cols-2">
          <AssessmentCard scorecard={scorecard} reportId={id} hasExpectations={!!report.expectations} />
          {devBundle ? (
            <DevelopmentSection section="growth" directReportId={id} reportName={report.name} bundle={devBundle} onRefresh={refreshDevBundle} />
          ) : (
            <p className="rounded-xl border border-hairline bg-surface px-4 py-4 text-sm text-amber-700">
              Development couldn&apos;t load. Refresh to try again.
            </p>
          )}
          <div className="rounded-xl border border-hairline bg-surface px-4 py-4 lg:col-span-2">
            <p className={EYEBROW}>Expectations</p>
            {report.expectations ? (
              <>
                <p className="mt-1.5 text-xs text-ink-secondary">
                  {report.expectations.role_level.job_role} · Level {report.expectations.role_level.job_level}
                </p>
                {report.expectations.metrics.length + report.expectations.skills.length + report.expectations.values.length === 0 ? (
                  <p className="mt-3 text-sm text-ink-muted">
                    No expectations configured for this role yet.{" "}
                    <Link href="/app/settings?section=roles" className="underline hover:text-ink-secondary">
                      Add them in Settings
                    </Link>
                    .
                  </p>
                ) : (
                  <div className="mt-3 space-y-2.5">
                    <ExpectationChips label="Metrics" items={report.expectations.metrics} />
                    <ExpectationChips label="Skills" items={report.expectations.skills} />
                    <ExpectationChips label="Values" items={report.expectations.values} />
                  </div>
                )}
              </>
            ) : (
              <div className="mt-2">
                <p className="text-sm text-amber-700">No role assigned.</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <GroupedRoleSelect
                    roleLevels={roleLevels}
                    roleFamilies={roleFamilies}
                    value=""
                    onChange={assignRole}
                    className="w-56 rounded-md border border-control px-2.5 py-1.5 text-xs disabled:opacity-50"
                    placeholder={assigningRole ? "Assigning..." : "Assign a role…"}
                  />
                  {report.role_title && <span className="text-xs text-ink-muted">was: &quot;{report.role_title}&quot;</span>}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Private notes — the manager's append-only notebook */}
      <div id="desk-panel-private" role="tabpanel" aria-labelledby="desk-tab-private" hidden={view !== "private"} className="pt-7">
        {devBundle ? (
          <DevelopmentSection section="notes" directReportId={id} reportName={report.name} bundle={devBundle} onRefresh={refreshDevBundle} />
        ) : (
          <p className="text-sm text-amber-700">Private notes couldn&apos;t load. Refresh to try again.</p>
        )}
      </div>

      {settingsOpen && (
        <SettingsDrawer
          onClose={() => setSettingsOpen(false)}
          orgCadenceDays={orgCadenceDays}
          cadenceDays={cadenceDays}
          setCadenceDays={setCadenceDays}
          savingCadence={savingCadence}
          cadenceSaved={cadenceSaved}
          saveCadence={saveCadence}
          capacitySettings={capacitySettings}
          contractedHours={contractedHours}
          setContractedHours={setContractedHours}
          utilizationPct={utilizationPct}
          setUtilizationPct={setUtilizationPct}
          offDaysPerYear={offDaysPerYear}
          setOffDaysPerYear={setOffDaysPerYear}
          savingCapacity={savingCapacity}
          capacitySaved={capacitySaved}
          saveCapacityProfile={saveCapacityProfile}
          timeOff={timeOff}
          toStart={toStart}
          setToStart={setToStart}
          toEnd={toEnd}
          setToEnd={setToEnd}
          toType={toType}
          setToType={setToType}
          addingTimeOff={addingTimeOff}
          addTimeOff={addTimeOff}
          removeTimeOff={removeTimeOff}
        />
      )}
    </PageShell>
  );
}
