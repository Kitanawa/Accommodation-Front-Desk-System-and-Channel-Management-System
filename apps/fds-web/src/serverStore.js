// Server mode for the staff web app: load what the screens show from the API, and send each change the screens make to the right endpoint.
// No React and no browser globals here, so it can be tested with node --test. `api` is the app's helper: api(path, options) -> parsed body, throws Error(message).
const SOURCE = { 'Walk-in': 1, Phone: 2, Email: 3, Website: 4, 'Direct website': 4, 'Travel agent': 5, OTA: 6 }
const METHOD = { Cash: 'CASH', Card: 'CARD', Online: 'ONLINE', 'Bank transfer': 'BANK_TRANSFER' }
const json = (method, body) => ({ method, body: JSON.stringify(body ?? {}) })
const same = (a, b) => JSON.stringify(a ?? []) === JSON.stringify(b ?? [])

export const loadState = api => api('/api/frontdesk/state')

// the booking the Booking page builds -> POST /api/reservations
export function reservationBody(b) {
  return { room_type_id: b.room, check_in: b.start, check_out: b.end, total_guests: Number(b.guests) || 1,
    source_id: SOURCE[b.guest?.source] || 1,
    ...(/^[0-9a-f-]{36}$/i.test(b.guest?.profileId || '') ? { guest_id: b.guest.profileId } : {}),
    guest: { full_name: (b.guest?.name || '').trim(), phone: b.guest?.phone || undefined, email: b.guest?.email || undefined, nationality: b.guest?.nationality || undefined,
      id_passport_no: b.guest?.identity || undefined, address: b.guest?.address || undefined },
    special_requests: b.guest?.requests || undefined, estimated_arrival: b.guest?.arrival || undefined }
}

// one call list for a booking that changed: [path, options] pairs, in the order they must run
export function planBookingChanges(prev, next, rooms) {
  const calls = [], roomId = number => rooms.flatMap(r => r.units || []).find(u => u.id === number)?.roomId
  const id = next.id, base = `/api/reservations/${id}`
  const numbersOf = b => b.roomNumbers || (b.roomNumber ? [b.roomNumber] : [])
  const stayChanged = prev.start !== next.start || prev.end !== next.end || prev.room !== next.room
  if (stayChanged) calls.push([base, json('PATCH', { check_in: next.start, check_out: next.end, room_type_id: next.room })])
  if (!same(numbersOf(prev), numbersOf(next)) && numbersOf(next).length) {
    const target = roomId(numbersOf(next)[0])
    if (target) calls.push([`${base}/assign-room`, json('POST', { room_id: target })])
  }
  if (prev.status !== next.status) {
    if (next.status === 'Cancelled') calls.push([`${base}/cancel`, json('POST', { remark: next.cancellationReason || undefined })])
    else if (next.status === 'Checked-in') calls.push([`${base}/check-in`, json('POST')])
    else if (next.status === 'Checked-out') calls.push([`${base}/check-out`, json('POST')])
    else if (next.status === 'No-show') calls.push([`${base}/no-show`, json('POST')])
  }
  for (const c of (next.charges || []).filter(c => !(prev.charges || []).some(p => p.id === c.id)))
    calls.push([`${base}/charges`, json('POST', { description: c.description, quantity: 1, unit_price: c.amountCents / 100 })])
  for (const p of (next.payments || []).filter(p => !(prev.payments || []).some(o => o.id === p.id)))
    calls.push([`${base}/payments`, json('POST', { amount: p.amountCents / 100, method: METHOD[p.method] || 'CASH', reference: p.paymentReference || undefined })])
  const g0 = prev.guest || {}, g1 = next.guest || {}
  if (['name', 'phone', 'email', 'requests', 'arrival'].some(k => (g0[k] || '') !== (g1[k] || '')))
    calls.push([base, json('PATCH', { full_name: g1.name, phone: g1.phone, email: g1.email, special_requests: g1.requests, estimated_arrival: g1.arrival || undefined })])
  return calls
}

