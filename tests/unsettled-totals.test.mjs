import { test } from "node:test";
import assert from "node:assert/strict";
import { unsettledTotals } from "../lib/unsettled-totals.ts";

const booking = { costCents: 10000, createdDate: "2026-09-01T04:00:00Z", appointmentDate: "2026-09-10T12:00:00Z" };
const credit = (id, date, cents = 2500) => ({ id, date, cents });

test("four split payments count in full while cost equals the displayed booking costs", () => {
  const result = unsettledTotals([booking], [1, 2, 3, 4].map(id => credit(String(id), "2026-09-05")), new Set());
  assert.equal(result.acuityCostCents, 10000);
  assert.equal(result.payNowCents, 10000);
  assert.equal(result.creditCount, 4);
});

test("overlapping windows do not count the same transaction twice", () => {
  const result = unsettledTotals([booking, { ...booking, costCents: 7500 }],
    [credit("1", "2026-09-05"), credit("1", "2026-09-05")], new Set());
  assert.equal(result.acuityCostCents, 17500);
  assert.equal(result.payNowCents, 2500);
  assert.equal(result.creditCount, 1);
});

test("excludes previously used credits and gaps between separate booking windows", () => {
  const later = { ...booking, createdDate: "2026-09-20T04:00:00Z", appointmentDate: "2026-09-25T04:00:00Z" };
  const result = unsettledTotals([booking, later], [credit("used", "2026-09-05"), credit("gap", "2026-09-15"),
    credit("later", "2026-09-22")], new Set(["used"]));
  assert.equal(result.payNowCents, 2500);
  assert.equal(result.creditCount, 1);
});

test("uses Singapore dates and includes both endpoints without extending past session date", () => {
  const result = unsettledTotals([{ ...booking, createdDate: "2026-08-31T18:00:00Z", appointmentDate: "2026-09-09T18:00:00Z" }],
    [credit("before", "2026-08-31"), credit("booking-day", "2026-09-01"), credit("session-day", "2026-09-10"), credit("after", "2026-09-11")], new Set());
  assert.equal(result.payNowCents, 5000);
  assert.equal(result.creditCount, 2);
});

test("missing dates preserve Acuity cost but do not invent payment windows", () => {
  const result = unsettledTotals([{ ...booking, createdDate: null }], [credit("1", "2026-09-05")], new Set());
  assert.equal(result.acuityCostCents, 10000);
  assert.equal(result.payNowCents, 0);
  assert.equal(result.missingWindows, 1);
  assert.equal(unsettledTotals([{ ...booking, costCents: null }], [], new Set()).acuityCostCents, null);
  assert.equal(unsettledTotals([], [credit("1", "2026-09-05")], new Set()).payNowCents, 0);
});
