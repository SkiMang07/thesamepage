"use client";

// Shared role/team display + picker helpers (extracted from
// app/app/settings/page.tsx, Session 42, Plan S4+S5 — see
// docs/TEAM_SETUP_UX_REVIEW.md §6). Settings > Roles & expectations, People,
// Capacity, the direct-report detail page, and the Team roster cards all
// need the same "ladder-grouped role label" and "department/team label"
// formatting — this used to live only in settings/page.tsx, which worked
// while only Settings needed it, but the person page and roster cards now
// need the identical formatting so a role reads the same everywhere.

import { OrgUnit, RoleFamily, RoleLevel } from "@/lib/api";

// Session 40 (Plan S2) display convention: once a level has a family, the
// family name takes over as the display name ("Corporate CSM · L3");
// job_role stays as the level's optional title override, shown separately
// wherever the ladder card itself is rendered (Settings' Roles &
// expectations section), not in this compact label used everywhere else
// (People/Expectations/Capacity selects, the coverage grid, "copy from"
// pickers, the direct-report page, Team roster cards).
export function roleLabel(rl: RoleLevel) {
  // functional_team (free text) dropped from the label as of Session 11 —
  // "which team" now lives on the direct report as a structured org_unit_id,
  // shown separately (People section, Team roster cards). The column stays
  // in the schema, just unused here.
  const name = rl.role_families?.name ?? rl.job_role;
  return `${name} · L${rl.job_level}`;
}

export function orgUnitLabel(ou: OrgUnit) {
  return `${ou.unit_type === "department" ? "Department" : "Team"} · ${ou.name}`;
}

export const UNGROUPED_LABEL = "Ungrouped";

// Groups role_levels by family for both the ladder-card view (Settings'
// RolesSection) and every grouped <select> elsewhere. Families with zero
// levels still appear (the "ghost card" state) since they come from
// roleFamilies, not from any role_level's embed. "Ungrouped" (role_family_id
// null, or pointing at a family this org can no longer see) sorts last.
export function groupRoleLevelsByFamily(
  roleLevels: RoleLevel[],
  roleFamilies: RoleFamily[]
): { family: RoleFamily | null; levels: RoleLevel[] }[] {
  const levelsByFamilyId = new Map<string, RoleLevel[]>();
  const ungrouped: RoleLevel[] = [];
  for (const rl of roleLevels) {
    if (rl.role_family_id) {
      const bucket = levelsByFamilyId.get(rl.role_family_id) ?? [];
      bucket.push(rl);
      levelsByFamilyId.set(rl.role_family_id, bucket);
    } else {
      ungrouped.push(rl);
    }
  }
  const sortByLevel = (a: RoleLevel, b: RoleLevel) => a.job_level - b.job_level;
  const groups: { family: RoleFamily | null; levels: RoleLevel[] }[] = [...roleFamilies]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((family) => ({
      family,
      levels: (levelsByFamilyId.get(family.id) ?? []).sort(sortByLevel),
    }));
  if (ungrouped.length > 0) {
    groups.push({ family: null, levels: ungrouped.sort(sortByLevel) });
  }
  return groups;
}

export const CREATE_NEW_VALUE = "__create_new__";

// Grouped role <select> — used by People, Expectations, Capacity, the
// direct-report detail page's inline "assign a role" picker, and Settings'
// own Roles & expectations section, so a role dropdown always reads as ~5
// ladders instead of 13 flat rows. onCreateNew (Session 41, Plan S1) is
// optional: when passed, an extra "+ Create new role…" option appears at
// the top and selecting it calls onCreateNew() instead of onChange(), so a
// caller can open an inline create form without touching plain usages.
export function GroupedRoleSelect({
  roleLevels,
  roleFamilies,
  value,
  onChange,
  onCreateNew,
  className,
  placeholder,
}: {
  roleLevels: RoleLevel[];
  roleFamilies: RoleFamily[];
  value: string;
  onChange: (id: string) => void;
  onCreateNew?: () => void;
  className?: string;
  placeholder?: string;
}) {
  const groups = groupRoleLevelsByFamily(roleLevels, roleFamilies).filter((g) => g.levels.length > 0);
  return (
    <select
      value={value}
      onChange={(e) => {
        if (e.target.value === CREATE_NEW_VALUE) {
          onCreateNew?.();
        } else {
          onChange(e.target.value);
        }
      }}
      className={className}
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {onCreateNew && <option value={CREATE_NEW_VALUE}>+ Create new role…</option>}
      {groups.map((g) => (
        <optgroup key={g.family?.id ?? "ungrouped"} label={g.family?.name ?? UNGROUPED_LABEL}>
          {g.levels.map((rl) => (
            <option key={rl.id} value={rl.id}>
              {roleLabel(rl)}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

// Small "org unit" <select> — org units aren't grouped by family like
// roles, just department-then-team ordered (matches orgUnits' own fetch
// order), so this stays a flat <select>. Same onCreateNew mechanic as
// GroupedRoleSelect above.
export function OrgUnitSelect({
  orgUnits,
  value,
  onChange,
  onCreateNew,
  className,
}: {
  orgUnits: OrgUnit[];
  value: string;
  onChange: (id: string) => void;
  onCreateNew: () => void;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => {
        if (e.target.value === CREATE_NEW_VALUE) onCreateNew();
        else onChange(e.target.value);
      }}
      className={className}
    >
      <option value="">No team assigned</option>
      <option value={CREATE_NEW_VALUE}>+ Create new team…</option>
      {orgUnits.map((ou) => (
        <option key={ou.id} value={ou.id}>
          {orgUnitLabel(ou)}
        </option>
      ))}
    </select>
  );
}
