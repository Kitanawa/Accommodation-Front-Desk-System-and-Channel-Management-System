// Front desk assistant service. Listens on this computer only (127.0.0.1); the FDS dev server forwards /api/ai to it.
// Read-only: it understands a message and replies. It never books, changes, cancels or touches payments.
try { process.loadEnvFile(); } catch { /* no .env file: defaults apply */ }
import express from 'express';
import { handleChat, cleanNames } from './chat.js';
import { provider } from './llm/index.js';
import { today } from './dates.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '20kb' }));

app.get('/api/ai/health', (_req, res) => res.json({ ok: true, llm: provider(), today: today() }));

app.post('/api/ai/chat', async (req, res) => {
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (!message) return res.status(400).json({ error: 'message is required' });
  if (message.length > 500) return res.status(400).json({ error: 'message too long (max 500 characters)' });
  try {
    res.json(await handleChat(message, { roomTypes: cleanNames(req.body?.roomTypes) }));
  } catch (e) {
    console.error('chat failed:', e.message);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

const port = Number(process.env.AI_PORT || 3002);
app.listen(port, '127.0.0.1', () => console.log(`Front desk assistant service on http://127.0.0.1:${port} (model: ${provider()}, today: ${today()})`));
