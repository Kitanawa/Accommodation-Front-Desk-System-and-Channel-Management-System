// The chat pipeline: understand -> validate -> run read-only tools -> build the reply.
// Facts always come from the database. For data answers, the model may write the sentence(s) (LLM_WRITE_REPLIES=1);
// every number, date and ID it writes is checked against the facts, and the fixed template reply is used if anything is off.
// Refusals, errors, lists and policy notes ("I cannot cancel...") are always fixed text from i18n.js.
import { pool } from './db.js';
import { parseRules } from './parse.js';
import { understandWithLlm, writeWithLlm, writerEnabled } from './llm/index.js';
import { checkReply } from './llm/writer.js';
import * as inv from './inventory.js';
import { today, nowDateTime, diffDays, monthOf, isValidIso } from './dates.js';
import { LANGS, detectLang, fmtDate, messages, UNSUPPORTED_NOTE } from './i18n.js';

const rm = (n) => `RM${Number(n).toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const UNPAID_SHOWN = 10;

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

// Build the reply for a data answer.
//   fallback = the full fixed template reply (always built, used whenever the model is off or fails a check)
//   facts/task = what the model gets; rows = a code-built list shown after the model's sentence; policy = fixed notes
async function compose(message, lang, { fallback, facts, task, rows = '', policy = [] }) {
  if (!facts || !writerEnabled()) return { reply: fallback, writer: 'template' };
  const w = await writeWithLlm({ lang, question: message, task, facts });
  if (!w.ok) return { reply: fallback, writer: `fallback:${w.reason}` };
  const bad = checkReply(w.text, facts);
  if (bad) return { reply: fallback, writer: `fallback:${bad}` };
  const tail = [rows, ...policy].filter(Boolean).join('\n');
  return { reply: tail ? `${w.text}\n${tail}` : w.text, writer: 'model' };
}

function availabilityPlan(av, req, L, lang) {
  const d = (x) => fmtDate(lang, x);
  const base = { from: d(av.from), to: d(av.to), nights: av.nights };
  const header = L.header({ ...base, type: req.room_type, guests: req.guests, maxPrice: req.max_price, below: req.price_op === '<' });
  if (!av.results.length) return { fallback: `${header}\n${L.noMatch()}` };
  const policy = [L.highlight(), ...(req.wants_booking ? [L.cannotBook()] : [])];
  // One room type asked for: answer Yes or No first, then the details from the database.
  if (req.room_type && av.results.length === 1) {
    const r = av.results[0];
    const text = r.is_available
      ? L.yes({ ...base, type: r.room_type, left: r.rooms_left, rate: r.avg_nightly_rate, total: r.total_price })
      : L.no({ ...base, type: r.room_type });
    return {
      fallback: `${text}\n${policy.join('\n')}`,
      facts: {
        room_type: r.room_type, from: base.from, to: base.to, nights: av.nights, available_for_whole_stay: !!r.is_available,
        ...(r.is_available ? { rooms_left: r.rooms_left, price_per_night: rm(r.avg_nightly_rate), total_price: rm(r.total_price) } : {}),
      },
      task: 'Answer yes or no first: is that room type available for the whole stay? If yes, also give the rooms left, the price per night and the total price. If no, say it is fully booked on at least one night.',
      policy,
    };
  }
  const lines = av.results.map((r) =>
    r.is_available
      ? L.lineFree({ type: r.room_type, left: r.rooms_left, rate: r.avg_nightly_rate, total: r.total_price })
      : L.lineFull({ type: r.room_type })
  );
  const nFree = av.results.filter((r) => r.is_available).length;
  const rows = lines.join('\n') + (nFree ? '' : `\n${L.nothingFree()}`);
  return {
    fallback: `${header}\n${rows}\n${policy.join('\n')}`,
    facts: {
      from: base.from, to: base.to, nights: av.nights, room_types_checked: av.results.length, room_types_with_availability: nFree,
      ...(req.guests ? { guests: req.guests } : {}),
      ...(req.max_price ? { price_limit_per_night: `${req.price_op === '<' ? 'below' : 'up to'} ${rm(req.max_price)}` } : {}),
    },
    task: 'Write ONE short sentence that introduces the list of room types that follows: mention the dates, the number of nights and any filters (guests, price limit). Do not repeat the list.',
    rows,
    policy,
  };
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
  const done = (c) => { result.reply = c.reply; req.writer = c.writer; };

  switch (req.intent) {
    case 'availability': {
      if (!req.from || !req.to) { result.reply = L.askDates(); break; }
      result.tools.push('availability');
      const av = await inv.availability(req.from, req.to, { roomTypeId: typeId, guests: req.guests, maxPrice: req.max_price, priceOp: req.price_op });
      result.data = av;
      done(await compose(message, lang, availabilityPlan(av, req, L, lang)));
      if (av.results.length) result.action = highlight(av);
      break;
    }
    case 'extend_check': {
      const b = await inv.findBookingByRef(req.booking_ref);
      if (!b) { result.reply = L.noBooking(req.booking_ref); break; }
      if (b.status === 'cancelled') { result.reply = L.extCancelled(b.booking_ref); break; }
      if (b.status === 'checked_out') { result.reply = L.extEnded(b.booking_ref); break; }
      const target = req.to || req.from || null;
      if (!target || target <= b.check_out) { result.reply = L.extAsk({ ref: b.booking_ref, type: b.room_type, out: d(b.check_out) }); break; }
      result.tools.push('availability');
      const av = await inv.availability(b.check_out, target, { roomTypeId: b.room_type_id });
      result.data = av;
      const r = av.results[0];
      const ok = !!r.is_available;
      const text = ok
        ? L.extYes({ ref: b.booking_ref, type: b.room_type, in: d(b.check_in), out: d(b.check_out), target: d(target), left: r.rooms_left, nights: av.nights, total: r.total_price })
        : L.extNo({ ref: b.booking_ref, type: b.room_type, target: d(target) });
      done(await compose(message, lang, {
        fallback: `${text}\n${L.highlight()}`,
        facts: {
          booking: b.booking_ref, room_type: b.room_type, current_stay: `${d(b.check_in)} - ${d(b.check_out)}`, extend_to: d(target),
          extra_nights: av.nights, can_extend: ok, ...(ok ? { rooms_left: r.rooms_left, extra_cost: rm(r.total_price) } : {}),
        },
        task: 'Say whether the booking can be extended to the new date. If yes, give the rooms left for the extra nights and the extra cost. If no, say the room type is fully booked on at least one of those nights.',
        policy: ok ? [L.extPolicy(), L.highlight()] : [L.highlight()],
      }));
      result.action = highlight(av);
      break;
    }
    case 'cancel_check': {
      const b = await inv.findBookingByRef(req.booking_ref);
      if (!b) { result.reply = L.noBooking(req.booking_ref); break; }
      const hours = (new Date(b.check_in + 'T00:00:00Z') - new Date(nowDt.replace(' ', 'T') + 'Z')) / 3600000;
      const h = Math.round(hours);
      if (b.status === 'cancelled') { result.reply = L.cancelAlready(b.booking_ref); break; }
      const kind = b.status === 'blocked' ? (hours > 72 ? 'free' : 'within') : 'other';
      const text = kind === 'free' ? L.cancelFree({ ref: b.booking_ref, hours: h })
        : kind === 'within' ? L.cancelWithin({ ref: b.booking_ref, hours: h })
        : L.cancelOther({ ref: b.booking_ref, status: L.status(b.status) });
      const note = kind === 'free' ? L.cancelPolicyFree() : kind === 'within' ? L.cancelPolicyWithin() : L.cancelPolicyOther();
      done(await compose(message, lang, {
        fallback: text,
        facts: { booking: b.booking_ref, status: L.status(b.status), check_in: d(b.check_in), ...(kind === 'other' ? {} : { hours_to_check_in: h }) },
        task: kind === 'other'
          ? "State the booking's status and its check-in date."
          : "State the booking's status and how many hours remain before check-in.",
        policy: [note],
      }));
      break;
    }
    case 'within_72h':
    case 'cancellable': {
      const within = req.intent === 'within_72h';
      result.tools.push('blockedWithHours');
      const all = await inv.blockedWithHours(nowDt);
      const rows = all.filter((r) => (within ? r.hours_to_check_in <= 72 : r.hours_to_check_in > 72));
      result.data = rows;
      if (!rows.length) { result.reply = within ? L.w72None() : L.canNone(); break; }
      const lines = rows.map((r) => (within ? L.w72Line : L.canLine)({ ref: r.booking_ref, agent: r.agent_name || L.na(), type: r.room_type, in: d(r.check_in), hours: r.hours_to_check_in })).join('\n');
      done(await compose(message, lang, {
        fallback: (within ? L.w72Title() : L.canTitle()) + '\n' + lines,
        facts: { count: rows.length, meaning: within ? 'blocked bookings that are within 72 hours of check-in' : 'blocked bookings that are more than 72 hours before check-in and still free to cancel' },
        task: `Write ONE short sentence saying how many ${within ? 'blocked bookings are within 72 hours of check-in' : 'blocked bookings are still free to cancel'}. A list follows; do not repeat it.`,
        rows: lines,
        policy: within ? [L.w72Note()] : [],
      }));
      break;
    }
    case 'unpaid': {
      result.tools.push('unpaidBookings');
      const rows = await inv.unpaidBookings();
      result.data = rows;
      if (!rows.length) { result.reply = L.unpaidNone(); break; }
      const shown = rows.slice(0, UNPAID_SHOWN);
      const lines = shown.map((r) => L.unpaidLine({ ref: r.booking_ref, by: r.booked_by, in: d(r.check_in), out: d(r.check_out), amount: r.total_amount != null ? rm(r.total_amount) : L.amountNa() })).join('\n')
        + (rows.length > shown.length ? '\n' + L.unpaidMore({ rest: rows.length - shown.length, total: rows.length }) : '');
      done(await compose(message, lang, {
        fallback: L.unpaidTitle() + '\n' + lines,
        facts: { total_unpaid: rows.length, shown: shown.length, meaning: 'confirmed or in-house bookings that are not yet paid' },
        task: 'Write ONE short sentence saying how many unpaid bookings there are and how many are shown below. A list follows; do not repeat it.',
        rows: lines,
      }));
      break;
    }
    case 'arrivals':
    case 'departures': {
      const arr = req.intent === 'arrivals';
      const rows = arr ? await inv.arrivals(tdy) : await inv.departures(tdy);
      result.tools.push(req.intent);
      result.data = rows;
      if (!rows.length) { result.reply = arr ? L.arrNone(d(tdy)) : L.depNone(d(tdy)); break; }
      const lines = rows.map((r) => L.dayLine({ ref: r.booking_ref, by: r.booked_by, type: r.room_type, status: L.status(r.status) })).join('\n');
      done(await compose(message, lang, {
        fallback: (arr ? L.arrTitle(d(tdy)) : L.depTitle(d(tdy))) + '\n' + lines,
        facts: { kind: req.intent, date: d(tdy), count: rows.length },
        task: `Write ONE short sentence saying how many ${req.intent} there are today. A list follows; do not repeat it.`,
        rows: lines,
      }));
      break;
    }
    case 'room_occupant': {
      const r = await inv.occupantOfRoom(req.room_number);
      result.tools.push('occupantOfRoom');
      result.data = r;
      if (!r) { result.reply = L.roomNone(req.room_number); break; }
      done(await compose(message, lang, r.full_name
        ? {
            fallback: L.roomIn({ n: r.room_number, name: r.full_name, ref: r.booking_ref, in: d(r.check_in), out: d(r.check_out) }),
            facts: { room_number: r.room_number, occupied_by: r.full_name, booking: r.booking_ref, stay: `${d(r.check_in)} - ${d(r.check_out)}` },
            task: 'Say who is staying in the room and for which dates.',
          }
        : {
            fallback: L.roomEmpty({ n: r.room_number, status: L.roomStatus(r.room_status) }),
            facts: { room_number: r.room_number, checked_in_guest: 'none', room_status: L.roomStatus(r.room_status) },
            task: 'Say that no guest is checked in to the room, and give the room status.',
          }));
      break;
    }
    case 'booking_lookup': {
      result.tools.push('findBooking');
      const rows = req.booking_ref ? [await inv.findBookingByRef(req.booking_ref)].filter(Boolean) : await inv.findBookingsByName(req.guest_name);
      result.data = rows;
      if (!rows.length) { result.reply = L.findNone(req.booking_ref || req.guest_name); break; }
      const lines = rows.map((r) => L.findLine({ ref: r.booking_ref, who: r.booked_by || r.guest_name || r.agent_name, type: r.room_type, room: r.room_number, in: d(r.check_in), out: d(r.check_out), status: L.status(r.status), pay: L.pay(r.payment_status) })).join('\n');
      done(await compose(message, lang, {
        fallback: L.findTitle() + '\n' + lines,
        facts: { count: rows.length, searched_for: req.booking_ref || req.guest_name },
        task: 'Write ONE short sentence saying how many bookings were found. A list follows; do not repeat it.',
        rows: lines,
      }));
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