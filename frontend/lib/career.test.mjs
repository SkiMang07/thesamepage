import { test } from "node:test";
import assert from "node:assert/strict";
import { careerAsks, isCareerDay, longDay, shortDay } from "./career.ts";

const p = (over) => ({ direct_report_id: "x", name: "Jonah Reyes", state: "off", planned: null, suggested: null, choices: [], ...over });

test("dates read as days, not instants", () => {
  assert.equal(shortDay("2026-10-22"), "Thu, Oct 22");
  assert.equal(longDay("2026-10-22T12:00:00+00:00"), "Thursday, October 22");
});

test("the career day is the planned date only while planned", () => {
  const planned = p({ state: "planned", planned: { planned_for: "2026-10-22", heads_up_sent_at: null } });
  assert.equal(isCareerDay(planned, "2026-10-22T12:00:00+00:00"), true);
  assert.equal(isCareerDay(planned, "2026-10-29"), false);
  assert.equal(isCareerDay({ ...planned, state: "missed" }, "2026-10-22"), false);
  assert.equal(isCareerDay(null, "2026-10-22"), false);
});

test("asks: missed first, then picks, then unsent heads-ups; nothing for the rest", () => {
  const asks = careerAsks([
    p({ direct_report_id: "a", name: "Ada Lin", state: "planned", planned: { planned_for: "2026-10-22", heads_up_sent_at: null } }),
    p({ direct_report_id: "b", name: "Ben Ode", state: "proposed", suggested: "2026-10-23" }),
    p({ direct_report_id: "c", name: "Cy Moe", state: "missed", planned: { planned_for: "2026-09-30", heads_up_sent_at: null } }),
    p({ direct_report_id: "d", name: "Di Pak", state: "planned", planned: { planned_for: "2026-10-22", heads_up_sent_at: "2026-10-10T00:00:00Z" } }),
    p({ direct_report_id: "e", name: "Ed Roe", state: "not_due" }),
    p({ direct_report_id: "f", name: "Fay Yu", state: "proposed" }),
  ]);
  assert.deepEqual(asks.map((a) => a.text), [
    "Cy: did the career conversation happen?",
    "Ben: pick the 1:1 (suggested Fri, Oct 23)",
    "Fay: pick a 1:1",
    "Ada, Thu, Oct 22: send the heads-up",
  ]);
});
