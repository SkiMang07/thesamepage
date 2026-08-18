"use client";

// Settings — the configuration backbone (Session 6).
// Four sections as of Session 12 (originally three from the Miro mockup
// review, 2026-08-01): Profile & Company, Roles & Levels, Team, Expectations.
// "Team" split out of Roles & Levels in Session 12 — the "who's in which
// role" list + org_unit assignment moved to their own section; Roles &
// Levels is now pure role_level CRUD (add/edit/delete role definitions).
// Session 12 also added Edit (update-in-place) for role_levels, matching
// the card-swap edit-in-place pattern from Goals (Session 10).
// Deferred: evaluation weighting, scale definitions, capacity/recruitment,
// project settings, permissions (all department-tier — see SESSION_HISTORY).

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  CapacitySettings,
  DirectReport,
  DraftMetricItem,
  DraftSkillItem,
  DraftValueItem,
  Expectation,
  ExpectationBatchItem,
  ExpectationKind,
  ExpectationsCoverage,
  OrgUnit,
  Profile,
  RoleLevel,
  WorkUnitConfig,
  assignReportOrgUnit,
  assignReportRole,
  batchCreateExpectations,
  createExpectation,
  createRoleLevel,
  deleteExpectation,
  deleteRoleLevel,
  deleteWorkUnitConfig,
  draftExpectations,
  expectationName,
  getCapacitySettings,
  getDirectReports,
  getExpectations,
  getExpectationsCoverage,
  getOrgUnits,
  getProfile,
  getRoleLevels,
  getWorkUnitConfigs,
  updateCapacitySettings,
  updateProfile,
  updateRoleLevel,
  upsertWorkUnitConfig,
} from "@/lib/api";

type SectionId = "profile" | "roles" | "team" | "expectations" | "capacity";

const SECTIONS: { id: SectionId; label: string; blurb: string }[] = [
  { id: "profile", label: "Profile & Company", blurb: "You and your company" },
  { id: "roles", label: "Roles & Levels", blurb: "The jobs on your team" },
  { id: "team", label: "Team", blurb: "Who's on which team" },
  { id: "expectations", label: "Expectations", blurb: "What good looks like" },
  { id: "capacity", label: "Capacity", blurb: "Baseline hours & utilization" },
];

const KIND_TABS: { id: ExpectationKind; label: string }[] = [
  { id: "metrics", label: "Metrics" },
  { id: "skills", label: "Skills" },
  { id: "values", label: "Values" },
];

const inputCls = "w-full rounded-md border border-gray-300 px-3 py-2 text-sm";
const labelCls = "mb-1 block text-xs font-medium text-gray-500";
const primaryBtnCls = "rounded-md bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50";

