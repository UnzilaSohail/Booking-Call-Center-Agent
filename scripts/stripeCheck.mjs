// `npm run stripe:check`: proves the Stripe keys work end to end in TEST mode (fake customer, Stripe's test card, one $1 charge, then cleaned up).
// Refuses live keys, so it can never move real money. Docs: docs/guides/STRIPE_SETUP.md
import 'dotenv/config';
import Stripe from 'stripe';

const key = process.env.STRIPE_SECRET_KEY;
if (!key) { console.error('STRIPE_SECRET_KEY is not set in .env (use a TEST key: sk_test_...).'); process.exit(1); }
if (!key.startsWith('sk_test_')) { console.error('This check only runs with a TEST key (sk_test_...). Refusing to continue.'); process.exit(1); }
const stripe = new Stripe(key);
const ok = (msg) => console.log(`OK    ${msg}`);

const customer = await stripe.customers.create({ name: 'Booking Agent connection check', metadata: { check: 'true' } });
try {
  const setup = await stripe.setupIntents.create({
    customer: customer.id, payment_method: 'pm_card_visa', confirm: true, usage: 'off_session',
    automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
  });
  if (setup.status !== 'succeeded') throw new Error(`saving the test card ended as "${setup.status}"`);
  ok('saved a test card on a test customer');

  const pi = await stripe.paymentIntents.create({
    amount: 100, currency: 'usd', customer: customer.id, payment_method: setup.payment_method, off_session: true, confirm: true,
  }, { idempotencyKey: `check_${customer.id}` });
  if (pi.status !== 'succeeded') throw new Error(`the $1 charge ended as "${pi.status}"`);
  ok(`charged $1.00 without the customer present (${pi.id})`);

  console.log(process.env.STRIPE_WEBHOOK_SECRET?.startsWith('whsec_')
    ? 'OK    STRIPE_WEBHOOK_SECRET is set'
    : 'TODO  STRIPE_WEBHOOK_SECRET is not set: add the webhook in Stripe (see the guide) so settled and failed payments reach us');
  console.log(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.startsWith('pk_test_')
    ? 'OK    publishable key is set for the dashboard'
    : 'TODO  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY (pk_test_...) is not set in dashboard/.env.local');
} catch (err) {
  console.error(`FAIL  ${err.message}`);
  process.exitCode = 1;
} finally {
  await stripe.customers.del(customer.id).catch(() => {});
}
