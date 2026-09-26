// Run: npm run test:assessments  (Node's built-in test runner, no dependencies)
import assert from "node:assert/strict";
import { test } from "node:test";
import { formatSpan, periodNoun, periodStillOpen, possessive, suggestPeriod } from "./assessment-periods.ts";

test("quarterly suggests the closing quarter in its last three weeks", () => {
  assert.deepEqual(suggestPeriod("quarterly", new Date(2026, 8, 25)), { start: "2026-07-01", end: "2026-09-30" });
});

test("quarterly suggests the last completed quarter early in a new one", () => {
  assert.deepEqual(suggestPeriod("quarterly", new Date(2026, 9, 6)), { start: "2026-07-01", end: "2026-09-30" });
  assert.deepEqual(suggestPeriod("quarterly", new Date(2026, 0, 15)), { start: "2025-10-01", end: "2025-12-31" });
});

test("biannual uses halves", () => {
  assert.deepEqual(suggestPeriod("biannual", new Date(2026, 8, 25)), { start: "2026-01-01", end: "2026-06-30" });
  assert.deepEqual(suggestPeriod("biannual", new Date(2026, 11, 20)), { start: "2026-07-01", end: "2026-12-31" });
});

test("off-cycle is the last 90 days", () => {
  assert.deepEqual(suggestPeriod("off_cycle", new Date(2026, 8, 25)), { start: "2026-06-28", end: "2026-09-25" });
});

test("labels", () => {
  assert.equal(formatSpan("2026-07-01", "2026-09-30"), "Jul 1 – Sep 30, 2026");
  assert.equal(formatSpan("2025-12-01", "2026-02-28"), "Dec 1, 2025 – Feb 28, 2026");
  assert.equal(periodNoun("quarterly", "2026-07-01", "2026-09-30"), "quarter");
  assert.equal(periodNoun("off_cycle", "2026-07-01", "2026-09-30"), "period");
  assert.equal(periodStillOpen("2026-09-30", new Date(2026, 8, 25)), true);
  assert.equal(possessive("James"), "James’");
});

import { buildYearStrip, stripQuarters } from "./assessment-periods.ts";

const TODAY = new Date(2026, 8, 25); // Q3 2026 is the natural quarter
const rv = (id, status, start, end) => ({ id, status, period_start: start, period_end: end });

test("strip is the four quarters ending with the natural one", () => {
  assert.deepEqual(stripQuarters(TODAY).map((q) => `${q.year}Q${q.quarter}`), ["2025Q4", "2026Q1", "2026Q2", "2026Q3"]);
  // Early October still anchors on Q3 — the quarter you'd assess now.
  assert.deepEqual(stripQuarters(new Date(2026, 9, 6)).at(-1), { year: 2026, quarter: 3 });
});

test("quarterly fills one slot, completed wins over a draft", () => {
  const s = buildYearStrip([rv("a", "completed", "2026-04-01", "2026-06-30"), rv("b", "draft", "2026-07-01", "2026-09-30")], null, TODAY);
  assert.deepEqual(s.map((x) => x.state), ["none", "none", "completed", "in_progress"]);
  assert.equal(s[3].current, true);
  const both = buildYearStrip([rv("d", "draft", "2026-07-01", "2026-09-30"), rv("c", "completed", "2026-07-01", "2026-09-30")], null, TODAY);
  assert.equal(both[3].state, "completed");
  assert.equal(both[3].reviewId, "c");
});

test("biannual covers two joined slots", () => {
  const s = buildYearStrip([rv("h", "completed", "2026-01-01", "2026-06-30")], null, TODAY);
  assert.deepEqual(s.map((x) => x.state), ["none", "completed", "completed", "none"]);
  assert.deepEqual(s.map((x) => x.joinsNext), [false, true, false, false]);
});

test("short off-cycle is a mark, not a covered quarter", () => {
  const s = buildYearStrip([rv("o", "completed", "2026-08-01", "2026-08-31")], null, TODAY);
  assert.equal(s[3].state, "none");
  assert.equal(s[3].offCycle, "completed");
});

test("legacy rating only marks an empty quarter; old reviews fall off", () => {
  const s = buildYearStrip([rv("old", "completed", "2025-01-01", "2025-03-31")], "2026-06-02T10:00:00Z", TODAY);
  assert.deepEqual(s.map((x) => x.state), ["none", "none", "legacy", "none"]);
  const t = buildYearStrip([rv("a", "completed", "2026-04-01", "2026-06-30")], "2026-06-02", TODAY);
  assert.equal(t[2].state, "completed");
});
