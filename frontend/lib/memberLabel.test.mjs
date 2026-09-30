// Run: npm run test:member-label  (Node's built-in test runner, no dependencies)
import assert from "node:assert/strict";
import { test } from "node:test";
import { ledByLabel, memberLabel } from "./memberLabel.ts";

const dana = { full_name: "", email: "andrewgodlew+dana@gmail.com", is_you: true };

test("the caller with no name is You, never their email", () => {
  assert.equal(memberLabel(dana), "You");
  assert.equal(ledByLabel(dana), "you");
});

test("the caller with a name is You (name)", () => {
  assert.equal(memberLabel({ ...dana, full_name: "Dana Kessler" }), "You (Dana Kessler)");
  assert.equal(ledByLabel({ ...dana, full_name: "Dana Kessler" }), "You (Dana Kessler)");
});

test("someone else is their name, or their email only as a last resort", () => {
  assert.equal(memberLabel({ full_name: "Sam Lee", email: "s@x.co" }), "Sam Lee");
  assert.equal(memberLabel({ full_name: " ", email: "s@x.co" }), "s@x.co");
});
