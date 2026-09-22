// Shared labels and date helpers for the Beyond the team pages. Not a route.

import { GoalStatus, OutsideRelationship } from "@/lib/api";

// Display order on the page: up the chain first, then across, then out.
export const RELATIONSHIP_ORDER: OutsideRelationship[] = [
  "manager",
  "skip_level",
  "peer",
  "indirect_report",
  "cross_functional",
  "other",
];

export const RELATIONSHIP_LABEL: Record<OutsideRelationship, string> = {
  manager: "Your manager",
  skip_level: "Skip-level",
  peer: "Peer",
  indirect_report: "Indirect report",
  cross_functional: "Cross-functional",
  other: "Other",
};

// Group headings on the People list.
export const RELATIONSHIP_GROUP: Record<OutsideRelationship, string> = {
  manager: "Your manager",
  skip_level: "Skip-level",
  peer: "Peers",
  indirect_report: "Indirect reports",
  cross_functional: "Cross-functional",
  other: "Everyone else",
};

export const CHECK_IN_STATUS_OPTIONS: { id: GoalStatus; label: string }[] = [
  { id: "on_track", label: "On track" },
  { id: "at_risk", label: "At risk" },
  { id: "active", label: "Active" },
  { id: "completed", label: "Completed" },
  { id: "cancelled", label: "Cancelled" },
];

// Local (not UTC) YYYY-MM-DD. Meeting dates are encoded at noon UTC, so
// reading them through the local clock keeps the calendar day stable.
export function localDateStr(d: Date = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function isoToDateStr(iso: string | null | undefined) {
  return iso ? localDateStr(new Date(iso)) : "";
}

export function shortDate(iso: string | null | undefined) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function longDate(iso: string | null | undefined) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

export function meetingTitle(m: { title: string | null; kind: string; people: { name: string }[] }) {
  if (m.title) return m.title;
  if (m.kind === "one_on_one" && m.people[0]) return `1:1 with ${m.people[0].name}`;
  if (m.people.length) return `Meeting with ${m.people.map((p) => p.name).join(", ")}`;
  return "Untitled meeting";
}
