// S175: cancelling a confirmed reservation, with the property's cancellation rule and the refund it leads to.
// Used by the staff endpoint (POST /api/reservations/:id/cancel) and by the guest endpoint of the booking engine.
// Rule (an assumption until the client confirms): free until `free_cancellation_hours` before the check-in time; after that a fee of
// `late_cancel_fee_pct` percent of the reservation total. Whatever the guest has paid beyond the fee is asked back as refund requests,
// which a Manager or Administrator still has to approve (M13), so no money moves by itself.
const S = require('./service');
const { notFound, conflict } = require('./errors');

async function cancelReservation(t, propertyId, reservationId, { userId, remark, via }) {
  const [lock] = await t.q('select reservation_id from reservations where reservation_id=$1 and property_id=$2 for update', [reservationId, propertyId]);
  if (!lock) throw notFound('Reservation not found.');
  const r = await S.getReservation(t.q, propertyId, reservationId);
  if (r.status !== 'CONFIRMED') throw conflict(`Only a confirmed reservation can be cancelled. This one is ${r.status}.`, 'INVALID_STATE');
  const [u] = await t.q("update reservations set status='CANCELLED', status_remark=$2, status_changed_at=now() where reservation_id=$1 and status='CONFIRMED' returning reservation_id", [r.reservation_id, remark || null]);
  if (!u) throw conflict('The reservation changed while you were working. Reload and try again.', 'INVALID_STATE');
  await S.lockStock(t.q, r.room_type_id, r.check_in, r.check_out);
  await S.releaseStock(t.q, r.room_type_id, r.check_in, r.check_out);
  await t.q('update reservation_rooms set room_id=null where reservation_room_id=$1', [r.reservation_room_id]);

  const cfg = await S.settings(t.q, propertyId);
  const hoursBefore = Math.round((new Date(`${r.check_in}T${cfg.check_in_time}:00+08:00`) - Date.now()) / 36e5 * 10) / 10;
  const free = hoursBefore >= cfg.free_cancellation_hours;
  await t.q('select folio_id from folios where folio_id=$1 for update', [r.folio_id]);
  const tot = await S.folioTotals(t.q, r.folio_id);
  const fee = free ? 0 : S.money(tot.total * cfg.late_cancel_fee_pct / 100);
  let left = Math.max(S.money(tot.net_paid - fee), 0), requested = 0;
  const refunds = [];
  if (left > 0) {
    const pays = await t.q(`select p.payment_id, p.amount::float8 amount, coalesce((select sum(rf.amount) from refunds rf where rf.payment_id=p.payment_id and rf.status in ('REQUESTED','COMPLETED')),0)::float8 used
      from payments p where p.folio_id=$1 and p.status='COMPLETED' order by p.paid_at desc, p.receipt_no desc`, [r.folio_id]);
    for (const p of pays) {
      const take = S.money(Math.min(left, p.amount - p.used));
      if (take <= 0) continue;
      const [rf] = await t.q('insert into refunds(payment_id,folio_id,amount,reason,requested_by) values($1,$2,$3,$4,$5) returning refund_id, refund_no', [p.payment_id, r.folio_id, take, free ? 'Cancellation, free of charge' : 'Cancellation after the free period', userId || null]);
      refunds.push(rf.refund_id); requested = S.money(requested + take); left = S.money(left - take);
      await S.audit(t.q, userId, 'REFUND_REQUESTED', 'refunds', rf.refund_id, null, { payment_id: p.payment_id, amount: take, reason: 'cancellation', via });
      await S.notify(t.q, propertyId, 'REFUND_REQUESTED', `Refund RF-${String(rf.refund_no).padStart(6, '0')} of ${take.toFixed(2)} needs approval (cancellation ${r.reservation_ref})`, { refund_id: rf.refund_id, reservation_id: r.reservation_id });
      if (left <= 0) break;
    }
  }
  await t.q('update reservations set cancel_fee=$2 where reservation_id=$1', [r.reservation_id, fee]);
  const info = { cancel_fee: fee, free_of_charge: free, hours_before_check_in: hoursBefore, refund_requested: requested, refund_ids: refunds };
  await S.audit(t.q, userId, 'RESERVATION_CANCELLED', 'reservations', r.reservation_id, { status: 'CONFIRMED' }, { status: 'CANCELLED', remark: remark || null, via: via || 'STAFF', ...info });
  return { reservation: r, ...info };
}
module.exports = { cancelReservation };
