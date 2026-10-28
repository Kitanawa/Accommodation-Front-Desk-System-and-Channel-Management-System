import { useEffect, useRef, useState } from 'react'
import './assistant.css'
import { loadChat, saveChat, clearChat } from './chatStorage'

const MAX_INPUT = 500
const REQUEST_TIMEOUT_MS = 35000
const newId = () => crypto.randomUUID()
const UNAVAILABLE = 'The assistant service did not answer. Check that it is running (see apps/ai-service/README.md) and try again.'
const NOTE = { openai: 'Understood by the AI model', local: 'Understood by the local AI model', rules: 'Understood by built-in rules', 'rules (model unavailable)': 'Model unavailable, used built-in rules' }

// The popup chat. It sends the staff message (and the names of the bookable room types) to the AI service
// and shows the reply. The service is read-only: it never books, changes or cancels anything.
// Room data is not connected yet, so for now replies only say what the assistant understood.
export default function AssistantPopup({ user, roomTypes = [] }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState(() => loadChat(localStorage, user.id))
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const endRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => { saveChat(localStorage, user.id, messages) }, [messages, user.id])
  useEffect(() => { if (open) { endRef.current?.scrollIntoView?.({ block: 'end' }); inputRef.current?.focus() } }, [open, messages, busy])

  async function send(event) {
    event.preventDefault()
    const question = text.trim()
    if (!question || busy) return
    setMessages(list => [...list, { id: newId(), role: 'user', text: question }])
    setText('')
    setBusy(true)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    let answer = { id: newId(), role: 'assistant', text: UNAVAILABLE }
    try {
      const response = await fetch('/api/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: question, roomTypes }), signal: controller.signal })
      const data = await response.json().catch(() => null)
      if (response.ok && typeof data?.reply === 'string') answer = { id: newId(), role: 'assistant', text: data.reply, meta: NOTE[data.source] || (typeof data.source === 'string' ? `Understood by ${data.source}` : undefined) }
      else if (response.status === 400 && typeof data?.error === 'string') answer = { id: newId(), role: 'assistant', text: data.error }
    } catch {
      /* The service is not running or did not answer in time: the default message above is shown. */
    } finally {
      clearTimeout(timer)
      setMessages(list => [...list, answer])
      setBusy(false)
    }
  }

  function clear() {
    clearChat(localStorage)
    setMessages([])
  }

  if (!open) {
    return <div className="ai-popup"><button className="ai-launcher" aria-expanded="false" aria-label="Open the front desk assistant" onClick={() => setOpen(true)}><span aria-hidden="true">✦</span>Assistant</button></div>
  }

  return <div className="ai-popup">
    <section className="ai-window" role="dialog" aria-label="Front desk assistant" onKeyDown={e => { if (e.key === 'Escape') setOpen(false) }}>
      <header className="ai-header">
        <div><strong>Front desk assistant</strong><small>Preview · room data not connected yet</small></div>
        <div className="ai-header-actions">
          <button type="button" className="ai-text-button" onClick={clear} disabled={!messages.length}>Clear</button>
          <button type="button" className="ai-close" aria-label="Close the assistant" onClick={() => setOpen(false)}>×</button>
        </div>
      </header>
      <div className="ai-messages" role="log" aria-live="polite" aria-label="Conversation">
        {!messages.length && <p className="ai-empty">Ask about room availability and rates for a stay. For example: “single room 25 to 30 Nov”. You can write in English, Malay or Mandarin.</p>}
        {messages.map(m => <div key={m.id} className={`ai-message ${m.role}`}>{m.text}{m.meta && <small className="ai-meta">{m.meta}</small>}</div>)}
        {busy && <div className="ai-message assistant ai-pending">Thinking…</div>}
        <div ref={endRef} />
      </div>
      <form className="ai-form" onSubmit={send}>
        <label className="sr-only" htmlFor="ai-input">Message to the assistant</label>
        <input id="ai-input" ref={inputRef} value={text} maxLength={MAX_INPUT} autoComplete="off" placeholder="Type a question…" onChange={e => setText(e.target.value)} />
        <button className="primary" disabled={!text.trim() || busy}>Send</button>
      </form>
    </section>
  </div>
}
