// Run: npm run test:role-goals  (Node's built-in test runner, no dependencies)
import assert from "node:assert/strict";
import { test } from "node:test";
import { barUnit, defaultPeriod, draftFromExpectation, parseReading, readingText, sourceLine, verdictText } from "./roleGoals.ts";

const tue = new Date(2026, 9, 20); // Tue Oct 20 2026

test("a reading's period follows the expectation's measurement period", () => {
  assert.equal(defaultPeriod("month", tue), "Sep 2026"); // last complete month
  assert.equal(defaultPeriod("quarter", tue), "Q3 2026"); // last complete quarter
  assert.equal(defaultPeriod("month", new Date(2026, 0, 15)), "Dec 2025");
  assert.equal(defaultPeriod("quarter", new Date(2026, 1, 15)), "Q4 2025");
  assert.equal(defaultPeriod("annual", tue), "2026");
  assert.equal(defaultPeriod("week", tue), "Week of Oct 19, 2026");
  assert.equal(defaultPeriod("week", new Date(2026, 10, 1)), "Week of Oct 26, 2026"); // Sunday
  assert.equal(defaultPeriod("none", tue), "Oct 20, 2026");
  assert.equal(defaultPeriod(null, tue), "Oct 20, 2026");
});

test("zero is a reading; blanks and words are not", () => {
  assert.deepEqual(parseReading("0"), { ok: true, value: 0 });
  assert.deepEqual(parseReading(" 7.2 "), { ok: true, value: 7.2 });
  assert.equal(parseReading("").ok, false);
  assert.equal(parseReading("about 8").ok, false);
  assert.equal(parseReading("Infinity").ok, false);
});

test("readings and verdicts are stated, never inferred", () => {
  assert.equal(readingText(7.2, "Oct 2026"), "7.2 (Oct 2026)");
  assert.equal(readingText(92, null), "92");
  assert.equal(readingText(89, "Q3 2026", barUnit("92% or above")), "89% (Q3 2026)");
  assert.equal(barUnit("8 hours"), null);
  assert.equal(barUnit(null), null);
  assert.equal(verdictText("below"), "Latest reading is below the bar.");
  assert.equal(verdictText("meets"), "Latest reading meets the bar.");
  assert.equal(verdictText(null), null);
});

test("a personalised goal says what it started from, and when that was retired", () => {
  assert.equal(sourceLine({ kind: "metric", name: "CSAT on cases they own", retired: false }, true), "Stretch on “CSAT on cases they own”");
  assert.equal(sourceLine({ kind: "metric", name: "CSAT on cases they own", retired: false }), "Builds on “CSAT on cases they own”");
  assert.equal(sourceLine({ kind: "responsibility", name: "Escalation handling", retired: true }),
    "Builds on “Escalation handling” · that expectation was retired");
  assert.equal(sourceLine(null), null);
});

test("making it their own goal leaves the target blank beside the bar and keeps the link", () => {
  const d = draftFromExpectation(
    { kind: "metric", id: "m-res", name: "Median resolution time", target: "8 hours", bar: { value: 8, direction: "at_most" } },
    "Support Specialist",
  );
  assert.equal(d.title, "Median resolution time");
  assert.deepEqual(d.measure, { label: "Median resolution time", format: "number", direction: "at_most" });
  assert.equal(d.targetHint, "8 hours");
  assert.deepEqual(d.link, { kind: "metric", id: "m-res" });
  const pct = draftFromExpectation(
    { kind: "metric", id: "m-grr", name: "Gross revenue retention", target: "92% or above", bar: { value: 92, direction: "at_least" } },
    "CSM",
  );
  assert.equal(pct.measure.format, "percent");
  const s = draftFromExpectation({ kind: "responsibility", id: "s-esc", name: "Escalation handling" }, null);
  assert.equal(s.measure, null);
  assert.deepEqual(s.link, { kind: "skill", id: "s-esc" });
});
