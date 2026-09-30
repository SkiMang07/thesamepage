// Run: npm run test:expectations-notice  (Node's built-in test runner, no dependencies)
import assert from "node:assert/strict";
import { test } from "node:test";
import { approvedNotice, approvedPayoff } from "./expectations-notice.ts";

const level = (names, r = 5, s = 3, v = 0) => ({
  people: names.map((name) => ({ name })),
  counts: { responsibilities: r, skills: s, values: v },
});

test("one holder: named, with the count from the approved rows", () => {
  assert.equal(
    approvedNotice("approved", level(["Sofia Alvarez"])),
    "Expectations approved. Sofia’s next prep sheet measures against these 8. They’re now used in 1:1 preparation, development and assessments.",
  );
});

test("several holders are all named", () => {
  assert.equal(approvedPayoff(level(["Andre Baptiste", "Mei Chen"])), "Andre’s and Mei’s next prep sheets measure against these 8.");
  assert.equal(
    approvedPayoff(level(["Andre Baptiste", "Mei Chen", "Sofia Alvarez"], 2, 1, 1)),
    "Andre’s, Mei’s and Sofia’s next prep sheets measure against these 4.",
  );
});

test("holders who share a first name get full names", () => {
  assert.equal(approvedPayoff(level(["Sam Ortiz", "Sam Lee"])), "Sam Ortiz’s and Sam Lee’s next prep sheets measure against these 8.");
});

test("one expectation reads as one", () => {
  assert.equal(approvedPayoff(level(["Tomás Reyes"], 1, 0, 0)), "Tomás’s next prep sheet measures against this one.");
  assert.equal(approvedPayoff(level(["Chris Wu"], 1, 0, 0)), "Chris’s next prep sheet measures against this one.");
});

test("nobody assigned: no payoff is claimed and the current wording stands", () => {
  assert.equal(approvedPayoff(level([])), null);
  assert.equal(
    approvedNotice("approved", level([])),
    "Expectations approved. They’re now used in 1:1 preparation, development and assessments.",
  );
  assert.equal(approvedNotice("approved", undefined), approvedNotice("approved", level([])));
});

test("the open-detail variant keeps its sentence", () => {
  assert.equal(
    approvedNotice("approved-open", level(["Lena Park"], 3, 2, 0)),
    "Expectations approved. Lena’s next prep sheet measures against these 5. The open detail stays listed here until it’s resolved.",
  );
  assert.equal(approvedNotice("approved-open", null), "Expectations approved. The open detail stays listed here until it’s resolved.");
});
