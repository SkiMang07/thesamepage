// Run: npm run test:scribe-citations  (Node's built-in test runner)
import assert from "node:assert/strict";
import { test } from "node:test";
import { citationHref, parseCitations, stripCitations } from "./scribeCitations.ts";

test("markers become chips with routes; prose stays text", () => {
  const segs = parseCitations("Ask [[person:p-1|Beth]] about [[goal:g-2|Activate the Army]].");
  assert.deepEqual(segs, [
    { kind: "text", text: "Ask " },
    { kind: "cite", type: "person", id: "p-1", label: "Beth", href: "/app/reports/p-1" },
    { kind: "text", text: " about " },
    { kind: "cite", type: "goal", id: "g-2", label: "Activate the Army", href: "/app/goals?goal=g-2" },
    { kind: "text", text: "." },
  ]);
});

test("unknown types render as their label, and plain text passes through", () => {
  assert.deepEqual(parseCitations("x [[route:a|Home]] y"), [{ kind: "text", text: "x Home y" }]);
  assert.deepEqual(parseCitations("no markers"), [{ kind: "text", text: "no markers" }]);
  assert.equal(citationHref("project", "p1"), "/app/projects?project=p1");
  assert.equal(citationHref("nope", "p1"), null);
});

test("stripCitations leaves labels only", () => {
  assert.equal(stripCitations("Is it [[person:a|Beth]]? · [[person:b|Sam]]"), "Is it Beth? · Sam");
});
