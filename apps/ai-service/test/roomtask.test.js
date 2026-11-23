// Housekeeping room tasks: the assistant only prepares a draft, and it can only use values it is allowed to use.
process.env.LLM_PROVIDER = 'rules';
import test from 'node:test';
import assert from 'node:assert/strict';
import { taskFields, guardTask, clarifiedOk, taskAction, taskReply } from '../src/roomtask.js';
import { parseRules } from '../src/rules.js';
import { parseModelJson } from '../src/llm/prompt.js';
import { handleChat } from '../src/chat.js';

const NAMES = ['Deluxe King', 'Standard Twin'];
const TODAY = '2026-11-03';
const task = (m) => parseRules(m, NAMES, TODAY);

test('rules parser: a full housekeeping command', () => {
  const r = task('set room 203 to dirty, assign Siti, high priority, note: AC not cold');
  assert.equal(r.intent, 'room_task'); assert.equal(r.room_number, '203');
  assert.equal(r.task_status, 'Dirty'); assert.equal(r.assignee, 'Siti'); assert.equal(r.priority, 'High'); assert.equal(r.note, 'AC not cold');
});

test('rules parser: other phrasings', () => {
  assert.equal(task('mark room 305 clean').task_status, 'Clean');
  assert.equal(task('Assign room 203 to Siti Aminah').assignee, 'Siti Aminah');
  assert.equal(task('update room 410 priority to normal').priority, 'Normal');
  assert.equal(task('room 118 note: towels missing').note, 'towels missing');
  assert.equal(task('change room 203 cleaning status to cleaning').task_status, 'Cleaning');
});

test('rules parser: a note is copied exactly even when it contains words that look like other commands', () => {
  const r = task('room 203 note: guest asked for a refund, please move the luggage');
  assert.equal(r.intent, 'room_task'); assert.equal(r.note, 'guest asked for a refund, please move the luggage');
  assert.equal(r.task_status, null);
});

test('rules parser: questions and other requests are not room tasks', () => {
  assert.notEqual(task('is room 203 clean?').intent, 'room_task');
  assert.notEqual(task('who is in room 203').intent, 'room_task');
  assert.notEqual(task('standard twin 10-14 nov').intent, 'room_task');
  assert.equal(task('refund please').intent, 'refuse_financial');
  assert.equal(task('set room dirty').intent !== 'room_task', true);   // no room number
});

test('guard: status and priority must be values the page offers', () => {
  const r = guardTask({ intent: 'room_task', room_number: '203', task_status: 'Spotless', priority: 'Urgent' }, 'room 203 spotless urgent');
  assert.equal(r.task_status, null); assert.equal(r.priority, null);
});

test('guard: the cleaner must be a name the staff typed', () => {
  assert.equal(guardTask({ assignee: 'Siti' }, 'assign siti to room 203').assignee, 'Siti');
  assert.equal(guardTask({ assignee: 'Ahmad' }, 'assign Siti to room 203').assignee, null);
  assert.equal(guardTask({ assignee: '12345' }, 'room 12345').assignee, null);
});

test('guard: the note is only the staff\'s own words, copied exactly', () => {
  const ok = guardTask({ note: 'AC not cold' }, 'room 203 note: AC not cold');
  assert.equal(ok.note, 'AC not cold'); assert.equal(ok.note_dropped, undefined);
  const rewritten = guardTask({ note: 'The air conditioner does not cool the room' }, 'room 203 note: AC not cold');
  assert.equal(rewritten.note, null); assert.equal(rewritten.note_dropped, true);
  const quoted = guardTask({ note: '“AC not cold”' }, 'room 203 note: AC not cold');
  assert.equal(quoted.note, 'AC not cold');
  assert.equal(guardTask({ note: 'x'.repeat(400) }, 'x'.repeat(400)).note, null);
});

test('clearer wording: faithful rephrasing passes', () => {
  assert.equal(clarifiedOk('AC not cold', 'The air conditioner in the room is not cold.'), true);
  assert.equal(clarifiedOk('towels missing room 305', 'The towels are missing in room 305.'), true);
  assert.equal(clarifiedOk('jangan masuk tetamu tidur', 'Jangan masuk, tetamu sedang tidur.'), true);
});

