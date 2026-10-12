import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ignoredBankCredit } from '../lib/bank-credit-exclusions.ts';

test('ignores IRAS credits and Mohith Karanth across statement formats', () => {
  for (const [first, second] of [
    ['INTERBANK GIRO IRAS 123817993-CITR', null],
    ['INTERBANK GIRO', 'IRAS ITX 201910314N REFU'],
    ['Inward PayNow Transfer - UEN', 'OTHER MOHITH KARANTH 20260406'],
    ['Inward PayNow OTHER Mohith, Karanth SGD 150', null],
    ['PayNow OTHER KARANTH MOHITH SGD 60', null],
  ]) assert.equal(ignoredBankCredit(first, second), true);
});

test('keeps unrelated payers with similar names eligible', () => {
  for (const description of ['PayNow OTHER MOHITH SHARMA', 'PayNow OTHER ARUN KARANTH', 'PayNow OTHER IRASH TAN', 'PayNow OTHER CHRIS CHUA', null]) {
    assert.equal(ignoredBankCredit(description), false);
  }
});
