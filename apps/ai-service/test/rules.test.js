import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRules, extractDates } from '../src/rules.js';

const TYPES = ['President DEF', 'Deluxe Queen', 'Deluxe King Room 2', 'Deluxe King'];
const TODAY = '2026-10-26';

test('dates: ranges, single date with nights, rollover to next year', () => {
  assert.deepEqual(extractDates('25 to 30 nov', TODAY), { from: '2026-11-25', to: '2026-11-30' });
  assert.deepEqual(extractDates('from 2026-11-25 to 2026-11-28', TODAY), { from: '2026-11-25', to: '2026-11-28' });
  assert.deepEqual(extractDates('5 nov for 3 nights', TODAY), { from: '2026-11-05', to: '2026-11-08' });
  assert.deepEqual(extractDates('3 jan to 6 jan', TODAY), { from: '2027-01-03', to: '2027-01-06' });
  assert.equal(extractDates('31 feb to 2 mar', TODAY)?.from ?? null, null);
  assert.equal(extractDates('hello there', TODAY), null);
});

test('availability with a room type, guests and dates', () => {
  const r = parseRules('Is Deluxe Queen available 25 to 30 Nov for 2 guests?', TYPES, TODAY);
  assert.equal(r.intent, 'availability');
  assert.equal(r.room_type, 'Deluxe Queen');
  assert.equal(r.guests, 2);
  assert.equal(r.from, '2026-11-25');
  assert.equal(r.to, '2026-11-30');
});

test('the longest room type name wins', () => {
  assert.equal(parseRules('deluxe king room 2 from 1 dec to 3 dec', TYPES, TODAY).room_type, 'Deluxe King Room 2');
  assert.equal(parseRules('deluxe king from 1 dec to 3 dec', TYPES, TODAY).room_type, 'Deluxe King');
});

test('booking references use the R-XXXXXX format', () => {
  const r = parseRules('what is the status of r-k3f9qa', TYPES, TODAY);
  assert.equal(r.booking_ref, 'R-K3F9QA');
  assert.equal(r.intent, 'booking_lookup');
  assert.equal(parseRules('status of BK-0004', TYPES, TODAY).booking_ref, null);
});

test('refusals: financial, cancel without a reference, delete/move/mark as paid', () => {
  assert.equal(parseRules('give a discount to this guest', TYPES, TODAY).intent, 'refuse_financial');
  assert.equal(parseRules('cancel the booking', TYPES, TODAY).intent, 'refuse_cancel');
  assert.equal(parseRules('can R-K3F9QA be cancelled?', TYPES, TODAY).intent, 'cancel_check');
  assert.equal(parseRules('delete R-K3F9QA', TYPES, TODAY).intent, 'refuse_change');
  assert.equal(parseRules('move R-K3F9QA to room 1002', TYPES, TODAY).intent, 'refuse_change');
  assert.equal(parseRules('mark R-K3F9QA as paid', TYPES, TODAY).intent, 'refuse_change');
});

test('other intents', () => {
  assert.equal(parseRules('who is arriving today', TYPES, TODAY).intent, 'arrivals');
  assert.equal(parseRules('show unpaid bookings', TYPES, TODAY).intent, 'unpaid');
  assert.equal(parseRules('how many people can each room type fit?', TYPES, TODAY).intent, 'room_info');
  assert.equal(parseRules('is the 72 hour hold about to expire', TYPES, TODAY).intent, 'hold_72h');
  assert.equal(parseRules('blah blah', TYPES, TODAY).intent, 'unknown');
});
