// Date helpers working on ISO strings (YYYY-MM-DD) in UTC, so no timezone surprises.
const toDate = (iso) => new Date(iso + 'T00:00:00Z');
export const toIso = (d) => d.toISOString().slice(0, 10);
export const addDays = (iso, n) => { const d = toDate(iso); d.setUTCDate(d.getUTCDate() + n); return toIso(d); };
export const diffDays = (a, b) => Math.round((toDate(b) - toDate(a)) / 86400000);
export const isValidIso = (iso) => /^\d{4}-\d{2}-\d{2}$/.test(iso) && toIso(toDate(iso)) === iso;

// nights from `from` (inclusive) to `to` (exclusive)
export function nightsBetween(from, to) {
  const out = [];
  for (let d = from; d < to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function today() {
  return process.env.APP_TODAY || toIso(new Date());
}
// "now" used for the 72-hour rule. With APP_TODAY set we use 09:00 on that day.
export function nowDateTime() {
  return process.env.APP_TODAY ? `${process.env.APP_TODAY} 09:00:00` : new Date().toISOString().slice(0, 19).replace('T', ' ');
}
export const firstOfMonth = (month) => `${month}-01`;
export function nextMonthFirst(month) {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}
export const monthOf = (iso) => iso.slice(0, 7);
export const weekday = (iso) => toDate(iso).getUTCDay(); // 0 = Sunday
