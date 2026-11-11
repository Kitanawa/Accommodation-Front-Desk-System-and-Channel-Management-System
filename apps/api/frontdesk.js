// Read model for the staff web app (apps/fds-web).
// GET /api/frontdesk/state returns what the app keeps in the browser today, in the shapes its screens already use:
// rooms (room types with rooms and rates), bookings (with folio charges and payments), cleaning (housekeeping per room) and settings.
// Everything here is read-only; changes go through the normal endpoints (reservations, billing, operations, catalog).
const STATUS = { CONFIRMED: 'Upcoming', CHECKED_IN: 'Checked-in', CHECKED_OUT: 'Checked-out', CANCELLED: 'Cancelled', NO_SHOW: 'No-show' };
const cents = v => Math.round(Number(v) * 100);

module.exports = function mountFrontdesk(app, { getDb, auth, need, wrap }) {
  app.get('/api/frontdesk/state', auth, need('reservations.manage'), wrap(async (req, res) => {
    const db = getDb(), pid = req.user.property_id;
    const [prop] = await db.q('select p.name, p.address, p.currency_code, s.check_in_time::text, s.contact_email, s.contact_phone, s.logo_data_url, s.tax_name, s.tax_rate_pct::float8 tax_rate_pct from properties p left join property_settings s using(property_id) where p.property_id=$1', [pid]);

    // ---- rooms: room types, their physical rooms and rates
    const types = await db.q(`select t.room_type_id, t.name, c.name category, t.max_guests, t.min_nights, t.description, t.facilities, t.approval_status
      from room_types t join room_categories c using(category_id) where c.property_id=$1 order by t.name`, [pid]);
    const rms = await db.q(`select r.room_id, r.room_type_id, r.room_number, r.floor, r.status_id from rooms r join room_types t using(room_type_id) join room_categories c using(category_id) where c.property_id=$1 order by r.room_number`, [pid]);
    const rates = await db.q(`select rr.rate_rule_id, rr.room_type_id, rr.rule_type, rr.rate_amount::float8 rate_amount, rr.date_from::text date_from, rr.date_to::text date_to, rr.selected_days, rr.specific_date::text specific_date,
        rr.priority, rr.approval_status, rr.supersedes_id, rr.valid_until, rr.created_at::text created_at
      from rate_rules rr join room_types t using(room_type_id) join room_categories c using(category_id)
      where c.property_id=$1 and ((rr.approval_status='APPROVED' and rr.valid_until is null) or rr.approval_status='PENDING') order by rr.priority nulls first, rr.created_at`, [pid]);
    const toRule = (x, i) => {
      const base = { rateRuleId: x.rate_rule_id, rate: x.rate_amount, prior: x.priority || i + 1, remark: x.approval_status === 'PENDING' ? 'Waiting for approval' : 'Approved rate' };
      return x.rule_type === 'DATE_RANGE' ? { ...base, type: 'Date Range', start: x.date_from, end: x.date_to }
        : x.rule_type === 'SELECTED_DAY' ? { ...base, type: 'Selected Day', days: (x.selected_days || []).map(Number) }
        : { ...base, type: 'Specific Date', dates: [x.specific_date] };
    };
    const pricingOf = list => { const b = list.find(x => x.rule_type === 'BASE'); return { baseRate: b ? b.rate_amount : 0, baseRuleId: b ? b.rate_rule_id : null, remark: '', rules: list.filter(x => x.rule_type !== 'BASE').map(toRule) }; };
    const rooms = types.map(t => {
      const approved = rates.filter(x => x.room_type_id === t.room_type_id && x.approval_status === 'APPROVED');
      const pending = rates.filter(x => x.room_type_id === t.room_type_id && x.approval_status === 'PENDING');
      const typePending = t.approval_status !== 'APPROVED';
      const pricing = pricingOf(typePending ? pending : approved);
      // a change to an approved room type's rates: the approved rates with the waiting changes applied
      let rateRequest = null;
      if (!typePending && pending.length) {
        const replaced = new Set(pending.map(x => x.supersedes_id).filter(Boolean));
        const after = [...approved.filter(x => !replaced.has(x.rate_rule_id)), ...pending];
        rateRequest = { pricing: pricingOf(after), previous: pricing, status: 'Pending Approval', submittedBy: '', submittedAt: pending[0].created_at, changeReason: '', ruleIds: pending.map(x => x.rate_rule_id) };
      }
      const units = rms.filter(r => r.room_type_id === t.room_type_id).map(r => ({ id: r.room_number, roomId: r.room_id, floor: r.floor == null ? '' : String(r.floor), notes: '' }));
      return { id: t.room_type_id, name: t.name, category: t.category, guests: t.max_guests, rate: pricing.baseRate, stock: units.length, units,
        note: t.description || '', facilities: Array.isArray(t.facilities) ? t.facilities.join(', ') : (t.facilities || ''), publication: typePending ? 'Pending Approval' : 'Published',
        pricing, ...(rateRequest ? { rateRequest } : {}) };
    });

    // ---- cleaning: housekeeping state per room number
    const tasks = await db.q(`select h.room_id, h.status, h.assigned_to, h.notes, u.full_name assignee from housekeeping_tasks h left join users u on u.user_id=h.assigned_to
      where h.status in ('OPEN','IN_PROGRESS') order by h.created_at`);
    const cleaning = {};
    for (const r of rms) {
      const task = tasks.find(x => x.room_id === r.room_id);
      const status = r.status_id === 4 ? 'Blocked' : r.status_id === 3 ? (task && task.status === 'IN_PROGRESS' ? 'Cleaning' : 'Dirty') : 'Clean';
      if (status !== 'Clean' || task) cleaning[r.room_number] = { status, assignee: task ? task.assignee || '' : '', notes: task ? task.notes || '' : '' };
    }

    // ---- bookings: one per reservation, with folio entries in the cents the app uses
    const rows = await db.q(`select r.reservation_id, r.reservation_ref, r.check_in_date::text check_in, r.check_out_date::text check_out, r.estimated_arrival::text arrival,
        r.total_guests, r.status, r.special_requests, r.notes, r.status_remark, r.checked_out_at::date::text checked_out_on,
        g.guest_id, g.full_name, g.phone, g.email, g.nationality, g.id_passport_no, g.address, s.name source,
        rr.room_type_id, rr.rate_total::float8 room_total, rm.room_number, f.folio_id, f.tax_name, f.tax_rate_pct::float8 tax_rate
      from reservations r join guests g using(guest_id) join booking_sources s using(source_id) join reservation_rooms rr using(reservation_id)
      left join rooms rm on rm.room_id=rr.room_id join folios f using(reservation_id)
      where r.property_id=$1 order by r.created_at`, [pid]);
    const folioIds = rows.map(r => r.folio_id);
    const charges = folioIds.length ? await db.q(`select folio_id, charge_id, description, amount::float8 amount, charged_at::date::text d from charges where folio_id = any($1::uuid[]) and charge_type<>'ROOM' and voided_at is null order by charged_at`, [folioIds]) : [];
    const payments = folioIds.length ? await db.q(`select folio_id, payment_id, amount::float8 amount, method, gateway_reference, receipt_no, paid_at::date::text d from payments where folio_id = any($1::uuid[]) and status='COMPLETED' and kind<>'REFUND' order by paid_at`, [folioIds]) : [];
    const METHOD = { CASH: 'Cash', CARD: 'Card', ONLINE: 'Online', BANK_TRANSFER: 'Bank transfer' };
    const bookings = rows.map(r => ({
      id: r.reservation_id, ref: r.reservation_ref, room: r.room_type_id, start: r.check_in, end: r.check_out, quantity: 1, total: r.room_total,
      taxRatePct: r.tax_rate, taxName: r.tax_name || '',   // the rate saved on this folio when it was opened; the app must use it, not its own 16%
      status: STATUS[r.status] || 'Upcoming', ...(r.room_number ? { roomNumbers: [r.room_number] } : {}),
      ...(r.status === 'CANCELLED' && r.status_remark ? { cancellationReason: r.status_remark } : {}),
      ...(r.checked_out_on ? { actualCheckOutDate: r.checked_out_on } : {}),
      guest: { profileId: r.guest_id, name: r.full_name, phone: r.phone || '', email: r.email || '', arrival: (r.arrival || '14:00').slice(0, 5), source: r.source,
        requests: r.special_requests || '', nationality: r.nationality || '', identity: r.id_passport_no || '', address: r.address || '' },
      charges: charges.filter(c => c.folio_id === r.folio_id).map(c => ({ id: c.charge_id, date: c.d, description: c.description, amountCents: cents(c.amount) })),
      payments: payments.filter(p => p.folio_id === r.folio_id).map(p => ({ id: p.payment_id, date: p.d, description: p.gateway_reference || '', amountCents: cents(p.amount),
        method: METHOD[p.method] || p.method, paymentReference: p.gateway_reference || '', receiptNo: p.receipt_no || '' })),
    }));

    // guest profiles: the live ones, and a marker for each deleted one so a booking does not bring the profile back
    const profs = await db.q('select guest_id, full_name, phone, email, nationality, id_passport_no, address, language, requests, deleted_at from guests where property_id=$1', [pid]);
    const profiles = profs.map(g => g.deleted_at ? { id: g.guest_id, deleted: true }
      : { id: g.guest_id, name: g.full_name, phone: g.phone || '', email: g.email || '', nationality: g.nationality || '', identity: g.id_passport_no || '', address: g.address || '', language: g.language || 'English', requests: g.requests || '' });

    res.json({ currency: prop.currency_code, settings: { propertyName: prop.name, city: prop.address || '', arrivalTime: (prop.check_in_time || '14:00').slice(0, 5), contactEmail: prop.contact_email || '', contactPhone: prop.contact_phone || '', logoDataUrl: prop.logo_data_url || '', taxName: prop.tax_name, taxRatePct: prop.tax_rate_pct },
      rooms, bookings, cleaning, profiles });
  }));
};
