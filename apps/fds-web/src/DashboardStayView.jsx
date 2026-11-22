// Stay View dashboard (preview): one screen with today's status counts, per-type availability and rates,
// per-room booking bars, unassigned bookings and daily occupancy. Reads the same data as the classic dashboard.
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { statusOf, occupiesInventory, physicalRooms, roomsForBooking, roomsOnDate } from './bookingRules'
import { monthlyInventory, rollingDates, dailySummary, bookingInPlanner } from './plannerRules'
import { nightlyRate, stayPrice } from './pricingRules'
import { walkInBooking, freeUntil, freeRooms, canCheckInNow, SOURCES } from './walkInRules'
import './DashboardStayView.css'

const DAYS = 14
const shift = (date, days) => new Date(Date.parse(date + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10)
const dayInfo = date => { const d = new Date(date + 'T12:00:00Z'); return { dow: d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }), day: d.getUTCDate(), month: d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }), weekend: [0, 6].includes(d.getUTCDay()) } }
const rm = value => `RM${Math.round(value)}`
const housekeeping = (cleaning, id) => cleaning[id]?.status || 'Clean'

// Consecutive visible days that share the same booking become one bar.
function segments(dates, pick) {
  const out = []
  dates.forEach((day, i) => {
    const b = pick(day)
    const last = out.at(-1)
    if (b && last && last.booking.id === b.id && last.end === i) last.end = i + 1
    else if (b) out.push({ booking: b, start: i, end: i + 1 })
  })
  return out
}

const blankGuest = { name: '', phone: '', email: '', identity: '', source: 'Walk-in' }
const newId = () => globalThis.crypto?.randomUUID?.() || 'booking-' + Math.random().toString(36).slice(2)

