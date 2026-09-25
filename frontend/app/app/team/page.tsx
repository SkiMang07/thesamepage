"use client";

// ---------------------------------------------------------------------------
// /app/team — the team as a unit: prepare and run collective conversations,
// see shared work and who owns it, and carry decisions into follow-through.
//
// Composition (selected 2026-09-25, docs/design-proposals/2026-09-25-team-
// overview/): an editorial heading with the selected scope, the manager-only
// line and the people up front; in-page links; the team meeting card beside
// quiet Must-knows and Training focus; Shared work beside Commitments; then
// the full roster. docs/systems/team.md is the current-state reference.
//
// Everything is manager-only. Nothing here is sent to or visible to reports.
//
// Scope: which records belong to the selected team is decided in one place,
// components/team/scope.ts, shared with the meeting screen. Switching team
// filters data already on the page — no refetch.
//
// Layout is measured, not viewport-based: the Scribe drawer narrows the
// content column without changing the viewport, so the page reflows to the
// width it actually has (same approach as Mission Control).
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  DirectReport,
  OrgUnit,
  Project,
  RoleLevel,
  SetupStatus,
  TeamCallout,
  TeamCommitment,
  TeamDevFocus,
  TeamGoal,
  TeamMeeting,
  TeamMember,
  getDirectReports,
  getLedOrgUnits,
  getOrgUnits,
  getProjects,
  getRoleLevels,
  getSetupStatus,
  getTeam,
  getTeamCallout,
  getTeamCommitments,
  getTeamDevFocus,
  getTeamGoals,
  getTeamMeetings,
} from "@/lib/api";
import PageShell from "@/components/PageShell";
import { Icon } from "@/components/ZoneMap";
import { ELEVATED } from "@/lib/tokens";
import { SkeletonSection } from "@/components/Skeleton";
import PartialLoadNotice from "@/components/PartialLoadNotice";
import { createSectionLoader } from "@/lib/sectionLoader";
import PersonAvatar from "@/components/team/PersonAvatar";
import TeamMeetingsSection from "@/components/team/TeamMeetingsSection";
import TeamContext from "@/components/team/TeamContext";
import { SharedWork, TeamCommitments } from "@/components/team/TeamWork";
import TeamPeople from "@/components/team/TeamPeople";
import {
  inScopeCommitment,
  inScopeGoal,
  inScopeMeeting,
  inScopeMember,
  inScopeProject,
  makeScope,
} from "@/components/team/scope";

// Same subset Mission Control's Key Initiatives card uses — "what's
// currently happening". Completed and cancelled work stays on /app/projects.
const ACTIVE_STATUSES = new Set(["active", "on_track", "at_risk"]);

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

// Content-width tiers. "wide" ≈ a desktop with the rail; "medium" ≈ 1024px or
// a wide screen with Scribe open; "split" keeps the meeting beside its
// context but stacks work over commitments; "stack" is one column.
type Tier = "wide" | "medium" | "split" | "stack";
function tierFor(width: number): Tier {
  if (width >= 1000) return "wide";
  if (width >= 740) return "medium";
  if (width >= 600) return "split";
  return "stack";
}

