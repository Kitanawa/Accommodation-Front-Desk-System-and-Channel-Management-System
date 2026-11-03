// Read-only room calendar for the Booking page (apps/fds-web).
// GET /api/calendar?from=YYYY-MM-DD&days=14  ->  every approved room type with, for each night: rooms left, total rooms and the nightly rate.
// Same stock table (room_stock) and the same approved-rate rules (service.js) as GET /api/availability. It never writes anything.
// Limited to the signed-in user's property, like every other endpoint.
const S = require('./service');
const { Fields } = require('./errors');

module.exports = function mountCalendar(app, { getDb, auth, need, wrap }) {
  app.get('/api/calendar', auth, need('reservations.manage'), wrap(async (req, res) => {
    const db = getDb(), f = new Fields();
    const from = req.query.from, days = req.query.days === undefined ? 14 : Number(req.query.days);
    if (!S.isDate(from)) f.add('from', 'Must be a date (YYYY-MM-DD).');
    if (!Number.isInteger(days) || days < 1 || days > 62) f.add('days', 'Must be a whole number from 1 to 62.');
    f.check();
    const to = S.addDays(from, days), dates = S.nightsList(from, to), propertyId = req.user.property_id;
    const [prop] = await db.q('select currency_code from properties where property_id=$1', [propertyId]);
    const types = await db.q(`select t.room_type_id, t.name, t.max_guests, t.min_nights, t.description
      from room_types t join room_categories c using(category_id)
      where c.property_id=$1 and t.approval_status='APPROVED' order by t.name`, [propertyId]);
    const roomTypes = [];
    for (const t of types) {
      const stock = await db.q(`select stock_date::text d, total_rooms, reserved_rooms from room_stock
        where room_type_id=$1 and stock_date>=$2::date and stock_date<$3::date`, [t.room_type_id, from, to]);
      const byDate = new Map(stock.map(s => [s.d, s]));
      const rules = await S.loadRules(db.q, t.room_type_id);
      roomTypes.push({ ...t, cells: dates.map(d => {
        const s = byDate.get(d), r = S.pickRule(rules, d);
        return { date: d, left: s ? Math.max(0, s.total_rooms - s.reserved_rooms) : 0, total: s ? s.total_rooms : 0, rate: r ? r.rate_amount : null };
      }) });
    }
    res.json({ currency: prop ? prop.currency_code : 'MYR', from, to, room_types: roomTypes });
  }));
};
