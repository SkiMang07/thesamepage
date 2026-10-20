// How a unit is named wherever one is picked: by how it relates to the person
// looking, not by its abstract type (docs/GOAL_ATTRIBUTION_SCOPING.md §A2).
//
//   Yours        a unit you lead               "Enterprise & Strategic (your team)"
//   Above you    the parent of your top unit   "Customer Success (your boss's group)"
//                anything higher               "Operations (above your boss's group)"
//   Under you    below a unit you lead         "Platform (Ines's team)", or
//                                              "Platform (a team under you)" with no leader on the app
//   Other        not related to you            "Billing", listed under "Other teams and departments"
//
// "Yours" follows goal_relationship() in backend/routes/onboarding.py: every
// unit you lead is yours, and "above" is walked from the top ones. The level
// (team or department) is still stored as it is today; only the wording
// changes. Someone who leads no unit gets null, and the caller keeps its
// existing labels. Pure, no imports beyond types (lib/unitRelation.test.mjs
// runs this file directly under Node).

import type { OrgMember, OrgUnit } from "./api";

export type UnitRelation = "yours" | "above" | "under" | "other";

export type RelativeUnit = {
  unit: OrgUnit;
  relation: UnitRelation;
  /** The name plus how it relates to you; plain name for "other". */
  label: string;
};

export const OTHER_UNITS_HEADING = "Other teams and departments";

type Leader = Pick<OrgMember, "id" | "full_name" | "is_you">;

const kind = (u: OrgUnit) => (u.unit_type === "department" ? "department" : "team");

function possessive(name: string) {
  return `${name}'s`;
}

/**
 * Every unit, related to the viewer and labelled. `led` is what
 * GET /api/org-units/led returns (units the viewer directly leads); `members`
 * names the leaders of units under you. Null when the viewer leads nothing.
 * Order: yours, above you (nearest first), under you, other; by name within each.
 */
export function relativeUnits(units: OrgUnit[], led: Pick<OrgUnit, "id">[], members: Leader[] = []): RelativeUnit[] | null {
  const byId = new Map(units.map((u) => [u.id, u]));
  const ledIds = new Set(led.map((u) => u.id).filter((id) => byId.has(id)));
  if (ledIds.size === 0) return null;

  // Above: walk up from each top unit you lead. Depth 1 is your boss's group.
  const depth = new Map<string, number>();
  for (const id of ledIds) {
    const u = byId.get(id)!;
    if (u.parent_unit_id && ledIds.has(u.parent_unit_id)) continue; // not a top unit
    let current = u.parent_unit_id ? byId.get(u.parent_unit_id) : undefined;
    let d = 1;
    while (current && !ledIds.has(current.id) && d <= 20) {
      depth.set(current.id, Math.min(depth.get(current.id) ?? d, d));
      current = current.parent_unit_id ? byId.get(current.parent_unit_id) : undefined;
      d++;
    }
  }

  // Under: anything with a unit you lead somewhere above it.
  const isUnder = (u: OrgUnit) => {
    let current = u.parent_unit_id ? byId.get(u.parent_unit_id) : undefined;
    for (let hops = 0; current && hops < 20; hops++) {
      if (ledIds.has(current.id)) return true;
      current = current.parent_unit_id ? byId.get(current.parent_unit_id) : undefined;
    }
    return false;
  };

  const leaderOf = new Map(members.map((m) => [m.id, m]));
  const underLabel = (u: OrgUnit) => {
    const leader = u.leader_user_id ? leaderOf.get(u.leader_user_id) : undefined;
    const first = leader && !leader.is_you ? leader.full_name.trim().split(/\s+/)[0] : "";
    return first ? `${u.name} (${possessive(first)} ${kind(u)})` : `${u.name} (a ${kind(u)} under you)`;
  };

  const out: (RelativeUnit & { rank: number; depth: number })[] = units.map((u) => {
    if (ledIds.has(u.id)) return { unit: u, relation: "yours", label: `${u.name} (your ${kind(u)})`, rank: 0, depth: 0 };
    const d = depth.get(u.id);
    if (d !== undefined)
      return {
        unit: u,
        relation: "above",
        label: d === 1 ? `${u.name} (your boss's group)` : `${u.name} (above your boss's group)`,
        rank: 1,
        depth: d,
      };
    if (isUnder(u)) return { unit: u, relation: "under", label: underLabel(u), rank: 2, depth: 0 };
    return { unit: u, relation: "other", label: u.name, rank: 3, depth: 0 };
  });

  // A department you lead comes before the teams under it; then by name.
  out.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.depth - b.depth ||
      Number(b.unit.unit_type === "department") - Number(a.unit.unit_type === "department") ||
      a.unit.name.localeCompare(b.unit.name),
  );
  return out.map(({ unit, relation, label }) => ({ unit, relation, label }));
}

/** One unit's relative label, or null when the viewer leads nothing (keep today's label). */
export function relativeUnitLabel(unitId: string, units: OrgUnit[], led: Pick<OrgUnit, "id">[], members: Leader[] = []): string | null {
  return relativeUnits(units, led, members)?.find((r) => r.unit.id === unitId)?.label ?? null;
}
