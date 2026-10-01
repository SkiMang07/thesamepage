// Run: npm run test:notes-dump-placement  (Node's built-in test runner, no dependencies)
import assert from "node:assert/strict";
import { test } from "node:test";
import { NOT_ON_TEAM, buildItems, initialKept, placement, problem, resolve } from "./notesDumpPlacement.ts";

const names = { priya: "Priya Nair", brennan: "Brennan Cole", sam: "Sam Ortiz" };
const nameOf = (id) => names[id];

// The shape of a parse response, with one row of each kind.
const draft = {
  org_units: [], role_assignments: [], goals: [], unmatched_people: [], other_names: [], max_roles: 5, overflow: 0, truncated: false,
  nothing_found: false, people: Object.entries(names).map(([id, name]) => ({ id, name })),
  expectations: [{ key: "exp1", report_id: "priya", person_name: "Priya Nair", role_sentences: ["Priya owns onboarding.", "I want a weekly note from her."] }],
  commitments: [
    // Jamal's Gwen: filed under the report, though it is owed to someone else.
    { key: "owe1", committed_by: "manager", report_id: "brennan", person_name: "Brennan Cole", description: "Give Brennan a written summary for HR",
      due_date: "2026-11-01", excerpt: "Gwen needs a written summary on Brennan for HR.", low: false, sentences: ["Gwen needs a written summary on Brennan for HR."] },
    { key: "owe2", committed_by: "direct_report", report_id: "sam", person_name: "Sam Ortiz", description: "Send the plan",
      due_date: null, excerpt: "Sam owes me the plan.", low: true, sentences: ["Sam owes me the plan."] },
  ],
  person_notes: [{ key: "note1", report_id: "priya", person_name: "Priya Nair", text: "Wants a staff path.", occurred_on: null, excerpt: "Wants a staff path.", low: false, sentences: ["Wants a staff path."] }],
  unplaced: [{ key: "u1", text: "Ride-alongs for Sam, twice a month.", report_id: "sam" }, { key: "u2", text: "Weekly standup is Tuesdays.", report_id: null }],
  unplaced_more: 0,
};
const rows = { priya: "ok" };
const run = (moves = {}, kept = initialKept(draft), edits = {}, roleRows = rows) =>
  resolve(buildItems(draft), moves, kept, edits, roleRows, nameOf);

test("changing nothing saves what the server proposed, and an unplaced sentence saves nothing", () => {
  const r = run();
  assert.deepEqual(r.commitments, [{ report_id: "brennan", description: "Give Brennan a written summary for HR", due_date: "2026-11-01", committed_by: "manager" }]);
  assert.deepEqual(r.person_notes, [{ report_id: "priya", text: "Wants a staff path." }]);
  assert.deepEqual(r.roleSentences, { priya: ["Priya owns onboarding.", "I want a weekly note from her."] });
  // owe2 starts unchecked (not stated plainly); u1 and u2 start unchecked.
  assert.equal(initialKept(draft).owe2, false);
  assert.equal(initialKept(draft).u1, false);
});

test("Gwen's summary moved off Brennan is saved with Gwen, or nowhere", () => {
  assert.equal(run({ owe1: { person: NOT_ON_TEAM } }).commitments.length, 0);
  assert.equal(problem(buildItems(draft)[0], { owe1: { person: NOT_ON_TEAM } }, rows, nameOf), "Not on your team, so nothing is saved.");
  assert.equal(run({ owe1: { person: "sam" } }).commitments[0].report_id, "sam");
});

test("a promise moved to the role is tagged as the sentences it came from, and leaves the commitments", () => {
  const r = run({ owe1: { lane: "role", person: "priya" } });
  assert.equal(r.commitments.length, 0);
  assert.ok(r.roleSentences.priya.includes("Gwen needs a written summary on Brennan for HR."));
  assert.ok(r.roleSentences.priya.includes("Priya owns onboarding."));          // what was already tagged stays
});

test("a role line moved out is no longer read by the draft", () => {
  const r = run({ "exp1:r1": { lane: "you_owe", person: "priya" } });
  assert.deepEqual(r.roleSentences, { priya: ["Priya owns onboarding."] });
  assert.deepEqual(r.commitments.at(-1), { report_id: "priya", description: "I want a weekly note from her.", due_date: null, committed_by: "manager" });
});

test("an unplaced sentence is saved only once it has a lane and a person, and is checked", () => {
  const kept = { ...initialKept(draft), u1: true, u2: true };
  const r = run({ u1: { lane: "they_owe" }, u2: { lane: "private" } }, kept);   // u1 names Sam; u2 names nobody
  assert.deepEqual(r.commitments.filter((c) => c.report_id === "sam"), [
    { report_id: "sam", description: "Ride-alongs for Sam, twice a month.", due_date: null, committed_by: "direct_report" }]);
  assert.equal(r.person_notes.length, 1);                                        // u2 has no person yet: not saved
  assert.equal(problem(buildItems(draft).find((i) => i.id === "u2"), { u2: { lane: "private" } }, rows, nameOf), "Choose who it is about.");
  assert.equal(problem(buildItems(draft).find((i) => i.id === "u1"), {}, rows, nameOf), "Choose where this goes.");
});

test("a role line for someone with no role row can't be saved, and says so", () => {
  const item = buildItems(draft).find((i) => i.id === "u1");
  const moves = { u1: { lane: "role" } };
  assert.match(problem(item, moves, rows, nameOf), /Sam has no role row from this read/);
  assert.equal(run(moves, { ...initialKept(draft), u1: true }).roleSentences.sam, undefined);
  assert.deepEqual(placement(item, moves, rows), "unplaced");           // still visible, with the unplaced sentences
  assert.deepEqual(placement(item, moves, { ...rows, sam: "ok" }), { role: "sam" });
  assert.deepEqual(placement(item, moves, { ...rows, sam: "blocked" }), "unplaced");     // a blocked row shows no lines
  assert.match(problem(item, moves, { ...rows, sam: "unchecked" }, nameOf), /Keep Sam’s role row/);
  assert.match(problem(item, moves, { ...rows, sam: "blocked" }, nameOf), /already has a draft/);
});

test("an edit changes what is saved, never what a role line says", () => {
  const edits = { owe1: "  Send HR the summary on Brennan  ", "exp1:r0": "ignored" };
  const r = run({}, initialKept(draft), edits);
  assert.equal(r.commitments[0].description, "Send HR the summary on Brennan");
  assert.equal(r.roleSentences.priya[0], "Priya owns onboarding.");
});

test("a due date stays with the promise it was read with, not a sentence moved in", () => {
  const kept = { ...initialKept(draft), u1: true };
  const r = run({ u1: { lane: "you_owe", person: "sam" }, owe1: { lane: "they_owe" } }, kept);
  assert.equal(r.commitments.find((c) => c.description.startsWith("Ride-alongs")).due_date, null);
  assert.equal(r.commitments.find((c) => c.description.startsWith("Give Brennan")).due_date, "2026-11-01");
});

test("an unchecked row saves nothing wherever it sits", () => {
  const r = run({ owe1: { lane: "private" } }, { ...initialKept(draft), owe1: false });
  assert.equal(r.person_notes.length, 1);
  assert.equal(r.commitments.length, 0);
});
