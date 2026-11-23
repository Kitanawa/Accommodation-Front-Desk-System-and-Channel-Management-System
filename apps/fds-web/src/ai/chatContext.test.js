// The assistant's chat memory is kept with the chat and wiped with it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { CHAT_KEY, CONTEXT_KEY, saveChat, loadChat, clearChat, saveContext, loadContext } from './chatStorage.js'

const fake = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), has: k => m.has(k) } }
const last = { room_type: 'Deluxe King', from: '2026-11-29', to: '2026-11-30', guests: 2 }

test('what was understood last time is saved and loaded for the same user', () => {
  const s = fake()
  assert.equal(saveContext(s, 'u1', last), true)
  assert.deepEqual(loadContext(s, 'u1'), last)
})

test('a different user never gets it', () => {
  const s = fake()
  saveContext(s, 'u1', last)
  assert.equal(loadContext(s, 'u2'), null)
})

test('clearing the chat also clears the memory', () => {
  const s = fake()
  saveChat(s, 'u1', [{ id: '1', role: 'user', text: 'hi' }])
  saveContext(s, 'u1', last)
  clearChat(s)
  assert.equal(s.has(CHAT_KEY), false)
  assert.equal(s.has(CONTEXT_KEY), false)
  assert.deepEqual(loadChat(s, 'u1'), [])
  assert.equal(loadContext(s, 'u1'), null)
})

test('corrupt or malformed storage gives no memory and never throws', () => {
  const s = fake()
  s.setItem(CONTEXT_KEY, '{not json')
  assert.equal(loadContext(s, 'u1'), null)
  s.setItem(CONTEXT_KEY, JSON.stringify({ userId: 'u1', last: 'text' }))
  assert.equal(loadContext(s, 'u1'), null)
  s.setItem(CONTEXT_KEY, JSON.stringify({ userId: 'u1', last: { room_type: 5, from: 7, to: null, guests: 'x' } }))
  assert.deepEqual(loadContext(s, 'u1'), { room_type: null, from: null, to: null, guests: null })
})

test('storage failures do not throw', () => {
  const broken = { getItem() { throw new Error('x') }, setItem() { throw new Error('x') }, removeItem() { throw new Error('x') } }
  assert.equal(saveContext(broken, 'u1', last), false)
  assert.equal(loadContext(broken, 'u1'), null)
  clearChat(broken)
})
