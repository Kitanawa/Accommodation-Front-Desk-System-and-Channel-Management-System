// Chat memory, loose room type matching, chit-chat and bare answers. No database and no model needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { matchRoomType, findRoomTypeInText } from '../src/roomnames.js';
import { sanitizeContext, applyContext } from '../src/context.js';
import { friendly } from '../src/friendly.js';
import { parseRules } from '../src/rules.js';
import { buildPrompt, parseModelJson, INTENTS, PROMPT_VERSION } from '../src/llm/prompt.js';

const NAMES = ['Deluxe King', 'Family Suite', 'Standard Twin'];
const TODAY = '2026-11-03';

test('room type matching: typos, short forms and case', () => {
  assert.equal(matchRoomType('delux king', NAMES), 'Deluxe King');
  assert.equal(matchRoomType('Deluxe King', NAMES), 'Deluxe King');
  assert.equal(matchRoomType('STANDARD  twin!', NAMES), 'Standard Twin');
  assert.equal(matchRoomType('king', NAMES), 'Deluxe King');
  assert.equal(matchRoomType('the twin room', NAMES), 'Standard Twin');
  assert.equal(matchRoomType('suit', NAMES), 'Family Suite');
});

test('room type matching: never guesses', () => {
  assert.equal(matchRoomType('single', NAMES), null);
  assert.equal(matchRoomType('room', NAMES), null);
  assert.equal(matchRoomType('', NAMES), null);
  assert.equal(matchRoomType(null, NAMES), null);
  assert.equal(matchRoomType('deluxe', ['Deluxe King', 'Deluxe Queen']), null); // two fit equally well
  assert.equal(matchRoomType('twin king', NAMES), null);                        // words from two different types
});

test('room type found inside a message (rules parser)', () => {
  assert.equal(findRoomTypeInText('i mahu delux king boss kerana saya baru ada bonous hahahaha', NAMES), 'Deluxe King');
  assert.equal(findRoomTypeInText('single room 10-14 nov', NAMES), null);
  assert.equal(findRoomTypeInText('standard twin please', NAMES), 'Standard Twin');
});

test('model output: a misspelled room type is matched, an unknown one is dropped', () => {
  const ok = parseModelJson('{"intent":"availability","room_type":"delux king"}', NAMES);
  assert.equal(ok.room_type, 'Deluxe King');
  const bad = parseModelJson('{"intent":"availability","room_type":"penthouse"}', NAMES);
  assert.equal(bad.room_type, null);
  assert.equal(parseModelJson('{"intent":"smalltalk"}', NAMES).intent, 'smalltalk');
  assert.equal(parseModelJson('{"intent":"confirm"}', NAMES).intent, 'confirm');
  assert.equal(parseModelJson('{"intent":"hack"}', NAMES), null);
});

test('prompt: version, new intents, casual-writing guidance, and context only when given', () => {
  assert.equal(PROMPT_VERSION, 'v5');
  assert.ok(INTENTS.includes('smalltalk') && INTENTS.includes('confirm'));
  const plain = buildPrompt('hi', NAMES, TODAY);
  assert.ok(plain.includes('ignore the chatter'));
  assert.ok(!plain.includes('Earlier messages'));
  assert.ok(!plain.includes('Understood last time'));
  const ctx = sanitizeContext({ history: ['saya mahu book bilik daripada 29 nov kepada 30'], last: { room_type: null, from: '2026-11-29', to: '2026-11-30', guests: null } }, NAMES);
  const withCtx = buildPrompt('delux king', NAMES, TODAY, ctx);
  assert.ok(withCtx.includes('Earlier messages from this staff member'));
  assert.ok(withCtx.includes('"from":"2026-11-29"'));
  assert.ok(withCtx.endsWith('Message: """delux king"""'));
});

test('context from the browser is checked before use', () => {
  assert.deepEqual(sanitizeContext(null, NAMES), { history: [], last: null });
  assert.deepEqual(sanitizeContext('x', NAMES), { history: [], last: null });
  const c = sanitizeContext({
    history: ['a', 5, 'b\u0000c', 'd', 'e', 'f', 'g'],
    last: { room_type: 'Penthouse', from: '2026-11-29', to: '2026-11-30', guests: 2 },
  }, NAMES);
  assert.deepEqual(c.history, ['d', 'e', 'f', 'g']);            // newest four, text only
  assert.equal(c.last.room_type, null);                          // not a real room type
  assert.equal(c.last.from, '2026-11-29');
  assert.equal(sanitizeContext({ last: { room_type: 'Deluxe King', from: '2026-11-30', to: '2026-11-29' } }, NAMES).last.from, null); // reversed dates dropped
  assert.equal(sanitizeContext({ last: { from: 'nope', to: 'nope' } }, NAMES).last, null);
  assert.equal(sanitizeContext({ history: ['x'.repeat(1000)] }, NAMES).history[0].length, 300);
});

