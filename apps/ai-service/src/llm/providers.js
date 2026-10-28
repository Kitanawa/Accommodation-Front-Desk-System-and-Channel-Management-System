// One function per provider. Each returns { text, inTok, outTok, retries }.
// API keys come ONLY from environment variables (.env). They are never logged or sent to the browser.
// Only OpenAI has been used live in this project. "local" is for any OpenAI-compatible local server.
// (The earlier prototype also had Gemini and Anthropic adapters; they were never tried live and are left out here.)
import { postJson, HttpError } from './http.js';

const need = (v, name) => { if (!v) throw new Error(`${name} is not set`); return v; };
// Some models reject a temperature setting. Try temperature 0 first and, if the API refuses it, drop it.
const noTemp = new Set();
async function send(model, build, post) {
  try { return await post(build(!noTemp.has(model))); }
  catch (e) {
    if (e instanceof HttpError && e.status === 400 && /temperature/i.test(e.body) && !noTemp.has(model)) { noTemp.add(model); return post(build(false)); }
    throw e;
  }
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

export const callOpenAI = (prompt) => openAiStyle(prompt, {
  model: need(process.env.OPENAI_MODEL, 'OPENAI_MODEL'),
  baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  key: need(process.env.OPENAI_API_KEY, 'OPENAI_API_KEY'),
});

export const callLocal = (prompt) => openAiStyle(prompt, {
  model: need(process.env.LOCAL_MODEL, 'LOCAL_MODEL'),
  baseUrl: process.env.LOCAL_BASE_URL || 'http://localhost:11434/v1',
  key: process.env.LOCAL_API_KEY || '',
});