// compare the old and new list the screens hold, run the calls, return how many were made
export async function commitBookings(api, prevList, nextList, rooms) {
  let made = 0
  for (const next of nextList) {
    const prev = prevList.find(b => b.id === next.id)
    if (!prev) {
      const n = Math.max(1, Number(next.quantity) || 1)
      for (let i = 0; i < n; i++) {
        const created = await api('/api/reservations', json('POST', reservationBody(next))); made++
        // a walk-in made on Stay View already names its room (and may check in at once): send those steps for the new reservation
        if (n === 1 && created?.reservation_id && (next.roomNumbers?.length || next.status))
          for (const [path, options] of planBookingChanges({ ...next, roomNumbers: [], roomNumber: undefined, status: undefined }, { ...next, id: created.reservation_id }, rooms)) { await api(path, options); made++ }
      }
      continue
    }
    for (const [path, options] of planBookingChanges(prev, next, rooms)) { await api(path, options); made++ }
  }
  return made
}

// Housekeeping: the screens keep one {status, assignee, notes} per room number. Compare the old and new object and make the matching calls.
// Dirty = room CLEANING; Cleaning = a started task; Clean = room AVAILABLE; Blocked = an open maintenance report that blocks the room.
export async function commitCleaning(api, prev, next, rooms) {
  const units = rooms.flatMap(r => r.units || [])
  const keys = [...new Set([...Object.keys(prev || {}), ...Object.keys(next || {})])]
  const sane = c => ({ status: c?.status || 'Clean', assignee: (c?.assignee || '').trim(), notes: (c?.notes || '').trim() })
  let people = null, made = 0
  const call = async (path, options) => { made++; return api(path, options) }
  for (const number of keys) {
    const was = sane(prev?.[number]), now = sane(next?.[number])
    if (was.status === now.status && was.assignee === now.assignee && was.notes === now.notes) continue
    const roomId = units.find(u => u.id === number)?.roomId
    if (!roomId) continue
    if (now.status === 'Blocked') {
      if (was.status !== 'Blocked') await call('/api/maintenance', json('POST', { room_id: roomId, issue: now.notes || 'Blocked from Housekeeping', severity: 'MEDIUM', block_room: true }))
      continue
    }
    if (was.status === 'Blocked') {
      const open = await api(`/api/maintenance?status=OPEN&room_id=${roomId}`)
      for (const r of open.filter(r => r.blocks_room)) await call(`/api/maintenance/${r.report_id}/resolve`, json('POST', { note: 'Released from Housekeeping' }))
    }
    const tasks = async () => [...await api(`/api/housekeeping/tasks?room_id=${roomId}&status=OPEN`), ...await api(`/api/housekeeping/tasks?room_id=${roomId}&status=IN_PROGRESS`)]
    if (now.status === 'Clean') {
      for (const t of await tasks()) await call(`/api/housekeeping/tasks/${t.task_id}/complete`, json('POST'))
      await call(`/api/rooms/${roomId}/status`, json('PATCH', { status: 'AVAILABLE' }))
      continue
    }
    // Dirty or Cleaning: the room is being cleaned, with a task that says who and why
    await call(`/api/rooms/${roomId}/status`, json('PATCH', { status: 'CLEANING' })).catch(e => { if (was.status === 'Clean' || was.status === 'Blocked') throw e })
    let task = (await tasks())[0]
    let assigneeId
    if (now.assignee) {
      people = people || await api('/api/housekeeping/assignees')
      assigneeId = people.find(p => p.full_name.toLowerCase() === now.assignee.toLowerCase())?.user_id
      if (!assigneeId) throw new Error(`"${now.assignee}" is not a staff member of this property. Use the name exactly as it appears in Staff.`)
    }
    if (!task) task = await call('/api/housekeeping/tasks', json('POST', { room_id: roomId, task_type: 'CHECKOUT_CLEAN', notes: now.notes || undefined, assigned_to: assigneeId }))
    else if (assigneeId && task.assigned_to !== assigneeId) await call(`/api/housekeeping/tasks/${task.task_id}/assign`, json('POST', { user_id: assigneeId }))
    if (now.status === 'Cleaning' && task.status === 'OPEN') await call(`/api/housekeeping/tasks/${task.task_id}/start`, json('POST'))
  }
  return made
}

