// Run: npm run test:growth-preview  (Node's built-in test runner, no dependencies)
import assert from "node:assert/strict";
import { test } from "node:test";
import { draftPrompt, growthDirection } from "./development-preview.ts";

const dev = (plan, role) => ({ development_plan: { plan_text: plan }, aspiration: role ? { desired_role: role } : null });

test("no plan: the preview offers the AI draft", () => {
  assert.deepEqual(growthDirection(dev(null, null), false), { kind: "none", offerDraft: true });
  assert.deepEqual(growthDirection(dev("   ", null), false), { kind: "none", offerDraft: true });
  assert.deepEqual(growthDirection(dev(null, "Team lead"), false), { kind: "aspiration", text: "Team lead", offerDraft: true });
});

test("a saved plan is shown and the draft is not offered", () => {
  assert.deepEqual(growthDirection(dev("Grow into renewals ownership.", "Team lead"), false), {
    kind: "plan", text: "Grow into renewals ownership.", offerDraft: false,
  });
});

test("failure and loading offer nothing", () => {
  assert.deepEqual(growthDirection(null, true), { kind: "failed" });
  assert.deepEqual(growthDirection(null, false), { kind: "loading" });
});

test("the prompt names the person", () => {
  assert.equal(draftPrompt("Jack"), "Draft one from Jack's 1:1s and assessments");
});