export default function DashboardStayView({ rooms, bookings, cleaning, today, money, onOpen, onWalkIn, request }) {
  const [from, setFrom] = useState(today)
  const [walkIn, setWalkIn] = useState(null) // { unitId, start, end, guests, guest, checkIn }
  const [walkInError, setWalkInError] = useState('')
  const [saved, setSaved] = useState('')
  const formRef = useRef(null)
  const opened = walkIn ? walkIn.unitId + walkIn.start : ''
  useEffect(() => {
    if (!opened) return
    formRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' })
    formRef.current?.querySelector('input[name="name"]')?.focus({ preventScroll: true })
  }, [opened])
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState([])
  const dates = useMemo(() => rollingDates(from, DAYS), [from])
  const units = useMemo(() => physicalRooms(rooms), [rooms])
  const active = bookings.filter(occupiesInventory)
  const ctx = { rooms, bookings, cleaning, today }
  // Click an empty cell: start a walk-in there. Click a later free cell in the same row: stretch the stay to that night.
  function pickCell(unit, day) {
    setSaved(''); setWalkInError('')
    if (!onWalkIn) return
    if (walkIn?.unitId === unit.id && day > walkIn.start && day < freeUntil(unit, walkIn.start, ctx)) { setWalkIn({ ...walkIn, end: shift(day, 1) }); return }
    setWalkIn({ unitId: unit.id, start: day, end: shift(day, 1), guests: 1, guest: walkIn?.guest || blankGuest, checkIn: canCheckInNow(day, today, unit.id, cleaning) })
  }
  function openNew({ from: start = today, to, roomType, guest } = {}) {
    setSaved(''); setWalkInError('')
    if (!onWalkIn) return
    if (start < today) start = today
    const end = to && to > start ? to : shift(start, 1)
    const unit = freeRooms(start, end, ctx, roomType)[0]
    if (!unit) { setSaved((roomType ? (rooms.find(r => r.id === roomType)?.name || 'That room type') : 'No room') + ' is free from ' + start + ' to ' + end + '. Pick other dates on the grid.'); setFrom(start); setWalkIn(null); return }
    setFrom(start < from || start >= shift(from, DAYS) ? start : from)
    setWalkIn({ unitId: unit.id, start, end, guests: 1, guest: { ...blankGuest, ...(guest || walkIn?.guest || {}) }, checkIn: false })
  }
  // another page (Guests, Room Planner, the AI assistant) asked for a new booking
  const handled = useRef(null)
  useEffect(() => { if (request && handled.current !== request.id) { handled.current = request.id; openNew(request) } }, [request]) // eslint-disable-line react-hooks/exhaustive-deps
  const walkUnit = walkIn && units.find(u => u.id === walkIn.unitId)
  const walkType = walkUnit && rooms.find(r => r.id === walkUnit.type)
  const walkNights = walkIn ? Math.round((Date.parse(walkIn.end) - Date.parse(walkIn.start)) / 86400000) : 0
  const walkLatest = walkUnit ? freeUntil(walkUnit, walkIn.start, ctx) : ''
  const walkCanCheckIn = !!walkIn && canCheckInNow(walkIn.start, today, walkIn.unitId, cleaning)
  const setWalk = patch => { setWalkInError(''); setWalkIn(cur => ({ ...cur, ...patch })) }
  const setWalkGuest = (field, value) => setWalk({ guest: { ...walkIn.guest, [field]: value } })
  function saveWalkIn(event) {
    event.preventDefault()
    try {
      const booking = walkInBooking({ ...walkIn, checkIn: walkIn.checkIn && walkCanCheckIn }, { ...ctx, id: newId() })
      if (onWalkIn(booking) === false) { setWalkInError('The walk-in could not be saved. Please try again.'); return }
      setSaved('Booking saved: ' + booking.guest.name + ', room ' + walkIn.unitId + ', ' + walkIn.start + ' → ' + walkIn.end + (booking.status === 'Checked-in' ? ', checked in.' : '.'))
      setWalkIn(null)
    } catch (error) { setWalkInError(error.message) }
  }
  // where the new walk-in sits on the visible 14 days (null when it is off screen)
  function draftSpan() {
    const s = walkIn.start < dates[0] ? 0 : dates.indexOf(walkIn.start)
    const lastNight = shift(walkIn.end, -1), e = lastNight > dates.at(-1) ? DAYS - 1 : dates.indexOf(lastNight)
    return s < 0 || e < s ? null : { gridColumn: (s + 2) + ' / ' + (e + 3), gridRow: 1 }
  }
  const inHouseOn = (unit, day) => bookings.find(b => bookingInPlanner(b, day, today) && roomsOnDate(b, day).includes(unit.id))
  const occupiedToday = new Set(units.filter(u => inHouseOn(u, today)).map(u => u.id))

  const groups = {
    arrivals: active.filter(b => b.start === today && statusOf(b) === 'Upcoming'),
    departures: active.filter(b => b.end === today && statusOf(b) === 'Checked-in'),
    inhouse: active.filter(b => statusOf(b) === 'Checked-in'),
    unassigned: active.filter(b => b.end > today && !roomsForBooking(b).length),
  }
  const unitGroups = {
    vacant: units.filter(u => !occupiedToday.has(u.id) && housekeeping(cleaning, u.id) !== 'Blocked'),
    dirty: units.filter(u => ['Dirty', 'Cleaning'].includes(housekeeping(cleaning, u.id))),
    blocked: units.filter(u => housekeeping(cleaning, u.id) === 'Blocked'),
  }
  const chips = [
    ['all', 'All rooms', units.length], ['arrivals', 'Arrivals', groups.arrivals.length], ['departures', 'Departures', groups.departures.length],
    ['inhouse', 'In-house', groups.inhouse.length], ['vacant', 'Vacant', unitGroups.vacant.length], ['dirty', 'Dirty', unitGroups.dirty.length],
    ['blocked', 'Blocked', unitGroups.blocked.length], ['unassigned', 'Unassigned', groups.unassigned.length],
  ]
  const summary = useMemo(() => dates.map(day => dailySummary(rooms, day, bookings, cleaning, today)), [rooms, dates, bookings, cleaning, today])

  const q = query.trim().toLowerCase()
  const matchesQuery = b => !q || `${b.guest?.name || ''} ${b.id} ${b.ref || ''} ${b.guest?.phone || ''}`.toLowerCase().includes(q)
  const focusBookings = groups[filter] ? new Set(groups[filter].map(b => b.id)) : null
  const highlighted = b => (!focusBookings || focusBookings.has(b.id)) && matchesQuery(b)
  function showUnit(unit, bars) {
    if (unitGroups[filter] && !unitGroups[filter].includes(unit)) return false
    if (focusBookings && filter !== 'unassigned' && !bars.some(s => focusBookings.has(s.booking.id))) return false
    if (filter === 'unassigned') return false
    if (q && !unit.id.toLowerCase().includes(q) && !bars.some(s => matchesQuery(s.booking))) return false
    return true
  }

  const cols = { gridTemplateColumns: `var(--sv-label) repeat(${DAYS}, minmax(var(--sv-cell), 1fr))` }
  const bar = (s, extra = '') => {
    const b = s.booking, status = statusOf(b).toLowerCase().replace(/\s/g, '-')
    const nights = Math.round((Date.parse(b.end) - Date.parse(b.start)) / 86400000)
    const clipped = `${b.start < dates[s.start] ? ' clip-start' : ''}${b.end > shift(dates[s.end - 1], 1) ? ' clip-end' : ''}`
    return <button key={b.id + s.start} className={`sv-bar ${status}${extra}${clipped}${highlighted(b) ? '' : ' dim'}`} style={{ gridColumn: `${s.start + 2} / ${s.end + 2}`, gridRow: 1 }}
      title={`${b.guest?.name} · ${b.start} → ${b.end} · ${statusOf(b)}`} onClick={() => onOpen(b)}>
      <strong>{b.guest?.name || 'Guest'}</strong><small>{nights}N · {statusOf(b)}</small>
    </button>
  }

  return <div className="stay-view">
    <section className="card sv-toolbar">
      <div className="sv-chips" role="group" aria-label="Filter rooms">
        {chips.map(([id, label, count]) => <button key={id} className={`sv-chip ${id}${filter === id ? ' current' : ''}`} aria-pressed={filter === id} onClick={() => setFilter(filter === id ? 'all' : id)}>
          <span>{label}</span><strong>{count}</strong></button>)}
      </div>
      <div className="sv-actions">
        <input type="search" placeholder="Search guest, booking or room no." value={query} onChange={e => setQuery(e.target.value)} aria-label="Search" />
        <button className="secondary" onClick={() => setFrom(shift(from, -7))} aria-label="Previous week">‹</button>
        <button className="secondary" onClick={() => setFrom(today)}>Today</button>
        <button className="secondary" onClick={() => setFrom(shift(from, 7))} aria-label="Next week">›</button>
        {onWalkIn && <button className="primary" onClick={() => openNew()}>+ New Reservation</button>}
      </div>
    </section>

    <div className="sv-layout">
      <section className="card sv-board">
        <div className="sv-scroll">
          <div className="sv-grid">
            <div className="sv-row sv-head" style={cols}>
              <div className="sv-label">Rooms <small>{dayInfo(dates[0]).month} {dayInfo(dates[0]).day} – {dayInfo(dates.at(-1)).month} {dayInfo(dates.at(-1)).day}</small></div>
              {dates.map(day => { const d = dayInfo(day); return <div key={day} className={`sv-day${day === today ? ' today' : ''}${d.weekend ? ' weekend' : ''}`}><small>{d.dow}</small><strong>{d.day}</strong></div> })}
            </div>

            {rooms.map(room => {
              const typeUnits = units.filter(u => u.type === room.id)
              if (!typeUnits.length) return null
              const open = !collapsed.includes(room.id)
              const unitRows = typeUnits.map(unit => ({ unit, bars: segments(dates, day => inHouseOn(unit, day)) })).filter(r => showUnit(r.unit, r.bars))
              const waiting = bookings.filter(b => b.room === room.id && occupiesInventory(b) && dates.some(day => bookingInPlanner(b, day, today) && !roomsOnDate(b, day).length))
                .filter(b => (filter === 'all' || filter === 'unassigned' || focusBookings?.has(b.id)) && matchesQuery(b))
              if (filter !== 'all' && !unitRows.length && !waiting.length) return null
              return <Fragment key={room.id}>
                <div className="sv-row sv-type" style={cols}>
                  <button className="sv-label" aria-expanded={open} onClick={() => setCollapsed(open ? [...collapsed, room.id] : collapsed.filter(id => id !== room.id))}>
                    <span className="sv-caret">{open ? '▾' : '▸'}</span>{room.name}<small>{typeUnits.length} rooms</small></button>
                  {dates.map(day => { const inv = monthlyInventory(room, day, bookings, cleaning, rooms, today); return <div key={day} className={`sv-avail ${inv.remaining <= 0 ? 'none' : inv.remaining === 1 ? 'low' : ''}${day === today ? ' today' : ''}`}>
                    <strong>{Math.max(0, inv.remaining)}</strong><small>{rm(nightlyRate(room, day))}</small></div> })}
                </div>
                {open && unitRows.map(({ unit, bars }) => {
                  const hk = housekeeping(cleaning, unit.id)
                  return <div key={unit.id} className={`sv-row sv-unit${hk === 'Blocked' ? ' blocked' : ''}`} style={cols}>
                    <div className="sv-label"><span className={`sv-hk ${hk.toLowerCase()}`} title={`Housekeeping: ${hk}`} />{unit.id}<small>{hk}</small></div>
                    {dates.map((day, i) => <button key={day} className={`sv-cell${day === today ? ' today' : ''}${dayInfo(day).weekend ? ' weekend' : ''}`} style={{ gridColumn: i + 2, gridRow: 1 }}
                      aria-label={`New booking, room ${unit.id}, ${day}`} title="Click to book this room" onClick={() => pickCell(unit, day)} disabled={hk === 'Blocked' || day < today} />)}
                    {walkIn?.unitId === unit.id && draftSpan() && <div className="sv-draft" style={draftSpan()}><strong>{walkIn.guest.name.trim() || 'Walk-in'}</strong><small>{walkNights}N · New</small></div>}
                    {hk === 'Blocked' && <div className="sv-blocked" style={{ gridColumn: `2 / ${DAYS + 2}`, gridRow: 1 }}>Out of order</div>}
                    {bars.map(s => bar(s))}
                  </div>
                })}
                {open && waiting.map(b => <div key={b.id} className="sv-row sv-unit sv-waiting" style={cols}>
                  <div className="sv-label"><span className="sv-hk unassigned" />Unassigned<small>Needs room</small></div>
                  {dates.map((day, i) => <div key={day} className={`sv-cell${day === today ? ' today' : ''}`} style={{ gridColumn: i + 2, gridRow: 1 }} />)}
                  {segments(dates, day => bookingInPlanner(b, day, today) && !roomsOnDate(b, day).length ? b : null).map(s => bar(s, ' unassigned'))}
                </div>)}
              </Fragment>
            })}

            <div className="sv-row sv-occ" style={cols}>
              <div className="sv-label">Occupancy</div>
              {summary.map((s, i) => <div key={dates[i]} className={`sv-occ-cell${dates[i] === today ? ' today' : ''}`} title={`${s.reserved}/${s.capacity} rooms`}>
                <span style={{ height: `${s.occupancy}%` }} /><strong>{s.occupancy}%</strong></div>)}
            </div>
          </div>
        </div>
        <div className="sv-legend">
          <span><i className="upcoming" />Reserved</span><span><i className="checked-in" />In-house</span><span><i className="checked-out" />Checked out</span>
          <span><i className="unassigned" />Unassigned</span>{onWalkIn && <span><i className="draft" />New booking</span>}<span><i className="blocked" />Out of order</span>
          <span><b className="sv-hk clean" />Clean</span><span><b className="sv-hk dirty" />Dirty</span><span><b className="sv-hk cleaning" />Cleaning</span>
        </div>
      </section>

      <aside className="sv-side">
        {saved && <p className="sv-saved" role="status">{saved}<button aria-label="Dismiss" onClick={() => setSaved('')}>×</button></p>}
        {walkIn && walkUnit && <form ref={formRef} className="card sv-walkin" onSubmit={saveWalkIn} aria-label="New booking">
          <div className="sv-walkin-head"><h2>New booking</h2><button type="button" className="close" aria-label="Close new booking" onClick={() => { setWalkIn(null); setWalkInError('') }}>×</button></div>
          <label>Room<select value={walkIn.unitId} onChange={e => setWalk({ unitId: e.target.value, guests: 1, checkIn: canCheckInNow(walkIn.start, today, e.target.value, cleaning) })}>
            {[walkUnit, ...freeRooms(walkIn.start, walkIn.end, ctx).filter(u => u.id !== walkUnit.id)].map(u => <option key={u.id} value={u.id}>{u.id} · {u.name}</option>)}</select>
            <small className="sv-walkin-sub">Housekeeping: {housekeeping(cleaning, walkUnit.id)}</small></label>
          <div className="sv-walkin-pair">
            <label>Check-in<input type="date" value={walkIn.start} min={today} onChange={e => e.target.value && setWalk({ start: e.target.value, end: e.target.value >= walkIn.end ? shift(e.target.value, 1) : walkIn.end })} /></label>
            <label>Check-out<input type="date" value={walkIn.end} min={shift(walkIn.start, 1)} max={walkLatest > walkIn.start ? walkLatest : undefined} onChange={e => e.target.value && setWalk({ end: e.target.value })} /></label>
          </div>
          <p className="sv-walkin-hint">{walkLatest > walkIn.start ? 'Free until ' + walkLatest + '. Click a later cell in this row to extend the stay.' : 'This room is not free on that date.'}</p>
          <label>Guest name<input name="name" value={walkIn.guest.name} onChange={e => setWalkGuest('name', e.target.value)} autoComplete="off" required /></label>
          <label>Phone<input type="tel" value={walkIn.guest.phone} onChange={e => setWalkGuest('phone', e.target.value)} placeholder="+60 12-345 6789" required /></label>
          <div className="sv-walkin-pair">
            <label>Guests<select value={walkIn.guests} onChange={e => setWalk({ guests: Number(e.target.value) })}>{Array.from({ length: walkType?.guests || 2 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</select></label>
            <label>ID / passport<input value={walkIn.guest.identity} onChange={e => setWalkGuest('identity', e.target.value)} autoComplete="off" /></label>
          </div>
          <label>Booking source<select value={walkIn.guest.source || 'Walk-in'} onChange={e => setWalkGuest('source', e.target.value)}>{SOURCES.map(x => <option key={x}>{x}</option>)}</select></label>
          <label>E-mail (optional)<input type="email" value={walkIn.guest.email} onChange={e => setWalkGuest('email', e.target.value)} /></label>
          <label className={'check-label' + (walkCanCheckIn ? '' : ' off')}><input type="checkbox" checked={!!walkIn.checkIn && walkCanCheckIn} disabled={!walkCanCheckIn} onChange={e => setWalk({ checkIn: e.target.checked })} />
            Check in now{!walkCanCheckIn && <small>{walkIn.start !== today ? ' (stay starts later)' : ' (room not clean)'}</small>}</label>
          <div className="sv-walkin-total"><span>{walkNights} night{walkNights === 1 ? '' : 's'} · room rate</span><strong>{money(walkType ? stayPrice(walkType, walkIn.start, walkIn.end, 1) : 0)}</strong></div>
          {walkInError && <p className="sv-walkin-error" role="alert">{walkInError}</p>}
          <button className="primary">{walkIn.checkIn && walkCanCheckIn ? 'Book and check in' : 'Save booking'}</button>
        </form>}
        {!walkIn && [['Arriving today', groups.arrivals, 'No arrivals today.'], ['Departing today', groups.departures, 'No departures today.']].map(([title, list, empty]) =>
          <section className="card sv-list" key={title}>
            <h2>{title}<span>{list.length}</span></h2>
            {list.length ? list.slice(0, 6).map(b => <button key={b.id} onClick={() => onOpen(b)}>
              <strong>{b.guest?.name}</strong><small>{rooms.find(r => r.id === b.room)?.name} · {roomsForBooking(b).join(', ') || 'Unassigned'}</small>
              <span>{money(b.total || 0)}</span></button>) : <p className="muted">{empty}</p>}
          </section>)}
        {!walkIn && <section className="card sv-list">
          <h2>Needs attention</h2>
          <button onClick={() => setFilter('unassigned')}><strong>{groups.unassigned.length} booking(s)</strong><small>waiting for a room number</small></button>
          <button onClick={() => setFilter('dirty')}><strong>{unitGroups.dirty.length} room(s)</strong><small>dirty or being cleaned</small></button>
          <button onClick={() => setFilter('blocked')}><strong>{unitGroups.blocked.length} room(s)</strong><small>out of order</small></button>
        </section>}
      </aside>
    </div>
  </div>
}
