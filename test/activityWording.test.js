// The "Activity history" page must show sentences, never web addresses (boss feedback: not developer language).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { describeActivity } from '../dashboard/lib/activity.js';

describe('activity wording', () => {
  const samples = [
    ['POST', '/api/onboarding/verify/confirm'], ['POST', '/api/onboarding/test-call'], ['PATCH', '/api/exceptions/callback_request/76a88f72'],
    ['POST', '/api/staff'], ['DELETE', '/api/staff/4fe0'], ['PATCH', '/api/team-members/4a6f'], ['POST', '/api/team-members/invite'],
    ['PUT', '/api/business-hours'], ['PUT', '/api/knowledge/draft'], ['POST', '/api/knowledge/publish'], ['PATCH', '/api/services/30ae'],
    ['POST', '/api/services'], ['POST', '/api/bookings'], ['PATCH', '/api/billing/plan'], ['PATCH', '/api/auth/password'], ['POST', '/api/something-new/x'],
  ];
  it('turns every kind of recorded action into plain words (AW-1)', () => {
    for (const [method, path] of samples) {
      const { text, group } = describeActivity({ method, path });
      assert.ok(text.length > 8 && group, `${method} ${path}`);
      assert.ok(!/\/|\bapi\b|\bPOST\b|\bPATCH\b|\bPUT\b|\bDELETE\b|[0-9a-f]{8}/i.test(text), `"${text}" still looks technical`);
    }
  });
  it('says what happened, with the right kind of thing (AW-2)', () => {
    assert.equal(describeActivity({ method: 'POST', path: '/api/staff' }).text, 'Added a team member to the calendar');
    assert.equal(describeActivity({ method: 'PATCH', path: '/api/exceptions/sms_delivery/abc' }).text, 'Updated a text that did not go out in Needs attention');
    assert.equal(describeActivity({ method: 'PUT', path: '/api/business-hours' }).group, 'Settings');
  });
});
