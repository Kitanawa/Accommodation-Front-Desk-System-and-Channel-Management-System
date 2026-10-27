// Versioned migrations (S054). Files: migrations/NNN_name.up.sql and NNN_name.down.sql, applied in order.
// Applied versions are recorded in the schema_migrations table. Every migration runs in one transaction.
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, 'migrations');

const versions = (dir = DIR) => [...new Set(fs.readdirSync(dir).filter(f => /\.(up|down)\.sql$/.test(f)).map(f => f.replace(/\.(up|down)\.sql$/, '')))].sort();
const sql = (v, kind, dir = DIR) => fs.readFileSync(path.join(dir, `${v}.${kind}.sql`), 'utf8');
async function ensureTable(d) { await d.exec('create table if not exists schema_migrations(version varchar(80) primary key, applied_at timestamptz not null default now())'); }
async function applied(d) { await ensureTable(d); return (await d.q('select version from schema_migrations order by version')).map(r => r.version); }

async function status(d, { dir } = {}) { const done = await applied(d); return versions(dir).map(v => ({ version: v, applied: done.includes(v) })); }

async function up(d, { steps = Infinity, dir } = {}) {
  const done = await applied(d), ran = [];
  for (const v of versions(dir).filter(v => !done.includes(v)).slice(0, steps)) {
    await d.tx(async t => { await t.exec(sql(v, 'up', dir)); await t.q('insert into schema_migrations(version) values($1)', [v]); });
    ran.push(v);
  }
  return ran;
}
async function down(d, { steps = 1, dir } = {}) {
  const done = (await applied(d)).reverse(), ran = [];
  for (const v of done.slice(0, steps)) {
    await d.tx(async t => { await t.exec(sql(v, 'down', dir)); await t.q('delete from schema_migrations where version=$1', [v]); });
    ran.push(v);
  }
  return ran;
}
module.exports = { up, down, status, versions };
