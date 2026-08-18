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

import { Fragment, Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
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
  OrgUnitType,
  Profile,
  RoleFamily,
  RoleLevel,
  SetupStatus,
  SetupStatusPerson,
  WorkUnitConfig,
  assignReportOrgUnit,
  assignReportRole,
  batchCreateExpectations,
  createDirectReport,
  createExpectation,
  createOrgUnit,
  createRoleFamily,
  createRoleLevel,
  deleteExpectation,
  deleteRoleFamily,
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
  getRoleFamilies,
  getRoleLevels,
  getSetupStatus,
  getWorkUnitConfigs,
  updateCapacitySettings,
  updateProfile,
  updateRoleFamily,
  updateRoleLevel,
  upsertWorkUnitConfig,
} from "@/lib/api";
import {
  GroupedRoleSelect,
  OrgUnitSelect,
  UNGROUPED_LABEL,
  groupRoleLevelsByFamily,
  orgUnitLabel,
  roleLabel,
} from "@/components/RolePicker";

// Session 41 (Plan S1, docs/TEAM_SETUP_UX_REVIEW.md §6): "Team" renamed
// "People" and promoted to right after Profile & Company — the roster-first
// guided flow (people → teams → roles → expectations) is now the natural
// second stop, ahead of the role/expectations definitions it depends on.
// Session 42 (Plan S4+S5): "Roles & Levels" and "Expectations" merge into
// one role-centric section, "Roles & expectations" — a manager picks a
// ladder and sees its levels, JD, and expectations coverage together
// instead of bouncing between two settings tabs. See §6, Plan S4+S5.
type SectionId = "profile" | "people" | "roles" | "capacity";

const SECTIONS: { id: SectionId; label: string; blurb: string }[] = [
  { id: "profile", label: "Profile & Company", blurb: "You and your company" },
  { id: "people", label: "People", blurb: "Add your team, wire up roles and teams" },
  { id: "roles", label: "Roles & expectations", blurb: "The jobs on your team, and what good looks like" },
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

// useSearchParams (for ?section=&unit=, the /app/org member-count
// click-through, Session 42 Plan S4+S5) requires a Suspense boundary — same
// pattern as app/app/reports/[id]/prep/page.tsx.
export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsFlow />
    </Suspense>
  );
}

