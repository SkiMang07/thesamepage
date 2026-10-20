// Run: npm run test:goal-draft  (Node's built-in test runner, no dependencies)
import assert from "node:assert/strict";
import { test } from "node:test";
import { matchingExpectation, readsLikeExpectation, saveGoalDraft, takeGoalDraft } from "./goalDraft.ts";

const exps = [
  { name: "CSAT on cases they own", roleLevelId: "spec", role: "Support Specialist" },
  { name: "Median resolution time", roleLevelId: "spec", role: "Support Specialist" },
  { name: "NPS", roleLevelId: "csm", role: "CSM" },
];

test("a dated goal is never questioned", () => {
  assert.equal(readsLikeExpectation("Maintain CSAT above 92%", "2027-03-31", exps), null);
});

test("an undated, ongoing goal that repeats an expectation names it", () => {
  const r = readsLikeExpectation("Maintain CSAT on owned cases above 92%", "", exps);
  assert.equal(r.ongoing, true);
  assert.equal(r.match.name, "CSAT on cases they own");
});

test("ongoing wording alone is enough, a repeat alone is enough", () => {
  assert.deepEqual(readsLikeExpectation("Respond to every customer within a day", "", exps), { ongoing: true, match: null });
  assert.equal(readsLikeExpectation("Lift NPS", "", exps).match.role, "CSM");
});

test("a one-time push with no date and no overlap is fine", () => {
  assert.equal(readsLikeExpectation("Launch the new escalation process", "", exps), null);
});

test("one shared word with a long expectation is not a match", () => {
  assert.equal(matchingExpectation("Cut resolution backlog", exps), null);
  assert.equal(matchingExpectation("Cut median resolution time", exps).name, "Median resolution time");
});

function mem() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
}

test("a draft is read once, and a malformed one reads as none", () => {
  const s = mem();
  const d = {
    title: "Raise team CSAT", dueDate: "2027-03-31", parentGoalId: null,
    measure: { label: "CSAT", format: "percent", direction: "at_least" },
    source: { kind: "expectation", label: "CSAT on cases they own", role: "Support Specialist" },
    targetHint: "92% or above", drafted: 3, shownAt: 1,
  };
  assert.equal(saveGoalDraft(d, s), true);
  assert.equal(takeGoalDraft(s).title, "Raise team CSAT");
  assert.equal(takeGoalDraft(s), null);
  s.setItem("tsp.goalDraft", JSON.stringify({ ...d, dueDate: "soon", measure: { label: "x", format: "bogus" } }));
  const t = takeGoalDraft(s);
  assert.equal(t.dueDate, null);
  assert.equal(t.measure, null);
  s.setItem("tsp.goalDraft", "{not json");
  assert.equal(takeGoalDraft(s), null);
  assert.equal(takeGoalDraft(null), null);
});