// ---- Room types, physical rooms, pricing and approvals ----
const RULE_TYPE = { 'Date Range': 'DATE_RANGE', 'Selected Day': 'SELECTED_DAY', 'Specific Date': 'SPECIFIC_DATE' }
const floorOf = v => (v === '' || v == null || !Number.isInteger(Number(v)) ? null : Number(v))
const facilitiesOf = text => String(text || '').split(',').map(x => x.trim()).filter(Boolean)
// one fds pricing object -> the list of rate rules the API takes (a rule with several specific dates becomes one rule per date)
export function ratesBody(pricing) {
  const out = [{ rule_type: 'BASE', rate_amount: Number(pricing.baseRate) }]
  for (const r of pricing.rules || []) {
    const rule_type = RULE_TYPE[r.type], base = { rule_type, rate_amount: Number(r.rate), priority: Number(r.prior) }
    if (rule_type === 'DATE_RANGE') out.push({ ...base, date_from: r.start, date_to: r.end })
    else if (rule_type === 'SELECTED_DAY') out.push({ ...base, selected_days: r.days.map(Number) })
    else (r.dates || []).forEach(d => out.push({ ...base, specific_date: d }))
  }
  return out
}
const ruleKey = r => JSON.stringify([r.type, r.start, r.end, r.days, r.dates])
// the rate calls that turn `before` (approved) into `after`: change an approved rate with /revise, add a new rule with POST /api/rates
export function planPricingChange(roomTypeId, before, after) {
  const calls = []
  if (Number(after.baseRate) !== Number(before.baseRate)) {
    if (!before.baseRuleId) throw new Error('This room type has no approved base rate to change.')
    calls.push([`/api/rates/${before.baseRuleId}/revise`, json('POST', { rate_amount: Number(after.baseRate) })])
  }
  for (const rule of after.rules || []) {
    const old = (before.rules || []).find(o => ruleKey(o) === ruleKey(rule))
    if (!old) ratesBody({ baseRate: 0, rules: [rule] }).slice(1).forEach(b => calls.push(['/api/rates', json('POST', { room_type_id: roomTypeId, ...b })]))
    else if (Number(old.rate) !== Number(rule.rate) || Number(old.prior) !== Number(rule.prior)) {
      if (!old.rateRuleId) throw new Error('That rate rule cannot be changed yet.')
      calls.push([`/api/rates/${old.rateRuleId}/revise`, json('POST', { rate_amount: Number(rule.rate), priority: Number(rule.prior) })])
    }
  }
  for (const old of before.rules || []) if (!(after.rules || []).some(r => ruleKey(r) === ruleKey(old)))
    throw new Error('An approved rate rule cannot be deleted. Change its price instead.')
  return calls
}

