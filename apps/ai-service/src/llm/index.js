// The "understanding" step: message in -> structured request out. It never writes replies and never touches data.
// LLM_PROVIDER = rules (default) | openai | local.
// Normal mode: if the model fails, the caller falls back to the rules parser.
// Strict mode (LLM_STRICT=1): a failure comes back as intent "unknown", so failures are visible instead of hidden.
import { buildPrompt, parseModelJson, emptyRequest } from './prompt.js';
import { callOpenAI, callLocal } from './providers.js';

const CALLERS = { openai: callOpenAI, local: callLocal };
export const provider = () => (process.env.LLM_PROVIDER || 'rules').toLowerCase();
let last = null;
export const getLastCall = () => last;   // timing, tokens and error of the most recent call (for the server log; never sent to the browser)

export async function understandWithLlm(message, roomTypeNames, todayIso, context = null) {
  const p = provider();
  last = null;
  if (p === 'rules') return null;
  const call = CALLERS[p];
  if (!call) throw new Error(`Unknown LLM_PROVIDER "${p}". Use rules, openai or local.`);
  const info = { provider: p, ms: 0, inTok: 0, outTok: 0, retries: 0, error: null };
  const t0 = performance.now();
  let req = null;
  try {
    const out = await call(buildPrompt(message, roomTypeNames, todayIso, context));
    info.inTok = out.inTok; info.outTok = out.outTok; info.retries = out.retries;
    req = parseModelJson(out.text, roomTypeNames);
    if (!req) info.error = 'unusable_output';
  } catch (e) { info.error = e.message.slice(0, 300); }
  info.ms = Math.round(performance.now() - t0);
  last = info;
  if (info.error) console.warn(`LLM understanding failed (${p}): ${info.error}`);
  if (req) return { ...req, source: p };
  if (process.env.LLM_STRICT === '1') return { ...emptyRequest(), source: `${p}_failed` };
  return null;
}
