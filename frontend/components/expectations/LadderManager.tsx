"use client";

// Ladder and level management for Roles & expectations (/app/expectations →
// "Manage ladders"). Moved here unchanged in behaviour from Settings' old
// "Roles & expectations" section: create/rename/delete ladders, add levels
// above or below, edit a level's title, move a level to another ladder (the
// merge mechanic — a PUT with a different role_family_id) and delete it.
// Defining expectations is the Define a role / role page flow, never here.

import { useState } from "react";
import Link from "next/link";
import {
  RoleFamily,
  RoleLevel,
  createRoleFamily,
  createRoleLevel,
  deleteRoleFamily,
  deleteRoleLevel,
  updateRoleFamily,
  updateRoleLevel,
} from "@/lib/api";
import NoteField from "@/components/NoteField";
import { BTN_PRIMARY, BTN_SECONDARY, INPUT, LABEL } from "@/lib/tokens";
import { UNGROUPED_LABEL, groupRoleLevelsByFamily } from "@/components/RolePicker";

const inputCls = INPUT;
const labelCls = LABEL;
const primaryBtnCls = BTN_PRIMARY;

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
    <form onSubmit={handleSubmit} className="mt-3 space-y-3 rounded-lg border border-dashed border-control p-4">
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
        <NoteField
          value={responsibilities}
          onChange={setResponsibilities}
          rows={2}
          baseClassName={inputCls}
          placeholder="What this role owns, in a sentence or two"
        />
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={saving} className={primaryBtnCls}>
          {saving ? savingLabel : dynamicLevelLabel ? `Add L${jobLevel}` : submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="text-sm text-ink-secondary hover:text-ink">
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
    <li className="rounded-lg border border-hairline px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">
            L{role.job_level}
            {overrideTitle && <span className="ml-2 font-normal text-ink-secondary">&middot; {overrideTitle}</span>}
          </p>
          {role.job_responsibilities && (
            <p className={`mt-1 text-xs text-ink-secondary ${jdExpanded ? "" : "line-clamp-2"}`}>{role.job_responsibilities}</p>
          )}
          {role.job_responsibilities && role.job_responsibilities.length > 100 && (
            <button onClick={onToggleJd} className="mt-0.5 text-xs text-ink-muted hover:text-ink-body">
              {jdExpanded ? "Show less" : "Show more"}
            </button>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <button onClick={onStartMove} className="text-xs text-ink-muted hover:text-ink-body" title="Move to another ladder">
            Move&hellip;
          </button>
          <button onClick={onStartEdit} className="text-xs text-ink-muted hover:text-ink-body" title="Edit level">
            Edit
          </button>
          <button onClick={onRemove} className="text-xs text-ink-muted hover:text-red-700" title="Delete level">
            Remove
          </button>
        </div>
      </div>
      {isMoving && (
        <div className="mt-2 flex items-center gap-2 border-t border-divider pt-2">
          <span className="text-xs text-ink-secondary">Move to</span>
          <select
            defaultValue=""
            onChange={(e) => onMove(e.target.value || null)}
            className="rounded-md border border-control px-2 py-1 text-xs"
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
          <button onClick={onCancelMove} className="text-xs text-ink-muted hover:text-ink">
            Cancel
          </button>
        </div>
      )}
    </li>
  );
}

// Ladder merge nudge (Session 43, Polish Pass B, finding P3 — see
// docs/TEAM_SETUP_UX_REVIEW.md §7.3 item 9). A 1-level family whose name
// contains, or is contained by, another family's name (after stripping a
// leading "Senior/Lead/Staff " variant) is flagged as a likely level of that
// other ladder — e.g. "Senior Corporate CSM" next to "Corporate Customer
// Success Manager". Heuristic + dismiss only, never auto-merges; the actual
// merge still goes through "Move to another ladder…" on the level row.
const SENIORITY_PREFIXES = ["senior ", "sr. ", "sr ", "lead ", "staff ", "principal "];

function stripSeniorityPrefix(name: string): string {
  const lower = name.toLowerCase();
  for (const prefix of SENIORITY_PREFIXES) {
    if (lower.startsWith(prefix)) return lower.slice(prefix.length).trim();
  }
  return lower;
}

function suggestLadderMerges(
  roleFamilies: RoleFamily[],
  roleLevels: RoleLevel[]
): { family: RoleFamily; target: RoleFamily }[] {
  const levelCountByFamily = new Map<string, number>();
  for (const rl of roleLevels) {
    if (!rl.role_family_id) continue;
    levelCountByFamily.set(rl.role_family_id, (levelCountByFamily.get(rl.role_family_id) ?? 0) + 1);
  }

  const suggestions: { family: RoleFamily; target: RoleFamily }[] = [];
  for (const family of roleFamilies) {
    if ((levelCountByFamily.get(family.id) ?? 0) !== 1) continue; // only 1-level families
    const stripped = stripSeniorityPrefix(family.name);
    const lowerName = family.name.trim().toLowerCase();
    const target = roleFamilies.find((other) => {
      if (other.id === family.id) return false;
      const otherLower = other.name.trim().toLowerCase();
      if (!otherLower) return false;
      return stripped === otherLower || lowerName.includes(otherLower) || otherLower.includes(stripped);
    });
    if (target) suggestions.push({ family, target });
  }
  return suggestions;
}

export default function LadderManager({
  roleLevels,
  setRoleLevels,
  roleFamilies,
  setRoleFamilies,
  onChanged,
  onError,
}: {
  roleLevels: RoleLevel[];
  setRoleLevels: React.Dispatch<React.SetStateAction<RoleLevel[]>>;
  roleFamilies: RoleFamily[];
  setRoleFamilies: React.Dispatch<React.SetStateAction<RoleFamily[]>>;
  onChanged: () => void;
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
  // Merge nudge (Session 43, Polish Pass B, finding P3) — dismissed
  // suggestions are local/session-only (not persisted), same "one-time
  // hint" scope as the plan calls for; a fresh page load can resurface a
  // dismissed suggestion if the underlying ladders still look mergeable.
  const [dismissedMergeIds, setDismissedMergeIds] = useState<Set<string>>(new Set());

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
      onChanged();
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
      onChanged();
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
      onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to save role");
    }
  }

  async function removeLevel(id: string) {
    try {
      await deleteRoleLevel(id);
      setRoleLevels((r) => r.filter((x) => x.id !== id));
      // The backend also unassigns anyone in this role; onChanged reloads
      // the overview so their names drop off the row.
      setEditingLevelId((current) => (current === id ? null : current));
      onChanged();
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
      onChanged();
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
      onChanged();
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
      onChanged();
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

  const mergeSuggestions = suggestLadderMerges(roleFamilies, roleLevels).filter(
    (s) => !dismissedMergeIds.has(s.family.id)
  );

  return (
    <div>
      <p className="text-sm text-ink-secondary">
        A ladder groups the levels of one role — L1, L2, L3&hellip; Expectations attach to a level. Assigning
        people to roles lives in{" "}
        <Link href="/app/settings?section=people" className="font-medium text-ink-body underline hover:text-ink">
          Settings → People &amp; structure
        </Link>
        .
      </p>

      {/* Merge nudge (Session 43, Polish Pass B, finding P3) — a one-time
          heuristic hint, dismiss-only, no auto-merge. Andrew still has to
          click Move… himself; this just points at the likely candidates. */}
      {mergeSuggestions.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {mergeSuggestions.map((s) => (
            <p
              key={s.family.id}
              className="flex items-center justify-between gap-3 rounded-md bg-blue-50 px-3 py-1.5 text-xs text-blue-800"
            >
              <span>
                <span className="font-medium">{s.family.name}</span> looks like a level of{" "}
                <span className="font-medium">{s.target.name}</span> — use Move&hellip; on its level row to merge.
              </span>
              <button
                onClick={() => setDismissedMergeIds((ids) => new Set(ids).add(s.family.id))}
                className="shrink-0 text-blue-400 hover:text-brand-hover"
              >
                Dismiss
              </button>
            </p>
          ))}
        </div>
      )}

      <div className="mt-4 space-y-5">
        {groups.map((g) => {
          if (!g.family) {
            // "Ungrouped" bucket — levels with no family (never assigned
            // one, or their family was deleted). Flat list, not a ladder
            // card, with an inline "Move to a ladder" picker per row.
            if (g.levels.length === 0) return null;
            return (
              <div key="ungrouped">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{UNGROUPED_LABEL}</h3>
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
            <div key={family.id} className="rounded-lg border border-hairline p-4">
              <div className="flex items-center justify-between gap-3">
                {renamingFamilyId === family.id ? (
                  <div className="flex flex-1 items-center gap-2">
                    <input
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      className={`${inputCls} max-w-xs`}
                      autoFocus
                    />
                    <button onClick={() => renameFamily(family.id)} className="text-xs font-medium text-ink hover:underline">
                      Save
                    </button>
                    <button onClick={() => setRenamingFamilyId(null)} className="text-xs text-ink-secondary hover:text-ink">
                      Cancel
                    </button>
                  </div>
                ) : (
                  <h3 className="font-medium text-ink">
                    {family.name}
                    <span className="ml-2 text-xs font-normal text-ink-muted">
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
                      className="text-xs text-ink-muted hover:text-ink-body"
                    >
                      Rename
                    </button>
                    {g.levels.length === 0 && (
                      <button onClick={() => removeFamily(family.id)} className="text-xs text-ink-muted hover:text-red-700">
                        Delete
                      </button>
                    )}
                  </div>
                )}
              </div>

              {g.levels.length === 0 ? (
                <p className="mt-2 text-xs text-ink-muted">No levels yet — add the first one below, or delete this ladder.</p>
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
                <div className="mt-3 flex flex-wrap items-center gap-4">
                  <button
                    onClick={() => setAddingLevel({ familyId: family.id, level: nextLevelUp })}
                    className="text-xs font-medium text-brand hover:text-brand-hover"
                  >
                    + Add L{nextLevelUp}
                  </button>
                  {/* Defining a level from a job description is the Define a
                      role flow, pinned to this ladder, so the expectations it
                      drafts go through review and approval. */}
                  <Link
                    href={`/app/expectations/new?family=${family.id}`}
                    className="text-xs font-medium text-ink-secondary hover:text-ink-body"
                  >
                    Define a level from a job description
                  </Link>
                  {nextLevelDown !== null && (
                    <button
                      onClick={() => setAddingLevel({ familyId: family.id, level: nextLevelDown })}
                      className="text-xs font-medium text-ink-secondary hover:text-ink-body"
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
          <p className="text-sm text-ink-secondary">No roles yet. Add your first ladder below.</p>
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
        <button onClick={() => setAddingLadder(true)} className={`${BTN_SECONDARY} mt-4`}>
          + Add a ladder by hand
        </button>
      )}
    </div>
  );
}
