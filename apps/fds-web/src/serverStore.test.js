import test from 'node:test'
import assert from 'node:assert/strict'
import { reservationBody, planBookingChanges, commitBookings, commitCleaning, commitRooms, commitGuests, settingsBody, ratesBody, planPricingChange } from './serverStore.js'

// a fake api that records every call and answers like the server would
const recorder = (answers = {}) => { const calls = []; const api = async (path, options = {}) => { calls.push([options.method || 'GET', path, options.body ? JSON.parse(options.body) : undefined]); const hit = Object.entries(answers).find(([k]) => path.startsWith(k)); return hit ? (typeof hit[1] === 'function' ? hit[1](path) : hit[1]) : {} }; return { api, calls } }
const rooms = [{ id: 'T1', units: [{ id: '101', roomId: 'r101' }, { id: '102', roomId: 'r102' }] }]
const booking = { id: 'B1', room: 'T1', start: '2026-12-01', end: '2026-12-03', quantity: 1, guests: 2, status: 'Upcoming', roomNumbers: [], charges: [], payments: [], guest: { name: 'Ann', phone: '1', email: 'a@x.co', source: 'Website' } }

test('a booking from the Booking page becomes a reservation request (profile id only when it is a real id)', () => {
  const b = reservationBody(booking)
  assert.deepEqual([b.room_type_id, b.check_in, b.check_out, b.total_guests, b.source_id, b.guest.full_name], ['T1', '2026-12-01', '2026-12-03', 2, 4, 'Ann'])
  assert.equal(b.guest_id, undefined)
  assert.equal(reservationBody({ ...booking, guest: { ...booking.guest, profileId: 'booking:B9' } }).guest_id, undefined)
  const id = '0f8fad5b-d9cb-469f-a165-70867728950e'
  assert.equal(reservationBody({ ...booking, guest: { ...booking.guest, profileId: id } }).guest_id, id)
})
test('each change of a booking maps to one call, in order', () => {
  const next = { ...booking, end: '2026-12-04', roomNumbers: ['102'], status: 'Checked-in', charges: [{ id: 'c1', description: 'Minibar', amountCents: 5000 }], payments: [{ id: 'p1', method: 'Card', amountCents: 1200, paymentReference: 'X1' }] }
  const calls = planBookingChanges(booking, next, rooms)
  assert.deepEqual(calls.map(c => c[0]), ['/api/reservations/B1', '/api/reservations/B1/assign-room', '/api/reservations/B1/check-in', '/api/reservations/B1/charges', '/api/reservations/B1/payments'])
  assert.equal(JSON.parse(calls[1][1].body).room_id, 'r102')
  assert.deepEqual(JSON.parse(calls[3][1].body), { description: 'Minibar', quantity: 1, unit_price: 50 })
  assert.deepEqual(JSON.parse(calls[4][1].body), { amount: 12, method: 'CARD', reference: 'X1' })
  assert.deepEqual(planBookingChanges(booking, { ...booking, status: 'Cancelled', cancellationReason: 'Sick' }, rooms).map(c => c[0]), ['/api/reservations/B1/cancel'])
  assert.deepEqual(planBookingChanges(booking, booking, rooms), [])
})
test('a new booking for 2 rooms makes 2 reservations; an unchanged list makes none', async () => {
  const { api, calls } = recorder()
  assert.equal(await commitBookings(api, [], [{ ...booking, id: 'new', quantity: 2 }], rooms), 2)
  assert.deepEqual(calls.map(c => c[1]), ['/api/reservations', '/api/reservations'])
  assert.equal(await commitBookings(api, [booking], [booking], rooms), 0)
})
test('housekeeping: Cleaning starts a task for the named cleaner; Clean finishes it and frees the room; Blocked opens a blocking report', async () => {
  const r = recorder({ '/api/housekeeping/assignees': [{ user_id: 'u1', full_name: 'Front Desk Staff' }], '/api/housekeeping/tasks?room_id=r101&status=OPEN': [], '/api/housekeeping/tasks?room_id=r101&status=IN_PROGRESS': [], '/api/housekeeping/tasks': { task_id: 't1', status: 'OPEN' } })
  await commitCleaning(r.api, {}, { 101: { status: 'Cleaning', assignee: 'Front Desk Staff' } }, rooms)
  assert.deepEqual(r.calls.filter(c => c[0] !== 'GET').map(c => c[0] + ' ' + c[1]), ['PATCH /api/rooms/r101/status', 'POST /api/housekeeping/tasks', 'POST /api/housekeeping/tasks/t1/start'])
  const r2 = recorder({ '/api/housekeeping/tasks?room_id=r101&status=OPEN': [{ task_id: 't9', status: 'OPEN' }], '/api/housekeeping/tasks?room_id=r101&status=IN_PROGRESS': [] })
  await commitCleaning(r2.api, { 101: { status: 'Dirty' } }, { 101: { status: 'Clean' } }, rooms)
  assert.deepEqual(r2.calls.filter(c => c[0] !== 'GET').map(c => c[1]), ['/api/housekeeping/tasks/t9/complete', '/api/rooms/r101/status'])
  const r3 = recorder()
  await commitCleaning(r3.api, {}, { 102: { status: 'Blocked', notes: 'Leak' } }, rooms)
  assert.deepEqual(r3.calls[0].slice(0, 2), ['POST', '/api/maintenance']); assert.equal(r3.calls[0][2].block_room, true)
  await assert.rejects(() => commitCleaning(recorder({ '/api/housekeeping/assignees': [] , '/api/housekeeping/tasks?room_id=r101&status=OPEN': [], '/api/housekeeping/tasks?room_id=r101&status=IN_PROGRESS': [] }).api, {}, { 101: { status: 'Dirty', assignee: 'Nobody' } }, rooms), /not a staff member/)
  assert.equal(await commitCleaning(r3.api, { 101: { status: 'Clean' } }, { 101: { status: 'Clean' } }, rooms), 0)
})
test('rates: the base and rules become API rate rules; a change uses revise, a new rule uses create, deleting an approved rule is refused', () => {
  const pricing = { baseRate: 100, baseRuleId: 'b1', rules: [{ type: 'Selected Day', days: [5, 6], rate: 150, prior: 1, rateRuleId: 'w1' }] }
  assert.deepEqual(ratesBody(pricing).map(r => r.rule_type + ':' + r.rate_amount), ['BASE:100', 'SELECTED_DAY:150'])
  assert.deepEqual(ratesBody({ baseRate: 1, rules: [{ type: 'Specific Date', dates: ['2026-12-24', '2026-12-25'], rate: 9, prior: 3 }] }).filter(r => r.specific_date).map(r => r.specific_date), ['2026-12-24', '2026-12-25'])
  const after = { baseRate: 110, rules: [{ ...pricing.rules[0], rate: 160 }, { type: 'Date Range', start: '2026-12-20', end: '2026-12-31', rate: 200, prior: 2 }] }
  assert.deepEqual(planPricingChange('T1', pricing, after).map(c => c[0]), ['/api/rates/b1/revise', '/api/rates/w1/revise', '/api/rates'])
  assert.throws(() => planPricingChange('T1', pricing, { baseRate: 100, rules: [] }), /cannot be deleted/)
})
test('room types: a new type is submitted with its rates and rooms; edits, new rooms and publication map to calls', async () => {
  const { api, calls } = recorder({ '/api/room-categories': [{ category_id: 'c1', name: 'Suites' }], '/api/room-types': { room_type_id: 'N1' } })
  const prev = [{ id: 'T1', name: 'King', category: 'Suites', guests: 2, note: '', facilities: '', publication: 'Pending Approval', stock: 1, units: [{ id: '101', roomId: 'r101', floor: '1' }], pricing: { baseRate: 100, rules: [] } }]
  const next = [{ ...prev[0], name: 'King Plus', publication: 'Published', units: [{ id: '101', roomId: 'r101', floor: '2' }, { id: '103', floor: '' }] },
    { id: 'tmp', name: 'Garden', category: 'Suites', guests: 3, note: 'Nice', facilities: 'Wifi, Pool', units: [{ id: '901', floor: '9' }], pricing: { baseRate: 250, rules: [] }, rate: 250 }]
  await commitRooms(api, prev, next)
  const sent = calls.filter(c => c[0] !== 'GET').map(c => c[0] + ' ' + c[1])
  assert.deepEqual(sent, ['PATCH /api/room-types/T1', 'PATCH /api/rooms/r101', 'POST /api/rooms', 'POST /api/room-types/T1/approve', 'POST /api/room-types', 'POST /api/rooms'])
  const created = calls.find(c => c[1] === '/api/room-types' && c[0] === 'POST')[2]
  assert.deepEqual([created.category_id, created.max_guests, created.facilities, created.rates[0].rule_type], ['c1', 3, ['Wifi', 'Pool'], 'BASE'])
  await assert.rejects(() => commitRooms(api, prev, [{ ...prev[0], publication: 'Archived' }]), /not available on the server/)
})
test('guest profiles: new ones are added, changed ones patched; settings map to the API names', async () => {
  const { api, calls } = recorder()
  const prev = [{ id: 'g1', name: 'Ann', phone: '1' }, { id: 'g2', name: 'Bob', phone: '2' }]
  await commitGuests(api, prev, [{ id: 'g1', name: 'Ann', phone: '1' }, { id: 'g2', name: 'Bob', phone: '9' }, { id: 'new', name: 'Cy', phone: '3' }, { id: 'g3', deleted: true }])
  assert.deepEqual(calls.map(c => c[0] + ' ' + c[1]), ['PATCH /api/guests/g2', 'POST /api/guests'])
  assert.deepEqual(settingsBody({ propertyName: ' Miri ', city: 'Miri', arrivalTime: '15:00', logoDataUrl: '', contactEmail: 'a@b.co' }), { property_name: 'Miri', address: 'Miri', contact_email: 'a@b.co', contact_phone: null, check_in_time: '15:00', logo_data_url: null })
})
