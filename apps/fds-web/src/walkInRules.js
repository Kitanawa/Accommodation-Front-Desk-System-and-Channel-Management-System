// Walk-in booking from the Stay View dashboard: staff click an empty room/date cell, fill in the guest and
// (when the stay starts today and the room is clean) check the guest in at once. No React here, so it can be tested with node --test.
import { canAssign, physicalRooms, stayNights } from './bookingRules.js'
import { inventoryAt } from './inventoryRules.js'
import { stayPrice } from './pricingRules.js'

const dayAfter = date => new Date(Date.parse(date + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10)
const nightsOf = (start, end) => Array.from({ length: Math.max(0, stayNights(start, end)) }, (_, i) => new Date(Date.parse(start + 'T12:00:00Z') + i * 86400000).toISOString().slice(0, 10))

// The longest stay (from `start`) this room number can take before another booking or a sold-out night gets in the way, capped at `limit` nights.
export function freeUntil(unit, start, { rooms, bookings, cleaning = {} }, limit = 30) {
  const type = rooms.find(r => r.id === unit.type), units = physicalRooms(rooms)
  let end = start
  for (let i = 0; i < limit; i++) {
    const next = dayAfter(end)
    if (!canAssign({ id: '', room: unit.type, quantity: 1, start: end, end: next }, [unit.id], bookings, units, cleaning)) break
    if (type && inventoryAt(type, end, bookings, cleaning, rooms).remaining < 1) break
    end = next
  }
  return end
}

// Room numbers (optionally of one room type) free for the whole stay, in room order.
export function freeRooms(start, end, ctx, type) {
  return physicalRooms(ctx.rooms).filter(u => (!type || u.type === type) && (ctx.cleaning?.[u.id]?.status || 'Clean') !== 'Blocked' && freeUntil(u, start, ctx, Math.max(1, stayNights(start, end))) >= end)
}

export const SOURCES = ['Walk-in', 'Phone', 'Email', 'Travel agent']

// Can this walk-in be checked in straight away? Only for a stay starting today, in a clean room.
export const canCheckInNow = (start, today, unitId, cleaning = {}) => start === today && (cleaning[unitId]?.status || 'Clean') === 'Clean'

// Returns the new booking, or throws an Error with a message for the staff member.
export function walkInBooking({ unitId, start, end, guests = 1, guest = {}, checkIn = false }, { rooms, bookings, cleaning = {}, today, id }) {
  const units = physicalRooms(rooms)
  const unit = units.find(u => u.id === unitId)
  if (!unit) throw new Error('Choose a room on the grid.')
  const room = rooms.find(r => r.id === unit.type)
  if (!start || !end || start < today) throw new Error('Check-in cannot be in the past.')
  if (end <= start) throw new Error('Check-out must be after check-in.')
  if (stayNights(start, end) > 30) throw new Error('A walk-in stay can be up to 30 nights. Use the Booking page for longer stays.')
  const name = (guest.name || '').trim().replace(/\s+/g, ' '), phone = (guest.phone || '').trim()
  if (name.length < 2) throw new Error('Enter the guest name.')
  if (!/^\+?[0-9 ()-]{6,20}$/.test(phone)) throw new Error('Enter a valid phone number.')
  if (guest.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guest.email.trim())) throw new Error('Enter a valid e-mail address, or leave it empty.')
  const count = Number(guests)
  if (!Number.isInteger(count) || count < 1 || count > (room?.guests || 2)) throw new Error(`This room takes 1 to ${room?.guests || 2} guests.`)
  if (cleaning[unitId]?.status === 'Blocked') throw new Error(`Room ${unitId} is out of order.`)
  const draft = { id: '', room: unit.type, quantity: 1, start, end }
  if (!canAssign(draft, [unitId], bookings, units, cleaning)) throw new Error(`Room ${unitId} is already booked for part of this stay.`)
  if (nightsOf(start, end).some(day => inventoryAt(room, day, bookings, cleaning, rooms).remaining < 1)) throw new Error(`${room.name} is sold out for part of this stay.`)
  if (checkIn && !canCheckInNow(start, today, unitId, cleaning)) throw new Error(start === today ? `Room ${unitId} must be clean before check-in.` : 'Only a stay starting today can be checked in now.')
  return {
    id, room: unit.type, start, end, quantity: 1, guests: count, total: stayPrice(room, start, end, 1),
    roomNumbers: [unitId], status: checkIn ? 'Checked-in' : 'Upcoming', charges: [], payments: [],
    guest: { name, phone, email: (guest.email || '').trim(), identity: (guest.identity || '').trim(), requests: (guest.requests || '').trim(), source: SOURCES.includes(guest.source) ? guest.source : 'Walk-in', arrival: guest.arrival || '',
      ...(guest.profileId ? { profileId: guest.profileId } : {}), ...(guest.nationality ? { nationality: guest.nationality } : {}), ...(guest.address ? { address: guest.address } : {}) },
  }
}
