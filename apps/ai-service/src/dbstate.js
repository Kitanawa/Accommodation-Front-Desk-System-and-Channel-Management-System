// Whether the database may be used right now. It is on only while the guard (src/guard.js) says the database user cannot write.
// Checked at startup and every minute; a failure switches data answers off (fail closed) until the check passes again.
import { configured, makeQ, getPool } from './db.js';
import { checkReadOnlyRole } from './guard.js';

const state = { status: configured() ? 'checking' : 'off', user: null, problems: [] };
export const dbReady = () => state.status === 'read-only verified';
export const dbStatus = () => ({ status: state.status, user: state.user, problems: state.problems });

export async function refreshGuard() {
  if (!configured()) { state.status = 'off'; return state; }
  try {
    const r = await checkReadOnlyRole(makeQ(getPool()));
    state.user = r.user; state.problems = r.problems;
    state.status = r.ok ? 'read-only verified' : 'blocked: user can write';
    if (!r.ok) console.error(`DATABASE BLOCKED. The assistant will not read data because its database user is not read-only:\n  - ${r.problems.join('\n  - ')}\nSee db/create_readonly_role.sql.`);
  } catch (e) {
    state.status = 'unavailable'; state.problems = [e.message.slice(0, 200)];
    console.warn('database not reachable:', e.message);
  }
  return state;
}
export function startGuardLoop(ms = 60000) { const t = setInterval(refreshGuard, ms); t.unref(); return t; }
