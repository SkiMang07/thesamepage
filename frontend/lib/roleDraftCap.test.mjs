// Run: npm run test:role-draft-cap  (Node's built-in test runner, no dependencies)
import assert from "node:assert/strict";
import { test } from "node:test";
import { roleDraftCapLine } from "./roleDraftCap.ts";

test("under the cap: no one is named as waiting", () => {
  const line = roleDraftCapLine(5, 3, []);
  assert.match(line, /3 of 5 chosen/);
  assert.doesNotMatch(line, /not in this pass/);
});

test("six roles, cap five: names the one left out and the next pass", () => {
  const line = roleDraftCapLine(5, 5, ["Sofia"]);
  assert.match(line, /Sofia is not in this pass/);
  assert.match(line, /single button after you save/);
});

test("several waiting read as a list", () => {
  assert.match(roleDraftCapLine(5, 5, ["Sofia", "Mei", "Kwame"]), /Sofia, Mei and Kwame are not in this pass/);
});
