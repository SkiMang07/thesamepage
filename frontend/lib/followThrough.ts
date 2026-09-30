// Words for one Follow-through bar on Mission Control.
//
// The bars hold dated commitments only (completed, due, overdue). Open
// commitments with no due date are counted separately, so a group can have
// no bar and still have open work. Saying "0 commitments" there reads as
// "you have none", which is the opposite of what the records say.

export type FollowThroughCopy = {
  countLabel: string;
  emptyText: string | null;
  undatedNote: string | null;
};

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export function followThroughCopy(total: number, undated: number, phrase: string): FollowThroughCopy {
  const undatedNote =
    undated > 0 ? `${plural(undated, "open commitment")} with no due date, not shown in the bar.` : null;
  return {
    countLabel: total > 0 ? plural(total, "dated commitment") : undated > 0 ? `${undated} open, no due date` : "0 commitments",
    emptyText: total === 0 ? `Nothing completed, due, or overdue ${phrase}.` : null,
    undatedNote,
  };
}
