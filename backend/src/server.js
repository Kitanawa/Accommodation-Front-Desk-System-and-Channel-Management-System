import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as inv from './inventory.js';
import { handleChat } from './chat.js';
import { today, monthOf, isValidIso } from './dates.js';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ ok: true, today: today(), llm: process.env.LLM_PROVIDER || 'rules' }));

app.get('/api/planner', async (req, res) => {
  try {
    const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : monthOf(today());
    res.json(await inv.planner(month));
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.get('/api/availability', async (req, res) => {
  try {
    const { from, to, type } = req.query;
    if (!isValidIso(from || '') || !isValidIso(to || '') || to <= from) return res.status(400).json({ error: 'from and to must be YYYY-MM-DD with to after from' });
    const types = await inv.getRoomTypes();
    const typeId = type ? types.find((t) => t.name.toLowerCase() === String(type).toLowerCase())?.id : null;
    res.json(await inv.availability(from, to, { roomTypeId: typeId }));
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.post('/api/chat', async (req, res) => {
  const message = String(req.body?.message || '').trim();
  if (!message) return res.status(400).json({ error: 'message is required' });
  if (message.length > 500) return res.status(400).json({ error: 'message too long (max 500 characters)' });
  try {
    res.json(await handleChat(message));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Something went wrong. Please try again.' }); }
});

// Serve the built React app if present (npm run build in /frontend).
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const port = Number(process.env.PORT || 3001);
app.listen(port, () => console.log(`Front desk AI backend on http://localhost:${port} (today=${today()}, llm=${process.env.LLM_PROVIDER || 'rules'})`));