export default function SettingsPage() {
  const [section, setSection] = useState<SectionId>("profile");
  const [error, setError] = useState<string | null>(null);

  // Shared data
  const [roleLevels, setRoleLevels] = useState<RoleLevel[]>([]);
  const [reports, setReports] = useState<DirectReport[]>([]);
  const [orgUnits, setOrgUnits] = useState<OrgUnit[]>([]);

  // Expectations' selected role + kind live here, not inside
  // ExpectationsSection, so they survive switching to another section and
  // back. Previously this state lived inside ExpectationsSection itself,
  // which unmounts whenever `section` changes — every trip to another tab
  // (e.g. Team) and back reset the role picker to the first role and the
  // kind tab to Metrics. The data was never actually lost (still safely in
  // the DB, confirmed via network inspection), but landing back on the
  // first role's empty list looked exactly like data loss. Bug reported by
  // Andrew 2026-08-06 after filling out expectations for every role.
  const [expRoleLevelId, setExpRoleLevelId] = useState<string>("");
  const [expKind, setExpKind] = useState<ExpectationKind>("metrics");

  useEffect(() => {
    Promise.all([getRoleLevels(), getDirectReports(), getOrgUnits()])
      .then(([rls, drs, ous]) => {
        setRoleLevels(rls);
        setReports(drs);
        setOrgUnits(ous);
      })
      .catch((e) => setError(e.message));
  }, []);

  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <p className="mt-1 text-sm text-gray-500">
        Set up roles and expectations once — everything else builds on them.
      </p>

      {error && <p className="mt-4 text-sm text-red-500">{error}</p>}

      <div className="mt-8 flex gap-10">
        <nav className="w-48 shrink-0 space-y-1">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={`block w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                section === s.id ? "bg-gray-100 font-medium text-gray-900" : "text-gray-500 hover:bg-gray-50"
              }`}
            >
              {s.label}
              <span className="block text-xs font-normal text-gray-400">{s.blurb}</span>
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1">
          {section === "profile" && <ProfileSection onError={setError} />}
          {section === "roles" && (
            <RolesSection
              roleLevels={roleLevels}
              setRoleLevels={setRoleLevels}
              setReports={setReports}
              onError={setError}
            />
          )}
          {section === "team" && (
            <TeamSection
              reports={reports}
              setReports={setReports}
              roleLevels={roleLevels}
              orgUnits={orgUnits}
              onNavigateToRoles={() => setSection("roles")}
              onError={setError}
            />
          )}
          {section === "expectations" && (
            <ExpectationsSection
              roleLevels={roleLevels}
              roleLevelId={expRoleLevelId}
              setRoleLevelId={setExpRoleLevelId}
              kind={expKind}
              setKind={setExpKind}
              onError={setError}
            />
          )}
          {section === "capacity" && <CapacitySection roleLevels={roleLevels} onError={setError} />}
        </div>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Section 1 — Profile & Company
// ---------------------------------------------------------------------------

function ProfileSection({ onError }: { onError: (m: string | null) => void }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [fullName, setFullName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [cadenceDays, setCadenceDays] = useState(21);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getProfile()
      .then((p) => {
        setProfile(p);
        setFullName(p.full_name);
        setCompanyName(p.company_name);
        setCadenceDays(p.one_on_one_cadence_days);
      })
      .catch((e) => onError(e.message));
  }, [onError]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    try {
      const p = await updateProfile({
        full_name: fullName,
        company_name: companyName,
        one_on_one_cadence_days: cadenceDays,
      });
      setProfile(p);
      setCadenceDays(p.one_on_one_cadence_days);
      setSaved(true);
      onError(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (!profile) return <p className="text-gray-500">Loading...</p>;

  return (
    <form onSubmit={save} className="max-w-md space-y-4">
      <div>
        <label className={labelCls}>Your name</label>
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputCls} placeholder="How you sign off" />
      </div>
      <div>
        <label className={labelCls}>Email</label>
        <input value={profile.email} disabled className={`${inputCls} bg-gray-50 text-gray-400`} />
      </div>
      <div>
        <label className={labelCls}>Company</label>
        <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} className={inputCls} placeholder="Company name" />
      </div>
      <div>
        <label className={labelCls}>Default 1:1 cadence (days)</label>
        <input
          type="number"
          min={1}
          max={365}
          step={1}
          value={cadenceDays}
          onChange={(e) => setCadenceDays(parseInt(e.target.value || "21", 10))}
          className={`${inputCls} max-w-[9rem]`}
        />
        <p className="mt-1 text-xs text-gray-400">
          How often you expect to meet 1:1 with a direct report, by default. Weekly for a new hire and monthly for a
          senior IC is common — override per person on their report page.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={saving} className={primaryBtnCls}>
          {saving ? "Saving..." : "Save"}
        </button>
        {saved && <span className="text-sm text-green-600">Saved</span>}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Section 2 — Roles & Levels (role_level CRUD only, as of Session 12 —
// "who's in which role" + org_unit assignment moved to TeamSection below)
// ---------------------------------------------------------------------------

function roleLabel(rl: RoleLevel) {
  // functional_team (free text) dropped from the label as of Session 11 —
  // "which team" now lives on the direct report as a structured org_unit_id,
  // shown separately in TeamSection. The column stays in the schema, just
  // unused here.
  return `${rl.job_role} · L${rl.job_level}`;
}

function orgUnitLabel(ou: OrgUnit) {
  return `${ou.unit_type === "department" ? "Department" : "Team"} · ${ou.name}`;
}

type RoleFormValues = {
  jobRole: string;
  jobLevel: number;
  responsibilities: string;
};

// Shared by "Add role" and "Edit role" — same card-swap edit-in-place
// pattern as Goals' GoalForm (Session 10). initialRole present -> edit mode.
function RoleForm({
  initialRole,
  onCancel,
  onSubmit,
  submitLabel,
  savingLabel,
}: {
  initialRole?: RoleLevel | null;
  onCancel?: () => void;
  onSubmit: (input: RoleFormValues) => Promise<void>;
  submitLabel: string;
  savingLabel: string;
}) {
  const [jobRole, setJobRole] = useState(initialRole?.job_role ?? "");
  const [jobLevel, setJobLevel] = useState(initialRole?.job_level ?? 1);
  const [responsibilities, setResponsibilities] = useState(initialRole?.job_responsibilities ?? "");
  const [saving, setSaving] = useState(false);
  const isEdit = !!initialRole;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!jobRole.trim() || saving) return;
    setSaving(true);
    try {
      await onSubmit({ jobRole: jobRole.trim(), jobLevel, responsibilities: responsibilities.trim() });
      if (!isEdit) {
        setJobRole("");
        setResponsibilities("");
        setJobLevel(1);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-3 rounded-lg border border-dashed border-gray-300 p-4">
      <div className="flex gap-3">
        <div className="flex-1">
          <label className={labelCls}>Role</label>
          <input value={jobRole} onChange={(e) => setJobRole(e.target.value)} className={inputCls} placeholder="e.g. Customer Success Manager" />
        </div>
        <div className="w-24">
          <label className={labelCls}>Level</label>
          <input
            type="number"
            min={1}
            max={10}
            value={jobLevel}
            onChange={(e) => setJobLevel(parseInt(e.target.value || "1", 10))}
            className={inputCls}
          />
        </div>
      </div>
      <div>
        <label className={labelCls}>Responsibilities (optional)</label>
        <textarea
          value={responsibilities}
          onChange={(e) => setResponsibilities(e.target.value)}
          rows={2}
          className={inputCls}
          placeholder="What this role owns, in a sentence or two"
        />
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={saving} className={primaryBtnCls}>
          {saving ? savingLabel : submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="text-sm text-gray-500 hover:text-gray-900">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function RolesSection({
  roleLevels,
  setRoleLevels,
  setReports,
  onError,
}: {
  roleLevels: RoleLevel[];
  setRoleLevels: React.Dispatch<React.SetStateAction<RoleLevel[]>>;
  setReports: React.Dispatch<React.SetStateAction<DirectReport[]>>;
  onError: (m: string | null) => void;
}) {
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);

  async function addRole(input: RoleFormValues) {
    try {
      const created = await createRoleLevel({
        job_role: input.jobRole,
        job_level: input.jobLevel,
        job_responsibilities: input.responsibilities || undefined,
      });
      setRoleLevels((r) => [...r, created]);
      onError(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to add role");
    }
  }

  // Takes the full role, not just its id, so the PUT (which replaces the
  // whole role_levels row server-side) can carry the existing
  // functional_team through unchanged. RoleForm doesn't expose that field
  // (deprecated in favor of org_unit_id since Session 11), so without this
  // an edit would silently null it out for any role that still has one set
  // from before Session 11 — same "read, tweak one field, PUT the whole
  // record" preservation pattern as assignReportRole/assignReportOrgUnit.
  async function saveEdit(role: RoleLevel, input: RoleFormValues) {
    try {
      const updated = await updateRoleLevel(role.id, {
        job_role: input.jobRole,
        job_level: input.jobLevel,
        job_responsibilities: input.responsibilities || undefined,
        functional_team: role.functional_team ?? undefined,
      });
      setRoleLevels((r) => r.map((x) => (x.id === role.id ? updated : x)));
      onError(null);
      setEditingRoleId(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to save role");
    }
  }

  async function removeRole(id: string) {
    try {
      await deleteRoleLevel(id);
      setRoleLevels((r) => r.filter((x) => x.id !== id));
      // Mirrors the backend's own cascade (delete_role_level nulls
      // direct_reports.role_level_id server-side) so the Team section's
      // already-loaded `reports` state doesn't show a stale role pointing
      // at a role_level that no longer exists until the next full reload.
      setReports((rs) => rs.map((r) => (r.role_level_id === id ? { ...r, role_level_id: null } : r)));
      setEditingRoleId((current) => (current === id ? null : current));
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to delete role");
    }
  }

  return (
    <div>
      <h2 className="font-medium text-gray-900">Roles on your team</h2>
      <p className="mt-1 text-sm text-gray-500">
        A role + level is the anchor everything else attaches to — expectations now, ratings later. Assigning
        people to roles and teams now lives in <span className="font-medium text-gray-700">Team</span>.
      </p>

      <ul className="mt-4 space-y-2">
        {roleLevels.map((rl) =>
          rl.id === editingRoleId ? (
            <li key={rl.id}>
              <RoleForm
                initialRole={rl}
                onCancel={() => setEditingRoleId(null)}
                onSubmit={(input) => saveEdit(rl, input)}
                submitLabel="Save changes"
                savingLabel="Saving..."
              />
            </li>
          ) : (
            <li key={rl.id} className="flex items-start justify-between gap-4 rounded-lg border border-gray-200 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900">{roleLabel(rl)}</p>
                {rl.job_responsibilities && (
                  <p className="mt-1 text-xs text-gray-500">{rl.job_responsibilities}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <button
                  onClick={() => setEditingRoleId(rl.id)}
                  className="text-xs text-gray-400 hover:text-gray-700"
                  title="Edit role"
                >
                  Edit
                </button>
                <button onClick={() => removeRole(rl.id)} className="text-xs text-gray-400 hover:text-red-500" title="Delete role">
                  Remove
                </button>
              </div>
            </li>
          )
        )}
        {roleLevels.length === 0 && (
          <p className="py-2 text-sm text-gray-500">No roles yet. Add the first role on your team below.</p>
        )}
      </ul>

      <RoleForm onSubmit={addRole} submitLabel="Add role" savingLabel="Adding..." />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section — Team (Session 12): "who's in which role" + org_unit assignment,
// split out of Roles & Levels so that section can stay pure role_level CRUD.
// ---------------------------------------------------------------------------

function TeamSection({
  reports,
  setReports,
  roleLevels,
  orgUnits,
  onNavigateToRoles,
  onError,
}: {
  reports: DirectReport[];
  setReports: React.Dispatch<React.SetStateAction<DirectReport[]>>;
  roleLevels: RoleLevel[];
  orgUnits: OrgUnit[];
  onNavigateToRoles: () => void;
  onError: (m: string | null) => void;
}) {
  async function assign(report: DirectReport, roleLevelId: string) {
    try {
      const updated = await assignReportRole(report.id, report, roleLevelId || null);
      setReports((rs) => rs.map((r) => (r.id === report.id ? { ...r, role_level_id: updated.role_level_id ?? (roleLevelId || null) } : r)));
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to assign role");
    }
  }

  async function assignOrgUnit(report: DirectReport, orgUnitId: string) {
    try {
      const updated = await assignReportOrgUnit(report.id, report, orgUnitId || null);
      setReports((rs) => rs.map((r) => (r.id === report.id ? { ...r, org_unit_id: updated.org_unit_id ?? (orgUnitId || null) } : r)));
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to assign team");
    }
  }

  return (
    <div>
      <h2 className="font-medium text-gray-900">Who&apos;s in which role</h2>
      <p className="mt-1 text-sm text-gray-500">
        Connect each direct report to a role (defined in{" "}
        <button onClick={onNavigateToRoles} className="underline">
          Roles &amp; Levels
        </button>
        ) so their expectations follow them, and to a team/department (set up in{" "}
        <Link href="/app/org" className="underline">
          Org
        </Link>
        ) so goals and reporting can be scoped correctly.
      </p>
      <ul className="mt-4 space-y-2">
        {reports.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-4 rounded-lg border border-gray-200 px-4 py-3">
            <div className="min-w-0 flex-1 truncate">
              <p className="truncate text-sm font-medium text-gray-900">{r.name}</p>
              {r.role_title && <p className="truncate text-xs text-gray-500">{r.role_title}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <select
                value={r.role_level_id ?? ""}
                onChange={(e) => assign(r, e.target.value)}
                className="w-48 truncate rounded-md border border-gray-300 px-2 py-1.5 text-sm"
              >
                <option value="">No role assigned</option>
                {roleLevels.map((rl) => (
                  <option key={rl.id} value={rl.id}>
                    {roleLabel(rl)}
                  </option>
                ))}
              </select>
              <select
                value={r.org_unit_id ?? ""}
                onChange={(e) => assignOrgUnit(r, e.target.value)}
                className="w-44 truncate rounded-md border border-gray-300 px-2 py-1.5 text-sm"
              >
                <option value="">No team assigned</option>
                {orgUnits.map((ou) => (
                  <option key={ou.id} value={ou.id}>
                    {orgUnitLabel(ou)}
                  </option>
                ))}
              </select>
            </div>
          </li>
        ))}
        {reports.length === 0 && (
          <p className="py-2 text-sm text-gray-500">
            No direct reports yet — add them from your <Link href="/app/dashboard" className="underline">dashboard</Link> first.
          </p>
        )}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section 3 — Expectations (metrics / skills / values per role level)
//
// Reworked Session 39 (Plan S3, docs/TEAM_SETUP_UX_REVIEW.md §6): the blind
// "pick 1 of 13 roles from a dropdown" entry point is replaced by a coverage
// grid (role x metrics/skills/values counts) — click a cell to edit that
// role+kind in the same editor as before. Each role also gets a "Draft with
// AI" button that turns its pasted job_responsibilities into a reviewable
// draft (or copies another role's existing items) before anything commits.
// ---------------------------------------------------------------------------

function ExpectationsSection({
  roleLevels,
  roleLevelId,
  setRoleLevelId,
  kind,
  setKind,
  onError,
}: {
  roleLevels: RoleLevel[];
  roleLevelId: string;
  setRoleLevelId: (id: string) => void;
  kind: ExpectationKind;
  setKind: (k: ExpectationKind) => void;
  onError: (m: string | null) => void;
}) {
  // 'grid' is the entry point (coverage overview); 'detail' is the existing
  // per-role editor. Deliberately local (not lifted like roleLevelId/kind)
  // — landing back on the grid after visiting another Settings section is
  // the desired behavior now that the grid, not the last-viewed role, is
  // the section's anchor.
  const [view, setView] = useState<"grid" | "detail">("grid");
  const [coverage, setCoverage] = useState<ExpectationsCoverage | null>(null);
  const [coverageLoading, setCoverageLoading] = useState(false);
  // Role currently being drafted/reviewed — the panel renders as an overlay
  // regardless of grid/detail view, so a draft started from the grid can
  // finish while looking at the coverage rows update live.
  const [draftingRoleId, setDraftingRoleId] = useState<string | null>(null);

  const loadCoverage = useCallback(() => {
    setCoverageLoading(true);
    getExpectationsCoverage()
      .then(setCoverage)
      .catch((e) => onError(e.message))
      .finally(() => setCoverageLoading(false));
  }, [onError]);

  useEffect(() => {
    loadCoverage();
  }, [loadCoverage]);

  function openCell(roleId: string, k: ExpectationKind) {
    setRoleLevelId(roleId);
    setKind(k);
    setView("detail");
  }

  function backToGrid() {
    setView("grid");
    loadCoverage();
  }

  if (roleLevels.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        Expectations attach to a role — set up your first role in{" "}
        <span className="font-medium text-gray-700">Roles &amp; Levels</span> and come back here.
      </p>
    );
  }

  return (
    <div>
      <h2 className="font-medium text-gray-900">What good looks like</h2>
      <p className="mt-1 text-sm text-gray-500">
        Define the metrics, skills, and values each role is measured against. Scales and weighting come later.
      </p>

      {view === "grid" || !roleLevelId ? (
        coverageLoading ? (
          <p className="mt-6 text-sm text-gray-500">Loading...</p>
        ) : (
          <CoverageGrid
            roleLevels={roleLevels}
            coverage={coverage}
            onCell={openCell}
            onDraft={(id) => setDraftingRoleId(id)}
          />
        )
      ) : (
        <ExpectationDetail
          roleLevels={roleLevels}
          roleLevelId={roleLevelId}
          setRoleLevelId={setRoleLevelId}
          kind={kind}
          setKind={setKind}
          onBack={backToGrid}
          onDraft={() => setDraftingRoleId(roleLevelId)}
          onError={onError}
        />
      )}

      {draftingRoleId && (
        <DraftReviewPanel
          roleLevelId={draftingRoleId}
          roleLevels={roleLevels}
          onClose={() => setDraftingRoleId(null)}
          onCommitted={() => {
            setDraftingRoleId(null);
            loadCoverage();
          }}
          onError={onError}
        />
      )}
    </div>
  );
}

// Coverage grid — one row per role, a count "pill" per kind (amber when
// zero) that opens the per-role editor, plus a Draft with AI shortcut.
function CoverageGrid({
  roleLevels,
  coverage,
  onCell,
  onDraft,
}: {
  roleLevels: RoleLevel[];
  coverage: ExpectationsCoverage | null;
  onCell: (roleId: string, kind: ExpectationKind) => void;
  onDraft: (roleId: string) => void;
}) {
  const countsByRole = new Map((coverage?.roles ?? []).map((r) => [r.role_level_id, r]));

  return (
    <div className="mt-4">
      {!!coverage && coverage.org_wide_values_count > 0 && (
        <p className="mb-3 rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-500">
          {coverage.org_wide_values_count} org-wide value{coverage.org_wide_values_count === 1 ? "" : "s"} apply to
          every role automatically — open any role's Values column to manage them.
        </p>
      )}
      <div className="overflow-hidden rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium text-gray-500">
              <th className="px-4 py-2">Role</th>
              <th className="px-3 py-2 text-center">Metrics</th>
              <th className="px-3 py-2 text-center">Skills</th>
              <th className="px-3 py-2 text-center">Values</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {roleLevels.map((rl) => {
              const c = countsByRole.get(rl.id);
              const cells: { kind: ExpectationKind; count: number }[] = [
                { kind: "metrics", count: c?.metrics_count ?? 0 },
                { kind: "skills", count: c?.skills_count ?? 0 },
                { kind: "values", count: c?.values_count ?? 0 },
              ];
              return (
                <tr key={rl.id} className="border-b border-gray-100 last:border-0">
                  <td className="px-4 py-2.5 font-medium text-gray-900">{roleLabel(rl)}</td>
                  {cells.map((cell) => (
                    <td key={cell.kind} className="px-3 py-2.5 text-center">
                      <button
                        onClick={() => onCell(rl.id, cell.kind)}
                        className={`min-w-[2.5rem] rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          cell.count === 0
                            ? "bg-amber-50 text-amber-700 hover:bg-amber-100"
                            : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                        }`}
                      >
                        {cell.count}
                      </button>
                    </td>
                  ))}
                  <td className="px-3 py-2.5 text-right">
                    <button onClick={() => onDraft(rl.id)} className="text-xs font-medium text-indigo-600 hover:text-indigo-800">
                      Draft with AI
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Per-role, per-kind editor — the same list + manual add form the section
// always had, now reached from a grid cell instead of being the landing
// view. Values tab also renders the org-wide values block above the list.
function ExpectationDetail({
  roleLevels,
  roleLevelId,
  setRoleLevelId,
  kind,
  setKind,
  onBack,
  onDraft,
  onError,
}: {
  roleLevels: RoleLevel[];
  roleLevelId: string;
  setRoleLevelId: (id: string) => void;
  kind: ExpectationKind;
  setKind: (k: ExpectationKind) => void;
  onBack: () => void;
  onDraft: () => void;
  onError: (m: string | null) => void;
}) {
  const [items, setItems] = useState<Expectation[]>([]);
  const [loading, setLoading] = useState(false);

  const [name, setName] = useState("");
  const [orderType, setOrderType] = useState("primary");
  const [expectation, setExpectation] = useState("");
  const [period, setPeriod] = useState("month");
  const [valueType, setValueType] = useState("company");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!roleLevelId) return;
    setLoading(true);
    getExpectations(kind, roleLevelId)
      .then(setItems)
      .catch((e) => onError(e.message))
      .finally(() => setLoading(false));
  }, [kind, roleLevelId, onError]);

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || adding || !roleLevelId) return;
    setAdding(true);
    try {
      const created = await createExpectation(kind, {
        name: name.trim(),
        role_level_id: roleLevelId,
        order_type: orderType,
        expectation: kind !== "values" ? expectation.trim() || undefined : undefined,
        description: kind === "values" ? expectation.trim() || undefined : undefined,
        measurement_period: kind === "metrics" ? period : undefined,
        value_type: kind === "values" ? valueType : undefined,
      });
      setItems((xs) => [...xs, created]);
      setName("");
      setExpectation("");
      onError(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to add");
    } finally {
      setAdding(false);
    }
  }

  async function removeItem(id: string) {
    try {
      await deleteExpectation(kind, id);
      setItems((xs) => xs.filter((x) => x.id !== id));
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to delete");
    }
  }

  const role = roleLevels.find((rl) => rl.id === roleLevelId);

  return (
    <div className="mt-4">
      <button onClick={onBack} className="text-xs font-medium text-gray-500 hover:text-gray-900">
        &larr; Back to coverage
      </button>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <select value={roleLevelId} onChange={(e) => setRoleLevelId(e.target.value)} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm">
          {roleLevels.map((rl) => (
            <option key={rl.id} value={rl.id}>
              {roleLabel(rl)}
            </option>
          ))}
        </select>
        <div className="flex rounded-md border border-gray-200 p-0.5">
          {KIND_TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setKind(t.id)}
              className={`rounded px-3 py-1 text-sm ${kind === t.id ? "bg-gray-900 text-white" : "text-gray-500 hover:text-gray-900"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button onClick={onDraft} className="ml-auto rounded-md border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100">
          Draft with AI
        </button>
      </div>

      {kind === "values" && <OrgWideValuesBlock onError={onError} />}

      {role && kind === "values" && (
        <p className="mt-4 text-xs font-medium text-gray-500">{roleLabel(role)}-specific values</p>
      )}

      {loading ? (
        <p className="mt-6 text-sm text-gray-500">Loading...</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {items.map((it) => (
            <li key={it.id} className="flex items-start justify-between gap-4 rounded-lg border border-gray-200 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900">
                  {expectationName(it)}
                  {it.order_type && (
                    <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-normal text-gray-500">{it.order_type}</span>
                  )}
                  {kind === "metrics" && it.measurement_period && it.measurement_period !== "none" && (
                    <span className="ml-2 text-xs font-normal text-gray-400">per {it.measurement_period}</span>
                  )}
                </p>
                {(it.expectation || it.description) && (
                  <p className="mt-1 text-xs text-gray-500">{it.expectation || it.description}</p>
                )}
              </div>
              <button onClick={() => removeItem(it.id)} className="shrink-0 text-xs text-gray-400 hover:text-red-500">
                Remove
              </button>
            </li>
          ))}
          {items.length === 0 && (
            <p className="py-2 text-sm text-gray-500">Nothing here yet — add the first one below, or draft with AI above.</p>
          )}
        </ul>
      )}

      <form onSubmit={addItem} className="mt-4 space-y-3 rounded-lg border border-dashed border-gray-300 p-4">
        <div className="flex gap-3">
          <div className="flex-1">
            <label className={labelCls}>{kind === "metrics" ? "Metric" : kind === "skills" ? "Skill" : "Value"}</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputCls}
              placeholder={kind === "metrics" ? "e.g. Net revenue retention" : kind === "skills" ? "e.g. Running discovery calls" : "e.g. Default to transparency"}
            />
          </div>
          <div className="w-36">
            <label className={labelCls}>Priority</label>
            <select value={orderType} onChange={(e) => setOrderType(e.target.value)} className={inputCls}>
              <option value="primary">Primary</option>
              <option value="secondary">Secondary</option>
              <option value="tertiary">Tertiary</option>
            </select>
          </div>
          {kind === "metrics" && (
            <div className="w-36">
              <label className={labelCls}>Measured</label>
              <select value={period} onChange={(e) => setPeriod(e.target.value)} className={inputCls}>
                <option value="week">Weekly</option>
                <option value="month">Monthly</option>
                <option value="quarter">Quarterly</option>
                <option value="annual">Annually</option>
                <option value="none">Not time-based</option>
              </select>
            </div>
          )}
          {kind === "values" && (
            <div className="w-36">
              <label className={labelCls}>Scope</label>
              <select value={valueType} onChange={(e) => setValueType(e.target.value)} className={inputCls}>
                <option value="company">Company</option>
                <option value="team">Team</option>
                <option value="department">Department</option>
              </select>
            </div>
          )}
        </div>
        <div>
          <label className={labelCls}>{kind === "values" ? "What living this value looks like (optional)" : "What good looks like (optional)"}</label>
          <textarea
            value={expectation}
            onChange={(e) => setExpectation(e.target.value)}
            rows={2}
            className={inputCls}
            placeholder={kind === "metrics" ? "e.g. NRR at or above 110% each quarter" : "Describe the bar, in plain language"}
          />
        </div>
        <button type="submit" disabled={adding} className={primaryBtnCls}>
          {adding ? "Adding..." : `Add ${kind === "metrics" ? "metric" : kind === "skills" ? "skill" : "value"}`}
        </button>
      </form>
    </div>
  );
}

// Org-wide values (Plan S3): value_configs.role_level_id NULL. Shown above
// the role-specific list on the Values tab — same createExpectation/
// deleteExpectation("values", ...) calls as the manual form below, just
// with role_level_id forced to null instead of the selected role.
function OrgWideValuesBlock({ onError }: { onError: (m: string | null) => void }) {
  const [items, setItems] = useState<Expectation[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    // No role_level_id filter server-side returns every org-wide AND
    // role-specific value config; filter to org-wide (null) client-side
    // rather than adding a dedicated backend query param for this one block.
    getExpectations("values")
      .then((all) => setItems(all.filter((v) => v.role_level_id === null)))
      .catch((e) => onError(e.message))
      .finally(() => setLoading(false));
  }, [onError]);

  useEffect(() => {
    load();
  }, [load]);

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || adding) return;
    setAdding(true);
    try {
      const created = await createExpectation("values", {
        name: name.trim(),
        role_level_id: null,
        order_type: "primary",
        description: description.trim() || undefined,
        value_type: "company",
      });
      setItems((xs) => [...xs, created]);
      setName("");
      setDescription("");
      onError(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to add");
    } finally {
      setAdding(false);
    }
  }

  async function removeItem(id: string) {
    try {
      await deleteExpectation("values", id);
      setItems((xs) => xs.filter((x) => x.id !== id));
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to delete");
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-indigo-100 bg-indigo-50/40 p-4">
      <h3 className="text-sm font-medium text-gray-900">Org-wide values</h3>
      <p className="mt-1 text-xs text-gray-500">
        Apply to every role automatically — no need to repeat a company value per role. Role-specific values below
        are additional to these, not a replacement.
      </p>
      {loading ? (
        <p className="mt-3 text-xs text-gray-500">Loading...</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {items.map((it) => (
            <li key={it.id} className="flex items-start justify-between gap-3 rounded-md bg-white px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="font-medium text-gray-900">{expectationName(it)}</p>
                {it.description && <p className="mt-0.5 text-xs text-gray-500">{it.description}</p>}
              </div>
              <button onClick={() => removeItem(it.id)} className="shrink-0 text-xs text-gray-400 hover:text-red-500">
                Remove
              </button>
            </li>
          ))}
          {items.length === 0 && <p className="text-xs text-gray-500">No org-wide values yet.</p>}
        </ul>
      )}
      <form onSubmit={addItem} className="mt-3 flex flex-wrap gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Default to transparency"
          className={`${inputCls} flex-1`}
        />
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What living it looks like (optional)"
          className={`${inputCls} flex-1`}
        />
        <button type="submit" disabled={adding} className={primaryBtnCls}>
          {adding ? "Adding..." : "Add"}
        </button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Draft with AI — review panel (Plan S3). Draft-then-review, same rule as
// wrap-up extraction and assessment drafts: nothing saves until the manager
// hits "Add N expectations". AI failure degrades to an inline error with a
// Retry — the manual forms in ExpectationDetail are never blocked by this.
// "Copy from…" is the non-AI alternative source: pulls another role's
// existing expectations into the same editable/include-checkbox rows.
// ---------------------------------------------------------------------------

type DraftMetricRow = DraftMetricItem & { included: boolean };
type DraftSkillRow = DraftSkillItem & { included: boolean };
type DraftValueRow = DraftValueItem & { included: boolean };

function DraftReviewPanel({
  roleLevelId,
  roleLevels,
  onClose,
  onCommitted,
  onError,
}: {
  roleLevelId: string;
  roleLevels: RoleLevel[];
  onClose: () => void;
  onCommitted: () => void;
  onError: (m: string | null) => void;
}) {
  const role = roleLevels.find((rl) => rl.id === roleLevelId);
  const otherRoles = roleLevels.filter((rl) => rl.id !== roleLevelId);

  const [tab, setTab] = useState<ExpectationKind>("metrics");
  const [loading, setLoading] = useState(true);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [copyFromId, setCopyFromId] = useState("");

  const [metrics, setMetrics] = useState<DraftMetricRow[]>([]);
  const [skills, setSkills] = useState<DraftSkillRow[]>([]);
  const [values, setValues] = useState<DraftValueRow[]>([]);

  const runDraft = useCallback(() => {
    setLoading(true);
    setPanelError(null);
    draftExpectations(roleLevelId)
      .then((d) => {
        setMetrics(d.metrics.map((m) => ({ ...m, included: true })));
        setSkills(d.skills.map((s) => ({ ...s, included: true })));
        setValues(d.values.map((v) => ({ ...v, included: true })));
      })
      .catch((e) => setPanelError(e instanceof Error ? e.message : "AI draft failed"))
      .finally(() => setLoading(false));
  }, [roleLevelId]);

  useEffect(() => {
    runDraft();
    // Only re-run automatically for the initial mount / role change, not on
    // every render — runDraft is stable per roleLevelId via useCallback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleLevelId]);

  async function copyFrom(sourceId: string) {
    if (!sourceId) return;
    setLoading(true);
    setPanelError(null);
    try {
      const [m, s, v] = await Promise.all([
        getExpectations("metrics", sourceId),
        getExpectations("skills", sourceId),
        getExpectations("values", sourceId),
      ]);
      setMetrics(
        m.map((e) => ({
          name: expectationName(e),
          order_type: e.order_type,
          expectation: e.expectation ?? null,
          measurement_period: e.measurement_period ?? null,
          included: true,
        }))
      );
      setSkills(
        s.map((e) => ({
          name: expectationName(e),
          order_type: e.order_type,
          expectation: e.expectation ?? null,
          included: true,
        }))
      );
      setValues(
        v
          .filter((e) => e.role_level_id != null) // that role's own values, not org-wide ones already covered
          .map((e) => ({
            name: expectationName(e),
            order_type: e.order_type,
            description: e.description ?? null,
            value_type: e.value_type ?? "company",
            included: true,
          }))
      );
    } catch (e) {
      setPanelError(e instanceof Error ? e.message : "Failed to copy from that role");
    } finally {
      setLoading(false);
    }
  }

  function updateMetric(i: number, patch: Partial<DraftMetricRow>) {
    setMetrics((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function updateSkill(i: number, patch: Partial<DraftSkillRow>) {
    setSkills((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function updateValue(i: number, patch: Partial<DraftValueRow>) {
    setValues((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  const includedCount =
    metrics.filter((m) => m.included).length + skills.filter((s) => s.included).length + values.filter((v) => v.included).length;

  async function commit() {
    setCommitting(true);
    setPanelError(null);
    try {
      const incM = metrics.filter((m) => m.included);
      const incS = skills.filter((s) => s.included);
      const incV = values.filter((v) => v.included);

      if (incM.length) {
        const items: ExpectationBatchItem[] = incM.map(({ included, ...rest }) => rest);
        await batchCreateExpectations("metrics", roleLevelId, items);
      }
      if (incS.length) {
        const items: ExpectationBatchItem[] = incS.map(({ included, ...rest }) => rest);
        await batchCreateExpectations("skills", roleLevelId, items);
      }
      if (incV.length) {
        const items: ExpectationBatchItem[] = incV.map(({ included, ...rest }) => rest);
        await batchCreateExpectations("values", roleLevelId, items);
      }
      onError(null);
      onCommitted();
    } catch (e) {
      setPanelError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setCommitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-medium text-gray-900">Draft with AI {role ? `— ${roleLabel(role)}` : ""}</h3>
            <p className="mt-1 text-xs text-gray-500">
              Review each item before it saves. Uncheck anything that doesn&apos;t fit, edit the rest.
            </p>
          </div>
          <button onClick={onClose} className="shrink-0 text-sm text-gray-400 hover:text-gray-900">
            Close
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            onClick={runDraft}
            disabled={loading}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {loading ? "Drafting..." : "Regenerate with AI"}
          </button>
          {otherRoles.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">or copy from</span>
              <select
                value={copyFromId}
                onChange={(e) => {
                  setCopyFromId(e.target.value);
                  copyFrom(e.target.value);
                }}
                className="rounded-md border border-gray-300 px-2 py-1 text-xs"
              >
                <option value="">Choose a role...</option>
                {otherRoles.map((rl) => (
                  <option key={rl.id} value={rl.id}>
                    {roleLabel(rl)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {panelError && <p className="mt-3 text-sm text-red-500">{panelError}</p>}

        <div className="mt-4 flex rounded-md border border-gray-200 p-0.5">
          {KIND_TABS.map((t) => {
            const count = t.id === "metrics" ? metrics.length : t.id === "skills" ? skills.length : values.length;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`rounded px-3 py-1 text-sm ${tab === t.id ? "bg-gray-900 text-white" : "text-gray-500 hover:text-gray-900"}`}
              >
                {t.label} ({count})
              </button>
            );
          })}
        </div>

        {loading ? (
          <p className="mt-4 text-sm text-gray-500">Drafting...</p>
        ) : (
          <div className="mt-4 space-y-2">
            {tab === "metrics" &&
              (metrics.length === 0 ? (
                <p className="text-sm text-gray-500">No metrics drafted — the manual form still works below.</p>
              ) : (
                metrics.map((m, i) => (
                  <div key={i} className="rounded-lg border border-gray-200 p-3">
                    <div className="flex items-start gap-2">
                      <input type="checkbox" checked={m.included} onChange={(e) => updateMetric(i, { included: e.target.checked })} className="mt-1.5" />
                      <div className="min-w-0 flex-1 space-y-2">
                        <input value={m.name} onChange={(e) => updateMetric(i, { name: e.target.value })} className={inputCls} />
                        <div className="flex gap-2">
                          <select
                            value={m.order_type ?? "primary"}
                            onChange={(e) => updateMetric(i, { order_type: e.target.value as "primary" | "secondary" | "tertiary" })}
                            className={`${inputCls} w-32`}
                          >
                            <option value="primary">Primary</option>
                            <option value="secondary">Secondary</option>
                            <option value="tertiary">Tertiary</option>
                          </select>
                          <select
                            value={m.measurement_period ?? "month"}
                            onChange={(e) => updateMetric(i, { measurement_period: e.target.value })}
                            className={`${inputCls} w-36`}
                          >
                            <option value="week">Weekly</option>
                            <option value="month">Monthly</option>
                            <option value="quarter">Quarterly</option>
                            <option value="annual">Annually</option>
                            <option value="none">Not time-based</option>
                          </select>
                        </div>
                        <textarea
                          value={m.expectation ?? ""}
                          onChange={(e) => updateMetric(i, { expectation: e.target.value })}
                          rows={2}
                          className={inputCls}
                          placeholder="What good looks like"
                        />
                      </div>
                    </div>
                  </div>
                ))
              ))}

            {tab === "skills" &&
              (skills.length === 0 ? (
                <p className="text-sm text-gray-500">No skills drafted — the manual form still works below.</p>
              ) : (
                skills.map((s, i) => (
                  <div key={i} className="rounded-lg border border-gray-200 p-3">
                    <div className="flex items-start gap-2">
                      <input type="checkbox" checked={s.included} onChange={(e) => updateSkill(i, { included: e.target.checked })} className="mt-1.5" />
                      <div className="min-w-0 flex-1 space-y-2">
                        <input value={s.name} onChange={(e) => updateSkill(i, { name: e.target.value })} className={inputCls} />
                        <select
                          value={s.order_type ?? "primary"}
                          onChange={(e) => updateSkill(i, { order_type: e.target.value as "primary" | "secondary" | "tertiary" })}
                          className={`${inputCls} w-32`}
                        >
                          <option value="primary">Primary</option>
                          <option value="secondary">Secondary</option>
                          <option value="tertiary">Tertiary</option>
                        </select>
                        <textarea
                          value={s.expectation ?? ""}
                          onChange={(e) => updateSkill(i, { expectation: e.target.value })}
                          rows={2}
                          className={inputCls}
                          placeholder="What good looks like"
                        />
                      </div>
                    </div>
                  </div>
                ))
              ))}

            {tab === "values" &&
              (values.length === 0 ? (
                <p className="text-sm text-gray-500">
                  No role-specific values drafted — that&apos;s often correct (most values belong in Org-wide
                  values instead). The manual form still works below.
                </p>
              ) : (
                values.map((v, i) => (
                  <div key={i} className="rounded-lg border border-gray-200 p-3">
                    <div className="flex items-start gap-2">
                      <input type="checkbox" checked={v.included} onChange={(e) => updateValue(i, { included: e.target.checked })} className="mt-1.5" />
                      <div className="min-w-0 flex-1 space-y-2">
                        <input value={v.name} onChange={(e) => updateValue(i, { name: e.target.value })} className={inputCls} />
                        <select
                          value={v.order_type ?? "secondary"}
                          onChange={(e) => updateValue(i, { order_type: e.target.value as "primary" | "secondary" | "tertiary" })}
                          className={`${inputCls} w-32`}
                        >
                          <option value="primary">Primary</option>
                          <option value="secondary">Secondary</option>
                          <option value="tertiary">Tertiary</option>
                        </select>
                        <textarea
                          value={v.description ?? ""}
                          onChange={(e) => updateValue(i, { description: e.target.value })}
                          rows={2}
                          className={inputCls}
                          placeholder="What living this value looks like"
                        />
                      </div>
                    </div>
                  </div>
                ))
              ))}
          </div>
        )}

        <div className="mt-6 flex items-center gap-3 border-t border-gray-100 pt-4">
          <button onClick={commit} disabled={committing || loading || includedCount === 0} className={primaryBtnCls}>
            {committing ? "Saving..." : `Add ${includedCount} expectation${includedCount === 1 ? "" : "s"}`}
          </button>
          <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-900">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section — Capacity (Session 14): org-wide baseline defaults + optional
// per-role work-unit translation. "Configured once" like Roles & Levels /
// Expectations — per-person overrides and time off logging happen on the
// Capacity page and each report's detail page instead, since those change
// far more often than a baseline does.
// ---------------------------------------------------------------------------

function CapacitySection({
  roleLevels,
  onError,
}: {
  roleLevels: RoleLevel[];
  onError: (m: string | null) => void;
}) {
  const [settings, setSettings] = useState<CapacitySettings | null>(null);
  const [hoursPerWeek, setHoursPerWeek] = useState(40);
  const [utilizationPct, setUtilizationPct] = useState(75);
  const [offDaysPerYear, setOffDaysPerYear] = useState(21);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [workUnits, setWorkUnits] = useState<WorkUnitConfig[]>([]);
  const [wuRoleLevelId, setWuRoleLevelId] = useState("");
  const [wuUnitName, setWuUnitName] = useState("");
  const [wuHoursPerUnit, setWuHoursPerUnit] = useState(0.5);
  const [addingWorkUnit, setAddingWorkUnit] = useState(false);

  useEffect(() => {
    Promise.all([getCapacitySettings(), getWorkUnitConfigs()])
      .then(([s, wu]) => {
        setSettings(s);
        setHoursPerWeek(s.default_hours_per_week);
        setUtilizationPct(s.default_target_utilization_pct);
        setOffDaysPerYear(s.default_off_days_per_year);
        setWorkUnits(wu);
      })
      .catch((e) => onError(e.message));
  }, [onError]);

  useEffect(() => {
    if (!wuRoleLevelId && roleLevels.length > 0) setWuRoleLevelId(roleLevels[0].id);
  }, [roleLevels, wuRoleLevelId]);

  async function saveDefaults(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    try {
      const s = await updateCapacitySettings({
        default_hours_per_week: hoursPerWeek,
        default_target_utilization_pct: utilizationPct,
        default_off_days_per_year: offDaysPerYear,
      });
      setSettings(s);
      setSaved(true);
      onError(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function addWorkUnit(e: React.FormEvent) {
    e.preventDefault();
    if (!wuRoleLevelId || !wuUnitName.trim() || addingWorkUnit) return;
    setAddingWorkUnit(true);
    try {
      const created = await upsertWorkUnitConfig({
        role_level_id: wuRoleLevelId,
        unit_name: wuUnitName.trim(),
        hours_per_unit: wuHoursPerUnit,
      });
      setWorkUnits((wus) => [...wus.filter((w) => w.role_level_id !== wuRoleLevelId), created]);
      setWuUnitName("");
      onError(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to add");
    } finally {
      setAddingWorkUnit(false);
    }
  }

  async function removeWorkUnit(id: string) {
    try {
      await deleteWorkUnitConfig(id);
      setWorkUnits((wus) => wus.filter((w) => w.id !== id));
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to delete");
    }
  }

  if (!settings) return <p className="text-gray-500">Loading...</p>;

  const roleLevelsWithoutUnit = roleLevels.filter((rl) => !workUnits.some((w) => w.role_level_id === rl.id));

  return (
    <div>
      <h2 className="font-medium text-gray-900">Baseline capacity</h2>
      <p className="mt-1 text-sm text-gray-500">
        The default working week for everyone on your team, before time off. Target utilization is deliberately
        under 100% — it reserves room for meetings, admin, and the unexpected. Override either number for a specific
        person on their report page.
      </p>

      <form onSubmit={saveDefaults} className="mt-4 max-w-md space-y-4">
        <div className="flex gap-3">
          <div className="flex-1">
            <label className={labelCls}>Contracted hours / week</label>
            <input
              type="number"
              min={1}
              max={80}
              step={0.5}
              value={hoursPerWeek}
              onChange={(e) => setHoursPerWeek(parseFloat(e.target.value || "0"))}
              className={inputCls}
            />
          </div>
          <div className="flex-1">
            <label className={labelCls}>Target utilization %</label>
            <input
              type="number"
              min={1}
              max={100}
              step={1}
              value={utilizationPct}
              onChange={(e) => setUtilizationPct(parseFloat(e.target.value || "0"))}
              className={inputCls}
            />
          </div>
        </div>
        <div>
          <label className={labelCls}>Default days off / year</label>
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={offDaysPerYear}
            onChange={(e) => setOffDaysPerYear(parseFloat(e.target.value || "0"))}
            className={`${inputCls} max-w-[9rem]`}
          />
          <p className="mt-1 text-xs text-gray-400">
            Vacation, sick, and holiday days assumed per year (e.g. 15 vacation + 6 sick = 21). This is a separate
            buffer from target utilization — target utilization covers the daily overhead of a working day; this
            covers whole days not worked at all. It&apos;s used to smooth out capacity for a period until you log
            someone&apos;s actual time off — once you do, the real dates take over for that period instead.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button type="submit" disabled={saving} className={primaryBtnCls}>
            {saving ? "Saving..." : "Save"}
          </button>
          {saved && <span className="text-sm text-green-600">Saved</span>}
        </div>
      </form>

      <h2 className="mt-10 font-medium text-gray-900">Work units by role</h2>
      <p className="mt-1 text-sm text-gray-500">
        Optional. If a role thinks in tickets, story points, or campaigns rather than hours, set the conversion here
        — the Capacity page will show both.
      </p>

      {roleLevels.length === 0 ? (
        <p className="mt-4 text-sm text-gray-500">
          Work units attach to a role — set up your first role in{" "}
          <span className="font-medium text-gray-700">Roles &amp; Levels</span> and come back here.
        </p>
      ) : (
        <>
          <ul className="mt-4 space-y-2">
            {workUnits.map((wu) => {
              const rl = roleLevels.find((r) => r.id === wu.role_level_id);
              return (
                <li key={wu.id} className="flex items-center justify-between gap-4 rounded-lg border border-gray-200 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900">{rl ? roleLabel(rl) : "Unknown role"}</p>
                    <p className="text-xs text-gray-500">
                      1 {wu.unit_name} &asymp; {wu.hours_per_unit}h
                    </p>
                  </div>
                  <button onClick={() => removeWorkUnit(wu.id)} className="shrink-0 text-xs text-gray-400 hover:text-red-500">
                    Remove
                  </button>
                </li>
              );
            })}
            {workUnits.length === 0 && <p className="py-2 text-sm text-gray-500">No work units set yet — hours are shown as-is.</p>}
          </ul>

          {roleLevelsWithoutUnit.length > 0 && (
            <form onSubmit={addWorkUnit} className="mt-4 space-y-3 rounded-lg border border-dashed border-gray-300 p-4">
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className={labelCls}>Role</label>
                  <select value={wuRoleLevelId} onChange={(e) => setWuRoleLevelId(e.target.value)} className={inputCls}>
                    {roleLevelsWithoutUnit.map((rl) => (
                      <option key={rl.id} value={rl.id}>
                        {roleLabel(rl)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex-1">
                  <label className={labelCls}>Unit name</label>
                  <input
                    value={wuUnitName}
                    onChange={(e) => setWuUnitName(e.target.value)}
                    className={inputCls}
                    placeholder="e.g. ticket"
                  />
                </div>
                <div className="w-32">
                  <label className={labelCls}>Hours / unit</label>
                  <input
                    type="number"
                    min={0.01}
                    step={0.05}
                    value={wuHoursPerUnit}
                    onChange={(e) => setWuHoursPerUnit(parseFloat(e.target.value || "0"))}
                    className={inputCls}
                  />
                </div>
              </div>
              <button type="submit" disabled={addingWorkUnit} className={primaryBtnCls}>
                {addingWorkUnit ? "Adding..." : "Add work unit"}
              </button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
