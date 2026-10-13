import { useEffect, useRef, useState } from 'react';

const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const EXAMPLES = [
  'Which rooms are free from 5 Nov to 10 Nov?',
  'Who is arriving today?',
  'Who is checking out today?',
  'Which blocked bookings are within 72 hours?',
  'Which bookings are unpaid?',
];

const monthLabel = (m) => new Date(m + '-01T00:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const shiftMonth = (m, n) => {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const deepLink = (h) => {
  const p = new URLSearchParams({ from: h.from, to: h.to });
  if (h.rows.length === 1) p.set('type', h.rows[0].room_type);
  return `${window.location.pathname}?${p.toString()}`;
};

export default function App() {
  const [month, setMonth] = useState('2026-10');
  const [planner, setPlanner] = useState(null);
  const [highlight, setHighlight] = useState(null); // {from, to, rows:[{room_type_id, available}]}
  const [messages, setMessages] = useState([
    { role: 'assistant', text: 'Hi, I am the front desk AI assistant (prototype, fake data). Ask me about room availability, rates, bookings or the 72-hour rule. I cannot create or change bookings or handle money. You can write in English, Malay or Mandarin.\n\nHai, saya pembantu AI kaunter hadapan (prototaip, data palsu). Tanya saya tentang ketersediaan bilik, kadar, tempahan atau peraturan 72 jam. Saya tidak boleh membuat atau mengubah tempahan atau mengendalikan wang. Anda boleh menulis dalam bahasa Inggeris, Melayu atau Mandarin.\n\n您好，我是前台 AI 助手（原型，使用虚构数据）。可以向我查询空房、价格、预订或72小时规则。我无法创建或更改预订，也无法处理款项。您可以用英语、马来语或中文提问。' },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const plannerRef = useRef(null);
  const endRef = useRef(null);

  // Load "today" month once, and apply a deep link like ?type=Single&from=2026-11-25&to=2026-11-30
  useEffect(() => {
    (async () => {
      try {
        const health = await fetch('/api/health').then((r) => r.json());
        const params = new URLSearchParams(window.location.search);
        const from = params.get('from');
        const to = params.get('to');
        if (from && to) {
          const type = params.get('type');
          const av = await fetch(`/api/availability?from=${from}&to=${to}${type ? `&type=${encodeURIComponent(type)}` : ''}`).then((r) => r.json());
          if (av.results) {
            setHighlight({ from, to, rows: av.results.map((x) => ({ room_type_id: x.room_type_id, room_type: x.room_type, available: x.is_available })) });
            setMonth(from.slice(0, 7));
            return;
          }
        }
        setMonth(health.today.slice(0, 7));
      } catch {
        setError('Cannot reach the backend. Is it running on port 3001?');
      }
    })();
  }, []);

  useEffect(() => {
    fetch(`/api/planner?month=${month}`).then((r) => r.json()).then(setPlanner).catch(() => setError('Cannot load the planner.'));
  }, [month]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  function applyAction(action) {
    if (!action) return;
    setHighlight({ from: action.from, to: action.to, rows: action.rows });
    setMonth(action.month);
    plannerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function send(text) {
    const message = (text ?? input).trim();
    if (!message || busy) return;
    setInput('');
    setBusy(true);
    setMessages((m) => [...m, { role: 'user', text: message }]);
    try {
      const res = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      setMessages((m) => [...m, { role: 'assistant', text: data.reply, action: data.action }]);
      applyAction(data.action); // the client wants the dashboard to open with the answer highlighted
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', text: `Sorry, something went wrong: ${e.message}` }]);
    } finally {
      setBusy(false);
    }
  }

  const rowHl = (rowId) => highlight?.rows.find((r) => r.room_type_id === rowId);
  const inRange = (date) => highlight && date >= highlight.from && date < highlight.to;

  return (
    <div className="app">
      <header>
        <h1>Front Desk AI Assistant <span className="tag">prototype · fake data</span></h1>
      </header>

      <main>
        <section className="planner" ref={plannerRef}>
          <div className="planner-head">
            <h2>Room Planner for {monthLabel(month)}</h2>
            <div className="nav">
              <button onClick={() => setMonth(shiftMonth(month, -1))}>‹ Prev</button>
              <button onClick={() => setMonth(shiftMonth(month, 1))}>Next ›</button>
              {highlight && <button className="clear" onClick={() => setHighlight(null)}>Clear highlight</button>}
            </div>
          </div>
          {error && <div className="error">{error}</div>}
          <div className="grid-wrap">
            {planner && (
              <table className="grid">
                <thead>
                  <tr>
                    <th className="type-col">Room Type</th>
                    {planner.days.map((d) => (
                      <th key={d.date} className={[d.weekday === 0 ? 'sun' : '', d.date === planner.today ? 'today' : ''].join(' ')}>
                        <div>{d.day}</div>
                        <div className="dl">{DAY_LETTERS[d.weekday]}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {planner.rows.map((row) => (
                    <tr key={row.room_type_id}>
                      <th className="type-col">{row.room_type}<div className="stock">{row.total} rooms</div></th>
                      {row.cells.map((c, i) => {
                        const h = rowHl(row.room_type_id);
                        const hl = h && inRange(c.date);
                        const cls = [
                          planner.days[i].weekday === 0 ? 'sun' : '',
                          c.date === planner.today ? 'today' : '',
                          c.available <= 0 ? 'full' : '',
                          hl ? (c.available > 0 ? 'hl-ok' : 'hl-no') : '',
                        ].join(' ');
                        return (
                          <td key={c.date} className={cls} title={`${row.room_type} ${c.date}`}>
                            <div className="price">{c.price.toFixed(0)}</div>
                            <div className="b">B:{c.booked}</div>
                            <div className="a">A:{c.available}</div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="legend">
            <span><i className="sw sun" /> Sunday</span>
            <span><i className="sw today" /> Today</span>
            <span><i className="sw full" /> Fully booked</span>
            <span><i className="sw hl-ok" /> Highlighted: available</span>
            <span><i className="sw hl-no" /> Highlighted: not available</span>
            <span className="key"><b className="price">199</b> price (RM) · <b className="b">B</b> booked · <b className="a">A</b> available</span>
          </div>
        </section>

        <aside className="chat">
          <h2>Assistant</h2>
          <div className="msgs">
            {messages.map((m, i) => (
              <div key={i} className={`msg ${m.role}`}>
                <div className="bubble">{m.text}</div>
                {m.action && (
                  <div className="actions">
                    <button onClick={() => applyAction(m.action)}>Show on planner</button>
                    <a href={deepLink(m.action)}>Link to this view</a>
                  </div>
                )}
              </div>
            ))}
            {busy && <div className="msg assistant"><div className="bubble">Checking the database…</div></div>}
            <div ref={endRef} />
          </div>
          <div className="chips">
            {EXAMPLES.map((e) => <button key={e} onClick={() => send(e)} disabled={busy}>{e}</button>)}
          </div>
          <div className="composer">
            <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder='Try: single room 25th to 30th November' maxLength={500} />
            <button onClick={() => send()} disabled={busy || !input.trim()}>Send</button>
          </div>
        </aside>
      </main>
    </div>
  );
}
