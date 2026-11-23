// The understanding prompt and the output checker. Anything the model returns that is not exactly the expected
// shape is dropped, so a model (or a message that tries to trick it) cannot add fields or invent values.
// v4: intents and booking references changed for the team's FDS (references look like R-K3F9QA; 72-hour holds do not exist yet).
import { matchRoomType } from '../roomnames.js';
export const PROMPT_VERSION = 'v5';
export const REQUEST_LANGS = ['en', 'ms', 'zh', 'other'];
export const INTENTS = ['availability', 'room_info', 'extend_check', 'cancel_check', 'hold_72h', 'unpaid', 'arrivals', 'departures', 'room_occupant', 'booking_lookup', 'refuse_financial', 'refuse_cancel', 'refuse_change', 'confirm', 'smalltalk', 'room_task', 'unknown'];
export const REF_RE = /^R-[A-Z0-9]{6}$/i;          // reservation_ref format in the team's API contract
export const ROOM_NO_RE = /^[A-Za-z0-9-]{1,10}$/;  // room_number: letters, digits, hyphens, up to 10

// Earlier messages and what was understood last time (from the browser, already checked by sanitizeContext). Context only: the code fills in missing values.
function contextText(context) {
  if (!context || (!(context.history || []).length && !context.last)) return '';
  const lines = [];
  if ((context.history || []).length) lines.push(`Earlier messages from this staff member, oldest first (context only): ${JSON.stringify(context.history)}`);
  if (context.last) lines.push(`Understood last time: ${JSON.stringify(context.last)}`);
  return `\n${lines.join('\n')}`;
}

export function buildPrompt(message, roomTypeNames, todayIso, context = null) {
  return `You convert a hotel front desk staff message into JSON. Today is ${todayIso}.
Return ONLY a JSON object with these keys:
intent: one of ${INTENTS.join(', ')}
room_type: the closest match from ${JSON.stringify(roomTypeNames)}, or null. Staff may misspell it (for example "delux king"), shorten it (for example "king") or name it in Malay or Chinese: return the name exactly as written in the list, and null if nothing is close
from: check-in date YYYY-MM-DD or null
to: check-out date YYYY-MM-DD or null. For a range like "5 to 10 November" or "1-6 Nov", "to" is the second date exactly as written. Do not add a day.
guests: integer or null
max_price: number (RM per night) or null
price_op: "<" or "<="
booking_ref: like R-K3F9QA or null
guest_name: string or null
room_number: the room number as written (letters, digits, hyphens) or null
wants_booking: true if the user wants to book, reserve or block a room
task_status: for room_task only, one of Dirty, Cleaning, Clean, Blocked, or null
assignee: for room_task only, the cleaner's name exactly as the user wrote it, or null
priority: for room_task only, Normal or High, or null
note: for room_task only, the note text copied EXACTLY as the user wrote it (do not rewrite or translate it), or null
note_clarified: for room_task only, a clearer version of that note, ONLY when the note is vague or very short. Rephrase and explain using only what the note already says. Never add facts, causes, numbers, names, places or times. Keep every number, name and negation (not, no, don't, jangan, tidak, 不) and the same language. At most two short sentences. null when the note is already clear or when you would have to guess.
lang: the language of the message: en (English), ms (Malay), zh (Chinese/Mandarin) or other. For mixed language use the dominant one.
Intent guide: availability = rooms left or prices for dates; room_info = how many guests a room type fits (no dates); hold_72h = questions about the 72-hour hold or auto-confirmation; refuse_financial = refunds, discounts, vouchers, waivers or rate changes; refuse_cancel = a cancel request without a booking ref; refuse_change = delete, move, edit or "mark as paid" requests; room_task = the user wants to fill in a housekeeping room task for ONE room number (cleaning status, assigned cleaner, priority or a note). It is not a booking change. If several rooms are named, set room_number to null.
The message may be in English, Malay or Mandarin. Understand it in any of these, but always return the values above in English: dates as YYYY-MM-DD (for example "5hb November" and "11月5日" are valid dates), room_type exactly as written in the list above (the user may name it in Malay or Chinese), and intent from the list. Keep guest_name as written.
For extend_check, put the new end date in "to" and leave "from" null.
If dates have no year, pick the next occurrence on or after today. Do not invent values.
Staff may write casually, with typos, slang, jokes or filler words (for example "boss", "haha"). Read generously: ignore the chatter and extract the request. Use intent smalltalk only when the message has no request at all (a greeting, thanks, a compliment, laughter). Use intent confirm only for a bare yes, ok, sure or "book it" with no room type or dates. If the message continues the earlier conversation (it only names a room type, gives only dates or guests, or answers a question), use intent availability and return only what the NEW message says: the system adds the earlier dates and room type itself, so do not copy them.${contextText(context)}
Message: """${message}"""`;
}

export function emptyRequest() {
  return { intent: 'unknown', lang: null, room_type: null, from: null, to: null, guests: null, max_price: null, price_op: '<=', booking_ref: null, guest_name: null, room_number: null, wants_booking: false, task_status: null, assignee: null, priority: null, note: null, note_clarified: null };
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
  const type = typeof o.room_type === 'string' ? matchRoomType(o.room_type, roomTypeNames) : null;
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
    task_status: ['Dirty', 'Cleaning', 'Clean', 'Blocked'].includes(o.task_status) ? o.task_status : null,
    assignee: typeof o.assignee === 'string' && o.assignee.trim() ? o.assignee.trim().slice(0, 60) : null,
    priority: o.priority === 'High' || o.priority === 'Normal' ? o.priority : null,
    note: typeof o.note === 'string' && o.note.trim() ? o.note.trim().slice(0, 301) : null,
    note_clarified: typeof o.note_clarified === 'string' && o.note_clarified.trim() ? o.note_clarified.trim().slice(0, 300) : null,
    lang: REQUEST_LANGS.includes(o.lang) ? o.lang : null,
  };
}
