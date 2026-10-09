import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moneyToCents, suggestPayNow, validDate } from '../lib/payment-reconciliation.ts';

const booking = { id: '123456', name: 'Alex Tan', date: '2026-10-09', createdDate: '2026-09-01', price: '80.00', certificateCode: null, canceled: false };
const credit = { id: '1', date: '2026-10-01', description: 'PAYNOW ALEX TAN', amount: '80.00', currency: 'SGD' };
const empty = { [booking.id]: { status: 'loaded', payments: [] } };

test('uses exact cents and validates calendar dates', () => {
  assert.equal(moneyToCents('80.0000'), 8000);
  assert.equal(moneyToCents('0.10'), 10);
  assert.equal(moneyToCents('80.001'), null);
  assert.equal(moneyToCents(''), null);
  assert.equal(validDate('2026-02-30'), false);
  assert.equal(validDate('2026-10-09'), true);
});

test('requires a successful processor lookup before suggesting a bank payment', () => {
  assert.equal(suggestPayNow([booking], [credit], {})[0].candidates.length, 0);
  assert.equal(suggestPayNow([booking], [credit], { [booking.id]: { status: 'error', payments: [] } })[0].processorCents, null);
  assert.equal(suggestPayNow([booking], [credit], empty)[0].candidates.length, 1);
});

test('requires identity, PayNow, currency, date and exact remaining amount', () => {
  for (const change of [
    { description: 'PAYNOW UNKNOWN' }, { description: 'PAYNOW ALEX' },
    { description: 'STRIPE PAYNOW ALEX TAN' }, { description: 'TRANSFER ALEX TAN' },
    { amount: '79.99' }, { currency: 'USD' }, { date: '2026-08-31' }, { date: '2026-10-17' },
  ]) assert.equal(suggestPayNow([booking], [{ ...credit, ...change }], empty)[0].candidates.length, 0);
  assert.equal(suggestPayNow([booking], [{ ...credit, description: 'PAYNOW booking 123456' }], empty)[0].candidates.length, 1);
});

test('handles split processor and PayNow payment without counting the full price twice', () => {
  const result = suggestPayNow([booking], [credit, { ...credit, id: '2', amount: '30.00' }], {
    [booking.id]: { status: 'loaded', payments: [{ transactionID: 'ch_1', processor: 'stripe', amount: '50.00', created: null }] },
  })[0];
  assert.equal(result.processorCents, 5000);
  assert.equal(result.remainingCents, 3000);
  assert.deepEqual(result.candidates.map((item) => item.id), ['2']);
});

test('flags a credit shared by multiple bookings instead of assigning it', () => {
  const other = { ...booking, id: '123457' };
  const result = suggestPayNow([booking, other], [credit], { ...empty, [other.id]: { status: 'loaded', payments: [] } });
  assert.ok(result.every((row) => row.sharedCredit));
});

test('excludes canceled bookings, certificates, adjustments and overpaid bookings', () => {
  for (const change of [{ canceled: true }, { certificateCode: 'PACKAGE' }]) {
    assert.equal(suggestPayNow([{ ...booking, ...change }], [credit], empty)[0].candidates.length, 0);
  }
  for (const amount of ['-10.00', '100.00']) {
    assert.equal(suggestPayNow([booking], [{ ...credit, amount: '90.00' }], {
      [booking.id]: { status: 'loaded', payments: [{ transactionID: 'ch_1', processor: 'stripe', amount, created: null }] },
    })[0].candidates.length, 0);
  }
});
