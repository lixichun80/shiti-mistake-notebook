import { test } from "node:test";
import assert from "node:assert/strict";
import { extendTrialByWeek, isTrialExpired, trialEndFrom } from "../lib/trial.ts";

const start = Date.parse("2026-10-19T12:00:00.000Z");
const weekMs = 7 * 24 * 60 * 60 * 1000;

test("self-registration trial lasts exactly seven days", () => {
  const end = trialEndFrom(start);
  assert.equal(end, "2026-10-26T12:00:00.000Z");
  assert.equal(isTrialExpired(end, start + weekMs - 1), false);
  assert.equal(isTrialExpired(end, start + weekMs), true);
});

test("existing accounts stay available and malformed expiries fail closed", () => {
  assert.equal(isTrialExpired(null, start + 10 * weekMs), false);
  assert.equal(isTrialExpired("invalid", start), true);
});

test("admin extension preserves remaining time or restarts after expiry", () => {
  const end = trialEndFrom(start);
  assert.equal(extendTrialByWeek(end, start + 2 * 24 * 60 * 60 * 1000), "2026-11-02T12:00:00.000Z");
  assert.equal(extendTrialByWeek(end, start + 10 * 24 * 60 * 60 * 1000), "2026-11-05T12:00:00.000Z");
});
