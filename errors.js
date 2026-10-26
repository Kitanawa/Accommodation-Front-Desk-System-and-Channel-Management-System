// One error shape for the whole API (S055):
// { "error": { "code": "VALIDATION_ERROR", "message": "...", "fields": [{ "field": "email", "message": "..." }], "request_id": "..." } }
class HttpError extends Error {
  constructor(status, code, message, fields) { super(message); this.status = status; this.code = code; this.fields = fields; }
}
const bad = (message, fields) => new HttpError(400, 'VALIDATION_ERROR', message || 'Some fields are not valid.', fields);
const unauthenticated = (message, code = 'UNAUTHENTICATED') => new HttpError(401, code, message || 'Please sign in.');
const forbidden = (message) => new HttpError(403, 'FORBIDDEN', message || 'Your role does not allow this action.');
const notFound = (message) => new HttpError(404, 'NOT_FOUND', message || 'Not found.');
const conflict = (message, code = 'CONFLICT', fields) => new HttpError(409, code, message, fields);

// Collects field-level problems, then throws one VALIDATION_ERROR listing all of them.
class Fields {
  constructor() { this.list = []; }
  add(field, message) { this.list.push({ field, message }); return this; }
  get any() { return this.list.length > 0; }
  check() { if (this.list.length) throw bad('Please correct the fields listed.', this.list); }
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = v => typeof v === 'string' && UUID_RE.test(v);

// The complete catalog of error codes (S055). Each code always comes with the same HTTP status.
const CODES = {
  VALIDATION_ERROR:    [400, 'A field is missing or wrong. "fields" lists each problem.'],
  UNAUTHENTICATED:     [401, 'No valid token was sent. Sign in.'],
  INVALID_CREDENTIALS: [401, 'Wrong email or password. The message never says which one.'],
  SESSION_REVOKED:     [401, 'The session was ended (logout, password change, deactivation or revocation).'],
  SESSION_EXPIRED:     [401, 'The session passed its lifetime or was idle too long.'],
  FORBIDDEN:           [403, 'The signed-in role is not allowed to do this (SRS section 4).'],
  ACCOUNT_DISABLED:    [403, 'The account is deactivated.'],
  NOT_FOUND:           [404, 'No such record in your property (a record of another property looks the same).'],
  CONFLICT:            [409, 'The value already exists.'],
  INVALID_STATE:       [409, 'The record is in a state that does not allow this action (for example cancelling a checked-in stay).'],
  SOLD_OUT:            [409, 'No room of that type is left on at least one night.'],
  NO_STOCK:            [409, 'No stock is configured for every night of the stay.'],
  NO_APPROVED_RATE:    [409, 'At least one night has no approved rate.'],
  HOLD_EXPIRED:        [409, 'The inventory hold ran out of time or was released. Search availability again.'],
  ROOM_NOT_AVAILABLE:  [409, 'The room is blocked, occupied, cleaning, overlapping another stay, or the wrong type.'],
  BALANCE_OUTSTANDING: [409, 'Check-out needs a zero balance.'],
  FOLIO_CLOSED:        [409, 'The folio is closed or the reservation is cancelled.'],
  BASE_RATE_EXISTS:    [409, 'The room type already has an approved Base Rate.'],
  ACCOUNT_LOCKED:      [429, 'Too many wrong passwords. Locked for 15 minutes.'],
  INTERNAL_ERROR:      [500, 'Unexpected server problem. Quote the request_id.'],
};
module.exports = { CODES, HttpError, bad, unauthenticated, forbidden, notFound, conflict, Fields, isUuid, UUID_RE };
