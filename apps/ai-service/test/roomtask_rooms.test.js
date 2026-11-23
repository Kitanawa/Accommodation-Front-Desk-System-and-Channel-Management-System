import test from 'node:test';
import assert from 'node:assert/strict';
import { checkTaskRoom, cleanRoomList, taskReply, taskAction, taskFollowUp } from '../src/roomtask.js';

const req = (room = '999') => ({ intent: 'room_task', room_number: room, task_status: 'Dirty', assignee: null, priority: null, note: null });

test('room list from the browser is cleaned', () => {
  assert.deepEqual(cleanRoomList(['201', ' 202 ', 203, '201', '', {}, 'x'.repeat(30)]), ['201', '202', '203']);
  assert.deepEqual(cleanRoomList('201'), []);
  assert.deepEqual(cleanRoomList(undefined), []);
  assert.equal(cleanRoomList(Array.from({ length: 600 }, (_, i) => String(i + 1))).length, 500);
});

test('a room that is not on the list is marked unknown', () => {
  assert.equal(checkTaskRoom(req('999'), ['201', '202']).room_unknown, true);
  assert.equal(checkTaskRoom(req('201'), ['201', '202']).room_unknown, undefined);
  assert.equal(checkTaskRoom(req(201), ['201', '202']).room_unknown, undefined);
});

test('no list (or an empty one) means no check is made', () => {
  assert.equal(checkTaskRoom(req('999'), []).room_unknown, undefined);
  assert.equal(checkTaskRoom(req('999'), undefined).room_unknown, undefined);
});

test('unknown room: fixed reply in three languages, no action, no follow-up', () => {
  const r = checkTaskRoom(req('999'), ['201']);
  assert.match(taskReply('en', r), /cannot find room 999/);
  assert.match(taskReply('ms', r), /bilik 999/);
  assert.match(taskReply('zh', r), /房间999/);
  assert.doesNotMatch(taskReply('en', r), /filled in the room task/);
  assert.equal(taskAction(r), null);
  assert.equal(taskFollowUp('en', r), null);
});

test('known room: action and follow-up are unchanged', () => {
  const r = checkTaskRoom(req('201'), ['201']);
  assert.equal(taskAction(r).room, '201');
  assert.ok(taskFollowUp('en', r).text);
  assert.match(taskReply('en', r), /filled in the room task for room 201/);
});