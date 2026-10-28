// Date helpers on ISO strings (YYYY-MM-DD), computed in UTC so there are no time zone surprises.
const toDate = (iso) => new Date(iso + 'T00:00:00Z');
export const toIso = (d) => d.toISOString().slice(0, 10);
export const addDays = (iso, n) => { const d = toDate(iso); d.setUTCDate(d.getUTCDate() + n); return toIso(d); };
export const diffDays = (a, b) => Math.round((toDate(b) - toDate(a)) / 86400000);
export const isValidIso = (iso) => typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso) && toIso(toDate(iso)) === iso;

// "Today" for the property. APP_TODAY pins it (demo/tests); otherwise the real date in APP_TIMEZONE (default Kuching),
// so between midnight and 08:00 local time it is not yesterday's UTC date.
export function today() {
  if (isValidIso(process.env.APP_TODAY)) return process.env.APP_TODAY;
  return new Intl.DateTimeFormat('en-CA', { timeZone: process.env.APP_TIMEZONE || 'Asia/Kuching', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
