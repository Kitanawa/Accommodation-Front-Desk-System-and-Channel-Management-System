import assert from 'node:assert/strict';
import test from 'node:test';
import { checkReadOnlySql } from '../src/db.js';
import { sessionCookie } from '../src/identity.js';
import { pickRule, priceStay } from '../src/pricing.js';

test('only a single SELECT is accepted by the code-level check', () => {
  assert.doesNotThrow(() => checkReadOnlySql('select 1'));
  assert.doesNotThrow(() => checkReadOnlySql("  WITH x AS (select 1) select * from x"));
  assert.doesNotThrow(() => checkReadOnlySql("select 'insert delete update' as text_in_quotes"));
  for (const bad of ['insert into guests(full_name) values (1)', 'update room_stock set reserved_rooms = 0', 'delete from guests', 'drop table guests', 'truncate guests',
    'select 1; delete from guests', 'with x as (delete from guests returning 1) select 1', 'create table t(x int)', 'grant all on guests to public', 'set transaction read write', 'copy guests to stdout', '', null]) {
    assert.throws(() => checkReadOnlySql(bad), /allowed/, String(bad));
  }
});

test('only the fds_session cookie is forwarded to the API', () => {
  assert.equal(sessionCookie('theme=dark; fds_session=abc123; other=1'), 'fds_session=abc123');
  assert.equal(sessionCookie('fds_session=a=b=c'), 'fds_session=a=b=c');
  assert.equal(sessionCookie('theme=dark'), null);
  assert.equal(sessionCookie(undefined), null);
});

test('pricing follows the API rules: approved only, priority, then rule type', () => {
  const rule = (o) => ({ rule_type: 'BASE', rate_amount: 100, priority: 0, approval_status: 'APPROVED', date_from: null, date_to: null, selected_days: null, specific_date: null, effective_from: null, valid_until: null, ...o });
  const rules = [
    rule({}),
    rule({ rule_type: 'DATE_RANGE', rate_amount: 150, date_from: '2026-12-24', date_to: '2026-12-26' }),
    rule({ rule_type: 'SELECTED_DAY', rate_amount: 130, selected_days: [5, 6] }),               // Friday, Saturday
    rule({ rule_type: 'SPECIFIC_DATE', rate_amount: 200, specific_date: '2026-12-25' }),
    rule({ rule_type: 'DATE_RANGE', rate_amount: 999, date_from: '2026-12-01', date_to: '2026-12-31', approval_status: 'PENDING' }),
  ];
  assert.equal(pickRule(rules, '2026-12-03').rate_amount, 100);   // Thursday: base
  assert.equal(pickRule(rules, '2026-12-04').rate_amount, 130);   // Friday: selected day beats base
  assert.equal(pickRule(rules, '2026-12-24').rate_amount, 150);   // Date range beats selected day / base on a tie of priority
  assert.equal(pickRule(rules, '2026-12-25').rate_amount, 200);   // specific date wins
  assert.equal(pickRule(rules, '2026-12-26').rate_amount, 150);   // range includes its last day
  assert.equal(priceStay(rules, '2026-12-24', '2026-12-27').total, 150 + 200 + 150);
  assert.equal(priceStay([], '2026-12-24', '2026-12-25').total, null);
  const replaced = [rule({ valid_until: '2026-12-10' }), rule({ rate_amount: 120, effective_from: '2026-12-10' })];
  assert.equal(pickRule(replaced, '2026-12-09').rate_amount, 100);
  assert.equal(pickRule(replaced, '2026-12-10').rate_amount, 120);
});

test('every database reply template renders in English, Malay and Mandarin', async () => {
  const { messages, LANGS } = await import('../src/messages.js');
  for (const lang of LANGS) {
    const L = messages(lang);
    const row = { name: 'Deluxe King', type: 'Deluxe King', from: '1 Nov 2026', to: '3 Nov 2026', nights: 2, left: 3, average: 'RM 120.00', total: 'RM 240.00', reasons: 'x', guests: 2, minNights: 1 };
    const texts = [L.availYes(row), L.availNo(row), L.availHeader(row), L.availLine(row), L.availLineNo(row), L.availNone, L.roomInfoHeader, L.roomInfoLine(row), L.arrivalsHeader(2), L.arrivalsNone,
      L.departuresHeader(2), L.departuresNone, L.unpaidHeader(12, 10), L.unpaidNone, L.roomWord('101'), L.notFound('R-ABC123'), L.cancelOk('R-ABC123'), L.cancelNo('R-ABC123', 'Cancelled'),
      L.needSignIn, L.dbUnavailable, L.pastDates(), L.needRefOrName, L.notYet('x'), ...Object.values(L.statuses), ...Object.values(L.payments),
      L.reasons.no_stock(), L.reasons.sold_out(), L.reasons.max_guests(4), L.reasons.min_nights(2), L.reasons.no_rate()];
    for (const t of texts) { assert.equal(typeof t, 'string', lang); assert.ok(t.length > 0, lang); assert.doesNotMatch(t, /undefined|NaN|\[object/, `${lang}: ${t}`); }
  }
});