function SettingsFlow() {
  const searchParams = useSearchParams();
  const sectionParam = searchParams.get("section");
  const unitParam = searchParams.get("unit");
  const [section, setSection] = useState<SectionId>(
    sectionParam === "people" || sectionParam === "roles" || sectionParam === "capacity" ? sectionParam : "profile"
  );
  const [error, setError] = useState<string | null>(null);
  // Set by /app/org's "N people" click-through (Session 42, Plan S4+S5) —
  // scopes the People roster to one team/department. Cleared from within
  // PeopleSection itself, not read again from the URL after mount, so
  // clicking a different person or switching sections and back doesn't
  // resurrect a stale filter.
  const [peopleFilterUnitId, setPeopleFilterUnitId] = useState<string | null>(unitParam);

  // Shared data
  const [roleLevels, setRoleLevels] = useState<RoleLevel[]>([]);
  // Role families (Session 40) — fetched separately from roleLevels' own
  // embedded role_families(name) because a family can exist with zero levels
  // (the "ghost card" state) and wouldn't show up via any level's embed.
  const [roleFamilies, setRoleFamilies] = useState<RoleFamily[]>([]);
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

  // People's expectations chip ("role has none → draft") deep-links here:
  // set the role to draft, switch sections, and ExpectationsSection opens
  // DraftReviewPanel for it on mount then clears this back to null (Session
  // 41, Plan S1). Lifted to SettingsPage rather than local to either section
  // since it's the one piece of state that has to survive the section swap
  // itself — the same reason expRoleLevelId/expKind live here.
  const [draftForRoleId, setDraftForRoleId] = useState<string | null>(null);

  function goDraftExpectations(roleLevelId: string) {
    setDraftForRoleId(roleLevelId);
    setSection("roles");
  }

  useEffect(() => {
    Promise.all([getRoleLevels(), getRoleFamilies(), getDirectReports(), getOrgUnits()])
      .then(([rls, rfs, drs, ous]) => {
        setRoleLevels(rls);
        setRoleFamilies(rfs);
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
            <div className="space-y-12">
              <RolesSection
                roleLevels={roleLevels}
                setRoleLevels={setRoleLevels}
                roleFamilies={roleFamilies}
                setRoleFamilies={setRoleFamilies}
                setReports={setReports}
                onError={setError}
              />
              <div id="expectations-block" className="border-t border-gray-200 pt-10">
                <ExpectationsSection
                  roleLevels={roleLevels}
                  roleFamilies={roleFamilies}
                  roleLevelId={expRoleLevelId}
                  setRoleLevelId={setExpRoleLevelId}
                  kind={expKind}
                  setKind={setExpKind}
                  initialDraftRoleId={draftForRoleId}
                  onConsumeInitialDraft={() => setDraftForRoleId(null)}
                  onError={setError}
                />
              </div>
            </div>
          )}
          {section === "people" && (
            <PeopleSection
              reports={reports}
              setReports={setReports}
              roleLevels={roleLevels}
              setRoleLevels={setRoleLevels}
              roleFamilies={roleFamilies}
              setRoleFamilies={setRoleFamilies}
              orgUnits={orgUnits}
              setOrgUnits={setOrgUnits}
              filterUnitId={peopleFilterUnitId}
              onClearFilter={() => setPeopleFilterUnitId(null)}
              onNavigateToRoles={() => setSection("roles")}
              onNavigateToExpectations={() => setSection("roles")}
              onDraftExpectations={goDraftExpectations}
              onError={setError}
            />
          )}
          {section === "capacity" && (
            <CapacitySection roleLevels={roleLevels} roleFamilies={roleFamilies} onError={setError} />
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
// "who's in which role" + org_unit assignment moved to PeopleSection below,
// renamed from TeamSection in Session 41)
// ---------------------------------------------------------------------------

type RoleFormValues = {
  jobRole: string;
  jobLevel: number;
  responsibilities: string;
};

// Shared by "Add ladder" / "Add L{n+1}" / "Edit level" — same card-swap
// edit-in-place pattern as Goals' GoalForm (Session 10). Takes plain
// `initialValues` (not a whole RoleLevel) as of Session 40, so the same form
// can pre-fill from a not-yet-created "next level" (job_role/responsibilities
// carried over from L{n}) as easily as from a real existing row.
function RoleForm({
  initialValues,
  isEdit,
  onCancel,
  onSubmit,
  submitLabel,
  savingLabel,
  roleLabelText = "Role",
  rolePlaceholder = "e.g. Customer Success Manager",
  dynamicLevelLabel,
}: {
  initialValues?: RoleFormValues;
  isEdit?: boolean;
  onCancel?: () => void;
  onSubmit: (input: RoleFormValues) => Promise<void>;
  submitLabel?: string;
  savingLabel: string;
  roleLabelText?: string;
  rolePlaceholder?: string;
  // Session 40 follow-up (Andrew's feedback): the "Add L{n}" button used to
  // show a level number frozen at open time, so typing a different number
  // into the Level field (e.g. adding a missing L1 below an existing L2)
  // left a stale "Add L3" label on submit. When true, the button text
  // tracks the Level field live instead of using the static submitLabel.
  dynamicLevelLabel?: boolean;
}) {
  const [jobRole, setJobRole] = useState(initialValues?.jobRole ?? "");
  const [jobLevel, setJobLevel] = useState(initialValues?.jobLevel ?? 1);
  const [responsibilities, setResponsibilities] = useState(initialValues?.responsibilities ?? "");
  const [saving, setSaving] = useState(false);

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
    <form onSubmit={handleSubmit} className="mt-3 space-y-3 rounded-lg border border-dashed border-gray-300 p-4">
      <div className="flex gap-3">
        <div className="flex-1">
          <label className={labelCls}>{roleLabelText}</label>
          <input value={jobRole} onChange={(e) => setJobRole(e.target.value)} className={inputCls} placeholder={rolePlaceholder} />
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
          {saving ? savingLabel : dynamicLevelLabel ? `Add L${jobLevel}` : submitLabel}
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

// Per-level row inside a ladder card (or the Ungrouped bucket) — the JD is
// collapsed to 2 lines by default (`line-clamp-2`, native to Tailwind 3.3+,
// no plugin needed), Edit swaps the row for RoleForm in place, and "Move to
// another ladder…" (the whole merge mechanic — a PUT with a different
// role_family_id) opens an inline family picker.
function LevelRow({
  role,
  allFamilies,
  isEditing,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onRemove,
  isMoving,
  onStartMove,
  onCancelMove,
  onMove,
  jdExpanded,
  onToggleJd,
}: {
  role: RoleLevel;
  allFamilies: RoleFamily[];
  isEditing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (input: RoleFormValues) => Promise<void>;
  onRemove: () => void;
  isMoving: boolean;
  onStartMove: () => void;
  onCancelMove: () => void;
  onMove: (familyId: string | null) => void;
  jdExpanded: boolean;
  onToggleJd: () => void;
}) {
  if (isEditing) {
    return (
      <li>
        <RoleForm
          initialValues={{ jobRole: role.job_role, jobLevel: role.job_level, responsibilities: role.job_responsibilities ?? "" }}
          isEdit
          onCancel={onCancelEdit}
          onSubmit={onSaveEdit}
          submitLabel="Save changes"
          savingLabel="Saving..."
        />
      </li>
    );
  }

  // Family name takes over as the primary display once a level has one
  // (Session 40 decision); job_role only shows separately here as an
  // override title when it differs — e.g. "Senior Corporate CSM" merged
  // into the "Corporate CSM" ladder still reads as "Senior Corporate CSM"
  // on its own row.
  const overrideTitle = role.role_families && role.role_families.name !== role.job_role ? role.job_role : null;

  return (
    <li className="rounded-lg border border-gray-200 px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900">
            L{role.job_level}
            {overrideTitle && <span className="ml-2 font-normal text-gray-500">&middot; {overrideTitle}</span>}
          </p>
          {role.job_responsibilities && (
            <p className={`mt-1 text-xs text-gray-500 ${jdExpanded ? "" : "line-clamp-2"}`}>{role.job_responsibilities}</p>
          )}
          {role.job_responsibilities && role.job_responsibilities.length > 100 && (
            <button onClick={onToggleJd} className="mt-0.5 text-xs text-gray-400 hover:text-gray-700">
              {jdExpanded ? "Show less" : "Show more"}
            </button>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <button onClick={onStartMove} className="text-xs text-gray-400 hover:text-gray-700" title="Move to another ladder">
            Move&hellip;
          </button>
          <button onClick={onStartEdit} className="text-xs text-gray-400 hover:text-gray-700" title="Edit level">
            Edit
          </button>
          <button onClick={onRemove} className="text-xs text-gray-400 hover:text-red-500" title="Delete level">
            Remove
          </button>
        </div>
      </div>
      {isMoving && (
        <div className="mt-2 flex items-center gap-2 border-t border-gray-100 pt-2">
          <span className="text-xs text-gray-500">Move to</span>
          <select
            defaultValue=""
            onChange={(e) => onMove(e.target.value || null)}
            className="rounded-md border border-gray-300 px-2 py-1 text-xs"
          >
            <option value="" disabled>
              Choose a ladder&hellip;
            </option>
            <option value="__ungrouped__">{UNGROUPED_LABEL}</option>
            {allFamilies
              .filter((f) => f.id !== role.role_family_id)
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
          </select>
          <button onClick={onCancelMove} className="text-xs text-gray-400 hover:text-gray-900">
            Cancel
          </button>
        </div>
      )}
    </li>
  );
}

function RolesSection({
  roleLevels,
  setRoleLevels,
  roleFamilies,
  setRoleFamilies,
  setReports,
  onError,
}: {
  roleLevels: RoleLevel[];
  setRoleLevels: React.Dispatch<React.SetStateAction<RoleLevel[]>>;
  roleFamilies: RoleFamily[];
  setRoleFamilies: React.Dispatch<React.SetStateAction<RoleFamily[]>>;
  setReports: React.Dispatch<React.SetStateAction<DirectReport[]>>;
  onError: (m: string | null) => void;
}) {
  const [editingLevelId, setEditingLevelId] = useState<string | null>(null);
  // Which family card has its "add a level" form open, and which level
  // number it was opened for — holds both directions (the next level up,
  // pre-filled from the top of the ladder, and a missing lower level like
  // L1 below an existing L2, pre-filled from the bottom of the ladder).
  const [addingLevel, setAddingLevel] = useState<{ familyId: string; level: number } | null>(null);
  const [movingLevelId, setMovingLevelId] = useState<string | null>(null);
  const [renamingFamilyId, setRenamingFamilyId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [addingLadder, setAddingLadder] = useState(false);
  const [expandedJdIds, setExpandedJdIds] = useState<Set<string>>(new Set());

  const groups = groupRoleLevelsByFamily(roleLevels, roleFamilies);

  async function addLevel(familyId: string | null, input: RoleFormValues) {
    try {
      const created = await createRoleLevel({
        job_role: input.jobRole,
        job_level: input.jobLevel,
        job_responsibilities: input.responsibilities || undefined,
        role_family_id: familyId,
      });
      setRoleLevels((r) => [...r, created]);
      setAddingLevel(null);
      onError(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to add role");
    }
  }

  async function createLadder(input: RoleFormValues) {
    try {
      const family = await createRoleFamily({ name: input.jobRole });
      setRoleFamilies((fs) => [...fs, family]);
      const created = await createRoleLevel({
        job_role: input.jobRole,
        job_level: input.jobLevel,
        job_responsibilities: input.responsibilities || undefined,
        role_family_id: family.id,
      });
      setRoleLevels((r) => [...r, created]);
      setAddingLadder(false);
      onError(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to add ladder");
    }
  }

  // Takes the full role, not just its id, so the PUT (which replaces the
  // whole role_levels row server-side) can carry the existing
  // functional_team and role_family_id through unchanged. RoleForm doesn't
  // expose either field, so without this an edit would silently null them
  // out — same "read, tweak one field, PUT the whole record" preservation
  // pattern as assignReportRole/assignReportOrgUnit.
  async function saveEdit(role: RoleLevel, input: RoleFormValues) {
    try {
      const updated = await updateRoleLevel(role.id, {
        job_role: input.jobRole,
        job_level: input.jobLevel,
        job_responsibilities: input.responsibilities || undefined,
        functional_team: role.functional_team ?? undefined,
        role_family_id: role.role_family_id,
      });
      setRoleLevels((r) => r.map((x) => (x.id === role.id ? updated : x)));
      onError(null);
      setEditingLevelId(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to save role");
    }
  }

  async function removeLevel(id: string) {
    try {
      await deleteRoleLevel(id);
      setRoleLevels((r) => r.filter((x) => x.id !== id));
      // Mirrors the backend's own cascade (delete_role_level nulls
      // direct_reports.role_level_id server-side) so the Team section's
      // already-loaded `reports` state doesn't show a stale role pointing
      // at a role_level that no longer exists until the next full reload.
      setReports((rs) => rs.map((r) => (r.role_level_id === id ? { ...r, role_level_id: null } : r)));
      setEditingLevelId((current) => (current === id ? null : current));
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to delete role");
    }
  }

  // The whole merge mechanic (per the plan): a PUT changing role_family_id.
  // familyId === null moves the level to "Ungrouped".
  async function moveLevel(role: RoleLevel, familyId: string | null) {
    try {
      const updated = await updateRoleLevel(role.id, {
        job_role: role.job_role,
        job_level: role.job_level,
        job_responsibilities: role.job_responsibilities ?? undefined,
        functional_team: role.functional_team ?? undefined,
        role_family_id: familyId,
      });
      setRoleLevels((r) => r.map((x) => (x.id === role.id ? updated : x)));
      setMovingLevelId(null);
      onError(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to move role");
    }
  }

  async function renameFamily(id: string) {
    if (!renameValue.trim()) return;
    try {
      const updated = await updateRoleFamily(id, { name: renameValue.trim() });
      setRoleFamilies((fs) => fs.map((f) => (f.id === id ? updated : f)));
      // Keep every level's embedded role_families.name in sync client-side
      // so the rename shows immediately everywhere without a refetch.
      setRoleLevels((r) =>
        r.map((x) => (x.role_family_id === id ? { ...x, role_families: { id, name: updated.name } } : x))
      );
      setRenamingFamilyId(null);
      onError(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to rename ladder");
    }
  }

  async function removeFamily(id: string) {
    try {
      await deleteRoleFamily(id);
      setRoleFamilies((fs) => fs.filter((f) => f.id !== id));
      // Mirrors the backend's ON DELETE SET NULL — any level still in this
      // family falls into "Ungrouped" client-side immediately too.
      setRoleLevels((r) =>
        r.map((x) => (x.role_family_id === id ? { ...x, role_family_id: null, role_families: null } : x))
      );
      onError(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to delete ladder");
    }
  }

  function toggleJd(id: string) {
    setExpandedJdIds((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleMove(role: RoleLevel, choice: string | null) {
    if (choice === "__ungrouped__") moveLevel(role, null);
    else moveLevel(role, choice);
  }

  return (
    <div>
      <h2 className="font-medium text-gray-900">Roles on your team</h2>
      <p className="mt-1 text-sm text-gray-500">
        A role family is a ladder — L1, L2, L3&hellip; are levels inside it. Everything else (expectations now,
        ratings later) attaches to a level. Assigning people to roles and teams lives in{" "}
        <span className="font-medium text-gray-700">Team</span>.
      </p>

      <div className="mt-4 space-y-5">
        {groups.map((g) => {
          if (!g.family) {
            // "Ungrouped" bucket — levels with no family (never assigned
            // one, or their family was deleted). Flat list, not a ladder
            // card, with an inline "Move to a ladder" picker per row.
            if (g.levels.length === 0) return null;
            return (
              <div key="ungrouped">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">{UNGROUPED_LABEL}</h3>
                <ul className="mt-2 space-y-2">
                  {g.levels.map((rl) => (
                    <LevelRow
                      key={rl.id}
                      role={rl}
                      allFamilies={roleFamilies}
                      isEditing={editingLevelId === rl.id}
                      onStartEdit={() => setEditingLevelId(rl.id)}
                      onCancelEdit={() => setEditingLevelId(null)}
                      onSaveEdit={(input) => saveEdit(rl, input)}
                      onRemove={() => removeLevel(rl.id)}
                      isMoving={movingLevelId === rl.id}
                      onStartMove={() => setMovingLevelId(rl.id)}
                      onCancelMove={() => setMovingLevelId(null)}
                      onMove={(choice) => handleMove(rl, choice)}
                      jdExpanded={expandedJdIds.has(rl.id)}
                      onToggleJd={() => toggleJd(rl.id)}
                    />
                  ))}
                </ul>
              </div>
            );
          }

          const family = g.family;
          // g.levels is sorted ascending (groupRoleLevelsByFamily), so the
          // first/last entries are the ladder's floor and ceiling. Two "add"
          // affordances: the common case (next level up, pre-filled from the
          // ceiling) and the gap case Andrew flagged — a ladder that starts
          // above L1 (e.g. only L2 exists) needs a way to backfill L1 too,
          // pre-filled from the floor rather than the ceiling.
          const firstLevel = g.levels[0];
          const lastLevel = g.levels[g.levels.length - 1];
          const nextLevelUp = g.levels.length > 0 ? lastLevel.job_level + 1 : 1;
          const nextLevelDown = g.levels.length > 0 && firstLevel.job_level > 1 ? firstLevel.job_level - 1 : null;
          const isAddingBelow = addingLevel?.familyId === family.id && nextLevelDown !== null && addingLevel.level === nextLevelDown;

          return (
            <div key={family.id} className="rounded-lg border border-gray-200 p-4">
              <div className="flex items-center justify-between gap-3">
                {renamingFamilyId === family.id ? (
                  <div className="flex flex-1 items-center gap-2">
                    <input
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      className={`${inputCls} max-w-xs`}
                      autoFocus
                    />
                    <button onClick={() => renameFamily(family.id)} className="text-xs font-medium text-gray-900 hover:underline">
                      Save
                    </button>
                    <button onClick={() => setRenamingFamilyId(null)} className="text-xs text-gray-500 hover:text-gray-900">
                      Cancel
                    </button>
                  </div>
                ) : (
                  <h3 className="font-medium text-gray-900">
                    {family.name}
                    <span className="ml-2 text-xs font-normal text-gray-400">
                      {g.levels.length} level{g.levels.length === 1 ? "" : "s"}
                    </span>
                  </h3>
                )}
                {renamingFamilyId !== family.id && (
                  <div className="flex shrink-0 items-center gap-3">
                    <button
                      onClick={() => {
                        setRenamingFamilyId(family.id);
                        setRenameValue(family.name);
                      }}
                      className="text-xs text-gray-400 hover:text-gray-700"
                    >
                      Rename
                    </button>
                    {g.levels.length === 0 && (
                      <button onClick={() => removeFamily(family.id)} className="text-xs text-gray-400 hover:text-red-500">
                        Delete
                      </button>
                    )}
                  </div>
                )}
              </div>

              {g.levels.length === 0 ? (
                <p className="mt-2 text-xs text-gray-400">No levels yet — add the first one below, or delete this ladder.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {g.levels.map((rl) => (
                    <LevelRow
                      key={rl.id}
                      role={rl}
                      allFamilies={roleFamilies}
                      isEditing={editingLevelId === rl.id}
                      onStartEdit={() => setEditingLevelId(rl.id)}
                      onCancelEdit={() => setEditingLevelId(null)}
                      onSaveEdit={(input) => saveEdit(rl, input)}
                      onRemove={() => removeLevel(rl.id)}
                      isMoving={movingLevelId === rl.id}
                      onStartMove={() => setMovingLevelId(rl.id)}
                      onCancelMove={() => setMovingLevelId(null)}
                      onMove={(choice) => handleMove(rl, choice)}
                      jdExpanded={expandedJdIds.has(rl.id)}
                      onToggleJd={() => toggleJd(rl.id)}
                    />
                  ))}
                </ul>
              )}

              {addingLevel?.familyId === family.id ? (
                <RoleForm
                  initialValues={{
                    jobRole: (isAddingBelow ? firstLevel?.job_role : lastLevel?.job_role) ?? family.name,
                    jobLevel: addingLevel.level,
                    responsibilities: (isAddingBelow ? firstLevel?.job_responsibilities : lastLevel?.job_responsibilities) ?? "",
                  }}
                  onCancel={() => setAddingLevel(null)}
                  onSubmit={(input) => addLevel(family.id, input)}
                  dynamicLevelLabel
                  savingLabel="Adding..."
                  roleLabelText="Title for this level"
                />
              ) : (
                <div className="mt-3 flex items-center gap-4">
                  <button
                    onClick={() => setAddingLevel({ familyId: family.id, level: nextLevelUp })}
                    className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
                  >
                    + Add L{nextLevelUp}
                  </button>
                  {nextLevelDown !== null && (
                    <button
                      onClick={() => setAddingLevel({ familyId: family.id, level: nextLevelDown })}
                      className="text-xs font-medium text-gray-500 hover:text-gray-800"
                      title={`This ladder starts at L${firstLevel.job_level} — add a lower level if one's missing`}
                    >
                      + Add L{nextLevelDown} (lower)
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {roleLevels.length === 0 && roleFamilies.length === 0 && (
          <p className="text-sm text-gray-500">No roles yet. Add your first ladder below.</p>
        )}
      </div>

      {addingLadder ? (
        <RoleForm
          onCancel={() => setAddingLadder(false)}
          onSubmit={createLadder}
          submitLabel="Add ladder"
          savingLabel="Adding..."
          roleLabelText="Ladder name"
          rolePlaceholder="e.g. Corporate CSM"
        />
      ) : (
        <button onClick={() => setAddingLadder(true)} className={`${primaryBtnCls} mt-4`}>
          + Add a new ladder
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section — People (Session 12 as "Team"; rebuilt + renamed Session 41,
// Plan S1 from docs/TEAM_SETUP_UX_REVIEW.md §6). The golden path: people →
// teams → roles → expectations, all wired from one roster-first screen —
// role and team pickers create the thing they're missing inline (no bounce
// to Roles & Levels or /app/org to create a dependency first), a progress
// header shows exactly what's left, and an add-person row means this is
// also where new reports get added, not just assigned.
// ---------------------------------------------------------------------------

const SETUP_STEP_DEFS: { id: "people" | "teams" | "roles" | "expectations"; label: string }[] = [
  { id: "people", label: "People" },
  { id: "teams", label: "Teams" },
  { id: "roles", label: "Roles assigned" },
  { id: "expectations", label: "Expectations" },
];

function setupStepView(status: SetupStatus, id: "people" | "teams" | "roles" | "expectations") {
  switch (id) {
    case "people":
      return { count: `${status.people_count}`, done: status.people_count > 0 };
    case "teams":
      return { count: `${status.teams_count}`, done: status.teams_count > 0 };
    case "roles": {
      const assigned = status.people_count - status.people_without_role_count;
      return {
        count: status.people_count === 0 ? "–" : `${assigned}/${status.people_count}`,
        done: status.people_count > 0 && status.people_without_role_count === 0,
      };
    }
    case "expectations":
      return {
        count: status.roles_count === 0 ? "–" : `${status.roles_with_expectations_count}/${status.roles_count}`,
        done: status.roles_count > 0 && status.roles_with_expectations_count === status.roles_count,
      };
  }
}

// Four steps with counts, each deep-linking to where you'd fix it — feeds
// the same setup-status data the roster badges and the Foundation door use,
// so all three can never tell three different stories about how "done"
// setup is.
function SetupProgressHeader({
  status,
  onStep,
}: {
  status: SetupStatus | null;
  onStep: (id: "people" | "teams" | "roles" | "expectations") => void;
}) {
  if (!status) return <p className="mt-4 text-sm text-gray-500">Loading setup status...</p>;
  return (
    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {SETUP_STEP_DEFS.map((step) => {
        const v = setupStepView(status, step.id);
        return (
          <button
            key={step.id}
            onClick={() => onStep(step.id)}
            className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
              v.done ? "border-gray-200 bg-white hover:bg-gray-50" : "border-amber-200 bg-amber-50 hover:bg-amber-100"
            }`}
          >
            <p className={`text-lg font-semibold ${v.done ? "text-gray-900" : "text-amber-800"}`}>{v.count}</p>
            <p className="text-xs text-gray-500">{step.label}</p>
          </button>
        );
      })}
    </div>
  );
}


// Inline create-role modal — mirrors RolesSection's "+ Add a new ladder"
// mechanic (create a role_family + its L1 level together) so a role created
// from here shows up correctly as its own ladder in Roles & Levels, not an
// orphaned "Ungrouped" level.
function CreateRoleModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onCreate(name.trim());
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create role");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 px-4 pt-24" onClick={onClose}>
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-medium text-gray-900">Create a new role</h3>
        <p className="mt-1 text-xs text-gray-500">
          Starts a new ladder at L1 — add more levels later from Roles &amp; expectations.
        </p>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Account Executive"
          className={`${inputCls} mt-3`}
        />
        {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-sm text-gray-500 hover:text-gray-700">
            Cancel
          </button>
          <button type="submit" disabled={saving || !name.trim()} className={primaryBtnCls}>
            {saving ? "Creating..." : "Create role"}
          </button>
        </div>
      </form>
    </div>
  );
}

// Inline create-team modal — covers the common "just give me a team to put
// this person on" case; the full tree (parent units, leaders) stays on
// /app/org, per the plan.
function CreateTeamModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string, unitType: OrgUnitType) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [unitType, setUnitType] = useState<OrgUnitType>("team");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onCreate(name.trim(), unitType);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create team");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 px-4 pt-24" onClick={onClose}>
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-medium text-gray-900">Create a new team</h3>
        <p className="mt-1 text-xs text-gray-500">
          For the full org chart (parent units, leaders), use{" "}
          <Link href="/app/org" className="underline">
            Org
          </Link>
          .
        </p>
        <div className="mt-3 space-y-3">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. US Success" className={inputCls} />
          <select value={unitType} onChange={(e) => setUnitType(e.target.value as OrgUnitType)} className={inputCls}>
            <option value="team">Team</option>
            <option value="department">Department</option>
          </select>
        </div>
        {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-sm text-gray-500 hover:text-gray-700">
            Cancel
          </button>
          <button type="submit" disabled={saving || !name.trim()} className={primaryBtnCls}>
            {saving ? "Creating..." : "Create team"}
          </button>
        </div>
      </form>
    </div>
  );
}

// The expectations chip — ✓ when the assigned role has configured
// expectations, amber "no role" when nothing's assigned yet, amber
// "Draft expectations" (deep-links into the Expectations section's AI
// draft flow) when a role is assigned but has zero configured items.
function ExpectationsChip({
  person,
  roleLevelId,
  onDraft,
}: {
  person: SetupStatusPerson | undefined;
  roleLevelId: string | null | undefined;
  onDraft: (roleLevelId: string) => void;
}) {
  if (!person || !roleLevelId) {
    return <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">No role</span>;
  }
  if (person.role_has_expectations) {
    return <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">✓ Expectations</span>;
  }
  return (
    <button
      onClick={() => onDraft(roleLevelId)}
      className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700 hover:bg-amber-100"
    >
      Draft expectations
    </button>
  );
}

function PeopleSection({
  reports,
  setReports,
  roleLevels,
  setRoleLevels,
  roleFamilies,
  setRoleFamilies,
  orgUnits,
  setOrgUnits,
  filterUnitId,
  onClearFilter,
  onNavigateToRoles,
  onNavigateToExpectations,
  onDraftExpectations,
  onError,
}: {
  reports: DirectReport[];
  setReports: React.Dispatch<React.SetStateAction<DirectReport[]>>;
  roleLevels: RoleLevel[];
  setRoleLevels: React.Dispatch<React.SetStateAction<RoleLevel[]>>;
  roleFamilies: RoleFamily[];
  setRoleFamilies: React.Dispatch<React.SetStateAction<RoleFamily[]>>;
  orgUnits: OrgUnit[];
  setOrgUnits: React.Dispatch<React.SetStateAction<OrgUnit[]>>;
  // /app/org's "N people" click-through (Session 42, Plan S4+S5) — non-null
  // scopes the roster below to one org unit; null shows everyone.
  filterUnitId: string | null;
  onClearFilter: () => void;
  onNavigateToRoles: () => void;
  onNavigateToExpectations: () => void;
  onDraftExpectations: (roleLevelId: string) => void;
  onError: (m: string | null) => void;
}) {
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);
  // Which report row a role/team create-modal was opened from — null when
  // opened from the progress header itself (no row to auto-assign back to).
  const [creatingRoleFor, setCreatingRoleFor] = useState<DirectReport | "header" | null>(null);
  const [creatingTeamFor, setCreatingTeamFor] = useState<DirectReport | "header" | null>(null);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [addingPerson, setAddingPerson] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const loadSetupStatus = useCallback(() => {
    getSetupStatus()
      .then(setSetupStatus)
      .catch((e) => onError(e.message));
  }, [onError]);

  useEffect(() => {
    loadSetupStatus();
  }, [loadSetupStatus]);

  const peopleById = new Map((setupStatus?.people ?? []).map((p) => [p.id, p]));

  async function assign(report: DirectReport, roleLevelId: string) {
    try {
      const updated = await assignReportRole(report.id, report, roleLevelId || null);
      setReports((rs) => rs.map((r) => (r.id === report.id ? { ...r, role_level_id: updated.role_level_id ?? (roleLevelId || null) } : r)));
      loadSetupStatus();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to assign role");
    }
  }

  async function assignOrgUnit(report: DirectReport, orgUnitId: string) {
    try {
      const updated = await assignReportOrgUnit(report.id, report, orgUnitId || null);
      setReports((rs) => rs.map((r) => (r.id === report.id ? { ...r, org_unit_id: updated.org_unit_id ?? (orgUnitId || null) } : r)));
      loadSetupStatus();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to assign team");
    }
  }

  async function handleCreateRole(name: string) {
    const family = await createRoleFamily({ name });
    const level = await createRoleLevel({ job_role: name, job_level: 1, role_family_id: family.id });
    setRoleFamilies((fs) => [...fs, family]);
    setRoleLevels((ls) => [...ls, level]);
    if (creatingRoleFor && creatingRoleFor !== "header") {
      await assign(creatingRoleFor, level.id);
    } else {
      loadSetupStatus();
    }
  }

  async function handleCreateTeam(name: string, unitType: OrgUnitType) {
    const unit = await createOrgUnit({ name, unit_type: unitType });
    setOrgUnits((us) => [...us, unit]);
    if (creatingTeamFor && creatingTeamFor !== "header") {
      await assignOrgUnit(creatingTeamFor, unit.id);
    } else {
      loadSetupStatus();
    }
  }

  async function addPerson(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim() || addingPerson) return;
    setAddingPerson(true);
    try {
      const created = await createDirectReport({ name: newName.trim(), email: newEmail.trim() || undefined });
      setReports((rs) => [...rs, created].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName("");
      setNewEmail("");
      loadSetupStatus();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to add person");
    } finally {
      setAddingPerson(false);
    }
  }

  function handleStep(id: "people" | "teams" | "roles" | "expectations") {
    if (id === "people") {
      document.getElementById("people-add-name")?.focus();
    } else if (id === "teams") {
      setCreatingTeamFor("header");
    } else if (id === "roles") {
      const firstUnassigned = reports.find((r) => !r.role_level_id);
      if (firstUnassigned) {
        setHighlightId(firstUnassigned.id);
        document.getElementById(`person-row-${firstUnassigned.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => setHighlightId(null), 2000);
      }
    } else if (id === "expectations") {
      onNavigateToExpectations();
      // The merged Roles & expectations section (Session 42, Plan S4+S5)
      // renders both halves stacked on one tab — scroll straight to the
      // expectations half instead of leaving the manager at the top of the
      // ladder cards.
      setTimeout(() => document.getElementById("expectations-block")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    }
  }

  const visibleReports = filterUnitId ? reports.filter((r) => r.org_unit_id === filterUnitId) : reports;
  const filterUnitName = filterUnitId ? orgUnits.find((u) => u.id === filterUnitId)?.name : null;

  return (
    <div>
      <h2 className="font-medium text-gray-900">Set up your team</h2>
      <p className="mt-1 text-sm text-gray-500">
        Add your people, then wire each one to a role and a team — create either inline, right here, if it doesn&apos;t exist
        yet. Expectations follow the role automatically. Editing levels within a ladder, or merging near-duplicate roles,
        still happens in{" "}
        <button onClick={onNavigateToRoles} className="underline">
          Roles &amp; expectations
        </button>
        .
      </p>

      <SetupProgressHeader status={setupStatus} onStep={handleStep} />

      {filterUnitId && (
        <div className="mt-4 flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-4 py-2 text-sm">
          <span className="text-gray-600">
            Showing people in <span className="font-medium text-gray-900">{filterUnitName ?? "this unit"}</span>
          </span>
          <button onClick={onClearFilter} className="text-gray-500 underline hover:text-gray-700">
            Clear filter
          </button>
        </div>
      )}

      <ul className="mt-6 space-y-2">
        {visibleReports.map((r) => {
          const person = peopleById.get(r.id);
          return (
            <li
              key={r.id}
              id={`person-row-${r.id}`}
              className={`flex flex-col gap-2 rounded-lg border px-4 py-3 transition-colors sm:flex-row sm:items-center sm:justify-between ${
                highlightId === r.id ? "border-amber-300 bg-amber-50" : "border-gray-200"
              }`}
            >
              <div className="min-w-0 flex-1 truncate">
                <p className="truncate text-sm font-medium text-gray-900">{r.name}</p>
                {!r.role_level_id && r.role_title && (
                  <p className="truncate text-xs text-gray-400">was: &quot;{r.role_title}&quot;</p>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <GroupedRoleSelect
                  roleLevels={roleLevels}
                  roleFamilies={roleFamilies}
                  value={r.role_level_id ?? ""}
                  onChange={(id) => assign(r, id)}
                  onCreateNew={() => setCreatingRoleFor(r)}
                  className="w-48 truncate rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                  placeholder="No role assigned"
                />
                <OrgUnitSelect
                  orgUnits={orgUnits}
                  value={r.org_unit_id ?? ""}
                  onChange={(id) => assignOrgUnit(r, id)}
                  onCreateNew={() => setCreatingTeamFor(r)}
                  className="w-44 truncate rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                />
                <ExpectationsChip person={person} roleLevelId={r.role_level_id} onDraft={onDraftExpectations} />
              </div>
            </li>
          );
        })}
        {visibleReports.length === 0 && reports.length > 0 && (
          <p className="py-2 text-sm text-gray-500">
            No one in {filterUnitName ?? "this unit"} yet.{" "}
            <button onClick={onClearFilter} className="underline hover:text-gray-700">
              Show everyone
            </button>
            .
          </p>
        )}
        {reports.length === 0 && (
          <p className="py-2 text-sm text-gray-500">No direct reports yet — add your first one below.</p>
        )}
      </ul>

      <form onSubmit={addPerson} className="mt-4 flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-gray-300 p-3">
        <div>
          <label className={labelCls}>Name</label>
          <input
            id="people-add-name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Priya Patel"
            className={`${inputCls} w-48`}
          />
        </div>
        <div>
          <label className={labelCls}>Email (optional)</label>
          <input
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="priya@company.com"
            className={`${inputCls} w-56`}
          />
        </div>
        <button type="submit" disabled={addingPerson || !newName.trim()} className={primaryBtnCls}>
          {addingPerson ? "Adding..." : "Add person"}
        </button>
      </form>

      {creatingRoleFor && (
        <CreateRoleModal onClose={() => setCreatingRoleFor(null)} onCreate={handleCreateRole} />
      )}
      {creatingTeamFor && (
        <CreateTeamModal onClose={() => setCreatingTeamFor(null)} onCreate={handleCreateTeam} />
      )}
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
  roleFamilies,
  roleLevelId,
  setRoleLevelId,
  kind,
  setKind,
  initialDraftRoleId,
  onConsumeInitialDraft,
  onError,
}: {
  roleLevels: RoleLevel[];
  roleFamilies: RoleFamily[];
  roleLevelId: string;
  setRoleLevelId: (id: string) => void;
  kind: ExpectationKind;
  setKind: (k: ExpectationKind) => void;
  // Session 41 (Plan S1) — People's expectations chip deep-links here: a
  // non-null id on mount opens DraftReviewPanel for that role immediately,
  // then onConsumeInitialDraft() clears it in the parent so it doesn't
  // reopen on a later visit to this section.
  initialDraftRoleId?: string | null;
  onConsumeInitialDraft?: () => void;
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

  useEffect(() => {
    if (initialDraftRoleId) {
      setDraftingRoleId(initialDraftRoleId);
      onConsumeInitialDraft?.();
    }
    // Only meant to fire once per arrival via the deep link — deliberately
    // omits onConsumeInitialDraft from deps (a new function identity each
    // render would otherwise re-run this).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDraftRoleId]);

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
        Expectations attach to a role — add your first role above, then come back here.
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
            roleFamilies={roleFamilies}
            coverage={coverage}
            onCell={openCell}
            onDraft={(id) => setDraftingRoleId(id)}
          />
        )
      ) : (
        <ExpectationDetail
          roleLevels={roleLevels}
          roleFamilies={roleFamilies}
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
  roleFamilies,
  coverage,
  onCell,
  onDraft,
}: {
  roleLevels: RoleLevel[];
  roleFamilies: RoleFamily[];
  coverage: ExpectationsCoverage | null;
  onCell: (roleId: string, kind: ExpectationKind) => void;
  onDraft: (roleId: string) => void;
}) {
  const countsByRole = new Map((coverage?.roles ?? []).map((r) => [r.role_level_id, r]));
  // Grouped by ladder (Session 40) — rows sub-headed by family instead of
  // one flat list of 13, same grouping used by the role selects.
  const groups = groupRoleLevelsByFamily(roleLevels, roleFamilies).filter((g) => g.levels.length > 0);

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
            {groups.map((g) => (
              <Fragment key={g.family?.id ?? "ungrouped"}>
                <tr className="border-b border-gray-100 bg-gray-50/60">
                  <td colSpan={5} className="px-4 py-1.5 text-xs font-medium text-gray-500">
                    {g.family?.name ?? UNGROUPED_LABEL}
                  </td>
                </tr>
                {g.levels.map((rl) => {
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
              </Fragment>
            ))}
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
  roleFamilies,
  roleLevelId,
  setRoleLevelId,
  kind,
  setKind,
  onBack,
  onDraft,
  onError,
}: {
  roleLevels: RoleLevel[];
  roleFamilies: RoleFamily[];
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
        <GroupedRoleSelect
          roleLevels={roleLevels}
          roleFamilies={roleFamilies}
          value={roleLevelId}
          onChange={setRoleLevelId}
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
        />
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
  roleFamilies,
  onError,
}: {
  roleLevels: RoleLevel[];
  roleFamilies: RoleFamily[];
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
          <span className="font-medium text-gray-700">Roles &amp; expectations</span> and come back here.
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
                  <GroupedRoleSelect
                    roleLevels={roleLevelsWithoutUnit}
                    roleFamilies={roleFamilies}
                    value={wuRoleLevelId}
                    onChange={setWuRoleLevelId}
                    className={inputCls}
                  />
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
