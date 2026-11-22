import test from 'node:test'
import assert from 'node:assert/strict'
import { walkInBooking, freeUntil, canCheckInNow } from './walkInRules.js'
import { reservationBody, commitBookings } from './serverStore.js'

const rooms = [{ id: 'k', name: 'Deluxe King', rate: 200, stock: 2, guests: 2, units: [{ id: '201', roomId: 'r201' }, { id: '202', roomId: 'r202' }] }]
const today = '2026-12-01'
const guest = { name: '  Walk  In ', phone: '+60 12-345 6789' }
const ctx = (bookings = [], cleaning = {}) => ({ rooms, bookings, cleaning, today, id: 'W1' })
const held = { id: 'B1', room: 'k', quantity: 1, start: '2026-12-03', end: '2026-12-05', roomNumbers: ['201'], guest: { name: 'Held' } }

test('a walk-in becomes a one-room booking on the clicked room, priced from the rate and marked as a walk-in', () => {
  const b = walkInBooking({ unitId: '201', start: today, end: '2026-12-03', guests: 2, guest }, ctx())
  assert.deepEqual([b.id, b.room, b.roomNumbers, b.quantity, b.total, b.status, b.guest.name, b.guest.source], ['W1', 'k', ['201'], 1, 400, 'Upcoming', 'Walk In', 'Walk-in'])
  assert.equal(walkInBooking({ unitId: '201', start: today, end: '2026-12-02', guest, checkIn: true }, ctx()).status, 'Checked-in')
})

test('a walk-in is refused when the room is taken, out of order, dirty for check-in or the details are wrong', () => {
  const fails = (input, c = ctx(), msg) => assert.throws(() => walkInBooking({ unitId: '201', start: today, end: '2026-12-02', guest, ...input }, c), msg)
  fails({ end: '2026-12-04' }, ctx([held]), /already booked/)
  fails({}, ctx([], { 201: { status: 'Blocked' } }), /out of order/)
  fails({ checkIn: true }, ctx([], { 201: { status: 'Dirty' } }), /must be clean/)
  fails({ start: '2026-12-02', end: '2026-12-03', checkIn: true }, ctx(), /starting today/)
  fails({ start: '2026-11-30' }, ctx(), /past/)
  fails({ end: today }, ctx(), /after check-in/)
  fails({ guest: { name: 'A', phone: '+60 12-345 6789' } }, ctx(), /guest name/)
  fails({ guest: { name: 'Ann', phone: 'call me' } }, ctx(), /phone/)
  fails({ guests: 3 }, ctx(), /1 to 2 guests/)
  // room 202 is free, but the type is sold out because an unassigned booking holds the other room
  const unassigned = { id: 'U', room: 'k', quantity: 1, start: today, end: '2026-12-02', guest: { name: 'U' } }
  fails({ unitId: '202' }, ctx([unassigned, { ...held, start: today, end: '2026-12-02', roomNumbers: ['201'] }]), /sold out/)
})

test('freeUntil gives the last check-out date before the room is next booked', () => {
  assert.equal(freeUntil({ id: '201', type: 'k' }, today, ctx([held])), '2026-12-03')
  assert.equal(freeUntil({ id: '201', type: 'k' }, today, ctx(), 5), '2026-12-06')
  assert.equal(canCheckInNow(today, today, '201', {}), true)
  assert.equal(canCheckInNow(today, today, '201', { 201: { status: 'Dirty' } }), false)
})

test('in Database mode a walk-in is created, then its room assigned and (if asked) checked in', async () => {
  const calls = []
  const api = async (path, options = {}) => { calls.push(`${options.method || 'GET'} ${path}`); return path === '/api/reservations' ? { reservation_id: 'R9' } : {} }
  const b = walkInBooking({ unitId: '202', start: today, end: '2026-12-02', guest, checkIn: true }, ctx())
  assert.equal(reservationBody(b).source_id, 1)
  await commitBookings(api, [], [b], rooms)
  assert.deepEqual(calls, ['POST /api/reservations', 'POST /api/reservations/R9/assign-room', 'POST /api/reservations/R9/check-in'])
})

test('freeRooms lists the rooms free for the whole stay; source and guest profile carry through', async () => {
  const { freeRooms } = await import('./walkInRules.js')
  assert.deepEqual(freeRooms(today, '2026-12-04', ctx([held])).map(u => u.id), ['202'])
  assert.deepEqual(freeRooms(today, '2026-12-02', ctx([], { 201: { status: 'Blocked' } }), 'k').map(u => u.id), ['202'])
  const b = walkInBooking({ unitId: '202', start: today, end: '2026-12-02', guest: { ...guest, source: 'Phone', profileId: 'P1' } }, ctx())
  assert.deepEqual([b.guest.source, b.guest.profileId], ['Phone', 'P1'])
  assert.equal(walkInBooking({ unitId: '202', start: today, end: '2026-12-02', guest: { ...guest, source: 'Hacker' } }, ctx()).guest.source, 'Walk-in')
})
