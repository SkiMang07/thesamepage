// Run: npm run test:projects  (Node's built-in test runner, no dependencies)
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyAttention,
  attentionReasons,
  compareProjects,
  matchesScope,
  overview,
  parseCompletion,
} from "./projects.ts";

const NOW = new Date(2026, 8, 25, 10, 0); // Sep 25, 2026 local
const recent = new Date(2026, 8, 20, 9).toISOString();
const old = new Date(2026, 7, 30, 9).toISOString(); // 26 days before

const p = (id, extra = {}) => ({
  id, title: id, description: null, status: "active", due_date: null, direct_report_id: null,
  goal_id: null, org_unit_id: null, created_at: recent, last_check_in_at: recent, next_move: null,
  next_move_available: true, ...extra,
});

const portfolio = [
  p("risk-and-late", { status: "at_risk", due_date: "2026-09-01", last_check_in_at: null }),
  p("late-only", { due_date: "2026-09-24" }),
  p("due-today", { due_date: "2026-09-25" }),
  p("stale", { last_check_in_at: old }),
  p("never", { last_check_in_at: null, direct_report_id: "dr-1", direct_report_name: "Maya Chen" }),
  p("fine", { status: "on_track", next_move: { status: "open" } }),
  p("closed", { status: "completed", due_date: "2026-01-01", last_check_in_at: null, next_move: { status: "open" } }),
];

test("counts are distinct records, overlap is honest, closed projects excluded", () => {
  const o = overview(portfolio, NOW);
  assert.equal(o.open, 6);
  assert.equal(o.attention, 2); // at risk + past due counts once
  assert.equal(o.missing, 3); // never, stale, and the at-risk one with no update
  assert.equal(o.nextMoves, 2); // includes the closed project's open move
  assert.ok(o.attention + o.missing > 3, "categories overlap; never a partition");
});

test("due today is not past due; local calendar day decides", () => {
  assert.deepEqual(attentionReasons(portfolio[2], NOW), []);
  assert.deepEqual(attentionReasons(portfolio[1], NOW).map((r) => r.tone), ["attention"]);
});

test("missing update is context, not risk", () => {
  const reasons = attentionReasons(portfolio[3], NOW);
  assert.equal(reasons.length, 1);
  assert.equal(reasons[0].tone, "context");
  assert.match(reasons[0].text, /No update in 26 days/);
});

test("unreadable next moves are unknown, never zero", () => {
  assert.equal(overview([p("a", { next_move_available: false })], NOW).nextMoves, null);
});

test("attention filter narrows rows; exceptions sort first", () => {
  const open = portfolio.filter((x) => x.status !== "completed");
  assert.deepEqual(applyAttention(open, "attention", NOW).map((x) => x.id), ["risk-and-late", "late-only"]);
  const order = [...open].sort((a, b) => compareProjects(a, b, NOW)).map((x) => x.id);
  assert.deepEqual(order.slice(0, 2), ["risk-and-late", "late-only"]);
  assert.equal(order.at(-1), "fine");
});

test("owner scope uses ids, not names", () => {
  assert.ok(matchesScope(portfolio[4], "dr-1", ""));
  assert.ok(!matchesScope(portfolio[4], "you", ""));
  assert.ok(matchesScope(portfolio[0], "you", "risk"));
  assert.ok(matchesScope(portfolio[4], "all", "maya"));
});

test("blank completion is no value; zero is a value", () => {
  assert.deepEqual(parseCompletion(""), { ok: true, value: null });
  assert.deepEqual(parseCompletion("0"), { ok: true, value: 0 });
  assert.equal(parseCompletion("40.5").ok, false);
  assert.equal(parseCompletion("101").ok, false);
});
