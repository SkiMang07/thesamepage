import { test } from "node:test";
import assert from "node:assert/strict";

import { inTeamTable, matchesOwner, matchesState, sortRows, staleNote, stateOf } from "./commitmentsTable.ts";

const TODAY = "2026-10-08";

const row = (over = {}) => ({
  id: "x", status: "open", due_date: null, owner: "you", direct_report_id: null,
  created_at: "2026-10-01T10:00:00Z", completed_at: null, is_team_commitment: false, org_unit_id: null,
  ...over,
});

test("state buckets: overdue, within 7 days, later, undated", () => {
  assert.equal(stateOf(row({ due_date: "2026-10-07" }), TODAY), "overdue");
  assert.equal(stateOf(row({ due_date: "2026-10-08" }), TODAY), "week");
  assert.equal(stateOf(row({ due_date: "2026-10-15" }), TODAY), "week");
  assert.equal(stateOf(row({ due_date: "2026-10-16" }), TODAY), "later");
  assert.equal(stateOf(row(), TODAY), "undated");
});

test("Open holds every open row; Done holds only done", () => {
  assert.ok(matchesState(row({ due_date: "2026-10-01" }), "open", TODAY));
  assert.ok(!matchesState(row({ status: "done" }), "open", TODAY));
  assert.ok(matchesState(row({ status: "done" }), "done", TODAY));
  assert.ok(!matchesState(row({ status: "dropped" }), "done", TODAY));
});

test("owner filter: you, your people, a person covers both sides", () => {
  const mine = row({ owner: "you", direct_report_id: "leah" });
  const leahs = row({ owner: "report", direct_report_id: "leah" });
  assert.ok(matchesOwner(mine, "you") && !matchesOwner(leahs, "you"));
  assert.ok(matchesOwner(leahs, "team") && !matchesOwner(mine, "team"));
  assert.ok(matchesOwner(mine, "leah") && matchesOwner(leahs, "leah"));
  assert.ok(!matchesOwner(row({ owner: "counterpart" }), "team"));
});

test("sort: overdue oldest first, then dated, then undated oldest first", () => {
  const rows = [
    row({ id: "undated-new", created_at: "2026-10-05T00:00:00Z" }),
    row({ id: "soon", due_date: "2026-10-10" }),
    row({ id: "overdue-recent", due_date: "2026-10-06" }),
    row({ id: "undated-old", created_at: "2026-08-20T00:00:00Z" }),
    row({ id: "overdue-old", due_date: "2026-09-01" }),
  ];
  assert.deepEqual(sortRows(rows, TODAY).map((r) => r.id), ["overdue-old", "overdue-recent", "soon", "undated-old", "undated-new"]);
});

test("still on? after 30 quiet days undated, or two weeks overdue", () => {
  assert.equal(staleNote(row(), "2026-09-08", TODAY), null);
  assert.equal(staleNote(row(), "2026-09-01", TODAY), "Open 5 weeks, no date. Still on?");
  assert.equal(staleNote(row({ due_date: "2026-09-30" }), "2026-09-01", TODAY), null);
  assert.equal(staleNote(row({ due_date: "2026-09-20" }), "2026-09-01", TODAY), "Still on?");
  assert.equal(staleNote(row({ status: "done" }), "2026-01-01", TODAY), null);
});

test("team table: team rows for the selected team; 1:1 rows only on request, only its people", () => {
  const members = new Set(["leah", "jordan"]);
  const opts = { teamId: "cs", memberIds: members, includeOneOnOnes: false };
  const teamRow = row({ is_team_commitment: true, org_unit_id: "cs" });
  const otherTeam = row({ is_team_commitment: true, org_unit_id: "sales" });
  const oneOnOne = row({ owner: "you", direct_report_id: "leah" });
  const outsider = row({ owner: "you", direct_report_id: "sam" });
  assert.ok(inTeamTable(teamRow, opts));
  assert.ok(!inTeamTable(otherTeam, opts));
  assert.ok(!inTeamTable(oneOnOne, opts));
  assert.ok(inTeamTable(oneOnOne, { ...opts, includeOneOnOnes: true }));
  assert.ok(!inTeamTable(outsider, { ...opts, includeOneOnOnes: true }));
  assert.ok(inTeamTable(otherTeam, { ...opts, teamId: null }));       // All teams
  assert.ok(!inTeamTable(row({ owner: "counterpart" }), { ...opts, includeOneOnOnes: true }));
});
