// AIN-512: slots and the dashboard's "today" in time zones that are not UTC, across daylight-saving changes and in a
// half-hour zone. The business is open 09:00-18:00 local every day (test fixture).
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTenant, dropTenants, skip } from './support/tenantFixture.js';
import { getAvailability } from '../src/services/bookingService.js';

describe('availability in other time zones', { skip }, () => {
  const made = [];
  const firstSlot = async (timezone, date) => {
    const t = await createTenant({ name: `__tz_${timezone}__`, timezone });
    made.push(t.businessId);
    const { slots } = await getAvailability(t.businessId, { serviceId: t.serviceIds.haircut, date });
    return { first: slots[0], count: slots.length };
  };
  after(() => dropTenants(...made));

  it('TZ-01 New York: 9am is 14:00Z in winter and 13:00Z once clocks have gone forward; the day is still 18 slots long', async () => {
    assert.deepEqual(await firstSlot('America/New_York', '2026-03-07'), { first: '2026-03-07T14:00:00.000Z', count: 18 });
    assert.deepEqual(await firstSlot('America/New_York', '2026-03-08'), { first: '2026-03-08T13:00:00.000Z', count: 18 }, 'the day the clocks change');
    assert.deepEqual(await firstSlot('America/New_York', '2026-11-01'), { first: '2026-11-01T14:00:00.000Z', count: 18 }, 'the day they go back');
  });

  it('TZ-02 Sydney: the southern-hemisphere change in October', async () => {
    assert.deepEqual(await firstSlot('Australia/Sydney', '2026-10-03'), { first: '2026-10-02T23:00:00.000Z', count: 18 });
    assert.deepEqual(await firstSlot('Australia/Sydney', '2026-10-04'), { first: '2026-10-03T22:00:00.000Z', count: 18 });
  });

  it('TZ-03 India is UTC+5:30: 9am is 03:30Z', async () => {
    assert.deepEqual(await firstSlot('Asia/Kolkata', '2026-06-15'), { first: '2026-06-15T03:30:00.000Z', count: 18 });
  });
});
