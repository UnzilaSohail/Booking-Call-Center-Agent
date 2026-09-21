// Pure logic, no MongoDB needed — exercises formatSystemInstruction directly with
// fabricated services/staff rather than going through buildSystemInstruction's DB fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { formatSystemInstruction } from '../src/voice/geminiSession.js';

// UTC explicitly — baseBusiness below uses timezone: 'UTC', and isOpenNow() (in
// src/voice/geminiSession.js) computes "today" in the business's own timezone, so this
// must match that, not whatever zone the machine running the test happens to be in.
const todayDow = DateTime.now().setZone('UTC').weekday % 7; // luxon: 1=Mon..7=Sun -> 0=Sun..6=Sat
const otherDow = (todayDow + 1) % 7;

const baseBusiness = { id: 'b1', name: 'Test Biz', timezone: 'UTC' };

test('falls back sensibly when knowledge is entirely unset', () => {
  const text = formatSystemInstruction({ ...baseBusiness }, [], []);
  assert.match(text, /Test Biz/);
  assert.doesNotMatch(text, /Common questions/);
});

test('uses legacy top-level faqs when knowledge is unset', () => {
  const text = formatSystemInstruction({ ...baseBusiness, faqs: [{ question: 'Open Sundays?', answer: 'No.' }] }, [], []);
  assert.match(text, /Open Sundays\?/);
});

test('custom greeting is used verbatim', () => {
  const text = formatSystemInstruction({ ...baseBusiness, knowledge: { greeting: 'Howdy from Test Biz!' } }, [], []);
  assert.match(text, /Howdy from Test Biz!/);
});

test('business open right now (wide hours today): no closed cue', () => {
  const business = { ...baseBusiness, hours: [{ day_of_week: todayDow, open_time: '00:00', close_time: '23:59' }] };
  const text = formatSystemInstruction(business, [], []);
  assert.doesNotMatch(text, /CLOSED right now/);
});

test('business closed right now (no hours entry for today): includes closed cue', () => {
  const business = { ...baseBusiness, hours: [{ day_of_week: otherDow, open_time: '09:00', close_time: '17:00' }] };
  const text = formatSystemInstruction(business, [], []);
  assert.match(text, /CLOSED right now/);
  assert.match(text, /leave_voicemail/);
});

test('restricted topics and emergency rules appear when set', () => {
  const business = {
    ...baseBusiness,
    knowledge: { restricted_topics: 'medical diagnoses', emergency_rules: 'severe bleeding: call 911' },
  };
  const text = formatSystemInstruction(business, [], []);
  assert.match(text, /medical diagnoses/);
  assert.match(text, /severe bleeding: call 911/);
  assert.match(text, /flag_emergency/);
});

test('pronunciation guidance is included when set', () => {
  const business = { ...baseBusiness, knowledge: { pronunciation: [{ term: 'Xero', pronunciation: 'ZEER-oh' }] } };
  const text = formatSystemInstruction(business, [], []);
  assert.match(text, /Say "Xero" like "ZEER-oh"/);
});
