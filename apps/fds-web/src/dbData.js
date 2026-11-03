// Database-first data for the Booking page. No imports on purpose, so it is easy to test.
// The page uses the PostgreSQL calendar only when the API reports a real PostgreSQL server
// (the API's built-in embedded database counts as "not detected") and the user is signed in through the API.
// In every other case the page keeps using the browser data it always used.

// true when GET /api/info says the API is running on a PostgreSQL server (DATABASE_URL). Never throws.
export async function detectDatabase(isDemo) {
  if (isDemo) return false
  try {
    const response = await fetch('/api/info', { credentials: 'same-origin', signal: AbortSignal.timeout(5000) })
    if (!response.ok) return false
    const body = await response.json()
    return typeof body?.database === 'string' && body.database.startsWith('PostgreSQL server')
  } catch { return false }
}

// apiFn is the page's api() helper (it sends the sign-in cookie). Rejects when the API or the session is not available.
export const loadCalendar = (apiFn, from, days = 62) => apiFn(`/api/calendar?from=${from}&days=${days}`)

// Turn the calendar answer into the room objects the Booking page already knows how to draw.
// A night with no approved rate is treated as not sellable (0 left), so it can never be selected.
export function roomsFromCalendar(cal) {
  if (!cal || !Array.isArray(cal.room_types)) return []
  return cal.room_types.map(type => {
    const cells = {}, rules = []
    let base = 0
    type.cells.forEach((cell, i) => {
      const priced = cell.rate !== null && cell.rate !== undefined
      cells[cell.date] = { left: priced ? cell.left : 0, rate: cell.rate }
      if (priced) {
        if (!base) base = cell.rate
        rules.push({ type: 'Specific Date', dates: [cell.date], rate: cell.rate, prior: i + 1, remark: 'Database rate' })
      }
    })
    return {
      id: type.room_type_id, name: type.name, rate: base, guests: type.max_guests, note: type.description || '',
      stock: Math.max(1, ...type.cells.map(c => c.total)), publication: 'Published', cells,
      pricing: { baseRate: base, remark: '', rules },
    }
  })
}
