import assert from 'node:assert/strict';
import http from 'node:http';
import test, { after, before } from 'node:test';
import { handleChat, cleanNames } from '../src/chat.js';

const TYPES = ['President DEF', 'Deluxe Queen'];
const NOW = '2026-10-26';

// A fake OpenAI-compatible server, so the model path can be tested without a real key or network.
let server, base, answer, calls;
before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      calls.push({ auth: req.headers.authorization, body: JSON.parse(body) });
      const a = answer();
      res.writeHead(a.status || 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(a.status >= 400 ? { error: { message: 'boom' } } : { choices: [{ message: { content: a.content } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/v1`;
});
after(() => server.close());
const useModel = () => { calls = []; Object.assign(process.env, { LLM_PROVIDER: 'openai', OPENAI_BASE_URL: base, OPENAI_API_KEY: 'fake-key', OPENAI_MODEL: 'fake-model' }); delete process.env.LLM_STRICT; };
const useRules = () => { process.env.LLM_PROVIDER = 'rules'; };
const model = (o) => JSON.stringify(o);

test('rules mode answers an availability question', async () => {
  useRules();
  const r = await handleChat('Deluxe Queen 25 to 30 Nov for 2 guests', { roomTypes: TYPES, now: NOW });
  assert.equal(r.source, 'rules');
  assert.equal(r.request.intent, 'availability');
  assert.match(r.reply, /Deluxe Queen from 25 Nov 2026 to 30 Nov 2026 \(5 nights\) for 2 guests/);
  assert.match(r.reply, /not connected/);
});

test('model mode: Malay question understood by the model, Malay reply, dates formatted in Malay', async () => {
  useModel();
  answer = () => ({ content: model({ intent: 'availability', room_type: 'Deluxe Queen', from: '2026-11-25', to: '2026-11-30', guests: 2, lang: 'ms' }) });
  const r = await handleChat('Ada bilik Deluxe Queen kosong 25 hingga 30 Nov untuk 2 tetamu?', { roomTypes: TYPES, now: NOW });
  assert.equal(r.source, 'openai');
  assert.equal(r.lang, 'ms');
  assert.match(r.reply, /ketersediaan untuk Deluxe Queen dari 25 Nov 2026 hingga 30 Nov 2026 \(5 malam\)/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].auth, 'Bearer fake-key');
  assert.match(calls[0].body.messages[0].content, /Today is 2026-10-26/);
  assert.match(calls[0].body.messages[0].content, /"President DEF"/);
});

test('model mode: Mandarin question, Chinese reply and date format', async () => {
  useModel();
  answer = () => ({ content: model({ intent: 'availability', room_type: null, from: '2026-11-25', to: '2026-11-30', guests: null, lang: 'zh' }) });
  const r = await handleChat('11月25日到30日有空房吗？', { roomTypes: TYPES, now: NOW });
  assert.equal(r.lang, 'zh');
  assert.match(r.reply, /2026年11月25日至2026年11月30日（共5晚）/);
});

test('a fourth language gets an English reply plus the three-language note', async () => {
  useModel();
  answer = () => ({ content: model({ intent: 'unknown', lang: 'other' }) });
  const r = await handleChat('Gibt es freie Zimmer?', { roomTypes: TYPES, now: NOW });
  assert.equal(r.lang, 'en');
  assert.match(r.reply, /I can help with room availability/);
  assert.match(r.reply, /Mandarin\. \/ Saya boleh/);
});

test('model failure falls back to rules; the error text never reaches the reply', async () => {
  useModel();
  answer = () => ({ status: 401 });
  const r = await handleChat('Deluxe Queen 25 to 30 Nov', { roomTypes: TYPES, now: NOW });
  assert.equal(r.source, 'rules (model unavailable)');
  assert.equal(r.request.intent, 'availability');
  assert.doesNotMatch(JSON.stringify(r), /boom|fake-key/);
});

test('garbage or tampered model output is rejected', async () => {
  useModel();
  answer = () => ({ content: 'sure! here you go' });
  assert.equal((await handleChat('hello', { roomTypes: TYPES, now: NOW })).source, 'rules (model unavailable)');
  answer = () => ({ content: model({ intent: 'drop_tables', from: '2026-11-25', to: '2026-11-30' }) });
  assert.equal((await handleChat('hello', { roomTypes: TYPES, now: NOW })).source, 'rules (model unavailable)');
  // a room type the FDS does not have is dropped, extra fields are ignored, a bad booking ref is dropped
  answer = () => ({ content: model({ intent: 'booking_lookup', room_type: 'Imaginary Suite', booking_ref: 'BK-0001', extra: 'x', lang: 'en' }) });
  const r = await handleChat('look up my booking', { roomTypes: TYPES, now: NOW });
  assert.equal(r.request.room_type, null);
  assert.equal(r.request.booking_ref, null);
  assert.equal('extra' in r.request, false);
});

test('strict mode shows a model failure as unknown instead of using rules', async () => {
  useModel();
  process.env.LLM_STRICT = '1';
  answer = () => ({ status: 500 });
  const r = await handleChat('Deluxe Queen 25 to 30 Nov', { roomTypes: TYPES, now: NOW });
  assert.equal(r.request.intent, 'unknown');
  delete process.env.LLM_STRICT;
});

test('validation: reversed dates, long stay, unknown room type, missing dates', async () => {
  useRules();
  assert.match((await handleChat('Deluxe Queen 30 nov to 25 nov', { roomTypes: TYPES, now: NOW })).reply, /after the check-in/);
  assert.match((await handleChat('availability 2026-11-01 to 2027-02-01', { roomTypes: TYPES, now: NOW })).reply, /60 nights/);
  assert.match((await handleChat('is a room available', { roomTypes: TYPES, now: NOW })).reply, /Which dates/);
  useModel();
  answer = () => ({ content: model({ intent: 'availability', room_type: null, from: '2026-02-30', to: '2026-03-02', lang: 'en' }) });
  const r = await handleChat('x', { roomTypes: TYPES, now: NOW });
  assert.equal(r.validated, false);
  assert.match(r.reply, /not valid/);
});

test('refusals and the 72-hour hold use fixed text and never change anything', async () => {
  useRules();
  assert.match((await handleChat('refund this guest', { roomTypes: TYPES, now: NOW })).reply, /cannot change rates/);
  assert.match((await handleChat('delete R-K3F9QA', { roomTypes: TYPES, now: NOW })).reply, /cannot delete, move or edit/);
  assert.match((await handleChat('book Deluxe Queen 25 to 30 Nov', { roomTypes: TYPES, now: NOW })).reply, /cannot make bookings/);
  assert.match((await handleChat('is the 72 hour hold expiring', { roomTypes: TYPES, now: NOW })).reply, /not in this system yet/);
});

test('cleanNames removes quotes, control characters, duplicates and non-strings', () => {
  assert.deepEqual(cleanNames(['A "x"', 'A "x"', 5, null, '  B\nC  ', '']), ['A x', 'B C']);
  assert.deepEqual(cleanNames('nope'), []);
  assert.equal(cleanNames(Array.from({ length: 100 }, (_, i) => `r${i}`)).length, 60);
});
