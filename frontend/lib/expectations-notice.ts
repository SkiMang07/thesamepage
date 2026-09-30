// What the Roles & expectations overview says after an approval. Pure, no
// imports, so Node's test runner can load it.
//
// Claim only what is true. The count is the role's active approved rows from
// GET /overview (`counts`), which is exactly what fetch_role_expectations feeds
// the 1:1 prep prompt; a role nobody holds gets no promise about a prep sheet.

type LevelLike = {
  people: { name: string }[];
  counts: { responsibilities: number; skills: number; values: number };
};

const USED_IN = "They’re now used in 1:1 preparation, development and assessments.";
const OPEN_DETAIL = "The open detail stays listed here until it’s resolved.";

function first(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

function possessive(name: string): string {
  return `${name}’s`;
}

// "Sofia’s", "Sofia’s and Andre’s", "Sofia’s, Andre’s and Mei’s". First names,
// unless two holders share one.
function holders(people: { name: string }[]): string {
  const firsts = people.map((p) => first(p.name));
  const shared = new Set(firsts).size < firsts.length;
  const names = (shared ? people.map((p) => p.name.trim()) : firsts).map(possessive);
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// The concrete line, or null when there is no payoff to claim.
export function approvedPayoff(level: LevelLike | null | undefined): string | null {
  if (!level) return null;
  const people = level.people.filter((p) => p.name && p.name.trim());
  const n = level.counts.responsibilities + level.counts.skills + level.counts.values;
  if (!people.length || n <= 0) return null;
  const sheet = people.length === 1 ? "next prep sheet measures" : "next prep sheets measure";
  const what = n === 1 ? "this one" : `these ${n}`;
  return `${holders(people)} ${sheet} against ${what}.`;
}

export function approvedNotice(kind: "approved" | "approved-open", level: LevelLike | null | undefined): string {
  const payoff = approvedPayoff(level);
  const tail = kind === "approved-open" ? OPEN_DETAIL : USED_IN;
  return ["Expectations approved.", payoff, tail].filter(Boolean).join(" ");
}
