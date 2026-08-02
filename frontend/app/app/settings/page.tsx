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

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  DirectReport,
  Expectation,
  ExpectationKind,
  OrgUnit,
  Profile,
  RoleLevel,
  assignReportOrgUnit,
  assignReportRole,
  createExpectation,
  createRoleLevel,
  deleteExpectation,
  deleteRoleLevel,
  expectationName,
  getDirectReports,
  getExpectations,
  getOrgUnits,
  getProfile,
  getRoleLevels,
  updateProfile,
  updateRoleLevel,
} from "@/lib/api";

type SectionId = "profile" | "roles" | "team" | "expectations";

const SECTIONS: { id: SectionId; label: string; blurb: string }[] = [
  { id: "profile", label: "Profile & Company", blurb: "You and your company" },
  { id: "roles", label: "Roles & Levels", blurb: "The jobs on your team" },
  { id: "team", label: "Team", blurb: "Who's on which team" },
  { id: "expectations", label: "Expectations", blurb: "What good looks like" },
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
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <Link href="/app/dashboard" className="text-sm text-gray-500 hover:text-gray-900">
          &larr; Back to your team
        </Link>
      </div>
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
            <ExpectationsSection roleLevels={roleLevels} onError={setError} />
          )}
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
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getProfile()
      .then((p) => {
        setProfile(p);
        setFullName(p.full_name);
        setCompanyName(p.company_name);
      })
      .catch((e) => onError(e.message));
  }, [onError]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    try {
      const p = await updateProfile({ full_name: fullName, company_name: companyName });
      setProfile(p);
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
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900">{r.name}</p>
              {r.role_title && <p className="text-xs text-gray-500">{r.role_title}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <select
                value={r.role_level_id ?? ""}
                onChange={(e) => assign(r, e.target.value)}
                className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
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
                className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
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
// ---------------------------------------------------------------------------

function ExpectationsSection({
  roleLevels,
  onError,
}: {
  roleLevels: RoleLevel[];
  onError: (m: string | null) => void;
}) {
  const [roleLevelId, setRoleLevelId] = useState<string>("");
  const [kind, setKind] = useState<ExpectationKind>("metrics");
  const [items, setItems] = useState<Expectation[]>([]);
  const [loading, setLoading] = useState(false);

  const [name, setName] = useState("");
  const [orderType, setOrderType] = useState("primary");
  const [expectation, setExpectation] = useState("");
  const [period, setPeriod] = useState("month");
  const [valueType, setValueType] = useState("company");
  const [adding, setAdding] = useState(false);

  // Default to the first role level once loaded.
  useEffect(() => {
    if (!roleLevelId && roleLevels.length > 0) setRoleLevelId(roleLevels[0].id);
  }, [roleLevels, roleLevelId]);

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

      <div className="mt-4 flex items-center gap-3">
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
      </div>

      {loading ? (
        <p className="mt-6 text-sm text-gray-500">Loading...</p>
      ) : (
        <ul className="mt-4 space-y-2">
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
            <p className="py-2 text-sm text-gray-500">Nothing here yet — add the first one below.</p>
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
