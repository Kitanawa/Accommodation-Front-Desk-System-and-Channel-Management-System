// One function per provider. Each returns { text, inTok, outTok, retries }.
// API keys come ONLY from environment variables (.env). They are never logged.
// UNTESTED against the live APIs unless you have run the smoke test (npm run compare -- --smoke).
import { postJson, HttpError } from './http.js';

const need = (v, name) => { if (!v) throw new Error(`${name} is not set`); return v; };
// Some models reject a temperature setting. We try temperature 0 first and, if the API refuses it, drop it.
const noTemp = new Set();
async function send(model, build, post) {
  try { return await post(build(!noTemp.has(model))); }
  catch (e) {
    if (e instanceof HttpError && e.status === 400 && /temperature/i.test(e.body) && !noTemp.has(model)) {
      noTemp.add(model); return post(build(false));
    }
    throw e;
  }
}
export const temperatureDropped = (model) => noTemp.has(model);

export async function callGemini(prompt, { model } = {}) {
  const m = need(model || process.env.GEMINI_MODEL, 'GEMINI_MODEL');
  const key = need(process.env.GEMINI_API_KEY, 'GEMINI_API_KEY');
  const url = `${process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com'}/v1beta/models/${m}:generateContent`;
  const { data, retries } = await send(m,
    (t) => ({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', ...(t ? { temperature: 0 } : {}) } }),
    (body) => postJson(url, { 'x-goog-api-key': key }, body));
  const u = data.usageMetadata || {};
  const text = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  return { text, inTok: u.promptTokenCount || 0, outTok: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0), retries };
}

async function openAiStyle(prompt, { model, baseUrl, key }) {
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  const headers = key ? { Authorization: `Bearer ${key}` } : {};
  const { data, retries } = await send(model,
    (t) => ({ model, messages: [{ role: 'user', content: prompt }], response_format: { type: 'json_object' }, ...(t ? { temperature: 0 } : {}), ...(process.env.OPENAI_REASONING_EFFORT && baseUrl.includes('openai.com') ? { reasoning_effort: process.env.OPENAI_REASONING_EFFORT } : {}) }),
    (body) => postJson(url, headers, body));
  const u = data.usage || {};
  return { text: data?.choices?.[0]?.message?.content || '', inTok: u.prompt_tokens || 0, outTok: u.completion_tokens || 0, retries };
}

export const callOpenAI = (prompt, { model } = {}) => openAiStyle(prompt, {
  model: need(model || process.env.OPENAI_MODEL, 'OPENAI_MODEL'),
  baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  key: need(process.env.OPENAI_API_KEY, 'OPENAI_API_KEY'),
});

// Any local server that speaks the OpenAI chat format (Ollama, LM Studio, llama.cpp). No key needed.
export const callLocal = (prompt, { model } = {}) => openAiStyle(prompt, {
  model: need(model || process.env.LOCAL_MODEL, 'LOCAL_MODEL'),
  baseUrl: process.env.LOCAL_BASE_URL || 'http://localhost:11434/v1',
  key: process.env.LOCAL_API_KEY || '',
});

export async function callAnthropic(prompt, { model } = {}) {
  const m = need(model || process.env.ANTHROPIC_MODEL, 'ANTHROPIC_MODEL');
  const key = need(process.env.ANTHROPIC_API_KEY, 'ANTHROPIC_API_KEY');
  const { data, retries } = await send(m,
    (t) => ({ model: m, max_tokens: 400, ...(t ? { temperature: 0 } : {}), system: 'Reply with the JSON object only. No explanation, no markdown.', messages: [{ role: 'user', content: prompt }] }),
    (body) => postJson(`${process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'}/v1/messages`, { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body));
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  return { text, inTok: data.usage?.input_tokens || 0, outTok: data.usage?.output_tokens || 0, retries };
}
