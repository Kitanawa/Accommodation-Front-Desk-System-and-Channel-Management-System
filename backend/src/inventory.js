// Read-only inventory logic: availability, rates, planner. The AI only ever calls these.
// A night counts as booked when a booking with status blocked / confirmed / checked_in covers it.
import { pool } from './db.js';
import { addDays, nightsBetween, nextMonthFirst, firstOfMonth, weekday, today } from './dates.js';

const ACTIVE = ['blocked', 'confirmed', 'checked_in'];

async function loadBase() {
  const [types] = await pool.query('SELECT id, name, max_guests, base_rate FROM room_types ORDER BY id');
  // Rooms under maintenance are not sellable inventory.
  const [counts] = await pool.query("SELECT room_type_id, COUNT(*) AS total FROM rooms WHERE status <> 'maintenance' GROUP BY room_type_id");
  const [rates] = await pool.query('SELECT id, room_type_id, start_date, end_date, rate FROM rates');
  const totals = Object.fromEntries(counts.map((c) => [c.room_type_id, Number(c.total)]));
  return { types: types.map((t) => ({ ...t, base_rate: Number(t.base_rate) })), totals, rates };
}

async function activeBookings(from, to) {
  const [rows] = await pool.query(
    `SELECT id, room_type_id, check_in, check_out FROM bookings
     WHERE status IN (?) AND check_in < ? AND check_out > ?`,
    [ACTIVE, to, from]
  );
  return rows;
}

// Latest matching rate rule wins (highest id), otherwise the base rate.
function rateFor(type, night, rates) {
  const matches = rates.filter((r) => r.room_type_id === type.id && r.start_date <= night && night <= r.end_date);
  if (!matches.length) return type.base_rate;
  return Number(matches.sort((a, b) => b.id - a.id)[0].rate);
}

const bookedOn = (bookings, typeId, night) =>
  bookings.filter((b) => b.room_type_id === typeId && b.check_in <= night && b.check_out > night).length;

export async function getRoomTypes() {
  return (await loadBase()).types;
}

/** Availability + price for a stay. `to` is the check-out date (exclusive). */
export async function availability(from, to, opts = {}) {
  const { roomTypeId = null, guests = null, maxPrice = null, priceOp = '<=' } = opts;
  const { types, totals, rates } = await loadBase();
  const bookings = await activeBookings(from, to);
  const nights = nightsBetween(from, to);

  let results = types
    .filter((t) => (roomTypeId ? t.id === roomTypeId : true))
    .map((t) => {
      const total = totals[t.id] || 0;
      const perNight = nights.map((n) => ({
        night: n,
        left: total - bookedOn(bookings, t.id, n),
        rate: rateFor(t, n, rates),
      }));
      const rooms_left = Math.min(...perNight.map((p) => p.left));
      const total_price = perNight.reduce((s, p) => s + p.rate, 0);
      return {
        room_type_id: t.id,
        room_type: t.name,
        max_guests: t.max_guests,
        nights: nights.length,
        rooms_left,
        is_available: rooms_left > 0,
        avg_nightly_rate: Math.round((total_price / nights.length) * 100) / 100,
        max_nightly_rate: Math.max(...perNight.map((p) => p.rate)),
        total_price,
      };
    });

  if (guests) results = results.filter((r) => r.max_guests >= guests);
  if (maxPrice != null) {
    results = results.filter((r) => (priceOp === '<' ? r.max_nightly_rate < maxPrice : r.max_nightly_rate <= maxPrice));
  }
  return { from, to, nights: nights.length, results };
}

/** Month view like the IRBS Room Planner: per room type, per day: price, booked (B), available (A). */
export async function planner(month) {
  const from = firstOfMonth(month);
  const to = nextMonthFirst(month);
  const { types, totals, rates } = await loadBase();
  const bookings = await activeBookings(from, to);
  const days = nightsBetween(from, to);
  return {
    month,
    today: today(),
    days: days.map((d) => ({ date: d, day: Number(d.slice(8)), weekday: weekday(d) })),
    rows: types.map((t) => {
      const total = totals[t.id] || 0;
      return {
        room_type_id: t.id,
        room_type: t.name,
        total,
        cells: days.map((d) => {
          const booked = bookedOn(bookings, t.id, d);
          return { date: d, price: rateFor(t, d, rates), booked, available: total - booked };
        }),
      };
    }),
  };
}