test('clearer wording: drift is rejected', () => {
  assert.equal(clarifiedOk('AC not cold', 'The air conditioner is very cold and works well.'), false);     // lost "not"
  assert.equal(clarifiedOk('Do not disturb guest sleeping', 'Disturb the guest, they are sleeping.'), false); // lost "not"
  assert.equal(clarifiedOk('towels in 305', 'Please bring 4 towels to room 305.'), false);                    // new number
  assert.equal(clarifiedOk('towels in 305', 'Please bring towels to room 350.'), false);                      // changed number
  assert.equal(clarifiedOk('Ask Siti about the key', 'Ask the cleaner about the key.'), false);               // lost the name
  assert.equal(clarifiedOk('leak', 'There is a leak. ' + 'x'.repeat(300)), false);                            // too long
  assert.equal(clarifiedOk('AC not cold', 'AC not cold'), false);                                             // nothing new
  assert.equal(clarifiedOk('AC not cold', 'See https://example.com for the cold air problem.'), false);      // link
  assert.equal(clarifiedOk('AC not cold', '空调不冷。'), false);                                                // other language
  assert.equal(clarifiedOk('', 'something'), false);
});

test('guard: a clearer wording that fails the check is dropped, one that passes is kept as a suggestion', () => {
  const good = guardTask({ note: 'AC not cold', note_clarified: 'The air conditioner is not cold.' }, 'room 203 note: AC not cold');
  assert.equal(good.note_clarified, 'The air conditioner is not cold.');
  const bad = guardTask({ note: 'AC not cold', note_clarified: 'The air conditioner is very cold.' }, 'room 203 note: AC not cold');
  assert.equal(bad.note, 'AC not cold'); assert.equal(bad.note_clarified, null);
  assert.equal(guardTask({ note: null, note_clarified: 'something new' }, 'room 203 dirty').note_clarified, null);
});

test('model output: the new fields are checked', () => {
  const r = parseModelJson('{"intent":"room_task","room_number":"203","task_status":"Dirty","assignee":"Siti","priority":"High","note":"AC not cold","note_clarified":"The air conditioner is not cold."}', NAMES);
  assert.equal(r.intent, 'room_task'); assert.equal(r.task_status, 'Dirty'); assert.equal(r.priority, 'High'); assert.equal(r.note_clarified, 'The air conditioner is not cold.');
  const bad = parseModelJson('{"intent":"room_task","room_number":"203","task_status":"Spotless","priority":"Urgent"}', NAMES);
  assert.equal(bad.task_status, null); assert.equal(bad.priority, null);
});

test('action for the page', () => {
  assert.deepEqual(taskAction({ room_number: '203', task_status: 'Dirty', assignee: null, priority: 'High', note: 'AC not cold', note_clarified: null }),
    { type: 'set_room_task', room: '203', status: 'Dirty', assignee: null, priority: 'High', note: 'AC not cold', noteClarified: null });
  assert.equal(taskAction({ room_number: null, task_status: 'Dirty' }), null);
  assert.equal(taskAction({ room_number: '203' }), null);
});

test('replies are fixed text in all three languages and say nothing is saved', () => {
  const req = { room_number: '203', task_status: 'Dirty', assignee: 'Siti', priority: 'High', note: 'AC not cold', note_clarified: 'x' };
  for (const lang of ['en', 'ms', 'zh']) {
    const r = taskReply(lang, req);
    assert.ok(r.includes('203') && r.includes('Dirty') && r.includes('Siti') && r.includes('AC not cold'), lang);
    assert.ok(taskReply(lang, { room_number: null }).length > 10);
    assert.ok(taskReply(lang, { room_number: '203' }).length > 10);
  }
  assert.ok(/Nothing is saved yet/.test(taskReply('en', req)));
  assert.ok(/Save Task/.test(taskReply('en', req)));
});

test('whole pipeline (rules mode): fills the draft, saves nothing, follows up', async () => {
  const r = await handleChat('set room 203 to dirty, assign Siti, high priority, note: AC not cold', { roomTypes: NAMES, now: TODAY });
  assert.equal(r.request.intent, 'room_task');
  assert.deepEqual(r.action, { type: 'set_room_task', room: '203', status: 'Dirty', assignee: 'Siti', priority: 'High', note: 'AC not cold', noteClarified: null });
  assert.ok(r.reply.includes('Nothing is saved yet'));
  assert.ok(r.followUp.text.includes('Save Task'));
  const noRoom = await handleChat('set it to dirty', { roomTypes: NAMES, now: TODAY });
  assert.notEqual(noRoom.request.intent, 'room_task');
  assert.equal(noRoom.action, null);
});

test('whole pipeline: a room with nothing to change asks what to change', async () => {
  const r = await handleChat('room 203 note:', { roomTypes: NAMES, now: TODAY });
  assert.ok(r.action === null);
});
