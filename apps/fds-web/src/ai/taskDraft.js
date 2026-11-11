// Housekeeping task drafts prepared by the assistant. Pure helpers: nothing here saves anything.
// The Housekeeping page shows the draft in its form; staff review it and press Save Task themselves.
export const TASK_STATUSES = ['Dirty', 'Cleaning', 'Clean', 'Blocked']
export const TASK_PRIORITIES = ['Normal', 'High']
const BLANK = { status: 'Clean', assignee: '', priority: 'Normal', notes: '' }

// current = the saved task for the room (or nothing); task = what the assistant sent. Returns the form draft and an optional note suggestion.
export function applyAssistTask(current, task) {
  const draft = { ...BLANK, ...(current || {}) }
  if (TASK_STATUSES.includes(task?.status)) draft.status = task.status
  if (typeof task?.assignee === 'string' && task.assignee.trim()) draft.assignee = task.assignee.trim().slice(0, 60)
  if (TASK_PRIORITIES.includes(task?.priority)) draft.priority = task.priority
  let suggestion = null
  if (typeof task?.note === 'string' && task.note.trim()) {
    draft.notes = task.note.trim().slice(0, 300)
    delete draft.notesOriginal
    delete draft.notesAi
    const better = typeof task.noteClarified === 'string' ? task.noteClarified.trim().slice(0, 300) : ''
    if (better && better !== draft.notes) suggestion = { original: draft.notes, suggested: better }
  }
  return { draft, suggestion }
}

// Staff chose the assistant's wording: the original stays with the task and the wording is marked as assistant-clarified.
export const acceptSuggestion = (draft, suggestion) => ({ ...draft, notes: suggestion.suggested, notesOriginal: suggestion.original, notesAi: true })

// Staff typed in the note box: the note is theirs again, so any "assistant-clarified" mark is removed.
export function editNotes(draft, text) {
  const { notesOriginal: _original, notesAi: _ai, ...rest } = draft
  return { ...rest, notes: text }
}
