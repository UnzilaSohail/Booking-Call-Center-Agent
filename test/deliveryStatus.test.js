// Confirmation delivery status (Jira 29o, docs/testing/TEST_CASES.md group DS): what happened to
// each confirmation message is recorded on the booking and surfaces in the Exceptions queue.
// Before this, a failed email left no trace because sendEmail returns {sent:false} instead of throwing.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTenant, dropTenants, skip, getDb } from './support/tenantFixture.js';
import { createBooking } from '../src/services/bookingService.js';
import { upsertCustomer, setSmsOptIn } from '../src/services/customerService.js';
import { emailDelivery, smsDelivery } from '../src/notifications/notify.js';
import { listExceptions } from '../src/routes/exceptions.js';

const providerConfigured = process.env.GMAIL_USER || process.env.SENDGRID_API_KEY || process.env.TWILIO_ACCOUNT_SID;
const at = (days, hh = 10) => new Date(Date.UTC(2033, 0, 1 + days, hh)).toISOString();

describe('delivery classification', () => {
  it('DS-01 results map to a status the dashboard can show', () => {
    assert.deepEqual(emailDelivery({ sent: true, reason: null }), { status: 'sent', error: null });
    assert.equal(emailDelivery({ sent: false, reason: 'no email provider configured — set GMAIL_USER' }).status, 'not_configured');
    const failed = emailDelivery({ sent: false, reason: 'Invalid login: 535' });
    assert.deepEqual([failed.status, failed.error], ['failed', 'Invalid login: 535']);
    assert.equal(emailDelivery(undefined).status, 'failed');
    assert.deepEqual(smsDelivery('SM123'), { status: 'sent', error: null });
    assert.equal(smsDelivery(null).status, 'not_configured');
    assert.match(smsDelivery(null).error, /no SMS provider/);
    assert.equal(emailDelivery({ sent: false, reason: 'x'.repeat(1000) }).error.length, 300, 'long provider errors are cut');
  });
});

describe('confirmation delivery on bookings', { skip: skip || (providerConfigured ? 'a real provider is configured; this file tests the unconfigured path' : false) }, () => {
  let db;
  let t;
  const confirmed = async (id) => {
    for (let i = 0; i < 60; i++) {
      const b = await db.collection('bookings').findOne({ _id: id });
      if (b.confirmation_sent_at) return b;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('confirmation never finished');
  };
  const book = async (over) => (await createBooking(t.businessId, {
    customerName: 'Del', phone: '+15550950001', serviceId: t.serviceIds.haircut, staffId: t.staffIds.Jessica, startTime: at(1), ...over,
  })).booking.id;

  before(async () => {
    db = await getDb();
    t = await createTenant({ name: '__delivery__', staff: ['Jessica'] });
  });
  after(() => dropTenants(t.businessId));

  it('DS-02 with no providers, both channels are recorded as "not configured" with the reason', async () => {
    const id = await book({ customerEmail: 'del@example.test' });
    const b = await confirmed(id);
    assert.equal(b.confirmation_sms_status, 'not_configured');
    assert.match(b.confirmation_sms_error, /no SMS provider/);
    assert.equal(b.confirmation_email_status, 'not_configured');
    assert.match(b.confirmation_email_error, /no email provider/);
  });

  it('DS-03 a customer who gave no email is not counted as an email failure', async () => {
    const id = await book({ phone: '+15550950002', startTime: at(2) });
    const b = await confirmed(id);
    assert.equal(b.confirmation_email_status, 'no_contact');
    assert.equal(b.confirmation_email_error, null);
  });

  it('DS-04 an opted-out customer is recorded as opted out, with no error', async () => {
    await upsertCustomer(t.businessId, { phone: '+15550950003', name: 'Stop' });
    await setSmsOptIn(t.businessId, '+15550950003', false);
    const id = await book({ phone: '+15550950003', startTime: at(3), customerEmail: 'stop@example.test' });
    const b = await confirmed(id);
    assert.equal(b.confirmation_sms_status, 'opted_out');
    assert.ok(!('confirmation_sms_error' in b));
  });

  it('DS-05 undelivered confirmations show up in the Exceptions queue', async () => {
    const items = await listExceptions(t.businessId, 'open');
    const types = items.map((i) => i.type);
    assert.ok(types.includes('sms_delivery'));
    assert.ok(types.includes('email_delivery'));
    assert.ok(items.some((i) => i.type === 'email_delivery' && /no email provider/.test(i.detail)));
  });
});
