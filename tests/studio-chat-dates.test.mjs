import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDateMention } from '../app/api/studio-chat/date-parser.ts';
test('January through September is a nine-month range, not September alone',()=>{
  const result=parseDateMention('IRAS payments from January to September 2026');
  assert.equal(result.dateRange.startDate,'2026-01-01');
  assert.equal(result.dateRange.endDateExclusive,'2026-10-01');
});
test('explicit day ranges include the final day',()=>{
  const result=parseDateMention('payments from 2026-01-01 to 2026-09-30');
  assert.equal(result.dateRange.startDate,'2026-01-01');
  assert.equal(result.dateRange.endDateExclusive,'2026-10-01');
});
test('relative dates use Singapore at a year boundary',()=>{
  const result=parseDateMention('this month',new Date('2025-12-31T17:00:00Z'));
  assert.equal(result.dateRange.startDate,'2026-01-01');
});
