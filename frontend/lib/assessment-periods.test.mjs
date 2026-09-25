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
