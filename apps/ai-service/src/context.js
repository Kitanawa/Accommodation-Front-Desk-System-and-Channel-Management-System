// Chat memory for the assistant. The browser keeps what was understood last time (room type, dates, guests) together with the chat
// and wipes it whenever the chat is cleared. Each question carries it, and this code (not the model) fills in what the new message leaves out.
import { isValidIso } from './dates.js';

// Bare answers and chit-chat, used by the rules parser (the model decides this itself when it is used).
const CONFIRM_WORDS = 'yes|yeah|yep|yup|ya|yea|ok|okay|oke|sure|please|pls|go ahead|do it|book it|book that|proceed|confirm|boleh|jom|setuju|好的|好|可以|行|是的|要';
export const CONFIRM_RE = new RegExp(`^(?:(?:${CONFIRM_WORDS})(?:\\s+|$)){1,3}(?:(?:lah|la|thanks|thank you)\\s*)?$`, 'i');
export const SMALLTALK_RE = /^(hi|hello|hey|hai|helo|good (morning|afternoon|evening)|selamat (pagi|petang|malam)|thanks|thank you|thx|ty|tq|terima kasih|cheers|你好|您好|谢谢|多谢|ha(ha)+|he(he)+|lol)( there| boss| bro| sir| madam| lah)?$/i;

// isValidIso must never throw on input from the browser
const okDate = (s) => { try { return typeof s === 'string' && isValidIso(s); } catch { return false; } };
const clip = (s, n) => String(s).replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

// The context comes from the browser, so it is checked before use: only real room types, real dates, small sizes.
export function sanitizeContext(raw, names = []) {
  const out = { history: [], last: null };
  if (!raw || typeof raw !== 'object') return out;
  if (Array.isArray(raw.history)) out.history = raw.history.filter((x) => typeof x === 'string').map((x) => clip(x, 300)).filter(Boolean).slice(-4);
  const l = raw.last;
  if (l && typeof l === 'object') {
    const room_type = typeof l.room_type === 'string' && names.includes(l.room_type) ? l.room_type : null;
    const dates = okDate(l.from) && okDate(l.to) && l.to > l.from;
    const guests = Number.isInteger(l.guests) && l.guests > 0 && l.guests <= 50 ? l.guests : null;
    if (room_type || dates) out.last = { room_type, from: dates ? l.from : null, to: dates ? l.to : null, guests };
  }
  return out;
}

// Fills in what the new message leaves out, for availability questions only. Anything the person says now always wins.
//  - no dates in the message  -> the earlier dates (and guests) are used
//  - no room type and no dates -> the earlier room type too
//  - a bare "yes" / "ok, book it" (intent confirm) becomes an availability question for the earlier request
export function applyContext(req, mem) {
  const last = mem && mem.last;
  if (!last || (req.intent !== 'availability' && req.intent !== 'confirm')) return req;
  const carried = [];
  const hasRoom = !!req.room_type, hasDate = !!(req.from || req.to);
  if (!hasDate && last.from && last.to) {
    req.from = last.from; req.to = last.to; carried.push('dates');
    if (req.guests == null && last.guests) { req.guests = last.guests; carried.push('guests'); }
  }
  if (!hasRoom && !hasDate && last.room_type) { req.room_type = last.room_type; carried.push('room_type'); }
  if (req.intent === 'confirm' && req.from && req.to) { req.intent = 'availability'; req.wants_booking = true; }
  if (carried.length) req.carried = carried;
  return req;
}
