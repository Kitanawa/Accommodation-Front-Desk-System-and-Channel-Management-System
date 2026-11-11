// Live connection to the FDS public booking API. Used only when VITE_API_URL is set; otherwise the site keeps its local demo data.
import {rooms as sample} from './booking.js'
const env = (typeof import.meta !== 'undefined' && import.meta.env) || {}
export const API_URL = (env.VITE_API_URL || '').replace(/\/$/, '')
export const LIVE = !!API_URL
// Demo only: no payment gateway is chosen yet. With this secret set, the site plays the gateway and sends the signed webhook itself.
const DEMO_SECRET = env.VITE_DEMO_WEBHOOK_SECRET || ''
async function call(method, path, body, headers) {
  let r
  try { r = await fetch(API_URL + path, {method, headers: {'Content-Type': 'application/json', ...(headers || {})}, body: body == null ? undefined : JSON.stringify(body)}) }
  catch { throw new Error('Cannot reach the booking server. Please try again in a moment.') }
  let j = null; try { j = await r.json() } catch {}
  if (!r.ok) { const e = new Error(j?.error?.message || 'Request failed (' + r.status + ').'); e.status = r.status; e.code = j?.error?.code; throw e }
  return j
}
export function mapRoomType(x, i, nights) {
  const base = sample[i % sample.length]   // photos and wording only; names, prices and availability come from the server
  const left = x.available ? Math.max(1, x.rooms_left || 1) : 0
  return {id: x.room_type_id, name: x.name, eyebrow: base.eyebrow, category: x.category === 'Suite' ? 'Suite' : 'Classic', rate: x.total ? x.total / nights : 0, capacity: x.max_guests,
    stock: left, size: '–', bed: x.category, image: base.image, description: x.description || base.description, features: (x.facilities && x.facilities.length ? x.facilities : base.features), serverTotal: x.total, reasons: x.reasons || []}
}
export async function liveAvailability(stay) {
  const j = await call('GET', `/api/public/availability?from=${stay.start}&to=${stay.end}&guests=${stay.guests}`)
  const nights = Math.max(1, Math.round((Date.parse(stay.end) - Date.parse(stay.start)) / 86400000))
  return j.room_types.map((x, i) => mapRoomType(x, i, nights))
}
async function sign(raw) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(DEMO_SECRET), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign'])
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(raw)))].map(b => b.toString(16).padStart(2, '0')).join('')
}
// Hold the room, create the payment session, and (demo only) let the simulated gateway confirm it.
// token: the guest account session, when signed in, so the booking shows under My bookings.
export async function liveBook(room, stay, guest, token) {
  const hold = await call('POST', '/api/public/bookings', {room_type_id: room.id, check_in: stay.start, check_out: stay.end, total_guests: Number(stay.guests),
    guest: {full_name: guest.name.trim(), email: guest.email.trim(), phone: guest.phone.trim()}, special_requests: guest.requests || undefined, expected_total: room.serverTotal}, token ? {Authorization: 'Bearer ' + token} : undefined)
  const H = {'X-Booking-Token': hold.access_token}
  const session = await call('POST', `/api/public/bookings/${hold.attempt_id}/payment-session`, {}, H)
  let status = hold.status
  if (DEMO_SECRET) {
    const raw = JSON.stringify({event_id: 'web-' + hold.attempt_id + '-' + Date.now(), type: 'payment.succeeded', reference: session.reference, amount: session.amount, currency: session.currency_code, transaction_id: 'demo-' + Date.now()})
    const r = await fetch(API_URL + '/api/public/payments/webhook', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Signature': await sign(raw)}, body: raw})
    if (!r.ok) throw new Error('The payment could not be confirmed. Your room is held for a short time; please try again.')
  }
  const b = await call('GET', `/api/public/bookings/${hold.attempt_id}`, null, H)
  status = b.status
  const nights = Math.max(1, Math.round((Date.parse(stay.end) - Date.parse(stay.start)) / 86400000))
  return {id: b.reservation_ref || 'PENDING-' + hold.attempt_id.slice(0, 8).toUpperCase(), room: room.id, roomName: room.name, ...stay, guests: Number(stay.guests), guest: {...guest, name: guest.name.trim()}, nights,
    total: b.price.total, rate: b.price.total / nights, status: status === 'CONFIRMED' ? 'Upcoming' : 'Awaiting payment', paymentStatus: status === 'CONFIRMED' ? 'Paid online' : 'Payment pending (' + session.reference + ')',
    source: 'Direct website', createdAt: new Date().toISOString(), apiAttemptId: hold.attempt_id}
}
