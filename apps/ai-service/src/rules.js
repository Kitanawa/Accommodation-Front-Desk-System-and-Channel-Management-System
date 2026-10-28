// Rules-based understanding (no model). English only, first match wins, English month names only.
// Used when LLM_PROVIDER=rules or when the model call fails.
import { addDays, isValidIso, today } from './dates.js';

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const MONTH_RE = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*';
const pad = (n) => String(n).padStart(2, '0');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Pick the year so the date is not in the past (relative to "today").
function resolve(day, month, tdy) {
  const y = Number(tdy.slice(0, 4));
  let iso = `${y}-${pad(month)}-${pad(day)}`;
  if (iso < tdy) iso = `${y + 1}-${pad(month)}-${pad(day)}`;
  return isValidIso(iso) ? iso : null;
}

export function extractDates(text, tdy = today()) {
  const t = text.toLowerCase();
  let m;
  const pair = (a, b) => (a && b ? { from: a, to: b } : null);

  // 2026-11-25 to 2026-11-30
  const iso = [...t.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)].map((x) => x[0]).filter(isValidIso);
  if (iso.length >= 2) return { from: iso[0], to: iso[1] };
  if (iso.length === 1) return withNights(iso[0], t);

  // 25th to 30th november  /  25-30 nov
  m = t.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:to|-|–|until|till|through)\\s*(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s+)?${MONTH_RE}`));
  if (m) { const mon = MONTHS[m[3]]; return pair(resolve(+m[1], mon, tdy), resolve(+m[2], mon, tdy)); }

  // 25 nov ... 30 nov   /   nov 25 ... nov 30   /   25/11
  const found = [];
  for (const x of t.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s+)?${MONTH_RE}\\b`, 'g'))) found.push({ i: x.index, d: +x[1], m: MONTHS[x[2]] });
  for (const x of t.matchAll(new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'g'))) found.push({ i: x.index, d: +x[3], m: MONTHS[x[1]] });
  for (const x of t.matchAll(/\b(\d{1,2})\/(\d{1,2})\b/g)) found.push({ i: x.index, d: +x[1], m: +x[2] });
  found.sort((a, b) => a.i - b.i);
  const valid = found.filter((f) => f.d >= 1 && f.d <= 31 && f.m >= 1 && f.m <= 12);
  if (valid.length >= 2) return pair(resolve(valid[0].d, valid[0].m, tdy), resolve(valid[1].d, valid[1].m, tdy));
  if (valid.length === 1) { const f = resolve(valid[0].d, valid[0].m, tdy); return f ? withNights(f, t) : null; }
  return null;
}

// One date only: "for 3 nights" -> check-out = from + 3, otherwise a single night.
function withNights(from, t) {
  const n = t.match(/(\d{1,2})\s*nights?/);
  return { from, to: addDays(from, n ? Number(n[1]) : 1) };
}

export function parseRules(message, roomTypeNames = [], tdy = today()) {
  const t = message.toLowerCase();
  const req = { intent: 'unknown', lang: null, room_type: null, from: null, to: null, guests: null, max_price: null, price_op: '<=', booking_ref: null, guest_name: null, room_number: null, wants_booking: false, source: 'rules' };

  const ref = message.match(/\bR-[A-Z0-9]{6}\b/i);
  if (ref) req.booking_ref = ref[0].toUpperCase();
  const room = t.match(/\broom\s+(\d{3,4})\b/);
  if (room) req.room_number = room[1];

  // The longest matching room type name wins (so "Deluxe King Room 2" beats a shorter name inside it).
  for (const name of [...roomTypeNames].sort((a, b) => b.length - a.length)) {
    if (new RegExp(`(^|[^a-z0-9])${escapeRe(name.toLowerCase())}($|[^a-z0-9])`).test(t)) { req.room_type = name; break; }
  }

  // "for 2 guests" always works; a bare "for 2" only when it is not part of a date or a number of nights.
  const gp = t.match(/(\d{1,2})\s*(?:guests?|people|persons?|pax|adults?)/);
  if (gp) req.guests = Number(gp[1]);
  else {
    const g = t.match(/\bfor\s+(\d{1,2})\b(?!\s*(?:nights?|st|nd|rd|th|\/|-|to\b|until|till|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec))/);
    if (g) req.guests = Number(g[1]);
  }

  const p = t.match(/(below|under|less than|cheaper than|max(?:imum)?|up to|within)\s*(?:rm|myr)?\s*(\d{2,5})/);
  if (p) { req.max_price = Number(p[2]); req.price_op = /below|under|less than|cheaper/.test(p[1]) ? '<' : '<='; }

  const dates = extractDates(message, tdy);
  if (dates) { req.from = dates.from; req.to = dates.to; }
  req.wants_booking = /\b(book|reserve|block)\b/.test(t);

  // --- intent ---
  if (/\b(refund|discount|voucher|promo|waive|waiver|compensat|change (the )?rate|lower (the )?rate|special rate)\b/.test(t)) req.intent = 'refuse_financial';
  else if (/\bcancel/.test(t) && req.booking_ref) req.intent = 'cancel_check';
  else if (/\bcancel/.test(t)) req.intent = 'refuse_cancel';
  else if (/\b(delete|remove|move|transfer|reassign|edit|modify|amend)\b|\b(mark|set)\b.*\bpaid\b|\bchange (the )?(dates?|room|booking|guest)\b/.test(t)) req.intent = 'refuse_change';
  else if (/\bextend|extension|stay (longer|until)\b/.test(t) && req.booking_ref) req.intent = 'extend_check';
  else if (/\b(72|three days|3 days)\b|\bon hold\b|\bhold\b|auto.?confirm/.test(t)) req.intent = 'hold_72h';
  else if (/\b(unpaid|not paid|outstanding|balance|owe|haven'?t paid|has not paid)\b/.test(t)) req.intent = 'unpaid';
  else if (/\b(arriv|check.?in).*today|today.*(arriv|check.?in)|arrivals/.test(t)) req.intent = 'arrivals';
  else if (/\b(depart|check.?out).*today|today.*(depart|check.?out)|departures/.test(t)) req.intent = 'departures';
  else if (req.room_number && /\b(who|occupied|staying|in room)\b/.test(t)) req.intent = 'room_occupant';
  else if (/\b(paid|payment status)\b/.test(t) && /\b(has|did|is)\b/.test(t)) req.intent = 'booking_lookup';
  else if (/\b(booking|bookings|reservation)s?\b.*\b(for|of|by|under)\b/.test(t) || req.booking_ref) req.intent = 'booking_lookup';
  else if (req.from && req.to) req.intent = 'availability';
  else if (/\b(how many (people|guests|persons)|capacity|can .* fit|max(imum)? (guests|occupancy)|sleeps?)\b/.test(t)) req.intent = 'room_info';
  else if (/\b(available|availability|rooms? left|how many)\b/.test(t)) req.intent = 'availability';

  if (req.intent === 'booking_lookup' && !req.booking_ref) {
    const name = message.match(/(?:[Ff]or|[Oo]f|[Bb]y|[Uu]nder|[Hh]as|[Dd]id|[Ii]s)\s+(?:mr\.?|mrs\.?|ms\.?|mdm\.?)?\s*([A-Z][\w'.-]+(?:\s+[A-Z][\w'.-]+)*)/);
    if (name) req.guest_name = name[1].trim();
  }
  if (req.intent === 'booking_lookup' && !req.booking_ref && !req.guest_name) req.intent = 'unknown';
  return req;
}