/** Booking helpers used by other tools. */
export async function findBookingByRef(ref) {
  const [rows] = await pool.query(
    `SELECT b.*, rt.name AS room_type, g.full_name AS guest_name, ta.name AS agent_name, rm.room_number
     FROM bookings b
     JOIN room_types rt ON rt.id = b.room_type_id
     LEFT JOIN guests g ON g.id = b.guest_id
     LEFT JOIN travel_agents ta ON ta.id = b.travel_agent_id
     LEFT JOIN rooms rm ON rm.id = b.room_id
     WHERE b.booking_ref = ?`,
    [ref.toUpperCase()]
  );
  return rows[0] || null;
}

export async function findBookingsByName(name) {
  const [rows] = await pool.query(
    `SELECT b.booking_ref, COALESCE(g.full_name, ta.name) AS booked_by, rt.name AS room_type, rm.room_number,
            b.check_in, b.check_out, b.status, b.payment_status, b.total_amount
     FROM bookings b
     JOIN room_types rt ON rt.id = b.room_type_id
     LEFT JOIN guests g ON g.id = b.guest_id
     LEFT JOIN travel_agents ta ON ta.id = b.travel_agent_id
     LEFT JOIN rooms rm ON rm.id = b.room_id
     WHERE g.full_name LIKE ? OR ta.name LIKE ?
     ORDER BY b.check_in`,
    [`%${name}%`, `%${name}%`]
  );
  return rows;
}

export async function unpaidBookings() {
  const [rows] = await pool.query(
    `SELECT b.booking_ref, COALESCE(g.full_name, ta.name) AS booked_by, b.check_in, b.check_out, b.status, b.total_amount
     FROM bookings b
     LEFT JOIN guests g ON g.id = b.guest_id
     LEFT JOIN travel_agents ta ON ta.id = b.travel_agent_id
     WHERE b.payment_status = 'unpaid' AND b.status IN ('confirmed','checked_in')
     ORDER BY b.check_in`
  );
  return rows;
}

/** Blocked bookings with hours left until check-in (check-in counted from 00:00 of the check-in date). */
export async function blockedWithHours(asOf) {
  const [rows] = await pool.query(
    `SELECT b.booking_ref, ta.name AS agent_name, rt.name AS room_type, b.check_in, b.check_out,
            TIMESTAMPDIFF(HOUR, ?, CAST(b.check_in AS DATETIME)) AS hours_to_check_in
     FROM bookings b
     JOIN room_types rt ON rt.id = b.room_type_id
     LEFT JOIN travel_agents ta ON ta.id = b.travel_agent_id
     WHERE b.status = 'blocked'
     ORDER BY b.check_in`,
    [asOf]
  );
  return rows.map((r) => ({ ...r, hours_to_check_in: Number(r.hours_to_check_in) }));
}

export async function arrivals(date) {
  const [rows] = await pool.query(
    `SELECT b.booking_ref, COALESCE(g.full_name, ta.name) AS booked_by, rt.name AS room_type, b.status
     FROM bookings b JOIN room_types rt ON rt.id = b.room_type_id
     LEFT JOIN guests g ON g.id = b.guest_id LEFT JOIN travel_agents ta ON ta.id = b.travel_agent_id
     WHERE b.check_in = ? AND b.status <> 'cancelled'`, [date]);
  return rows;
}
export async function departures(date) {
  const [rows] = await pool.query(
    `SELECT b.booking_ref, COALESCE(g.full_name, ta.name) AS booked_by, rt.name AS room_type, b.status
     FROM bookings b JOIN room_types rt ON rt.id = b.room_type_id
     LEFT JOIN guests g ON g.id = b.guest_id LEFT JOIN travel_agents ta ON ta.id = b.travel_agent_id
     WHERE b.check_out = ? AND b.status <> 'cancelled'`, [date]);
  return rows;
}

export async function occupantOfRoom(roomNumber) {
  const [rows] = await pool.query(
    `SELECT rm.room_number, rm.status AS room_status, b.booking_ref, g.full_name, b.check_in, b.check_out
     FROM rooms rm
     LEFT JOIN bookings b ON b.room_id = rm.id AND b.status = 'checked_in'
     LEFT JOIN guests g ON g.id = b.guest_id
     WHERE rm.room_number = ?`, [roomNumber]);
  return rows[0] || null;
}

export { addDays };
