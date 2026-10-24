// Run: npm run test:transcription-usage  (Node's built-in test runner, no dependencies)
import assert from "node:assert/strict";
import { test } from "node:test";
import { formatUsedHours, pillUsageNote, settingsUsageLine } from "./transcriptionUsage.ts";

const H = 3600;
const paid = (used, extra = {}) => ({
  tier: "paid", period: "month", used_seconds: used, allowed_seconds: 30 * H, allowed_hours: 30,
  at_limit: used >= 30 * H, resets_on: "2026-11-01", ...extra,
});
const trial = (used) => ({
  tier: "trial", period: "total", used_seconds: used, allowed_seconds: 5 * H, allowed_hours: 5,
  at_limit: used >= 5 * H, resets_on: null,
});

test("hours read the way a manager reads them", () => {
  assert.equal(formatUsedHours(0), "0");
  assert.equal(formatUsedHours(20 * 60), "Under 1");
  assert.equal(formatUsedHours(2.5 * H), "2.5");
  assert.equal(formatUsedHours(3 * H), "3");
  assert.equal(formatUsedHours(12.4 * H), "12");
});

test("Settings: the monthly line names the reset month", () => {
  assert.equal(settingsUsageLine(paid(12 * H)), "12 of 30 hours used this month. Resets November 1.");
  assert.equal(
    settingsUsageLine(paid(30 * H)),
    "You've used your 30 hours for October. Resets November 1. Call notes and dictation still work.",
  );
  assert.equal(
    settingsUsageLine(paid(30 * H, { resets_on: "2027-01-01" })),
    "You've used your 30 hours for December. Resets January 1. Call notes and dictation still work.",
  );
});

test("Settings: the trial counts its whole life and never resets", () => {
  assert.equal(settingsUsageLine(trial(3 * H)), "3 of 5 trial hours used.");
  assert.match(settingsUsageLine(trial(5 * H)), /^You've used the 5 transcription hours in your trial\./);
});

test("Settings: read-only keeps deleting and clearing consent visible; a report sees nothing", () => {
  const ro = { ...paid(0), tier: "read_only", allowed_seconds: 0, allowed_hours: 0, at_limit: true };
  assert.match(settingsUsageLine(ro), /delete transcripts and clear consent/);
  assert.equal(settingsUsageLine({ ...ro, tier: "ic" }), null);
});

test("Pill: nothing below 80%", () => {
  assert.equal(pillUsageNote(paid(23.9 * H)), null);
  assert.equal(pillUsageNote(null), null);
  assert.equal(pillUsageNote(paid(24 * H)), "24 of 30 hours used this month");
  assert.equal(pillUsageNote(trial(4 * H)), "4 of 5 trial hours used");
});

test("Pill: at 100% the call keeps going", () => {
  assert.equal(
    pillUsageNote(paid(30.2 * H)),
    "You've reached 30 hours for October. This 1:1 keeps transcribing; new ones can be transcribed again from November 1.",
  );
  assert.equal(pillUsageNote(trial(5 * H)), "You've used your 5 trial hours. This 1:1 keeps transcribing.");
});
