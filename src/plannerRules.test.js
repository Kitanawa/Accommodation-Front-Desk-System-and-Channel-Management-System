import test from 'node:test'
import assert from 'node:assert/strict'
import { monthDates,monthlyInventory } from './plannerRules.js'
const room={id:'a',name:'Alpha',rate:250,stock:4,guests:2,units:[{id:'201'},{id:'202'},{id:'203'},{id:'204'}]}
const booking={id:'b',room:'a',quantity:2,start:'2026-10-15',end:'2026-10-18',guest:{name:'Sample'}}
test('monthly calendar has correct lengths, weekdays and leap years',()=>{
 assert.equal(monthDates(2026,9).length,31)
 assert.equal(monthDates(2026,1).length,28)
 assert.equal(monthDates(2028,1).length,29)
 assert.equal(monthDates(2026,11).at(-1),'2026-12-31')
 assert.equal(new Date(monthDates(2026,9)[0]+'T12:00:00').getDay(),4)
})
test('allotment subtracts physical and dated blocks, balance subtracts bookings',()=>{
 const r={...room,blocks:[{start:'2026-10-15',end:'2026-10-16',quantity:1}]}
 const n=monthlyInventory(r,'2026-10-15',[booking],{'204':{status:'Blocked'}},[r])
 assert.equal(n.allotment,2);assert.equal(n.reserved,2);assert.equal(n.remaining,0);assert.equal(n.state,'full')
})
test('checkout dates excluded and cancelled/no-show reservations ignored',()=>{
 const n=monthlyInventory(room,'2026-10-18',[booking],{},[room]);assert.equal(n.reserved,0);assert.equal(n.state,'available')
 const cancelled=monthlyInventory(room,'2026-10-15',[{...booking,status:'Cancelled'},{...booking,status:'No-show'}],{},[room]);assert.equal(cancelled.reserved,0)
})
test('departed reservations count for historical booked nights without mutating status',()=>{
 const b={...booking,status:'Checked-out'}
 assert.equal(monthlyInventory(room,'2026-10-15',[b],{},[room]).reserved,2)
 assert.equal(b.status,'Checked-out')
})
test('unpublished and zero-allotment types show no allocation',()=>{
 assert.equal(monthlyInventory({...room,publication:'Draft'},'2026-10-15',[],{},[room]).state,'unallocated')
 const zero={...room,stock:0,units:[]}
 assert.equal(monthlyInventory(zero,'2026-10-15',[],{},[zero]).state,'unallocated')
})
test('invalid negative stock is flagged instead of hidden',()=>{
 const n=monthlyInventory(room,'2026-10-15',[{...booking,quantity:5}],{},[room]);assert.equal(n.remaining,-1);assert.equal(n.state,'invalid')
})
