// The chat pipeline: understand -> validate -> run read-only tools -> build the reply from data only.
// The reply text is built by code from database results, so it cannot contain invented prices or dates.
// Replies come from fixed templates in i18n.js (English, Malay, Mandarin). The model only picks the language.
import { pool } from './db.js';
import { parseRules } from './parse.js';
import { understandWithLlm } from './llm/index.js';
import * as inv from './inventory.js';
import { today, nowDateTime, diffDays, monthOf, isValidIso } from './dates.js';
import { LANGS, detectLang, fmtDate, messages, UNSUPPORTED_NOTE } from './i18n.js';

const rm = (n) => `RM${Number(n).toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

function highlight(av, extra = {}) {
  return {
    type: 'highlight_planner',
    from: av.from,
    to: av.to,
    month: monthOf(av.from),
    rows: av.results.map((r) => ({ room_type_id: r.room_type_id, room_type: r.room_type, available: r.is_available, rooms_left: r.rooms_left })),
    ...extra,
  };
}

async function understand(message, types) {
  try {
    const r = await understandWithLlm(message, types.map((t) => t.name), today());
    if (r) return r;
  } catch (e) {
    console.warn('LLM understanding failed, using rules:', e.message);
  }
  return parseRules(message, types, today());
}

// Decide the reply language. Only English, Malay and Mandarin are supported.
// Chinese characters always mean Mandarin. Otherwise trust the model, and fall back to a simple word check.
function pickLang(req, message) {
  if (/[\u3400-\u9fff]/.test(message)) return { lang: 'zh', unsupported: false };
  if (req.lang === 'other') return { lang: 'en', unsupported: true };
  if (LANGS.includes(req.lang)) return { lang: req.lang, unsupported: false };
  return { lang: detectLang(message), unsupported: false };
}

function validate(req, types, L) {
  const names = types.map((t) => t.name);
  if (req.room_type && !names.includes(req.room_type)) return L.badRoomType(names);
  if (req.from && req.to) {
    if (!isValidIso(req.from) || !isValidIso(req.to)) return L.badDates();
    if (req.to <= req.from) return L.checkoutAfter();
    if (diffDays(req.from, req.to) > 60) return L.longStay();
  }
  return null;
}

function availabilityReply(av, req, L, lang) {
  const d = (x) => fmtDate(lang, x);
  const base = { from: d(av.from), to: d(av.to), nights: av.nights };
  const header = L.header({ ...base, type: req.room_type, guests: req.guests, maxPrice: req.max_price, below: req.price_op === '<' });
  if (!av.results.length) return `${header}\n${L.noMatch()}`;
  // One room type asked for: answer Yes or No first, then the details from the database.
  if (req.room_type && av.results.length === 1) {
    const r = av.results[0];
    let one = r.is_available
      ? L.yes({ ...base, type: r.room_type, left: r.rooms_left, rate: r.avg_nightly_rate, total: r.total_price })
      : L.no({ ...base, type: r.room_type });
    one += `\n${L.highlight()}`;
    if (req.wants_booking) one += `\n${L.cannotBook()}`;
    return one;
  }
  const lines = av.results.map((r) =>
    r.is_available
      ? L.lineFree({ type: r.room_type, left: r.rooms_left, rate: r.avg_nightly_rate, total: r.total_price })
      : L.lineFull({ type: r.room_type })
  );
  const anyFree = av.results.some((r) => r.is_available);
  let out = `${header}\n${lines.join('\n')}`;
  if (!anyFree) out += `\n${L.nothingFree()}`;
  out += `\n${L.highlight()}`;
  if (req.wants_booking) out += `\n${L.cannotBook()}`;
  return out;
}

export async function handleChat(message, { staffUser = 'demo-staff' } = {}) {
  const types = await inv.getRoomTypes();
  const req = await understand(message, types);
  const { lang, unsupported } = pickLang(req, message);
  const L = messages(lang);
  const d = (x) => fmtDate(lang, x);
  req.lang = unsupported ? 'other' : lang;
  const result = { reply: '', request: req, lang, action: null, validated: true, tools: [] };

  const err = validate(req, types, L);
  if (err) { result.reply = err; return finish(message, result, staffUser, unsupported); }

  const typeId = req.room_type ? types.find((t) => t.name === req.room_type)?.id : null;
  const nowDt = nowDateTime();
  const tdy = today();

  switch (req.intent) {
    case 'availability': {
      if (!req.from || !req.to) { result.reply = L.askDates(); break; }
      result.tools.push('availability');
      const av = await inv.availability(req.from, req.to, { roomTypeId: typeId, guests: req.guests, maxPrice: req.max_price, priceOp: req.price_op });
      result.data = av;
      result.reply = availabilityReply(av, req, L, lang);
      if (av.results.length) result.action = highlight(av);
      break;
    }
    case 'extend_check': {
      const b = await inv.findBookingByRef(req.booking_ref);
      if (!b) { result.reply = L.noBooking(req.booking_ref); break; }
      if (b.status === 'cancelled') { result.reply = L.extCancelled(b.booking_ref); break; }
      const newTo = req.to && req.from ? req.to : null;
      const target = newTo || (req.from ? req.from : null);
      if (!target || target <= b.check_out) { result.reply = L.extAsk({ ref: b.booking_ref, type: b.room_type, out: d(b.check_out) }); break; }
      result.tools.push('availability');
      const av = await inv.availability(b.check_out, target, { roomTypeId: b.room_type_id });
      result.data = av;
      const r = av.results[0];
      result.reply = (r.is_available
        ? L.extYes({ ref: b.booking_ref, type: b.room_type, in: d(b.check_in), out: d(b.check_out), target: d(target), left: r.rooms_left, nights: av.nights, total: r.total_price })
        : L.extNo({ ref: b.booking_ref, type: b.room_type, target: d(target) })) + `\n${L.highlight()}`;
      result.action = highlight(av);
      break;
    }
    case 'cancel_check': {
      const b = await inv.findBookingByRef(req.booking_ref);
      if (!b) { result.reply = L.noBooking(req.booking_ref); break; }
      const hours = (new Date(b.check_in + 'T00:00:00Z') - new Date(nowDt.replace(' ', 'T') + 'Z')) / 3600000;
      result.reply = b.status === 'cancelled' ? L.cancelAlready(b.booking_ref)
        : b.status === 'blocked' && hours > 72 ? L.cancelFree({ ref: b.booking_ref, hours: Math.round(hours) })
        : b.status === 'blocked' ? L.cancelWithin({ ref: b.booking_ref, hours: Math.round(hours) })
        : L.cancelOther({ ref: b.booking_ref, status: L.status(b.status) });
      break;
    }
    case 'within_72h': {
      result.tools.push('blockedWithHours');
      const rows = (await inv.blockedWithHours(nowDt)).filter((r) => r.hours_to_check_in <= 72);
      result.data = rows;
      result.reply = rows.length
        ? L.w72Title() + '\n' + rows.map((r) => L.w72Line({ ref: r.booking_ref, agent: r.agent_name || L.na(), type: r.room_type, in: d(r.check_in), hours: r.hours_to_check_in })).join('\n')
        : L.w72None();
      break;
    }
    case 'cancellable': {
      result.tools.push('blockedWithHours');
      const rows = (await inv.blockedWithHours(nowDt)).filter((r) => r.hours_to_check_in > 72);
      result.data = rows;
      result.reply = rows.length
        ? L.canTitle() + '\n' + rows.map((r) => L.canLine({ ref: r.booking_ref, agent: r.agent_name || L.na(), type: r.room_type, in: d(r.check_in), hours: r.hours_to_check_in })).join('\n')
        : L.canNone();
      break;
    }
    case 'unpaid': {
      result.tools.push('unpaidBookings');
      const rows = await inv.unpaidBookings();
      result.data = rows;
      result.reply = rows.length
        ? L.unpaidTitle() + '\n' + rows.map((r) => L.unpaidLine({ ref: r.booking_ref, by: r.booked_by, in: d(r.check_in), out: d(r.check_out), amount: r.total_amount != null ? rm(r.total_amount) : L.amountNa() })).join('\n')
        : L.unpaidNone();
      break;
    }
    case 'arrivals':
    case 'departures': {
      const arr = req.intent === 'arrivals';
      const rows = arr ? await inv.arrivals(tdy) : await inv.departures(tdy);
      result.tools.push(req.intent);
      result.data = rows;
      result.reply = rows.length
        ? (arr ? L.arrTitle(d(tdy)) : L.depTitle(d(tdy))) + '\n' + rows.map((r) => L.dayLine({ ref: r.booking_ref, by: r.booked_by, type: r.room_type, status: L.status(r.status) })).join('\n')
        : (arr ? L.arrNone(d(tdy)) : L.depNone(d(tdy)));
      break;
    }
    case 'room_occupant': {
      const r = await inv.occupantOfRoom(req.room_number);
      result.tools.push('occupantOfRoom');
      result.data = r;
      result.reply = !r ? L.roomNone(req.room_number)
        : r.full_name ? L.roomIn({ n: r.room_number, name: r.full_name, ref: r.booking_ref, in: d(r.check_in), out: d(r.check_out) })
        : L.roomEmpty({ n: r.room_number, status: L.roomStatus(r.room_status) });
      break;
    }
    case 'booking_lookup': {
      result.tools.push('findBooking');
      const rows = req.booking_ref ? [await inv.findBookingByRef(req.booking_ref)].filter(Boolean) : await inv.findBookingsByName(req.guest_name);
      result.data = rows;
      result.reply = rows.length
        ? L.findTitle() + '\n' + rows.map((r) => L.findLine({ ref: r.booking_ref, who: r.booked_by || r.guest_name || r.agent_name, type: r.room_type, room: r.room_number, in: d(r.check_in), out: d(r.check_out), status: L.status(r.status), pay: L.pay(r.payment_status) })).join('\n')
        : L.findNone(req.booking_ref || req.guest_name);
      break;
    }
    case 'refuse_financial':
      result.reply = L.refuseFinancial();
      break;
    case 'refuse_cancel':
      result.reply = L.refuseCancel();
      break;
    default:
      result.reply = L.help();
  }
  return finish(message, result, staffUser, unsupported);
}

async function finish(message, result, staffUser, unsupported = false) {
  if (unsupported) result.reply += `\n${UNSUPPORTED_NOTE}`;
  try {
    await pool.query(
      'INSERT INTO ai_audit_log (staff_user, user_message, parsed_request, db_result, reply_text, validator_passed) VALUES (?,?,?,?,?,?)',
      [staffUser, message, JSON.stringify(result.request), JSON.stringify(result.data ?? null), result.reply, result.validated ? 1 : 0]
    );
  } catch (e) {
    console.warn('audit log failed:', e.message);
  }
  return result;
}
