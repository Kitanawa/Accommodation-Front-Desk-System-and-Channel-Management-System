// A change to the name or details of an approved room type waits for approval, like a rate change.
const { ok, summary, boot, api, tok } = require('./helpers');

(async () => {
  await boot();
  const code = r => r.body && r.body.error && r.body.error.code, AD = 'admin', MG = 'manager', FD = 'frontdesk';
  const list = async who => (await api('GET', '/api/room-types', null, who)).body;
  const type = (await list(AD)).find(x => x.approval_status === 'APPROVED');
  const id = type.room_type_id, ratesBefore = (await api('GET', `/api/room-types/${id}`, null, AD)).body.rates.length;
  const inbox = async () => (await api('GET', '/api/approvals?kind=ROOM_TYPE', null, AD)).body;

  // ---------- submit ----------
  ok((await api('PATCH', `/api/room-types/${id}`, { name: 'Lake View Loft' }, FD)).status === 403, 'Front Desk cannot change a room type');
  const p1 = await api('PATCH', `/api/room-types/${id}`, { name: 'Lake View Loft' }, MG);
  ok(p1.status === 200 && p1.body.name === type.name && p1.body.pending_changes && p1.body.pending_changes.name === 'Lake View Loft', 'a new name waits for approval: the room type keeps its approved name');
  ok((await list(FD)).find(x => x.room_type_id === id).name === type.name && !('pending_changes' in (await list(FD)).find(x => x.room_type_id === id)), 'Front Desk still sees the approved name and no waiting change');
  const st = (await api('GET', '/api/frontdesk/state', null, FD)).body.rooms.find(r => r.id === id);
  ok(st.name === type.name && st.publication === 'Published' && st.detailRequest && st.detailRequest.changes.name === 'Lake View Loft' && st.detailRequest.status === 'Pending Approval', 'the front desk state shows the waiting change beside the approved name');
  const p2 = await api('PATCH', `/api/room-types/${id}`, { max_guests: 5 }, MG);
  ok(p2.status === 200 && p2.body.pending_changes.name === 'Lake View Loft' && p2.body.pending_changes.max_guests === 5, 'a second change is added to the waiting request');

  // ---------- inbox ----------
  const first = (await inbox()).find(x => x.id === id);
  ok(first && first.title.startsWith('Room type change') && first.details.is_change && first.details.current.name === type.name && first.details.changes.name === 'Lake View Loft' && first.status === 'PENDING' && first.revision, 'the approval inbox lists the change with the current and the new values');
  ok((await api('GET', '/api/approvals', null, MG)).status === 403, 'a Manager without the approval right cannot open the inbox');
  ok((await api('POST', `/api/room-types/${id}/approve`, null, MG)).status === 403, 'and cannot approve it');
  const sum = (await api('GET', '/api/approvals/summary', null, AD)).body;
  ok(sum.by_kind.ROOM_TYPE >= 1, 'the badge counts the change');
  await api('PATCH', `/api/room-types/${id}`, { description: 'Quiet loft by the lake' }, MG);
  const stale = await api('POST', `/api/approvals/ROOM_TYPE/${id}/approve`, { revision: first.revision }, AD);
  ok(stale.status === 409 && code(stale) === 'STALE_REQUEST', 'a change that was edited after it was opened is refused (STALE_REQUEST)');
  ok((await list(AD)).find(x => x.room_type_id === id).name === type.name, 'nothing was applied');

  // ---------- approve ----------
  const cur = (await inbox()).find(x => x.id === id);
  const ap = await api('POST', `/api/approvals/ROOM_TYPE/${id}/approve`, { revision: cur.revision }, AD);
  ok(ap.status === 200 && ap.body.status === 'APPROVED', 'Administrator approves the change');
  const after = (await api('GET', `/api/room-types/${id}`, null, AD)).body;
  ok(after.name === 'Lake View Loft' && after.max_guests === 5 && after.description === 'Quiet loft by the lake' && after.pending_changes === null && after.rates.length === ratesBefore, 'the new details are in force, nothing is waiting and the rates are untouched');
  ok((await list(FD)).some(x => x.room_type_id === id && x.name === 'Lake View Loft'), 'Front Desk now sees the new name');
  ok(!(await inbox()).some(x => x.id === id), 'the inbox no longer lists it');
  ok((await api('POST', `/api/approvals/ROOM_TYPE/${id}/approve`, {}, AD)).status === 409, 'approving it twice is refused');
  const hist = (await api('GET', '/api/approvals?status=APPROVED&kind=ROOM_TYPE', null, AD)).body;
  ok(hist.some(x => x.id === id && x.title.startsWith('Room type change')), 'the decision is in the history');
  const au = (await api('GET', '/api/audit', null, AD)).body.map(a => a.action);
  ok(au.includes('ROOM_TYPE_CHANGE_SUBMITTED') && au.includes('ROOM_TYPE_CHANGE_APPROVED'), 'the audit log records the request and the approval');

  // ---------- reject ----------
  await api('PATCH', `/api/room-types/${id}`, { name: 'Rejected Name' }, MG);
  ok((await api('POST', `/api/approvals/ROOM_TYPE/${id}/reject`, {}, AD)).status === 400, 'a rejection needs a reason');
  const rj = await api('POST', `/api/approvals/ROOM_TYPE/${id}/reject`, { reason: 'Keep the old name' }, AD);
  const afterRj = (await api('GET', `/api/room-types/${id}`, null, AD)).body;
  ok(rj.status === 200 && rj.body.status === 'REJECTED' && afterRj.name === 'Lake View Loft' && afterRj.pending_changes === null && afterRj.approval_status === 'APPROVED', 'a rejected change is dropped; the room type stays as it was and stays on sale');
  ok((await api('GET', '/api/approvals?status=REJECTED&kind=ROOM_TYPE', null, AD)).body.some(x => x.id === id && x.decision.reason === 'Keep the old name'), 'the rejection and its reason are in the history');

  // ---------- take a change back, no-op, conflicts ----------
  await api('PATCH', `/api/room-types/${id}`, { name: 'Temporary Name' }, MG);
  const back = await api('PATCH', `/api/room-types/${id}`, { name: 'Lake View Loft' }, MG);
  ok(back.status === 200 && back.body.pending_changes === null && !(await inbox()).some(x => x.id === id), 'sending the current value again takes the waiting change back');
  const same = await api('PATCH', `/api/room-types/${id}`, { max_guests: 5 }, MG);
  ok(same.status === 200 && same.body.pending_changes === null, 'sending values that are already in force changes nothing');
  const other = (await list(AD)).find(x => x.room_type_id !== id && x.category_id === type.category_id && x.approval_status === 'APPROVED');
  if (other) {
    const dup = await api('PATCH', `/api/room-types/${id}`, { name: other.name.toUpperCase() }, MG);
    ok(dup.status === 409 && code(dup) === 'CONFLICT', 'a name used by another room type in the category is refused at once');
  }
  await api('PATCH', `/api/room-types/${id}`, { name: 'Late Name' }, MG);
  const body = { category_id: type.category_id, name: 'Late Name', max_guests: 2, rates: [{ rule_type: 'BASE', rate_amount: 100 }] };
  const clash = await api('POST', '/api/room-types', body, MG);
  const ap2 = await api('POST', `/api/room-types/${id}/approve`, null, AD);
  ok(clash.status === 201 && ap2.status === 409 && code(ap2) === 'INVALID_STATE' && (await api('GET', `/api/room-types/${id}`, null, AD)).body.name === 'Lake View Loft', 'if another room type took the name while the change was waiting, approval is refused and nothing changes');
  await api('POST', `/api/approvals/ROOM_TYPE/${id}/reject`, { reason: 'Name taken' }, AD);

  // ---------- a new room type is still being set up: details change at once ----------
  const np = await api('POST', '/api/room-types', { ...body, name: 'Brand New Suite' }, MG);
  const nu = await api('PATCH', `/api/room-types/${np.body.room_type_id}`, { name: 'Brand New Suite II', max_guests: 3 }, MG);
  ok(np.status === 201 && nu.status === 200 && nu.body.name === 'Brand New Suite II' && nu.body.max_guests === 3 && !nu.body.pending_changes, 'a room type that is still pending changes at once');
  summary();
})().catch(e => { console.error(e); process.exit(1); });
