// The whole chat pipeline with the chat memory, in rules mode (no model, no database).
process.env.LLM_PROVIDER = 'rules';
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleChat } from '../src/chat.js';
import { friendly } from '../src/friendly.js';

const NAMES = ['Deluxe King', 'Family Suite', 'Standard Twin'];
const NOW = '2026-11-03';
const last = { room_type: null, from: '2026-11-29', to: '2026-11-30', guests: null };

test('a room type alone (with a typo and chatter) uses the dates from the chat memory', async () => {
  const r = await handleChat('i mahu delux king boss kerana saya baru ada bonous hahahaha', { roomTypes: NAMES, now: NOW, context: { history: [], last } });
  assert.equal(r.request.intent, 'availability');
  assert.equal(r.request.room_type, 'Deluxe King');
  assert.equal(r.request.from, '2026-11-29');
  assert.equal(r.request.to, '2026-11-30');
  assert.deepEqual(r.action, { type: 'select_stay', room_type: 'Deluxe King', from: '2026-11-29', to: '2026-11-30' });
  assert.ok(r.reply.includes('Deluxe King') || r.reply.includes('29'));
});

test('without memory the same message asks for dates', async () => {
  const r = await handleChat('deluxe king please', { roomTypes: NAMES, now: NOW });
  assert.equal(r.request.intent, 'availability');
  assert.ok(/Which dates/.test(r.reply));
  assert.equal(r.action, null);
});

test('a bare yes selects the remembered stay', async () => {
  const r = await handleChat('yes', { roomTypes: NAMES, now: NOW, context: { history: [], last: { ...last, room_type: 'Deluxe King' } } });
  assert.equal(r.request.intent, 'availability');
  assert.equal(r.request.wants_booking, true);
  assert.equal(r.action.room_type, 'Deluxe King');
  assert.equal(r.action.from, '2026-11-29');
});

test('a bare yes with nothing remembered asks what to use', async () => {
  const r = await handleChat('yes', { roomTypes: NAMES, now: NOW });
  assert.equal(r.reply, friendly('en').confirmNothing);
  assert.ok(r.followUp && r.followUp.text);
  assert.equal(r.action, null);
});

test('chit-chat gets a fixed friendly reply and a follow-up question', async () => {
  const r = await handleChat('hello!', { roomTypes: NAMES, now: NOW });
  assert.equal(r.reply, friendly('en').smalltalk);
  assert.ok(r.followUp.buttons.length > 0);
});

test('memory from a tampered browser cannot invent a room type or dates', async () => {
  const r = await handleChat('yes', { roomTypes: NAMES, now: NOW, context: { history: [5, 'x'], last: { room_type: 'Penthouse', from: '2026-13-45', to: 'soon', guests: 999 } } });
  assert.equal(r.reply, friendly('en').confirmNothing);
});

test('a question with its own dates ignores the memory', async () => {
  const r = await handleChat('standard twin 10-14 nov', { roomTypes: NAMES, now: NOW, context: { history: [], last: { ...last, room_type: 'Deluxe King' } } });
  assert.equal(r.request.room_type, 'Standard Twin');
  assert.equal(r.request.from, '2026-11-10');
  assert.equal(r.request.to, '2026-11-14');
});