const mem = (o = {}) => ({ history: [], last: { room_type: null, from: '2026-11-29', to: '2026-11-30', guests: null, ...o } });
const avail = (o = {}) => ({ intent: 'availability', room_type: null, from: null, to: null, guests: null, wants_booking: false, ...o });

test('memory: a room type with no dates reuses the earlier dates', () => {
  const r = applyContext(avail({ room_type: 'Deluxe King' }), mem());
  assert.equal(r.from, '2026-11-29'); assert.equal(r.to, '2026-11-30'); assert.equal(r.room_type, 'Deluxe King');
  assert.deepEqual(r.carried, ['dates']);
});

test('memory: new dates win, and the room type is not carried over', () => {
  const r = applyContext(avail({ from: '2026-12-01', to: '2026-12-03' }), mem({ room_type: 'Deluxe King' }));
  assert.equal(r.from, '2026-12-01'); assert.equal(r.room_type, null); assert.equal(r.carried, undefined);
  const both = applyContext(avail({ room_type: 'Standard Twin', from: '2026-12-01', to: '2026-12-03' }), mem({ room_type: 'Deluxe King' }));
  assert.equal(both.room_type, 'Standard Twin'); assert.equal(both.from, '2026-12-01');
});

test('memory: a question with neither room type nor dates uses both, plus guests', () => {
  const r = applyContext(avail({}), mem({ room_type: 'Deluxe King', guests: 2 }));
  assert.equal(r.room_type, 'Deluxe King'); assert.equal(r.guests, 2); assert.deepEqual(r.carried, ['dates', 'guests', 'room_type']);
  assert.equal(applyContext(avail({ guests: 3 }), mem({ guests: 2 })).guests, 3);   // what the person says now wins
});

test('memory: a bare yes becomes an availability question for the earlier request', () => {
  const r = applyContext({ intent: 'confirm', room_type: null, from: null, to: null, guests: null, wants_booking: false }, mem({ room_type: 'Deluxe King' }));
  assert.equal(r.intent, 'availability'); assert.equal(r.wants_booking, true);
  assert.equal(r.room_type, 'Deluxe King'); assert.equal(r.from, '2026-11-29');
});

test('memory: a yes with nothing remembered stays a yes (the reply asks for room type and dates)', () => {
  const r = applyContext({ intent: 'confirm', room_type: null, from: null, to: null }, { history: [], last: null });
  assert.equal(r.intent, 'confirm');
  assert.equal(applyContext({ intent: 'confirm', room_type: null, from: null, to: null }, null).intent, 'confirm');
});

test('memory: other questions are left alone', () => {
  const r = applyContext({ intent: 'arrivals', room_type: null, from: null, to: null }, mem({ room_type: 'Deluxe King' }));
  assert.equal(r.from, null); assert.equal(r.room_type, null);
  assert.equal(applyContext({ intent: 'unpaid' }, mem()).from, undefined);
});

test('rules parser: bare answers, chit-chat and typos', () => {
  const p = (m) => parseRules(m, NAMES, TODAY);
  for (const m of ['yes', 'Yes!', 'ok', 'OK, book it', 'sure please', 'boleh', '好的', 'go ahead']) assert.equal(p(m).intent, 'confirm', m);
  for (const m of ['hi', 'Hello!', 'hey there', 'thanks', 'Thank you!', 'terima kasih', '谢谢', 'hahaha', 'good morning']) assert.equal(p(m).intent, 'smalltalk', m);
  const r = p('i mahu delux king boss kerana saya baru ada bonous hahahaha');
  assert.equal(r.room_type, 'Deluxe King'); assert.equal(r.intent, 'availability');
  assert.equal(p('deluxe king please').intent, 'availability');
});

test('rules parser: existing behaviour is unchanged', () => {
  const r = parseRules('standard twin 10-14 nov', NAMES, TODAY);
  assert.equal(r.intent, 'availability'); assert.equal(r.room_type, 'Standard Twin'); assert.equal(r.from, '2026-11-10'); assert.equal(r.to, '2026-11-14');
  assert.equal(parseRules('arrivals today', NAMES, TODAY).intent, 'arrivals');
  assert.equal(parseRules('unpaid bookings', NAMES, TODAY).intent, 'unpaid');
  assert.equal(parseRules('refund please', NAMES, TODAY).intent, 'refuse_financial');
  assert.equal(parseRules('tell me a joke about cats', NAMES, TODAY).intent, 'unknown');
  assert.equal(parseRules('yes I would like to cancel it', NAMES, TODAY).intent, 'refuse_cancel');
  const gibberish = parseRules('qwerty', NAMES, TODAY);
  assert.equal(gibberish.intent, 'unknown');
});

test('friendly lines exist in English, Malay and Mandarin', () => {
  for (const lang of ['en', 'ms', 'zh', 'fr']) {
    const f = friendly(lang);
    assert.ok(f.smalltalk.length > 20 && f.confirmNothing.length > 10, lang);
  }
  assert.notEqual(friendly('ms').smalltalk, friendly('en').smalltalk);
  assert.notEqual(friendly('zh').smalltalk, friendly('en').smalltalk);
});