export default function TeamPage() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [goals, setGoals] = useState<TeamGoal[]>([]);
  const [meetings, setMeetings] = useState<TeamMeeting[]>([]);
  const [commitments, setCommitments] = useState<TeamCommitment[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [callouts, setCallouts] = useState<TeamCallout[]>([]);
  const [devFocuses, setDevFocuses] = useState<TeamDevFocus[]>([]);
  const [directReports, setDirectReports] = useState<DirectReport[]>([]);
  const [roleLevels, setRoleLevels] = useState<RoleLevel[]>([]);
  const [orgUnits, setOrgUnits] = useState<OrgUnit[]>([]);
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);
  const [ledOrgUnits, setLedOrgUnits] = useState<OrgUnit[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailures, setLoadFailures] = useState<string[]>([]);
  const [refreshFailed, setRefreshFailed] = useState(false);

  const [rootRef, width] = useMeasuredWidth<HTMLDivElement>();
  const tier = tierFor(width);

  useEffect(() => {
    // No single request is essential: each section degrades on its own and
    // is named in the notice (lib/sectionLoader.ts), so an empty section is
    // never passed off as "no data".
    const { optional, failed } = createSectionLoader();
    Promise.all([
      optional("team members", getTeam(), []),
      optional("goals", getTeamGoals(), []),
      optional("meetings", getTeamMeetings(), []),
      optional("team commitments", getTeamCommitments(), []),
      optional("projects", getProjects(), []),
      optional("must-knows", getTeamCallout(), []),
      optional("training focus", getTeamDevFocus(), []),
      optional("people", getDirectReports(), []),
      optional("role levels", getRoleLevels(), []),
      optional("teams", getOrgUnits(), []),
      optional("setup status", getSetupStatus(), null),
      optional("the teams you lead", getLedOrgUnits(), []),
    ])
      .then(([m, g, n, c, p, calloutRows, devFocusRows, drs, rls, ous, status, led]) => {
        setMembers(m);
        setGoals(g);
        setMeetings(n);
        setCommitments(c);
        setProjects(p.filter((proj) => ACTIVE_STATUSES.has(proj.status)));
        setCallouts(calloutRows);
        setDevFocuses(devFocusRows);
        setDirectReports(drs);
        setRoleLevels(rls);
        setOrgUnits(ous);
        setSetupStatus(status);
        setLedOrgUnits(led);
        setLoadFailures(failed());
      })
      .finally(() => setLoading(false));
  }, []);

  // Re-read the records a logged meeting changes, so counts and the receipt
  // reflect what the server holds. A failed refresh keeps what's on screen
  // (already merged from the save response) and says so.
  const refreshRecords = useCallback(async () => {
    try {
      const [n, c] = await Promise.all([getTeamMeetings(), getTeamCommitments()]);
      setMeetings(n);
      setCommitments(c);
      setRefreshFailed(false);
    } catch {
      setRefreshFailed(true);
    }
  }, []);

  const scope = makeScope(selectedTeamId, orgUnits, directReports);
  const visibleMembers = members.filter((m) => inScopeMember(scope, m));
  const visibleGoals = goals.filter((g) => inScopeGoal(scope, g));
  const visibleProjects = projects.filter((p) => inScopeProject(scope, p));
  const visibleCommitments = commitments.filter((c) => inScopeCommitment(scope, c));
  const visibleMeetings = meetings.filter((m) => inScopeMeeting(scope, m));

  const blank = (id: string | null) => ({ message: "", updated_at: null, org_unit_id: id });
  const activeCallout: TeamCallout = callouts.find((c) => c.org_unit_id === selectedTeamId) ?? blank(selectedTeamId);
  const activeDevFocus: TeamDevFocus = devFocuses.find((d) => d.org_unit_id === selectedTeamId) ?? blank(selectedTeamId);

  function upsert<T extends { org_unit_id: string | null }>(rows: T[], updated: T): T[] {
    const idx = rows.findIndex((r) => r.org_unit_id === updated.org_unit_id);
    if (idx === -1) return [...rows, updated];
    const copy = [...rows];
    copy[idx] = updated;
    return copy;
  }

  const unitName = (id: string | null) => (id ? orgUnits.find((u) => u.id === id)?.name ?? "Team" : "All teams");
  const selectedTeamName =
    selectedTeamId === null ? "All teams" : ledOrgUnits.find((u) => u.id === selectedTeamId)?.name ?? "Team";

  const prepUnavailable = loadFailures.filter((f) => ["goals", "projects", "team commitments", "meetings"].includes(f));

  const upperCols =
    tier === "wide" ? "grid-cols-[minmax(0,1fr)_280px] gap-8" : tier === "stack" ? "grid-cols-1 gap-8" : tier === "medium" ? "grid-cols-[minmax(0,1fr)_230px] gap-6" : "grid-cols-[minmax(0,1fr)_220px] gap-6";
  const workCols =
    tier === "wide" ? "grid-cols-[minmax(0,1fr)_340px] gap-8" : tier === "medium" ? "grid-cols-[minmax(0,1fr)_285px] gap-6" : "grid-cols-1 gap-8";

  return (
    <PageShell maxWidth="8xl">
      <div ref={rootRef}>
        <header>
          <p className="text-2xs font-medium uppercase tracking-[0.16em] text-ink-muted">Team</p>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
            <h1 className="min-w-0 font-serif text-[2.1rem] font-normal leading-[1.12] tracking-[-0.035em] text-ink sm:text-[2.6rem]">
              {selectedTeamName}
            </h1>
            {ledOrgUnits.length > 0 && (
              <ScopePicker
                led={ledOrgUnits}
                selectedTeamId={selectedTeamId}
                selectedName={selectedTeamName}
                onSelect={setSelectedTeamId}
              />
            )}
          </div>
          <p className="mt-2 text-xs text-ink-muted">Only you can see this page. Nothing here is shared with your team.</p>
          {!loading && visibleMembers.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-1.5">
              {visibleMembers.slice(0, 8).map((m) => (
                <span key={m.id} title={m.name}>
                  <PersonAvatar id={m.id} name={m.name} size="sm" />
                  <span className="sr-only">{m.name}</span>
                </span>
              ))}
              {visibleMembers.length > 8 && (
                <span className="inline-grid h-7 min-w-7 place-items-center rounded-full bg-sunken px-1.5 text-2xs text-ink-muted">
                  +{visibleMembers.length - 8}
                </span>
              )}
              <a href="#team-people" className="ml-2 text-xs text-brand hover:text-brand-hover">
                {visibleMembers.length} direct report{visibleMembers.length === 1 ? "" : "s"} →
              </a>
            </div>
          )}
        </header>

        <nav aria-label="On this page" className="mt-6 flex flex-wrap gap-x-6 gap-y-1 border-b border-hairline pb-3 text-xs">
          {[
            ["#team-meetings", "Meetings"],
            ["#team-work", "Shared work"],
            ["#team-commitments", "Commitments"],
            ["#team-people", "People"],
          ].map(([href, label]) => (
            <a key={href} href={href} className="py-1 text-ink-secondary hover:text-brand">
              {label}
            </a>
          ))}
        </nav>

        <PartialLoadNotice failed={loadFailures} className="mt-4" />
        {refreshFailed && (
          <p className="mt-4 text-sm text-amber-700" role="status">
            Your meeting was saved, but the page couldn&apos;t refresh. Reload to see the latest records.
          </p>
        )}

        {loading ? (
          <SkeletonSection label="Loading your team" variant="cards" className="mt-8" />
        ) : (
          <>
            <div className={`mt-8 grid ${upperCols}`}>
              <TeamMeetingsSection
                meetings={visibleMeetings}
                allMeetings={meetings}
                setMeetings={setMeetings}
                commitments={commitments}
                setCommitments={setCommitments}
                goals={goals}
                projects={projects}
                members={visibleMembers}
                directReports={directReports}
                orgUnits={orgUnits}
                selectedTeamId={selectedTeamId}
                unavailable={prepUnavailable}
                onRefresh={refreshRecords}
                narrow={tier !== "wide"}
              />
              <aside
                aria-label="Team context"
                className={tier === "stack" ? "border-t border-hairline pt-6" : "pt-1.5"}
              >
                <TeamContext
                  callout={activeCallout}
                  devFocus={activeDevFocus}
                  scopeLabel={selectedTeamName}
                  onCalloutSaved={(row) => setCallouts((rows) => upsert(rows, row))}
                  onDevFocusSaved={(row) => setDevFocuses((rows) => upsert(rows, row))}
                />
              </aside>
            </div>

            <div className={`mt-10 grid border-t border-hairline pt-8 ${workCols}`}>
              <SharedWork
                goals={visibleGoals}
                projects={visibleProjects}
                commitments={visibleCommitments}
                scope={scope}
                unitName={unitName}
              />
              <div className={tier === "wide" || tier === "medium" ? "" : "border-t border-hairline pt-8"}>
                <TeamCommitments
                  commitments={visibleCommitments}
                  setCommitments={setCommitments}
                  members={visibleMembers}
                  selectedTeamId={selectedTeamId}
                  meetings={meetings}
                  goals={goals}
                  projects={projects}
                  twoColumn={tier === "split"}
                />
              </div>
            </div>

            <div className="mt-10 border-t border-hairline pt-8">
              <TeamPeople
                members={visibleMembers}
                setMembers={setMembers}
                directReports={directReports}
                roleLevels={roleLevels}
                orgUnits={orgUnits}
                setupStatus={setupStatus}
                columns={tier === "wide" ? 3 : tier === "stack" ? 1 : 2}
              />
            </div>
          </>
        )}
      </div>
    </PageShell>
  );
}

