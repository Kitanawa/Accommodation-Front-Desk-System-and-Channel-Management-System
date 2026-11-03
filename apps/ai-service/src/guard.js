// Fail-closed check that the database user really cannot write. Asks PostgreSQL itself what this user is allowed to do.
// If it finds ANY write right (or anything that could grant one), the assistant must not use the database.
export async function checkReadOnlyRole(q) {
  const problems = [];
  const [me] = await q('select rolname, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls from pg_roles where rolname = current_user');
  if (!me) return { ok: false, user: null, problems: ['cannot read the current database user'] };
  for (const f of ['rolsuper', 'rolcreatedb', 'rolcreaterole', 'rolreplication', 'rolbypassrls']) if (me[f]) problems.push(`the database user has ${f.replace('rol', '').toUpperCase()}`);

  const groups = await q('select r.rolname from pg_auth_members m join pg_roles r on r.oid = m.roleid join pg_roles u on u.oid = m.member where u.rolname = current_user');
  for (const g of groups) problems.push(`the database user is a member of role "${g.rolname}"`);

  const rels = await q(`
    select c.relname, p.priv from pg_class c join pg_namespace n on n.oid = c.relnamespace
      cross join (values ('INSERT'), ('UPDATE'), ('REFERENCES')) p(priv)
     where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast') and c.relkind in ('r', 'p', 'v', 'm', 'f')
       and has_any_column_privilege(current_user, c.oid, p.priv)
    union all
    select c.relname, p.priv from pg_class c join pg_namespace n on n.oid = c.relnamespace
      cross join (values ('DELETE'), ('TRUNCATE'), ('TRIGGER')) p(priv)
     where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast') and c.relkind in ('r', 'p', 'v', 'm', 'f')
       and has_table_privilege(current_user, c.oid, p.priv)
    union all
    select c.relname, 'SEQUENCE ' || p.priv from pg_class c join pg_namespace n on n.oid = c.relnamespace
      cross join (values ('USAGE'), ('UPDATE')) p(priv)
     where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast') and c.relkind = 'S'
       and has_sequence_privilege(current_user, c.oid, p.priv)`);
  for (const r of rels) problems.push(`the database user can ${r.priv} on "${r.relname}"`);

  const schemas = await q(`select nspname from pg_namespace where nspname not like 'pg\\_%' and nspname <> 'information_schema' and has_schema_privilege(current_user, oid, 'CREATE')`);
  for (const s of schemas) problems.push(`the database user can create objects in schema "${s.nspname}"`);
  const [db] = await q(`select has_database_privilege(current_user, current_database(), 'CREATE') as can_create`);
  if (db.can_create) problems.push('the database user can create schemas in this database');

  const [ro] = await q(`select current_setting('default_transaction_read_only') as v`);
  if (ro.v !== 'on') problems.push('connections are not read-only by default');

  return { ok: problems.length === 0, user: me.rolname, problems };
}
