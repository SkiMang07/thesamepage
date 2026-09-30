// Run: npm run test:follow-through  (Node's built-in test runner, no dependencies)
import assert from "node:assert/strict";
import { test } from "node:test";
import { followThroughCopy } from "./followThrough.ts";

test("no dated commitments but open undated ones: never says 0 commitments", () => {
  const c = followThroughCopy(0, 4, "this week");
  assert.equal(c.countLabel, "4 open, no due date");
  assert.equal(c.emptyText, "Nothing completed, due, or overdue this week.");
  assert.equal(c.undatedNote, "4 open commitments with no due date, not shown in the bar.");
});

test("truly nothing: still says 0 commitments, no note", () => {
  const c = followThroughCopy(0, 0, "this week");
  assert.equal(c.countLabel, "0 commitments");
  assert.equal(c.undatedNote, null);
});

test("dated commitments with an undated one: count is labelled dated, note is singular", () => {
  const c = followThroughCopy(3, 1, "this week");
  assert.equal(c.countLabel, "3 dated commitments");
  assert.equal(c.emptyText, null);
  assert.equal(c.undatedNote, "1 open commitment with no due date, not shown in the bar.");
});
