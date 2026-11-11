// The assistant only prepares a housekeeping draft; these helpers never save anything.
import test from 'node:test'
import assert from 'node:assert/strict'
import { applyAssistTask, acceptSuggestion, editNotes } from './taskDraft.js'

test('a task fills the status, cleaner and priority and keeps the rest of the saved task', () => {
  const { draft, suggestion } = applyAssistTask({ status: 'Dirty', assignee: 'Aina', priority: 'Normal', notes: 'old' }, { status: 'Clean', assignee: ' Siti ', priority: 'High' })
  assert.deepEqual(draft, { status: 'Clean', assignee: 'Siti', priority: 'High', notes: 'old' })
  assert.equal(suggestion, null)
})

test('a room with no saved task starts from the blank task', () => {
  const { draft } = applyAssistTask(undefined, { status: 'Dirty' })
  assert.deepEqual(draft, { status: 'Dirty', assignee: '', priority: 'Normal', notes: '' })
})

test('values the page does not offer are ignored', () => {
  const { draft } = applyAssistTask({}, { status: 'Spotless', priority: 'Urgent', assignee: '   ' })
  assert.equal(draft.status, 'Clean'); assert.equal(draft.priority, 'Normal'); assert.equal(draft.assignee, '')
})

test('the staff note goes in exactly as given and the clearer wording is only a suggestion', () => {
  const { draft, suggestion } = applyAssistTask({}, { note: 'AC not cold', noteClarified: 'The air conditioner is not cold.' })
  assert.equal(draft.notes, 'AC not cold')
  assert.deepEqual(suggestion, { original: 'AC not cold', suggested: 'The air conditioner is not cold.' })
  const used = acceptSuggestion(draft, suggestion)
  assert.equal(used.notes, 'The air conditioner is not cold.')
  assert.equal(used.notesOriginal, 'AC not cold')
  assert.equal(used.notesAi, true)
})

test('typing in the note box removes the assistant mark and keeps the typed words', () => {
  const used = acceptSuggestion({ status: 'Dirty', notes: 'x' }, { original: 'a', suggested: 'b' })
  const typed = editNotes(used, 'my own words')
  assert.equal(typed.notes, 'my own words')
  assert.equal('notesOriginal' in typed, false); assert.equal('notesAi' in typed, false)
})

test('a new note replaces an old assistant-clarified mark', () => {
  const { draft } = applyAssistTask({ notes: 'b', notesOriginal: 'a', notesAi: true }, { note: 'fresh' })
  assert.equal(draft.notes, 'fresh'); assert.equal('notesAi' in draft, false)
})

test('an identical clarified wording is not offered', () => {
  assert.equal(applyAssistTask({}, { note: 'same', noteClarified: 'same' }).suggestion, null)
})
