import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocationBalance, assertAllocation } from '../lib/bank-allocation-model.ts';
import { unsettledTotals } from '../lib/unsettled-totals.ts';

const saved = (appointmentId, cents) => ({ transactionKey: 'same-credit', appointmentId, cents });

test('a previously reconciled credit cannot be fully reused by a booking in another month', () => {
  assert.equal(allocationBalance(10000, [saved('may-booking', 10000)]), 0);
  assert.throws(() => assertAllocation(10000, [saved('may-booking', 10000)], 'september-booking', 10000), /reuse/);
});

test('partial allocations leave only their unused balance available', () => {
  assert.equal(allocationBalance(10000, [saved('may-booking', 7500)]), 2500);
  assert.doesNotThrow(() => assertAllocation(10000, [saved('may-booking', 7500)], 'september-booking', 2500));
  assert.throws(() => assertAllocation(10000, [saved('may-booking', 7500)], 'september-booking', 2501), /reuse/);
});

test('rechecking or updating the same booking does not add its amount twice', () => {
  assert.equal(allocationBalance(10000, [saved('same-booking', 5000)], 'same-booking'), 10000);
  assert.doesNotThrow(() => assertAllocation(10000, [saved('same-booking', 5000)], 'same-booking', 10000));
});

test('split allocations across bookings are bounded by the bank credit', () => {
  const allocations = [saved('one', 2500), saved('two', 2500), saved('three', 2500)];
  assert.doesNotThrow(() => assertAllocation(10000, allocations, 'four', 2500));
  assert.throws(() => assertAllocation(10000, allocations, 'four', 3000), /reuse/);
});

test('invalid and zero amounts cannot be confirmed', () => {
  for (const cents of [0, -1, 1.5, NaN, Infinity]) assert.throws(() => assertAllocation(10000, [], 'booking', cents));
  assert.throws(() => allocationBalance(10000, [saved('booking', 10001)]), /exceed/);
});

test('unsettled totals use remaining balances and stable identities to prevent re-upload duplicates', () => {
  const booking = { costCents: 10000, createdDate: '2026-04-10T00:00:00+08:00', appointmentDate: '2026-09-30T20:00:00+08:00' };
  const result = unsettledTotals([booking], [
    { id: 'stable-source-key', date: '2026-06-10', cents: 2500 },
    { id: 'stable-source-key', date: '2026-06-10', cents: 2500 },
    { id: 'fully-used-source-key', date: '2026-05-10', cents: 0 },
  ], new Set());
  assert.equal(result.acuityCostCents, 10000);
  assert.equal(result.payNowCents, 2500);
  assert.equal(result.creditCount, 1);
});
