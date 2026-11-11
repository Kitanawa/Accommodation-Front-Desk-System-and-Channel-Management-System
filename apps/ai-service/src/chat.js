// The chat pipeline for this step: understand -> pick language -> validate -> fixed-text reply.
// Facts (availability, rates, bookings) are NOT connected yet, so data questions only say what was understood.
// The reply is always fixed text from messages.js; the model only fills in the structured request.
import { understandWithLlm, provider } from './llm/index.js';
import { parseRules } from './rules.js';
import { today, diffDays, isValidIso } from './dates.js';
import { LANGS, detectLang, fmtDate, messages, UNSUPPORTED_NOTE } from './messages.js';
import { makeQ } from './db.js';
import { dbReady } from './dbstate.js';
import { getIdentity } from './identity.js';
import * as F from './facts.js';
import { buildFollowUp, buildAction } from './followups.js';
import { sanitizeContext, applyContext } from './context.js';
import { friendly } from './friendly.js';
import { guardTask, taskReply, taskAction, taskFollowUp, checkTaskRoom, cleanRoomList } from './roomtask.js';

// Room type names come from the browser, so they are cleaned before they go into a prompt.
export function cleanNames(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const v of list) {
    if (typeof v !== 'string') continue;
    const n = v.replace(/[\u0000-\u001f"\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
    if (n && !out.includes(n)) out.push(n);
    if (out.length >= 60) break;
  }
  return out;
}

async function understand(message, names, tdy, mem) {
  try {
    const r = await understandWithLlm(message, names, tdy, mem);
    if (r) return { req: r, via: r.source };
  } catch (e) {
    console.warn('LLM understanding failed, using rules:', e.message);
  }
  return { req: parseRules(message, names, tdy), via: provider() === 'rules' ? 'rules' : 'rules (model unavailable)' };
}

// Only English, Malay and Mandarin are supported. Chinese characters always mean Mandarin.
function pickLang(req, message) {
  if (/[\u3400-\u9fff]/.test(message)) return { lang: 'zh', unsupported: false };
  if (req.lang === 'other') return { lang: 'en', unsupported: true };
  if (LANGS.includes(req.lang)) return { lang: req.lang, unsupported: false };
  return { lang: detectLang(message), unsupported: false };
}

function validate(req, names, L) {
  if (req.room_type && !names.includes(req.room_type)) return L.badRoomType(names);
  if (req.from && req.to) {
    if (!isValidIso(req.from) || !isValidIso(req.to)) return L.badDates();
    if (req.to <= req.from) return L.checkoutAfter();
    if (diffDays(req.from, req.to) > 60) return L.longStay();
  }
  return null;
}

// Reply when no data is read (database off, or nobody signed in through the API): says what was understood, nothing more.
function replyFor(req, L, lang, live) {
  const pending = live ? L.needSignIn : L.pending;
  switch (req.intent) {
    case 'refuse_financial': return L.refuseFinancial;
    case 'refuse_cancel': return L.refuseCancel;
    case 'refuse_change': return L.refuseChange;
    case 'hold_72h': return L.hold72;
    case 'unknown': return L.help;
    case 'smalltalk': return friendly(lang).smalltalk;
    case 'confirm': return friendly(lang).confirmNothing;
    case 'room_task': return taskReply(lang, req);
    case 'availability': {
      if (!req.from || !req.to) return L.needDates();
      const nights = diffDays(req.from, req.to);
      const lines = [L.availability({ type: req.room_type, from: fmtDate(lang, req.from), to: fmtDate(lang, req.to), nights, guests: req.guests }), pending];
      if (req.wants_booking) lines.push(L.cannotBook);
      return lines.join('\n');
    }
    default: return [L.understood(L.labels[req.intent] || req.intent), pending].join('\n');
  }
}

const money = (cur, n) => `${cur === 'MYR' ? 'RM' : cur} ${n.toFixed(2)}`;
const reasonText = (L, reasons) => reasons.map((r) => L.reasons[r.code](r.n)).join(', ');
function bookingLine(L, lang, r) {
  const parts = [r.ref, r.guest, `${r.room_type}${r.room_number ? ` (${L.roomWord(r.room_number)})` : ''}`, `${fmtDate(lang, r.check_in)} → ${fmtDate(lang, r.check_out)}`, L.statuses[r.status] || r.status, L.payments[r.payment_status] || r.payment_status];
  return `• ${parts.join(' · ')}`;
}

// Reply built from database facts (read-only). Wording is fixed text; only values come from the database.
async function dataReply(req, L, lang, { q, propertyId, tdy, ctx = {} }) {
  const list = (header, rows) => [header, ...rows.map((r) => bookingLine(L, lang, r))].join('\n');
  switch (req.intent) {
    case 'availability': {
      if (!req.from || !req.to) return L.needDates();
      if (req.from < tdy) return L.pastDates();
      const [rows, cur] = await Promise.all([F.availability(q, propertyId, { from: req.from, to: req.to, guests: req.guests }), F.currency(q, propertyId)]);
      ctx.bookable = rows.filter((r) => r.bookable).map((r) => r.name);
      if (!rows.length) return L.availNone;
      const from = fmtDate(lang, req.from), to = fmtDate(lang, req.to), nights = rows[0].nights;
      const fmt = (r) => ({ name: r.name, type: r.name, from, to, nights, left: r.rooms_left, average: r.average === null ? '' : money(cur, r.average), total: r.total === null ? '' : money(cur, r.total), reasons: reasonText(L, r.reasons) });
      let out;
      if (req.room_type) {
        const r = rows.find((x) => x.name === req.room_type);
        out = r.bookable ? L.availYes(fmt(r)) : L.availNo(fmt(r));
      } else {
        out = [L.availHeader({ from, to, nights, guests: req.guests }), ...rows.map((r) => (r.bookable ? L.availLine(fmt(r)) : L.availLineNo(fmt(r))))].join('\n');
      }
      return req.wants_booking ? `${out}\n${L.cannotBook}` : out;
    }
    case 'room_info': {
      const rows = await F.roomTypes(q, propertyId);
      if (!rows.length) return L.availNone;
      const pick = req.room_type ? rows.filter((r) => r.name === req.room_type) : rows;
      return [L.roomInfoHeader, ...pick.map((r) => L.roomInfoLine({ name: r.name, guests: r.max_guests, minNights: r.min_nights }))].join('\n');
    }
    case 'arrivals': { const rows = await F.arrivals(q, propertyId, tdy); return rows.length ? list(L.arrivalsHeader(rows.length), rows) : L.arrivalsNone; }
    case 'departures': { const rows = await F.departures(q, propertyId, tdy); return rows.length ? list(L.departuresHeader(rows.length), rows) : L.departuresNone; }
    case 'unpaid': { const u = await F.unpaid(q, propertyId); return u.count ? list(L.unpaidHeader(u.count, u.rows.length), u.rows) : L.unpaidNone; }
    case 'booking_lookup': {
      if (!req.booking_ref && !req.guest_name) return L.needRefOrName;
      const rows = req.booking_ref ? await F.bookingByRef(q, propertyId, req.booking_ref) : await F.bookingsByGuest(q, propertyId, req.guest_name);
      return rows.length ? rows.map((r) => bookingLine(L, lang, r)).join('\n') : L.notFound(req.booking_ref || req.guest_name);
    }
    case 'cancel_check': {
      if (!req.booking_ref) return L.needRefOrName;
      const [b] = await F.bookingByRef(q, propertyId, req.booking_ref);
      if (!b) return L.notFound(req.booking_ref);
      return b.status === 'CONFIRMED' ? L.cancelOk(b.ref) : L.cancelNo(b.ref, L.statuses[b.status] || b.status);
    }
    default: return [L.understood(L.labels[req.intent] || req.intent), L.notYet(L.labels[req.intent] || req.intent)].join('\n');
  }
}

// cookie: the browser's Cookie header. With a valid FDS session AND a read-only database that passed the guard, answers come from the database.
export async function handleChat(message, { roomTypes = [], now, cookie, lang: forcedLang, context, taskRooms } = {}) {
  const tdy = now || today();
  const live = dbReady();
  const identity = live ? await getIdentity(cookie) : null;
  let q = null;
  let names = cleanNames(roomTypes);
  if (live && identity) {
    try { q = makeQ(); names = cleanNames((await F.roomTypes(q, identity.propertyId)).map((t) => t.name)); }
    catch (e) { console.warn('room data unavailable:', e.message); q = null; }
  }
  const mem = sanitizeContext(context, names);
  const { req, via } = await understand(message, names, tdy, mem);
  applyContext(req, mem);
  if (req.intent === 'room_task') { guardTask(req, message); checkTaskRoom(req, cleanRoomList(taskRooms)); }
  const forced = LANGS.includes(forcedLang) ? forcedLang : null;
  const { lang, unsupported } = forced ? { lang: forced, unsupported: false } : pickLang(req, message);
  const L = messages(lang);
  req.lang = unsupported ? 'other' : lang;
  const problem = validate(req, names, L);
  let reply = problem;
  let answeredFromDatabase = false;
    const ctx = {};
  if (!problem) {
    const needsData = ['availability', 'room_info', 'arrivals', 'departures', 'unpaid', 'booking_lookup', 'cancel_check', 'room_occupant', 'extend_check'].includes(req.intent);
    if (needsData && q && identity) {
      try { reply = await dataReply(req, L, lang, { q, propertyId: identity.propertyId, tdy, ctx }); answeredFromDatabase = !['room_occupant', 'extend_check'].includes(req.intent); }
      catch (e) { console.error('database read failed:', e.message); reply = L.dbUnavailable; }
    } else {
      reply = replyFor(req, L, lang, live);
    }
  }
  if (unsupported) reply = `${reply}\n${UNSUPPORTED_NOTE}`;
  return { reply, request: req, lang, source: via, validated: !problem, writer: 'template', data: answeredFromDatabase ? 'database (read-only)' : 'none', followUp: req.intent === 'room_task' ? taskFollowUp(lang, req) : buildFollowUp(lang, { req, problem, ctx, tdy }), action: req.intent === 'room_task' ? taskAction(req) : buildAction({ req, problem, ctx, tdy }) };
}
