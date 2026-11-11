// Housekeeping room tasks. The assistant only PREPARES a draft: it never saves anything.
// Staff review the filled-in form on the Housekeeping page and press Save Task themselves.
// Safety rules (all enforced here in code, whatever the model says):
//  - the cleaning status and priority must be one of the values the page offers
//  - the cleaner's name must be a name the staff member actually typed
//  - the note is only ever the staff's own words, copied exactly; if it cannot be matched exactly it is left out
//  - a clearer wording of the note is only a SUGGESTION: it is shown next to the note and used only if staff click it
// The Malay and Mandarin wording was drafted by AI and needs a native reader.

export const TASK_STATUSES = ['Dirty', 'Cleaning', 'Clean', 'Blocked'];
export const TASK_PRIORITIES = ['Normal', 'High'];
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const straight = (s) => s.replace(/[’‘]/g, "'");

// ---------- rules parser (English only; the model path handles other languages) ----------
// Fills the task fields on req and returns true when the message is clearly a housekeeping command such as
// "set room 203 to dirty, assign Siti, high priority, note: AC not cold". A question like "is room 203 clean?" is not a command.
export function taskFields(message, req) {
  if (!req.room_number) return false;
  const note = message.match(/\bnotes?\s*[:\-]\s*(.+)$/is);
  const head = note ? message.slice(0, note.index) : message;
  const t = head.toLowerCase().replace(/\bcleaning (status|task)\b/g, ' ');
  const verb = !!note || /\b(set|mark|change|update|make|put|assign|assigned|prioriti[sz]e)\b/.test(t);
  const st = t.match(/\b(dirty|cleaning|clean|blocked)\b/);
  const status = st ? st[1][0].toUpperCase() + st[1].slice(1) : null;
  let priority = null;
  if (/\bpriority\b/.test(t) || /\burgent\b/.test(t)) {
    if (/\b(high|urgent)\b/.test(t)) priority = 'High';
    else if (/\bnormal\b/.test(t)) priority = 'Normal';
  }
  const name = (m) => (m && !/^(room|rooms|to|high|normal)$/i.test(m[1].split(' ')[0]) ? m[1] : null);
  const who = name(head.match(/\b[Aa]ssign(?:ed)?\s+(?:to\s+)?([A-Z][\w'.-]*(?:\s+[A-Z][\w'.-]*)?)/))
    || name(head.match(/\b[Aa]ssign(?:ed)?\b[^.]*?\bto\s+([A-Z][\w'.-]*(?:\s+[A-Z][\w'.-]*)?)/))
    || name(head.match(/\b[Cc]leaner\s+(?:is\s+|to\s+)?([A-Z][\w'.-]*)/));
  const noteText = note ? norm(note[1]) : null;
  if (!verb || !(status || priority || who || noteText)) return false;
  req.task_status = status; req.priority = priority; req.assignee = who; req.note = noteText;
  return true;
}

// ---------- checks on what the model returned ----------
const NEG = /\b(not|no|never|none|cannot|without|don'?t|dont|doesn'?t|isn'?t|aren'?t|won'?t|can'?t|cant|nothing|nobody|tidak|tak|bukan|jangan|tiada|belum|tanpa)\b|不要|不能|没有|不|没|别|勿|无|未/gi;
const DIGITS = /\d+(?:[.:]\d+)?/g;
const count = (s, re) => (s.match(re) || []).length;
const hasCjk = (s) => /[\u3400-\u9fff]/.test(s);

// Is the clearer wording a faithful rephrasing? This catches mechanical drift (new or lost numbers, a lost or added "not", lost names,
// a changed language, big growth, links). It can NOT judge meaning, which is why the wording is only ever a suggestion for staff to accept.
export function clarifiedOk(original, clarified) {
  const a = straight(norm(original)), b = straight(norm(clarified));
  if (!a || !b || b.toLowerCase() === a.toLowerCase()) return false;
  if (b.length > Math.min(300, a.length * 3 + 60)) return false;
  if (/https?:|www\.|@|[<>{}[\]`]/.test(b)) return false;
  if (hasCjk(a) !== hasCjk(b)) return false;
  if (count(a, NEG) !== count(b, NEG)) return false;
  const da = new Set(a.match(DIGITS) || []), db = new Set(b.match(DIGITS) || []);
  if (da.size !== db.size || [...da].some((d) => !db.has(d))) return false;
  const bl = b.toLowerCase();
  const names = a.split(' ').slice(1).map((w) => w.replace(/[^\p{L}]/gu, '')).filter((w) => /^\p{Lu}\p{Ll}+$/u.test(w));
  if (names.some((w) => !bl.includes(w.toLowerCase()))) return false;
  if (!hasCjk(a)) {
    const words = [...new Set(a.toLowerCase().match(/\p{L}{4,}/gu) || [])];
    if (words.length && words.filter((w) => bl.includes(w)).length / words.length < 0.6) return false;
  }
  return true;
}

// Applies the safety rules to a room_task request (from the model or from the rules parser).
export function guardTask(req, message) {
  const msg = norm(message).toLowerCase();
  const inMsg = (s) => !!s && msg.includes(norm(s).toLowerCase());
  req.task_status = TASK_STATUSES.includes(req.task_status) ? req.task_status : null;
  req.priority = TASK_PRIORITIES.includes(req.priority) ? req.priority : null;
  const who = typeof req.assignee === 'string' ? norm(req.assignee).slice(0, 60) : '';
  req.assignee = who && /\p{L}/u.test(who) && inMsg(who) ? who : null;
  let note = typeof req.note === 'string' ? norm(req.note).replace(/^["“”]+|["“”]+$/g, '').trim() : '';
  if (note && (note.length > 300 || !inMsg(note))) { req.note_dropped = true; note = ''; }
  req.note = note || null;
  req.note_clarified = req.note && typeof req.note_clarified === 'string' && clarifiedOk(req.note, req.note_clarified) ? norm(req.note_clarified) : null;
  return req;
}

// ---------- what goes to the page ----------
export function taskAction(req) {
  if (!req.room_number || req.room_unknown || !(req.task_status || req.assignee || req.priority || req.note)) return null;
  return { type: 'set_room_task', room: req.room_number, status: req.task_status || null, assignee: req.assignee || null, priority: req.priority || null, note: req.note || null, noteClarified: req.note_clarified || null };
}

const T = {
  en: {
    head: (r) => `I filled in the room task for room ${r} on the Housekeeping page. Nothing is saved yet.`,
    status: (v) => `• Cleaning status: ${v}`, assignee: (v) => `• Assigned cleaner: ${v}`, priority: (v) => `• Priority: ${v}`, note: (v) => `• Note (your own words): “${v}”`,
    suggestion: 'I also prepared a clearer wording for the note. Your own wording stays unless you choose mine.',
    dropped: 'I could not copy your note exactly, so I left it empty. Please type it in the form.',
    tail: 'Please check it and press Save Task.',
    needRoom: 'Which room? Please give one room number, for example: “set room 203 to dirty”.',
    noRoom: (r) => `I cannot find room ${r} on the Housekeeping list, so I did not fill in anything. Please check the room number.`,
    needChange: (r) => `What should I change for room ${r}? I can set the cleaning status (Dirty, Cleaning, Clean, Blocked), the assigned cleaner, the priority (Normal, High) or a note.`,
    next: 'Check the task on the Housekeeping page and press Save Task when it is right. Would you like to set another room task?',
  },
  ms: {
    head: (r) => `Saya telah mengisi tugasan bilik untuk bilik ${r} di halaman Housekeeping. Belum ada yang disimpan.`,
    status: (v) => `• Status pembersihan: ${v}`, assignee: (v) => `• Pembersih ditugaskan: ${v}`, priority: (v) => `• Keutamaan: ${v}`, note: (v) => `• Nota (kata-kata anda sendiri): “${v}”`,
    suggestion: 'Saya juga menyediakan ayat nota yang lebih jelas. Ayat anda sendiri kekal melainkan anda memilih ayat saya.',
    dropped: 'Saya tidak dapat menyalin nota anda dengan tepat, jadi saya biarkan kosong. Sila taip di dalam borang.',
    tail: 'Sila semak dan tekan Save Task.',
    needRoom: 'Bilik yang mana? Berikan satu nombor bilik, contohnya: “set room 203 to dirty”.',
    noRoom: (r) => `Saya tidak jumpa bilik ${r} dalam senarai Housekeeping, jadi saya tidak mengisi apa-apa. Sila semak nombor bilik.`,
    needChange: (r) => `Apa yang perlu saya ubah untuk bilik ${r}? Saya boleh menetapkan status pembersihan (Dirty, Cleaning, Clean, Blocked), pembersih yang ditugaskan, keutamaan (Normal, High) atau nota.`,
    next: 'Semak tugasan di halaman Housekeeping dan tekan Save Task apabila betul. Adakah anda mahu menetapkan tugasan bilik lain?',
  },
  zh: {
    head: (r) => `我已在 Housekeeping 页面填好房间${r}的任务。目前还没有保存任何内容。`,
    status: (v) => `• 清洁状态：${v}`, assignee: (v) => `• 指派清洁员：${v}`, priority: (v) => `• 优先级：${v}`, note: (v) => `• 备注（您自己的原话）：“${v}”`,
    suggestion: '我还准备了一个更清楚的备注说法。除非您选择我的说法，否则会保留您自己的原话。',
    dropped: '我无法原样复制您的备注，所以留空了。请在表单中自行输入。',
    tail: '请检查后按 Save Task。',
    needRoom: '请问是哪一间房？请提供一个房间号，例如：“set room 203 to dirty”。',
    noRoom: (r) => `在 Housekeeping 列表中找不到房间${r}，所以我没有填写任何内容。请检查房间号。`,
    needChange: (r) => `房间${r}要更改什么？我可以设置清洁状态（Dirty、Cleaning、Clean、Blocked）、指派的清洁员、优先级（Normal、High）或备注。`,
    next: '请在 Housekeeping 页面检查任务，确认无误后按 Save Task。还要设置其他房间的任务吗？',
  },
};
const tx = (lang) => T[lang] || T.en;

// The fixed reply for a room_task request (no model-written wording).
export function taskReply(lang, req) {
  const t = tx(lang);
  if (!req.room_number) return t.needRoom;
  if (req.room_unknown) return t.noRoom(req.room_number);
  const any = req.task_status || req.assignee || req.priority || req.note;
  if (!any) return req.note_dropped ? t.dropped : t.needChange(req.room_number);
  const lines = [t.head(req.room_number)];
  if (req.task_status) lines.push(t.status(req.task_status));
  if (req.assignee) lines.push(t.assignee(req.assignee));
  if (req.priority) lines.push(t.priority(req.priority));
  if (req.note) lines.push(t.note(req.note));
  if (req.note_clarified) lines.push(t.suggestion);
  if (req.note_dropped) lines.push(t.dropped);
  lines.push(t.tail);
  return lines.join('\n');
}
export const taskFollowUp = (lang, req) => (req?.room_unknown ? null : { text: tx(lang).next, buttons: [] });

// The room numbers come from the browser (the Housekeeping list). Keep only short, plain values.
export function cleanRoomList(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const v of list) {
    if (typeof v !== 'string' && typeof v !== 'number') continue;
    const s = String(v).replace(/\s+/g, ' ').trim();
    if (!s || s.length > 20 || /[\u0000-\u001f]/.test(s) || out.includes(s)) continue;
    out.push(s);
    if (out.length >= 500) break;
  }
  return out;
}

// Marks the request when the room is not on the list. An empty or missing list means "unknown list": no check is made.
export function checkTaskRoom(req, rooms) {
  if (!Array.isArray(rooms) || !rooms.length || !req.room_number) return req;
  if (!rooms.map(String).includes(String(req.room_number))) req.room_unknown = true;
  return req;
}
