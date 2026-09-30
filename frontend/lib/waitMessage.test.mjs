// Run: npm run test:wait-message  (Node's built-in test runner, no dependencies)
import assert from "node:assert/strict";
import { test } from "node:test";
import { waitMessage } from "./waitMessage.ts";

test("starts with the usual time", () => {
  assert.equal(waitMessage(0, "10 to 40 seconds"), "This usually takes 10 to 40 seconds. You can leave this open.");
  assert.match(waitMessage(19, "10 to 40 seconds"), /usually takes/);
});

test("past 20 seconds it says it is still working, past a minute it offers a retry", () => {
  assert.match(waitMessage(20, "x"), /Still working/);
  assert.match(waitMessage(59, "x"), /Still working/);
  assert.match(waitMessage(60, "x"), /longer than usual/);
});
