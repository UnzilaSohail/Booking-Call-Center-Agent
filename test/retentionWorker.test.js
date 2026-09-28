import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cutoffDate } from '../src/services/retentionWorker.js';

test('cutoffDate subtracts the given number of days', () => {
  const now = new Date('2026-09-25T12:00:00.000Z');
  assert.equal(cutoffDate(30, now).toISOString(), '2026-08-26T12:00:00.000Z');
});

test('cutoffDate(0) is now', () => {
  const now = new Date('2026-09-25T12:00:00.000Z');
  assert.equal(cutoffDate(0, now).getTime(), now.getTime());
});
