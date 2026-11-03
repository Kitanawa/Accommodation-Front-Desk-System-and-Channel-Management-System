// Nightly price for a stay. MIRRORS the rules in apps/api/service.js (SRS FR-15 to FR-17, S064 to S068), so the assistant quotes
// the same price the booking system would: only APPROVED rules count; higher priority wins; on a tie Specific Date > Date Range >
// Selected Day > Base; Date Range includes both end dates; a rule applies from effective_from and stops at valid_until.
// test/db.test.js compares this against the team's own availability() on the seed data, so a change to the team's rules shows up as a failing test.
import { addDays } from './dates.js';

const SPEC = { SPECIFIC_DATE: 4, DATE_RANGE: 3, SELECTED_DAY: 2, BASE: 1 };
export const nightsList = (from, to) => { const o = []; for (let d = from; d < to; d = addDays(d, 1)) o.push(d); return o; };

function matches(r, d) {
  const dow = new Date(`${d}T00:00:00Z`).getUTCDay();   // 0 = Sunday
  return r.rule_type === 'BASE'
    || (r.rule_type === 'SPECIFIC_DATE' && r.specific_date === d)
    || (r.rule_type === 'DATE_RANGE' && d >= r.date_from && d <= r.date_to)
    || (r.rule_type === 'SELECTED_DAY' && (r.selected_days || []).includes(dow));
}
const inForce = (r, d) => r.approval_status === 'APPROVED' && (!r.effective_from || d >= r.effective_from) && (!r.valid_until || d < r.valid_until);
const order = (a, b) => ((b.priority ?? 0) - (a.priority ?? 0)) || (SPEC[b.rule_type] - SPEC[a.rule_type]);

export function pickRule(rules, d) {
  const m = rules.filter((r) => inForce(r, d) && matches(r, d)).sort(order);
  return m[0] || null;
}

export function priceStay(rules, from, to) {
  const nights = nightsList(from, to).map((d) => { const r = pickRule(rules, d); return { date: d, rate: r ? r.rate_amount : null }; });
  if (nights.some((n) => n.rate === null)) return { nights, total: null };
  return { nights, total: Math.round(nights.reduce((s, n) => s + n.rate, 0) * 100) / 100 };
}
