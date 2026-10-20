import { inventoryAt } from './inventoryRules.js'
import { statusOf } from './bookingRules.js'
import { isBookable } from './roomManagementRules.js'
export function monthDates(year,month){return Array.from({length:new Date(Date.UTC(year,month+1,0)).getUTCDate()},(_,i)=>`${year}-${String(month+1).padStart(2,'0')}-${String(i+1).padStart(2,'0')}`)}
export function monthlyInventory(room,date,bookings,cleaning,rooms){
 const eligible=bookings.filter(b=>!['Cancelled','No-show'].includes(statusOf(b)))
 // Historical departed reservations still count against the nights they booked.
 const counts=inventoryAt(room,date,eligible.map(b=>({...b,status:'Upcoming'})),cleaning,rooms)
 const allotment=counts.capacity-counts.blocked
 const state=counts.remaining<0?'invalid':!isBookable(room)||allotment<=0?'unallocated':counts.remaining===0?'full':'available'
 return {...counts,allotment,state,reservations:eligible.filter(b=>b.room===room.id&&b.start<=date&&b.end>date)}
}
