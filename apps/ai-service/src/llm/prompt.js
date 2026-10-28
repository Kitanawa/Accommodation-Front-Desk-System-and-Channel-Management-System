// The understanding prompt and the output checker. Anything the model returns that is not exactly the expected
// shape is dropped, so a model (or a message that tries to trick it) cannot add fields or invent values.
// v4: intents and booking references changed for the team's FDS (references look like R-K3F9QA; 72-hour holds do not exist yet).
export const PROMPT_VERSION = 'v4';
export const REQUEST_LANGS = ['en', 'ms', 'zh', 'other'];
export const INTENTS = ['availability', 'room_info', 'extend_check', 'cancel_check', 'hold_72h', 'unpaid', 'arrivals', 'departures', 'room_occupant', 'booking_lookup', 'refuse_financial', 'refuse_cancel', 'refuse_change', 'unknown'];
export const REF_RE = /^R-[A-Z0-9]{6}$/i;          // reservation_ref format in the team's API contract
export const ROOM_NO_RE = /^[A-Za-z0-9-]{1,10}$/;  // room_number: letters, digits, hyphens, up to 10

export function buildPrompt(message, roomTypeNames, todayIso) {
  return `You convert a hotel front desk staff message into JSON. Today is ${todayIso}.
Return ONLY a JSON object with these keys:
intent: one of ${INTENTS.join(', ')}
room_type: exactly one of ${JSON.stringify(roomTypeNames)} or null
from: check-in date YYYY-MM-DD or null
to: check-out date YYYY-MM-DD or null. For a range like "5 to 10 November" or "1-6 Nov", "to" is the second date exactly as written. Do not add a day.
guests: integer or null
max_price: number (RM per night) or null
price_op: "<" or "<="
booking_ref: like R-K3F9QA or null
guest_name: string or null
room_number: the room number as written (letters, digits, hyphens) or null
wants_booking: true if the user wants to book, reserve or block a room
lang: the language of the message: en (English), ms (Malay), zh (Chinese/Mandarin) or other. For mixed language use the dominant one.
Intent guide: availability = rooms left or prices for dates; room_info = how many guests a room type fits (no dates); hold_72h = questions about the 72-hour hold or auto-confirmation; refuse_financial = refunds, discounts, vouchers, waivers or rate changes; refuse_cancel = a cancel request without a booking ref; refuse_change = delete, move, edit or "mark as paid" requests.
The message may be in English, Malay or Mandarin. Understand it in any of these, but always return the values above in English: dates as YYYY-MM-DD (for example "5hb November" and "11月5日" are valid dates), room_type exactly as written in the list above (the user may name it in Malay or Chinese), and intent from the list. Keep guest_name as written.
For extend_check, put the new end date in "to" and leave "from" null.
If dates have no year, pick the next occurrence on or after today. Do not invent values. Message: """${message}"""`;
}

export function emptyRequest() {
  return { intent: 'unknown', lang: null, room_type: null, from: null, to: null, guests: null, max_price: null, price_op: '<=', booking_ref: null, guest_name: null, room_number: null, wants_booking: false };
}

// Turns the model's raw text into a safe request object, or null if it is unusable.
export function parseModelJson(text, roomTypeNames) {
  if (typeof text !== 'string') return null;
  const s = text.replace(/```json|```/g, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b < a) return null;
  let o;
  try { o = JSON.parse(s.slice(a, b + 1)); } catch { return null; }
  if (!o || typeof o !== 'object' || !INTENTS.includes(o.intent)) return null;
  const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const type = typeof o.room_type === 'string' ? roomTypeNames.find((n) => n.toLowerCase() === o.room_type.trim().toLowerCase()) : null;
  return {
    intent: o.intent,
    room_type: type || null,
    from: isDate(o.from) ? o.from : null,
    to: isDate(o.to) ? o.to : null,
    guests: Number.isInteger(o.guests) && o.guests > 0 && o.guests <= 50 ? o.guests : null,
    max_price: typeof o.max_price === 'number' && o.max_price > 0 ? o.max_price : null,
    price_op: o.price_op === '<' ? '<' : '<=',
    booking_ref: typeof o.booking_ref === 'string' && REF_RE.test(o.booking_ref.trim()) ? o.booking_ref.trim().toUpperCase() : null,
    guest_name: typeof o.guest_name === 'string' && o.guest_name.trim() ? o.guest_name.trim().slice(0, 120) : null,
    room_number: typeof o.room_number === 'string' && ROOM_NO_RE.test(o.room_number.trim()) ? o.room_number.trim() : null,
    wants_booking: o.wants_booking === true,
    lang: REQUEST_LANGS.includes(o.lang) ? o.lang : null,
  };
}
