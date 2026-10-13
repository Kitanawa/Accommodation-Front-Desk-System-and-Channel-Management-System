// The "understanding" step: message in -> structured request out. It never writes replies or touches the database.
// LLM_PROVIDER = rules (default) | gemini | openai | anthropic | local
// Normal mode: if the model fails, chat.js falls back to the rules parser.
// Strict mode (LLM_STRICT=1, or the compare runner): a failure is returned as intent "unknown", so failures are
// MEASURED instead of being hidden by the rules fallback.
import { buildPrompt, parseModelJson, emptyRequest } from './prompt.js';
import { callGemini, callOpenAI, callAnthropic, callLocal, temperatureDropped } from './providers.js';

const CALLERS = { gemini: callGemini, openai: callOpenAI, anthropic: callAnthropic, local: callLocal };
const ENV_MODEL = { gemini: 'GEMINI_MODEL', openai: 'OPENAI_MODEL', anthropic: 'ANTHROPIC_MODEL', local: 'LOCAL_MODEL' };
let override = null;
let last = null;

export function setContender(c) { override = c; }          // { provider, model, strict }
export const getLastCall = () => last;                      // timing/tokens/error of the most recent call
const active = () => override ?? { provider: (process.env.LLM_PROVIDER || 'rules').toLowerCase(), model: null, strict: process.env.LLM_STRICT === '1' };

export async function understandWithLlm(message, roomTypeNames, todayIso) {
  const a = active();
  last = null;
  if (a.provider === 'rules') return null;
  const call = CALLERS[a.provider];
  if (!call) throw new Error(`Unknown LLM_PROVIDER "${a.provider}". Use rules, gemini, openai, anthropic or local.`);
  const model = a.model || process.env[ENV_MODEL[a.provider]] || null;
  const info = { provider: a.provider, model, ms: 0, inTok: 0, outTok: 0, retries: 0, error: null, temperatureDropped: false };
  const t0 = performance.now();
  let req = null;
  try {
    const out = await call(buildPrompt(message, roomTypeNames, todayIso), { model: a.model });
    info.inTok = out.inTok; info.outTok = out.outTok; info.retries = out.retries;
    req = parseModelJson(out.text, roomTypeNames);
    if (!req) info.error = 'unusable_output';
  } catch (e) { info.error = e.message.slice(0, 300); }
  info.ms = Math.round(performance.now() - t0);
  info.temperatureDropped = model ? temperatureDropped(model) : false;
  last = info;
  if (req) return { ...req, source: a.provider };
  if (a.strict) return { ...emptyRequest(), source: `${a.provider}_failed` };
  return null;
}
