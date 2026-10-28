// Small fetch helper: timeout, retries on rate limits (429) and server errors (5xx).
// Short limits (12 s, 2 attempts) because a person is waiting in the chat.
export class HttpError extends Error {
  constructor(status, body) { super(`HTTP ${status}: ${String(body).slice(0, 300)}`); this.status = status; this.body = String(body); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function postJson(url, headers, body, { timeoutMs = 12000, maxAttempts = 2 } = {}) {
  let retries = 0;
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      if (attempt >= maxAttempts) throw new Error(`network/timeout: ${e.message}`);
      retries++; await sleep(1000 * 2 ** (attempt - 1)); continue;
    }
    if (res.ok) return { data: await res.json(), retries };
    const text = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < maxAttempts) {
      const ra = Number(res.headers.get('retry-after'));
      retries++; await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 30) * 1000 : 1000 * 2 ** (attempt - 1)); continue;
    }
    throw new HttpError(res.status, text);
  }
}
