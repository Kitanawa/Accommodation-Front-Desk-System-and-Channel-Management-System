// Who is asking? The browser sends its FDS session cookie to this service; we ask the team's API (GET /api/me) who it belongs to.
// Only the fds_session cookie is forwarded, only GET is used, and the API checks that the session is valid, active and not expired.
// No valid session -> null: the assistant then understands questions but does not read any data.
export function sessionCookie(header) {
  for (const part of String(header || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === 'fds_session' && v.length) return `fds_session=${v.join('=')}`;
  }
  return null;
}

export async function getIdentity(cookieHeader) {
  const cookie = sessionCookie(cookieHeader);
  if (!cookie) return null;
  try {
    const res = await fetch(`${process.env.API_URL || 'http://127.0.0.1:3001'}/api/me`, { method: 'GET', headers: { Cookie: cookie }, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const u = await res.json();
    return typeof u?.user_id === 'string' && typeof u?.property_id === 'string' ? { userId: u.user_id, propertyId: u.property_id, role: u.role, name: u.name } : null;
  } catch {
    return null;
  }
}
