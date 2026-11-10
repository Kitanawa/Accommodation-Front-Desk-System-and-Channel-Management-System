// Guest profiles for the staff web app (Guests page): list, add, change, delete (S-guest). A deleted profile is hidden, never removed: reservations keep their guest details.
const { bad, notFound, Fields, isUuid } = require('./errors');

const COLS = `guest_id, full_name, phone, email, nationality, id_passport_no, address, language, requests, created_at`;
const text = (v, max) => typeof v === 'string' && v.trim().length <= max;

function fields(b, f, partial) {
  const out = {}, has = k => b[k] !== undefined;
  if (!partial || has('full_name')) { if (typeof b.full_name !== 'string' || b.full_name.trim().length < 1 || b.full_name.trim().length > 120) f.add('full_name', 'Name is required (up to 120 characters).'); else out.full_name = b.full_name.trim(); }
  const opt = (k, max, label) => { if (!has(k)) return; if (b[k] === null || b[k] === '') out[k] = null; else if (!text(b[k], max)) f.add(k, `${label}: at most ${max} characters.`); else out[k] = b[k].trim(); };
  opt('phone', 30, 'Phone'); opt('email', 160, 'E-mail'); opt('nationality', 60, 'Nationality'); opt('id_passport_no', 40, 'ID or passport'); opt('address', 500, 'Address'); opt('language', 40, 'Language'); opt('requests', 1000, 'Requests');
  if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) f.add('email', 'Enter a valid e-mail address.');
  return out;
}

module.exports = function mountGuests(app, { getDb, auth, need, wrap }) {
  const q = (...a) => getDb().q(...a), prop = req => req.user.property_id;
  const one = async (req, id) => { const [g] = await q(`select ${COLS} from guests where guest_id=$1 and property_id=$2 and deleted_at is null`, [id, prop(req)]); if (!g) throw notFound('Guest not found.'); return g; };

  app.get('/api/guests', auth, need('reservations.manage'), wrap(async (req, res) => {
    const term = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    const rows = await q(`select ${COLS} from guests where property_id=$1 and deleted_at is null order by full_name limit 500`, [prop(req)]);
    res.json(term ? rows.filter(g => `${g.full_name} ${g.phone || ''} ${g.email || ''}`.toLowerCase().includes(term)) : rows);
  }));
  app.post('/api/guests', auth, need('reservations.manage'), wrap(async (req, res) => {
    const f = new Fields(), v = fields(req.body || {}, f, false); f.check();
    const [g] = await q(`insert into guests(full_name,phone,email,nationality,id_passport_no,address,language,requests,property_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning ${COLS}`,
      [v.full_name, v.phone ?? null, v.email ?? null, v.nationality ?? null, v.id_passport_no ?? null, v.address ?? null, v.language ?? null, v.requests ?? null, prop(req)]);
    res.status(201).json(g);
  }));
  app.patch('/api/guests/:id', auth, need('reservations.manage'), wrap(async (req, res) => {
    if (!isUuid(req.params.id)) throw notFound('Guest not found.');
    const cur = await one(req, req.params.id), f = new Fields(), v = fields(req.body || {}, f, true);
    if (!Object.keys(req.body || {}).length) f.add('body', 'Send at least one field to change.');
    f.check();
    const keys = Object.keys(v);
    await q(`update guests set ${keys.map((k, i) => `${k}=$${i + 2}`).join(', ')} where guest_id=$1`, [cur.guest_id, ...keys.map(k => v[k])]);
    res.json(await one(req, cur.guest_id));
  }));
  app.delete('/api/guests/:id', auth, need('settings.manage'), wrap(async (req, res) => {
    if (!isUuid(req.params.id)) throw notFound('Guest not found.');
    const cur = await one(req, req.params.id);
    await q('update guests set deleted_at=now() where guest_id=$1', [cur.guest_id]);
    res.json({ ok: true });
  }));
};
