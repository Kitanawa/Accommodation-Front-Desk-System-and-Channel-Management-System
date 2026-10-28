// The chat pipeline for this step: understand -> pick language -> validate -> fixed-text reply.
// Facts (availability, rates, bookings) are NOT connected yet, so data questions only say what was understood.
// The reply is always fixed text from messages.js; the model only fills in the structured request.
import { understandWithLlm, provider } from './llm/index.js';
import { parseRules } from './rules.js';
import { today, diffDays, isValidIso } from './dates.js';
import { LANGS, detectLang, fmtDate, messages, UNSUPPORTED_NOTE } from './messages.js';

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

async function understand(message, names, tdy) {
  try {
    const r = await understandWithLlm(message, names, tdy);
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

function replyFor(req, L, lang) {
  switch (req.intent) {
    case 'refuse_financial': return L.refuseFinancial;
    case 'refuse_cancel': return L.refuseCancel;
    case 'refuse_change': return L.refuseChange;
    case 'hold_72h': return L.hold72;
    case 'unknown': return L.help;
    case 'availability': {
      if (!req.from || !req.to) return L.needDates();
      const nights = diffDays(req.from, req.to);
      const lines = [L.availability({ type: req.room_type, from: fmtDate(lang, req.from), to: fmtDate(lang, req.to), nights, guests: req.guests }), L.pending];
      if (req.wants_booking) lines.push(L.cannotBook);
      return lines.join('\n');
    }
    default: return [L.understood(L.labels[req.intent] || req.intent), L.pending].join('\n');
  }
}

export async function handleChat(message, { roomTypes = [], now } = {}) {
  const tdy = now || today();
  const names = cleanNames(roomTypes);
  const { req, via } = await understand(message, names, tdy);
  const { lang, unsupported } = pickLang(req, message);
  const L = messages(lang);
  req.lang = unsupported ? 'other' : lang;
  const problem = validate(req, names, L);
  let reply = problem || replyFor(req, L, lang);
  if (unsupported) reply = `${reply}\n${UNSUPPORTED_NOTE}`;
  return { reply, request: req, lang, source: via, validated: !problem, writer: 'template' };
}
