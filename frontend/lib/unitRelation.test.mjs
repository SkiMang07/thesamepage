// Run: npm run test:unit-relation  (Node's built-in test runner, no dependencies)
import assert from "node:assert/strict";
import { test } from "node:test";
import { relativeUnitLabel, relativeUnits } from "./unitRelation.ts";

const unit = (id, name, unit_type, parent_unit_id = null, leader_user_id = null) => ({ id, name, unit_type, parent_unit_id, leader_user_id });
const labels = (rows) => rows.map((r) => `${r.relation}: ${r.label}`);

test("someone who leads nothing keeps today's labels", () => {
  const units = [unit("t", "Support", "team")];
  assert.equal(relativeUnits(units, []), null);
  assert.equal(relativeUnitLabel("t", units, []), null);
  // A stale led id that isn't in the list counts as leading nothing.
  assert.equal(relativeUnits(units, [{ id: "gone" }]), null);
});

test("Renata: one team she leads, nothing above it", () => {
  const units = [unit("es", "Enterprise & Strategic", "team", null, "renata")];
  assert.deepEqual(labels(relativeUnits(units, [{ id: "es" }])), ["yours: Enterprise & Strategic (your team)"]);
});

test("Susie: her team under a department with no leader", () => {
  const units = [unit("mx", "Member Experience", "department"), unit("ms", "Member Support", "team", "mx", "susie")];
  assert.deepEqual(labels(relativeUnits(units, [{ id: "ms" }])), [
    "yours: Member Support (your team)",
    "above: Member Experience (your boss's group)",
  ]);
});

test("higher than your boss's group, and units not related to you", () => {
  const units = [
    unit("ops", "Operations", "department"),
    unit("cs", "Customer Success", "department", "ops"),
    unit("es", "Enterprise & Strategic", "team", "cs", "me"),
    unit("bill", "Billing", "team", "ops"),
  ];
  assert.deepEqual(labels(relativeUnits(units, [{ id: "es" }])), [
    "yours: Enterprise & Strategic (your team)",
    "above: Customer Success (your boss's group)",
    "above: Operations (above your boss's group)",
    "other: Billing",
  ]);
});

test("a department you lead: teams under it by their leader, or as under you", () => {
  const units = [
    unit("cs", "Customer Success", "department", null, "me"),
    unit("plat", "Platform", "team", "cs", "ines"),
    unit("onb", "Onboarding", "team", "cs"),
    unit("pod", "Pod A", "team", "plat"),
  ];
  const members = [
    { id: "me", full_name: "Merri Okafor", is_you: true },
    { id: "ines", full_name: "Ines Duarte", is_you: false },
  ];
  assert.deepEqual(labels(relativeUnits(units, [{ id: "cs" }], members)), [
    "yours: Customer Success (your department)",
    "under: Onboarding (a team under you)",
    "under: Platform (Ines's team)",
    "under: Pod A (a team under you)",
  ]);
});

test("leading a department and a team inside it: both are yours, department first", () => {
  const units = [
    unit("up", "Revenue", "department"),
    unit("cs", "Customer Success", "department", "up", "me"),
    unit("es", "Enterprise", "team", "cs", "me"),
  ];
  assert.deepEqual(labels(relativeUnits(units, [{ id: "es" }, { id: "cs" }])), [
    "yours: Customer Success (your department)",
    "yours: Enterprise (your team)",
    "above: Revenue (your boss's group)",
  ]);
});

test("a leader with no name, or the viewer leading a unit below, never shows an email", () => {
  const units = [unit("cs", "CS", "department", null, "me"), unit("p", "Platform", "team", "cs", "x")];
  const members = [{ id: "x", full_name: "  ", is_you: false }];
  assert.equal(relativeUnitLabel("p", units, [{ id: "cs" }], members), "Platform (a team under you)");
});

test("a parent cycle in bad data doesn't loop", () => {
  const units = [unit("a", "A", "department", "b"), unit("b", "B", "department", "a"), unit("t", "T", "team", "a", "me")];
  const rows = relativeUnits(units, [{ id: "t" }]);
  assert.equal(rows.length, 3);
  assert.equal(relativeUnitLabel("a", units, [{ id: "t" }]), "A (your boss's group)");
});
