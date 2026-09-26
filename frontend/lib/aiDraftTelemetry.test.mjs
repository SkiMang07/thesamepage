// Run: npm run test:ai-drafts  (Node's built-in test runner, no dependencies)
import assert from "node:assert/strict";
import { test } from "node:test";
import { DraftTracker, editBucket, itemCounts, MAX_SECONDS_TO_CONFIRM } from "./aiDraftTelemetry.ts";

const hundred = Array.from({ length: 100 }, (_, i) => `w${i}`).join(" ");

test("edit buckets match the backend's thresholds", () => {
  assert.equal(editBucket(hundred, hundred), "none");
  assert.equal(editBucket(hundred, `  ${hundred.toUpperCase()} `), "none");
  assert.equal(editBucket(hundred, hundred.replace("w5 ", "x5 ")), "light");
  assert.equal(editBucket(hundred, hundred.split(" ").slice(0, 75).join(" ")), "moderate");
  assert.equal(editBucket(hundred, "entirely new text"), "heavy");
  assert.equal(editBucket("", "something"), "heavy");
});

test("items: light edits count as kept, rewrites and new rows as added", () => {
  const drafted = ["Send Jack the renewal list by Friday", "Book the QBR room", "Draft the hiring plan"];
  const saved = ["Send Jack the renewal list by Thursday", "Something else entirely new here", ""];
  assert.deepEqual(itemCounts(drafted, saved), { items_drafted: 3, items_kept: 1, items_added: 1 });
});

test("a tracker reports once, with only enums and counts", () => {
  const sent = [];
  let t = 1_000;
  const tr = new DraftTracker("one_on_one_wrapup", { text: "Summary of the call", items: ["Do the thing"] }, (r) => sent.push(r), () => t);
  t += 42_400;
  tr.accept({ text: "Summary of the call, edited", items: ["Do the thing", "A new one"] });
  tr.discard();
  tr.abandon();
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], {
    surface: "one_on_one_wrapup", outcome: "accepted", edit_bucket: "heavy", seconds_to_confirm: 42,
    items_drafted: 1, items_kept: 1, items_added: 1,
  });
  for (const v of Object.values(sent[0])) assert.ok(typeof v === "number" || /^[a-z_]+$/.test(v));
});

test("discard and abandon carry no edit, and time is capped", () => {
  const sent = [];
  let t = 0;
  new DraftTracker("team_wrapup", { text: "x" }, (r) => sent.push(r), () => t).discard();
  const tr = new DraftTracker("development_plan", { text: "x" }, (r) => sent.push(r), () => t);
  t = 10 * MAX_SECONDS_TO_CONFIRM * 1000;
  tr.abandon();
  assert.deepEqual(sent.map((r) => [r.outcome, r.edit_bucket]), [["discarded", "none"], ["abandoned", "none"]]);
  assert.equal(sent[1].seconds_to_confirm, MAX_SECONDS_TO_CONFIRM);
});
