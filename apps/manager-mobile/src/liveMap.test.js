import test from 'node:test'
import assert from 'node:assert/strict'
import {mapApproval} from './liveMap.js'
test('room type with a base rate and a date-range rule', () => {
  const r = mapApproval({kind: 'ROOM_TYPE', id: 'a', title: 'New room type: Loft', summary: 'Suite, up to 4 guests, base rate 250.00', revision: 'rv', status: 'PENDING', submitted_at: '2026-11-03T01:00:00Z', decision: null,
    details: {name: 'Loft', category: 'Suite', max_guests: 4, description: 'Nice', rates: [{rule_type: 'BASE', rate_amount: 250}, {rule_type: 'DATE_RANGE', date_from: '2026-12-20', date_to: '2026-12-31', rate_amount: 300, priority: 5}]}})
  assert.equal(r.kind, 'Room Type'); assert.equal(r.status, 'Pending'); assert.equal(r.proposed, 250); assert.equal(r.guests, 4)
  assert.equal(r.rules.length, 1); assert.equal(r.rules[0].type, 'Date Range'); assert.equal(r.rules[0].condition, '2026-12-20 to 2026-12-31'); assert.equal(r.id, 'ROOM_TYPE:a')
})
test('rate change shows current and new rate', () => {
  const r = mapApproval({kind: 'RATE', id: 'b', title: 'Rate change: Deluxe', summary: 'base 270.00 (now 250.00)', revision: 'rv', status: 'PENDING', details: {room_type: 'Deluxe', rule_type: 'BASE', rate_amount: 270, current_rate: 250}})
  assert.equal(r.kind, 'Room Rate'); assert.equal(r.current, 250); assert.equal(r.proposed, 270); assert.deepEqual(r.rules, [])
})
test('decided add-on keeps who and why', () => {
  const r = mapApproval({kind: 'ADD_ON', id: 'c', title: 'New add-on: Spa', summary: 'per stay 60.00', revision: null, status: 'REJECTED', details: {name: 'Spa', unit_price: 60, is_new: true}, decision: {decided_by: 'Administrator', decided_at: '2026-11-03T02:00:00Z', reason: 'Too high'}})
  assert.equal(r.status, 'Rejected'); assert.equal(r.reviewedBy, 'Administrator'); assert.equal(r.reviewRemark, 'Too high'); assert.equal(r.current, null); assert.equal(r.proposed, 60)
})
