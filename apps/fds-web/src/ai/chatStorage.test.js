import assert from 'node:assert/strict'
import test from 'node:test'
import { CHAT_KEY, MAX_MESSAGES, clearChat, loadChat, saveChat } from './chatStorage.js'

const fakeStorage = (initial = {}) => {
  const data = { ...initial }
  return { getItem: k => data[k] ?? null, setItem: (k, v) => { data[k] = String(v) }, removeItem: k => { delete data[k] }, data }
}
const msg = (n, role = 'user') => ({ id: `m${n}`, role, text: `text ${n}` })

test('saved messages load back for the same user', () => {
  const storage = fakeStorage()
  assert.equal(saveChat(storage, 'u1', [msg(1), msg(2, 'assistant')]), true)
  assert.deepEqual(loadChat(storage, 'u1'), [msg(1), msg(2, 'assistant')])
})

test('an optional note on a message is kept and trimmed', () => {
  const storage = fakeStorage()
  saveChat(storage, 'u1', [{ ...msg(1, 'assistant'), meta: 'Understood by the AI model' }, { ...msg(2, 'assistant'), meta: 5 }])
  assert.deepEqual(loadChat(storage, 'u1'), [{ ...msg(1, 'assistant'), meta: 'Understood by the AI model' }, msg(2, 'assistant')])
})

test('a different user never sees the log', () => {
  const storage = fakeStorage()
  saveChat(storage, 'u1', [msg(1)])
  assert.deepEqual(loadChat(storage, 'u2'), [])
})

test('clearChat removes the log', () => {
  const storage = fakeStorage()
  saveChat(storage, 'u1', [msg(1)])
  clearChat(storage)
  assert.equal(storage.getItem(CHAT_KEY), null)
  assert.deepEqual(loadChat(storage, 'u1'), [])
})

test('corrupt or malformed storage gives an empty log', () => {
  assert.deepEqual(loadChat(fakeStorage({ [CHAT_KEY]: '{not json' }), 'u1'), [])
  assert.deepEqual(loadChat(fakeStorage({ [CHAT_KEY]: JSON.stringify({ userId: 'u1', messages: 'oops' }) }), 'u1'), [])
  const mixed = JSON.stringify({ userId: 'u1', messages: [msg(1), { id: 2, role: 'user', text: 'bad id' }, { id: 'x', role: 'system', text: 'bad role' }, null] })
  assert.deepEqual(loadChat(fakeStorage({ [CHAT_KEY]: mixed }), 'u1'), [msg(1)])
})

test('only the newest messages are kept', () => {
  const storage = fakeStorage()
  saveChat(storage, 'u1', Array.from({ length: MAX_MESSAGES + 5 }, (_, i) => msg(i)))
  const loaded = loadChat(storage, 'u1')
  assert.equal(loaded.length, MAX_MESSAGES)
  assert.equal(loaded.at(-1).id, `m${MAX_MESSAGES + 4}`)
})

test('storage failures do not throw', () => {
  const broken = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('full') }, removeItem() { throw new Error('blocked') } }
  assert.equal(saveChat(broken, 'u1', [msg(1)]), false)
  assert.deepEqual(loadChat(broken, 'u1'), [])
  assert.doesNotThrow(() => clearChat(broken))
})
