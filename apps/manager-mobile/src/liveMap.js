// Maps the FDS API approval items (/api/approvals) to the request shape the Manager app already shows.
// Pure functions, no React Native imports, so they can be tested with node --test.
const KIND = {ROOM_TYPE: 'Room Type', RATE: 'Room Rate', ADD_ON: 'Room Rate'}   // the app has two kinds; add-ons are shown with the rate requests
const STATUS = {PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected'}
const RULE = {DATE_RANGE: 'Date Range', SELECTED_DAY: 'Selected Day', SPECIFIC_DATE: 'Specific Date'}
const cond = r => r.rule_type === 'DATE_RANGE' ? `${r.date_from} to ${r.date_to}` : r.rule_type === 'SELECTED_DAY' ? [].concat(r.selected_days || []).join(', ') : r.specific_date
const rule = r => ({type: RULE[r.rule_type], condition: cond(r), current: null, proposed: r.rate_amount, prior: r.priority ?? 0, remark: ''})
export function mapApproval(x) {
  const d = x.details || {}, dec = x.decision
  let name, category, current = null, proposed = 0, rules = [], extra = {}
  if (x.kind === 'ROOM_TYPE') {
    const base = (d.rates || []).find(r => r.rule_type === 'BASE')
    name = d.name; category = d.category; proposed = base ? base.rate_amount : 0
    rules = (d.rates || []).filter(r => r.rule_type !== 'BASE').map(rule)
    extra = {guests: d.max_guests, stock: '—', facilities: d.description || 'No description.'}
  } else if (x.kind === 'RATE') {
    name = d.room_type; category = 'Room rate'; current = d.current_rate; proposed = d.rate_amount
    rules = d.rule_type === 'BASE' ? [] : [rule(d)]
  } else {
    name = d.name; category = 'Add-on'
    current = d.is_new ? null : d.unit_price; proposed = d.is_new ? d.unit_price : d.pending_unit_price
  }
  return {
    id: x.kind + ':' + x.id, apiKind: x.kind, apiId: x.id, revision: x.revision,
    kind: KIND[x.kind], name, category, subtitle: x.summary, submittedBy: 'Front desk / management',
    submittedAt: x.submitted_at || (dec && dec.decided_at) || new Date().toISOString(),
    status: STATUS[x.status], reason: x.title + '. ' + x.summary + '.', current, proposed, remark: x.summary, rules,
    reviewedBy: dec ? dec.decided_by : undefined, reviewedAt: dec ? dec.decided_at : undefined, reviewRemark: dec ? (dec.reason || '') : undefined, ...extra
  }
}