// The scope menu: All teams (the default) plus the teams the caller leads.
function ScopePicker({
  led,
  selectedTeamId,
  selectedName,
  onSelect,
}: {
  led: OrgUnit[];
  selectedTeamId: string | null;
  selectedName: string;
  onSelect: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  return (
    <div className="relative flex items-center gap-2" ref={ref}>
      <span className="text-xs text-ink-muted" id="team-scope-label">Team scope</span>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="team-scope-menu"
        aria-labelledby="team-scope-label team-scope-value"
        className="inline-flex h-9 max-w-60 items-center gap-2 rounded-md border border-control bg-surface px-3 text-sm text-ink-body hover:border-ink-muted hover:bg-sunken hover:text-ink"
      >
        <span id="team-scope-value" className="truncate">{selectedName}</span>
        <Icon name="chevron" className={`h-4 w-4 shrink-0 text-ink-muted transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div id="team-scope-menu" role="menu" aria-label="Switch team" className={`absolute right-0 top-11 z-30 w-64 p-1.5 ${ELEVATED}`}>
          {[{ id: null as string | null, name: "All teams" }, ...led.map((u) => ({ id: u.id as string | null, name: u.name }))].map((team) => {
            const selected = team.id === selectedTeamId;
            return (
              <button
                key={team.id ?? "all"}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => {
                  onSelect(team.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm ${
                  selected ? "bg-brand-tint font-medium text-brand" : "text-ink-body hover:bg-sunken hover:text-ink"
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{team.name}</span>
                <span className={`shrink-0 ${selected ? "opacity-100" : "opacity-0"}`} aria-hidden="true">✓</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
