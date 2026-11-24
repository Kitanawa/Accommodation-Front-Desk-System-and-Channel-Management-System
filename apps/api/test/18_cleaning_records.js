// Room cleaning records: priority, who finished a clean, a completion note and the last clean in the front desk state.
const { ok, summary, boot, api } = require('./helpers');

(async () => {
  await boot();
  const code = r => r.body && r.body.error && r.body.error.code, AD = 'admin', FD = 'frontdesk';
  const rooms = (await api('GET', '/api/rooms', null, AD)).body;
  const room = rooms.find(r => r.status === 'AVAILABLE') || rooms[0];
  const people = (await api('GET', '/api/housekeeping/assignees', null, FD)).body;

  const t1 = await api('POST', '/api/housekeeping/tasks', { room_id: room.room_id, task_type: 'DAILY_CLEAN', notes: 'Fresh towels', priority: 'HIGH' }, FD);
  ok(t1.status === 201 && t1.body.priority === 'HIGH' && t1.body.notes === 'Fresh towels' && t1.body.completion_note === null && t1.body.done_by_name === null, 'a task can be created with HIGH priority');
  const t2 = await api('POST', '/api/housekeeping/tasks', { room_id: room.room_id, task_type: 'DAILY_CLEAN' }, FD);
  ok(t2.status === 201 && t2.body.priority === 'NORMAL', 'priority defaults to NORMAL');
  const bad = await api('POST', '/api/housekeeping/tasks', { room_id: room.room_id, priority: 'URGENT' }, FD);
  ok(bad.status === 400 && code(bad) === 'VALIDATION_ERROR', 'an unknown priority is refused');

  const list = (await api('GET', '/api/housekeeping/tasks?status=OPEN', null, FD)).body;
  ok(list.findIndex(x => x.task_id === t1.body.task_id) < list.findIndex(x => x.task_id === t2.body.task_id), 'HIGH priority tasks are listed before NORMAL ones');
  ok((await api('GET', '/api/housekeeping/tasks?priority=HIGH', null, FD)).body.every(x => x.priority === 'HIGH'), 'the list can be filtered by priority');
  ok((await api('GET', '/api/housekeeping/tasks?priority=X', null, FD)).status === 400, 'a bad priority filter is refused');

  // ---------- change an open task ----------
  const p = await api('PATCH', `/api/housekeeping/tasks/${t2.body.task_id}`, { priority: 'HIGH', notes: 'Guest allergic to feathers' }, FD);
  ok(p.status === 200 && p.body.priority === 'HIGH' && p.body.notes === 'Guest allergic to feathers', 'notes and priority of an open task can be changed');
  ok((await api('PATCH', `/api/housekeeping/tasks/${t2.body.task_id}`, { notes: null }, FD)).body.notes === null, 'notes can be cleared');
  ok((await api('PATCH', `/api/housekeeping/tasks/${t2.body.task_id}`, {}, FD)).status === 400, 'an empty change is refused');
  ok((await api('PATCH', `/api/housekeeping/tasks/${t2.body.task_id}`, { notes: 'x'.repeat(301) }, FD)).status === 400, 'notes are limited to 300 characters');
  ok((await api('PATCH', '/api/housekeeping/tasks/00000000-0000-4000-8000-000000000000', { priority: 'HIGH' }, FD)).status === 404, 'an unknown task is not found');

  // ---------- finish ----------
  ok((await api('POST', `/api/housekeeping/tasks/${t1.body.task_id}/start`, null, FD)).body.status === 'IN_PROGRESS', 'a task is started');
  const st = (await api('GET', '/api/frontdesk/state', null, FD)).body.cleaning[room.room_number];
  ok(st && st.priority === 'High', 'the front desk state shows the priority of the open task');
  ok((await api('POST', `/api/housekeeping/tasks/${t1.body.task_id}/complete`, { note: 'x'.repeat(301) }, FD)).status === 400, 'a long completion note is refused');
  const d = await api('POST', `/api/housekeeping/tasks/${t1.body.task_id}/complete`, { note: 'Stain on carpet, reported' }, FD);
  ok(d.status === 200 && d.body.status === 'DONE' && d.body.completion_note === 'Stain on carpet, reported' && d.body.done_by_name && d.body.done_at, 'completing records who finished it, when, and the note');
  ok((await api('PATCH', `/api/housekeeping/tasks/${t1.body.task_id}`, { priority: 'NORMAL' }, FD)).status === 409, 'a finished task cannot be changed (INVALID_STATE)');
  ok((await api('POST', `/api/housekeeping/tasks/${t2.body.task_id}/complete`, null, FD)).body.completion_note === null, 'a note is optional');

  // ---------- history ----------
  const hist = (await api('GET', `/api/housekeeping/tasks?room_id=${room.room_id}&status=DONE`, null, FD)).body;
  ok(hist.length === 2 && hist.every(x => x.done_by_name && x.done_at), 'the finished cleans of a room form its cleaning history');
  const last = (await api('GET', '/api/frontdesk/state', null, FD)).body.cleaning[room.room_number];
  ok(last && last.lastCleanedAt && last.lastCleanedBy && last.priority === 'Normal', 'the front desk state shows when the room was last cleaned and by whom');
  const h = await api('GET', `/api/housekeeping/rooms/${room.room_id}/history`, null, FD);
  ok(h.status === 200 && h.body.length === 2 && h.body.every(x => x.status === 'DONE' && x.room_id === room.room_id) && h.body[0].done_at >= h.body[1].done_at, 'the room history endpoint lists the finished cleans, newest first');
  ok((await api('GET', `/api/housekeeping/rooms/${room.room_id}/history?limit=1`, null, FD)).body.length === 1, 'the history can be limited');
  ok((await api('GET', `/api/housekeeping/rooms/${room.room_id}/history?limit=0`, null, FD)).status === 400 && (await api('GET', '/api/housekeeping/rooms/abc/history', null, FD)).status === 400, 'a bad limit or room id is refused');
  ok((await api('GET', '/api/housekeeping/rooms/00000000-0000-4000-8000-000000000000/history', null, FD)).status === 404, 'an unknown room is not found');
  const aud = (await api('GET', '/api/audit', null, AD)).body;
  ok(Array.isArray(aud) && aud.some(a => a.action === 'HOUSEKEEPING_UPDATED') && aud.some(a => a.action === 'HOUSEKEEPING_DONE'), 'the change and the completion are in the audit log');
  summary();
})().catch(e => { console.error(e); process.exit(1); });
