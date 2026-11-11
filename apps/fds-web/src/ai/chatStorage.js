// Keeps the assistant chat log in this browser only, tagged with the signed-in user's id.
// Demo-stage storage: it moves to the server with the rest of the data once the API is connected.
export const CHAT_KEY = 'miri-ai-chat'
export const MAX_MESSAGES = 100
export const MAX_TEXT = 2000
export const MAX_META = 80
export const CONTEXT_KEY = 'miri-ai-context'

const valid = m => m && typeof m.id === 'string' && ['user', 'assistant'].includes(m.role) && typeof m.text === 'string'
const clean = m => ({ id: m.id, role: m.role, text: m.text.slice(0, MAX_TEXT), ...(typeof m.meta === 'string' && m.meta ? { meta: m.meta.slice(0, MAX_META) } : {}) })

export function loadChat(storage, userId) {
  try {
    const saved = JSON.parse(storage.getItem(CHAT_KEY))
    if (saved?.userId !== userId || !Array.isArray(saved.messages)) return []
    return saved.messages.filter(valid).map(clean).slice(-MAX_MESSAGES)
  } catch {
    return []
  }
}

export function saveChat(storage, userId, messages) {
  try {
    storage.setItem(CHAT_KEY, JSON.stringify({ userId, messages: messages.slice(-MAX_MESSAGES).map(clean) }))
    return true
  } catch {
    return false
  }
}

export function clearChat(storage) {
  try {
    storage.removeItem(CHAT_KEY)
    storage.removeItem(CONTEXT_KEY)
  } catch {
    /* Storage unavailable. */
  }
}

// What the assistant understood last time (room type, dates, guests). Kept with the chat and wiped together with it (clearChat).
export function loadContext(storage, userId) {
  try {
    const saved = JSON.parse(storage.getItem(CONTEXT_KEY))
    if (saved?.userId !== userId || !saved.last || typeof saved.last !== 'object') return null
    const l = saved.last
    return {
      room_type: typeof l.room_type === 'string' ? l.room_type.slice(0, 100) : null,
      from: typeof l.from === 'string' ? l.from.slice(0, 10) : null,
      to: typeof l.to === 'string' ? l.to.slice(0, 10) : null,
      guests: Number.isInteger(l.guests) ? l.guests : null,
    }
  } catch {
    return null
  }
}

export function saveContext(storage, userId, last) {
  try {
    storage.setItem(CONTEXT_KEY, JSON.stringify({ userId, last }))
    return true
  } catch {
    return false
  }
}