// compare the rooms the screens held with the rooms they hold now, and make the calls; returns how many were made
export async function commitRooms(api, prev, next) {
  const prevById = new Map(prev.map(r => [r.id, r]))
  let made = 0, cats = null
  const call = async (path, options) => { made++; return api(path, options) }
  const categoryId = async name => {
    cats = cats || await api('/api/room-categories')
    let c = cats.find(c => c.name.toLowerCase() === String(name).trim().toLowerCase())
    if (!c) { c = await call('/api/room-categories', json('POST', { name: String(name).trim() })); cats.push(c) }
    return c.category_id
  }
  for (const r of next) {
    const p = prevById.get(r.id)
    if (!p) {                                            // a new room type: submitted with its rates, waits for approval
      const created = await call('/api/room-types', json('POST', { name: r.name.trim(), category_id: await categoryId(r.category), max_guests: Number(r.guests),
        description: r.note || undefined, facilities: facilitiesOf(r.facilities), rates: ratesBody(r.pricing || { baseRate: r.rate, rules: [] }) }))
      for (const u of r.units || []) await call('/api/rooms', json('POST', { room_type_id: created.room_type_id, room_number: u.id, floor: floorOf(u.floor) }))
      continue
    }
    const fields = {}
    if (r.name !== p.name) fields.name = r.name.trim()
    if (Number(r.guests) !== Number(p.guests)) fields.max_guests = Number(r.guests)
    if ((r.note || '') !== (p.note || '')) fields.description = r.note || null
    if ((r.facilities || '') !== (p.facilities || '')) fields.facilities = facilitiesOf(r.facilities)
    if (r.category !== p.category) fields.category_id = await categoryId(r.category)
    if (Object.keys(fields).length) await call(`/api/room-types/${r.id}`, json('PATCH', fields))
    for (const u of r.units || []) {                     // physical rooms: added, floor changed
      const old = (p.units || []).find(o => o.id === u.id)
      if (!old) await call('/api/rooms', json('POST', { room_type_id: r.id, room_number: u.id, floor: floorOf(u.floor) }))
      else if (old.roomId && floorOf(old.floor) !== floorOf(u.floor)) await call(`/api/rooms/${old.roomId}`, json('PATCH', { floor: floorOf(u.floor) }))
    }
    for (const old of p.units || []) if (old.roomId && !(r.units || []).some(u => u.id === old.id)) await call(`/api/rooms/${old.roomId}`, json('DELETE'))
    if (r.publication !== p.publication) {               // publication: only what the API can do
      const last = (r.publicationHistory || []).at(-1)
      if (p.publication === 'Pending Approval' && r.publication === 'Published') await call(`/api/room-types/${r.id}/approve`, json('POST'))
      else if (p.publication === 'Pending Approval' && r.publication === 'Rejected') await call(`/api/approvals/ROOM_TYPE/${r.id}/reject`, json('POST', { reason: last?.reason || 'Rejected' }))
      else throw new Error(`"${p.publication}" to "${r.publication}" is not available on the server yet.`)
    }
    // pricing of a room type that is still waiting: withdraw its pending rates and send the new ones
    if (p.publication === 'Pending Approval' && r.publication === 'Pending Approval' && JSON.stringify(ratesBody(r.pricing)) !== JSON.stringify(ratesBody(p.pricing))) {
      for (const id of [p.pricing.baseRuleId, ...(p.pricing.rules || []).map(x => x.rateRuleId)].filter(Boolean)) await call(`/api/rates/${id}`, json('DELETE'))
      for (const b of ratesBody(r.pricing)) await call('/api/rates', json('POST', { room_type_id: r.id, ...b }))
    }
    if (r.rateRequest && !p.rateRequest)                 // a price change on a published room type
      for (const [path, options] of planPricingChange(r.id, p.pricing, r.rateRequest.pricing)) await call(path, options)
    if (!r.rateRequest && p.rateRequest) {               // the Manager decided
      const approved = JSON.stringify(ratesBody(r.pricing)) !== JSON.stringify(ratesBody(p.pricing)) || Number(r.rate) !== Number(p.rate)
      const reason = (r.rateHistory || []).at(-1)?.reason || 'Rejected'
      for (const id of p.rateRequest.ruleIds || []) await call(approved ? `/api/rates/${id}/approve` : `/api/approvals/RATE/${id}/reject`, json('POST', approved ? {} : { reason }))
    }
  }
  return made
}

// ---- Guest profiles and property settings ----
const profileBody = p => ({ full_name: (p.name || '').trim(), phone: p.phone || null, email: p.email || null, nationality: p.nationality || null,
  id_passport_no: p.identity || null, address: p.address || null, language: p.language || null, requests: p.requests || null })
const profileKeys = ['name', 'phone', 'email', 'nationality', 'identity', 'address', 'language', 'requests']
// added and changed profiles; a profile with an id the server does not know yet is new
export async function commitGuests(api, prev, next) {
  let made = 0
  for (const p of next.filter(p => !p.deleted)) {
    const old = prev.find(o => o.id === p.id && !o.deleted)
    if (!old) { await api('/api/guests', json('POST', profileBody(p))); made++ }
    else if (profileKeys.some(k => (old[k] || '') !== (p[k] || ''))) { await api(`/api/guests/${p.id}`, json('PATCH', profileBody(p))); made++ }
  }
  return made
}
export const deleteGuest = (api, id) => api(`/api/guests/${id}`, json('DELETE'))
// the Property & Policies form -> PATCH /api/settings (the demo staff display name stays in the browser)
export const settingsBody = s => ({ property_name: (s.propertyName || '').trim(), address: s.city || null, contact_email: s.contactEmail || null, contact_phone: s.contactPhone || null,
  check_in_time: s.arrivalTime, logo_data_url: s.logoDataUrl || null })
