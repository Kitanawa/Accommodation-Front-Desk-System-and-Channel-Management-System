// Fixed, read-only questions the assistant can ask the database. The model never writes SQL and never picks a query:
// the request fields are validated first, then one of these functions runs with them as parameters ($1, $2 ...).
// Every query is limited to the signed-in user's property. Only columns granted in db/create_readonly_role.sql can be read.
import { priceStay, nightsList } from './pricing.js';

export const currency = async (q, propertyId) => (await q('select currency_code from properties where property_id = $1', [propertyId]))[0]?.currency_code || 'MYR';

export const roomTypes = (q, propertyId) => q(
  `select t.room_type_id, t.name, t.max_guests, t.min_nights from room_types t join room_categories c on c.category_id = t.category_id
    where c.property_id = $1 and t.approval_status = 'APPROVED' order by t.name`, [propertyId]);

// Rooms left, nightly rate and total per room type for a stay (check-out night not counted). Same rules as GET /api/availability.
export async function availability(q, propertyId, { from, to, guests }) {
  const types = await roomTypes(q, propertyId);
  if (!types.length) return [];
  const ids = types.map((t) => t.room_type_id);
  const stock = await q(`select room_type_id, stock_date as d, total_rooms, reserved_rooms from room_stock where room_type_id = any($1::uuid[]) and stock_date >= $2::date and stock_date < $3::date`, [ids, from, to]);
  const rules = await q(`select room_type_id, rule_type, rate_amount::float8 as rate_amount, date_from, date_to, selected_days, specific_date, priority, approval_status, effective_from, valid_until from rate_rules where room_type_id = any($1::uuid[])`, [ids]);
  const n = nightsList(from, to).length, g = Number(guests) || 1;
  return types.map((t) => {
    const s = stock.filter((x) => x.room_type_id === t.room_type_id);
    const covered = s.length === n;
    const left = covered ? Math.max(0, Math.min(...s.map((x) => x.total_rooms - x.reserved_rooms))) : 0;
    const price = priceStay(rules.filter((r) => r.room_type_id === t.room_type_id), from, to);
    const reasons = [];
    if (!covered) reasons.push({ code: 'no_stock' });
    if (covered && left <= 0) reasons.push({ code: 'sold_out' });
    if (g > t.max_guests) reasons.push({ code: 'max_guests', n: t.max_guests });
    if (n < t.min_nights) reasons.push({ code: 'min_nights', n: t.min_nights });
    if (price.total === null) reasons.push({ code: 'no_rate' });
    return { name: t.name, max_guests: t.max_guests, min_nights: t.min_nights, nights: n, rooms_left: left, total: price.total, average: price.total === null ? null : Math.round((price.total / n) * 100) / 100, bookable: reasons.length === 0, reasons };
  });
}

const BOOKING_COLUMNS = `r.reservation_ref as ref, g.full_name as guest, t.name as room_type, rm.room_number, r.check_in_date as check_in, r.check_out_date as check_out, r.status, r.payment_status`;
const BOOKING_FROM = `from reservations r join guests g on g.guest_id = r.guest_id join reservation_rooms rr on rr.reservation_id = r.reservation_id
  join room_types t on t.room_type_id = rr.room_type_id left join rooms rm on rm.room_id = rr.room_id`;

export const arrivals = (q, propertyId, today) => q(`select ${BOOKING_COLUMNS} ${BOOKING_FROM}
  where r.property_id = $1 and r.check_in_date = $2::date and r.status in ('CONFIRMED', 'CHECKED_IN') order by r.reservation_ref limit 20`, [propertyId, today]);

// Departures include guests still in the room (CHECKED_IN) whose check-out is today.
export const departures = (q, propertyId, today) => q(`select ${BOOKING_COLUMNS} ${BOOKING_FROM}
  where r.property_id = $1 and r.check_out_date = $2::date and r.status in ('CHECKED_IN', 'CHECKED_OUT') order by r.reservation_ref limit 20`, [propertyId, today]);

export async function unpaid(q, propertyId) {
  const where = `r.property_id = $1 and r.status in ('CONFIRMED', 'CHECKED_IN') and r.payment_status in ('UNPAID', 'PARTIAL')`;
  const [{ n }] = await q(`select count(*) as n from reservations r where ${where}`, [propertyId]);
  const rows = await q(`select ${BOOKING_COLUMNS} ${BOOKING_FROM} where ${where} order by r.check_in_date, r.reservation_ref limit 10`, [propertyId]);
  return { count: n, rows };
}

export const bookingByRef = (q, propertyId, ref) => q(`select ${BOOKING_COLUMNS} ${BOOKING_FROM}
  where r.property_id = $1 and upper(r.reservation_ref) = upper($2) limit 1`, [propertyId, ref]);

export const bookingsByGuest = (q, propertyId, name) => q(`select ${BOOKING_COLUMNS} ${BOOKING_FROM}
  where r.property_id = $1 and g.full_name ilike $2 escape '\\' order by r.check_in_date desc limit 5`, [propertyId, `%${name.replace(/[\\%_]/g, '\\$&')}%`]);
