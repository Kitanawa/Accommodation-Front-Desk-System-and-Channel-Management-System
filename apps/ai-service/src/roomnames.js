// Loose room type matching, so "delux king", "king" or "STANDARD  twin" still find the real room type.
// Only names that really exist are ever returned. If two room types fit equally well the answer is null (ambiguous), never a guess.
const STOP = new Set(['room', 'rooms', 'bilik', 'type', 'jenis', 'the', 'a']);
const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\u3400-\u9fff]+/g, ' ').trim();

function lev(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

// two words are "close" when equal, when one is the start of the other (3+ letters), or when a small typo apart
function close(a, b) {
  if (a === b) return true;
  if (Math.min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a))) return true;
  const allowed = Math.max(a.length, b.length) >= 7 ? 2 : Math.max(a.length, b.length) >= 4 ? 1 : 0;
  return allowed > 0 && lev(a, b) <= allowed;
}

// candidate = text the model (or a person) gave for the room type. Returns the exact name from the list, or null.
export function matchRoomType(candidate, names) {
  const nc = norm(candidate);
  if (!nc) return null;
  const exact = names.find((n) => norm(n) === nc);
  if (exact) return exact;
  const ct = nc.split(' ').filter((t) => t && !STOP.has(t));
  if (!ct.length) return null;
  const hits = names.filter((n) => { const nt = norm(n).split(' '); return ct.every((c) => nt.some((t) => close(c, t))); });
  return hits.length === 1 ? hits[0] : null;
}

// For the rules parser: finds a room type whose words all appear (with small typos) somewhere in a message.
export function findRoomTypeInText(text, names) {
  const tt = norm(text).split(' ').filter(Boolean);
  const hits = names.filter((n) => { const nt = norm(n).split(' ').filter((t) => t && !STOP.has(t)); return nt.length > 0 && nt.every((t) => tt.some((x) => close(x, t))); });
  return hits.length === 1 ? hits[0] : null;
}
