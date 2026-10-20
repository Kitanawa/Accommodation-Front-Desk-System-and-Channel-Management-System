// Single source for the API contract (S055). docs/build.js turns this into API_CONTRACT.md and openapi.yaml.
// status: 'implemented' = runs today. A status such as 'S060' would mean: defined now, built in that subtask.
const P = require('../permissions');

// ---- shorthand types: uuid, date, time, datetime, int, number, string, bool, enum:A|B, ref:Name, T[], T? (nullable)
const E = {
  role: 'enum:ADMINISTRATOR|OWNER_MANAGER|FRONT_DESK',
  resStatus: 'enum:CONFIRMED|CHECKED_IN|CHECKED_OUT|CANCELLED', payStatus: 'enum:UNPAID|PARTIAL|PAID',
  roomStatus: 'enum:AVAILABLE|OCCUPIED|CLEANING|MAINTENANCE_BLOCKED', rule: 'enum:BASE|DATE_RANGE|SELECTED_DAY|SPECIFIC_DATE',
  method: 'enum:CASH|CARD|ONLINE|BANK_TRANSFER', approval: 'enum:PENDING|APPROVED',
};
const schemas = {
  Ok: { ok: 'bool' },
  User: { user_id: 'uuid', name: 'string', email: 'string', role: E.role, can_approve_rates: 'bool', property_id: 'uuid' },
  LoginResponse: { token: 'string', expires_at: 'datetime', user: 'ref:User' },
  Source: { source_id: 'int', code: 'string', name: 'string' },
  RoomType: { room_type_id: 'uuid', name: 'string', category: 'string', max_guests: 'int', min_nights: 'int', description: 'string?', facilities: 'string[]?', layout_info: 'string?' },
  ReservationRow: { reservation_id: 'uuid', reservation_ref: 'string', full_name: 'string', room_type: 'string', room_number: 'string?', check_in: 'date', check_out: 'date', total_guests: 'int', status: E.resStatus, payment_status: E.payStatus, source: 'string', total: 'number' },
  DashboardRow: { reservation_id: 'uuid', reservation_ref: 'string', full_name: 'string', room_type: 'string', room_number: 'string?', check_in: 'date', check_out: 'date', status: E.resStatus, payment_status: E.payStatus },
  Dashboard: { today: 'date', arrivals: 'ref:DashboardRow[]', departures: 'ref:DashboardRow[]', in_house: 'int', occupied: 'int', total_rooms: 'int', pending_rates: 'int?' },
  NightRate: { date: 'date', rate: 'number?', rule: 'string?' },
  AvailabilityItem: { room_type_id: 'uuid', name: 'string', category: 'string', max_guests: 'int', min_nights: 'int', nights: 'int', rooms_left: 'int', total: 'number?', nightly: 'ref:NightRate[]', bookable: 'bool', reasons: 'string[]' },
  ReservationCreated: { reservation_id: 'uuid', reservation_ref: 'string' },
  Charge: { charge_id: 'uuid', charge_type: 'enum:ROOM|ADDITIONAL', description: 'string', quantity: 'number', unit_price: 'number', amount: 'number', charged_at: 'datetime' },
  Payment: { payment_id: 'uuid', amount: 'number', method: E.method, status: 'enum:PENDING|COMPLETED|FAILED', paid_at: 'datetime' },
  ReservationDetail: { reservation_id: 'uuid', reservation_ref: 'string', check_in: 'date', check_out: 'date', estimated_arrival: 'time?', total_guests: 'int', status: E.resStatus, payment_status: E.payStatus,
    special_requests: 'string?', notes: 'string?', created_at: 'datetime', guest_id: 'uuid', full_name: 'string', phone: 'string?', email: 'string?', nationality: 'string?', id_passport_no: 'string?', address: 'string?',
    source: 'string', reservation_room_id: 'uuid', room_type_id: 'uuid', room_id: 'uuid?', rate_total: 'number', room_type: 'string', room_number: 'string?', folio_id: 'uuid', closed_at: 'datetime?',
    charges: 'ref:Charge[]', payments: 'ref:Payment[]', total_charges: 'number', total_paid: 'number', balance: 'number' },
  FreeRoom: { room_id: 'uuid', room_number: 'string', status: E.roomStatus },
  Room: { room_id: 'uuid', room_number: 'string', room_type: 'string', status: E.roomStatus, in_house_ref: 'string?' },
  Rate: { rate_rule_id: 'uuid', room_type: 'string', rule_type: E.rule, rate_amount: 'number', date_from: 'date?', date_to: 'date?', selected_days: 'int[]?', specific_date: 'date?', priority: 'int?', approval_status: E.approval },
  RateCreated: { rate_rule_id: 'uuid', approval_status: E.approval },
  AuditRecord: { audit_id: 'int', created_at: 'datetime', full_name: 'string', action: 'string', entity_type: 'string', new_values: 'object?' },
  StaffUser: { user_id: 'uuid', full_name: 'string', email: 'string', role: E.role, can_approve_rates: 'bool', is_active: 'bool', last_login_at: 'datetime?', created_at: 'datetime' },
  Session: { session_id: 'uuid', created_at: 'datetime', last_seen_at: 'datetime', expires_at: 'datetime', user_agent: 'string?', current: 'bool' },
  Revoked: { revoked: 'int' },
  PasswordPolicy: { min_length: 'int', max_length: 'int', rules: 'string[]' },
  Role: { name: E.role },
};

// body field: [type, required?, note]
const f = (type, req, note) => ({ type, req: !!req, note: note || '' });
const guest = { full_name: f('string', 1, 'Required unless guest_id is sent.'), phone: f('string'), email: f('string'), nationality: f('string'), id_passport_no: f('string'), address: f('string') };

const endpoints = [
  // ---- sign in
  { m: 'POST', p: '/api/login', tag: 'Sign in', who: 'public', status: 'implemented', sum: 'Sign in with email and password. Returns a session token.', body: { email: f('string', 1), password: f('string', 1) }, ok: [200, 'LoginResponse'], err: ['VALIDATION_ERROR', 'INVALID_CREDENTIALS', 'ACCOUNT_DISABLED', 'ACCOUNT_LOCKED'] },
  { m: 'POST', p: '/api/logout', tag: 'Sign in', who: 'any', status: 'implemented', sum: 'End the current session.', ok: [200, 'Ok'], err: ['UNAUTHENTICATED', 'SESSION_REVOKED', 'SESSION_EXPIRED'] },
  { m: 'GET', p: '/api/me', tag: 'Sign in', who: 'any', status: 'implemented', sum: 'The signed-in user.', ok: [200, 'User'], err: ['UNAUTHENTICATED', 'SESSION_REVOKED', 'SESSION_EXPIRED'] },
  { m: 'GET', p: '/api/info', tag: 'Sign in', who: 'public', status: 'implemented', sum: 'Which database the server is using.', ok: [200, null] },
  { m: 'GET', p: '/api/sessions', tag: 'Sessions', who: 'any', status: 'implemented', sum: 'My active sessions (the current one is marked).', ok: [200, 'Session[]'] },
  { m: 'DELETE', p: '/api/sessions/{id}', tag: 'Sessions', who: 'any', status: 'implemented', sum: 'End one of my sessions.', ok: [200, 'Ok'], err: ['NOT_FOUND'] },
  { m: 'POST', p: '/api/sessions/revoke-others', tag: 'Sessions', who: 'any', status: 'implemented', sum: 'End all my sessions except this one.', ok: [200, 'Revoked'] },
  // ---- reference
  { m: 'GET', p: '/api/sources', tag: 'Reference data', who: 'any', status: 'implemented', sum: 'Booking sources (Walk-in, Phone, Email, Website, Travel agent, OTA).', ok: [200, 'Source[]'] },
  { m: 'GET', p: '/api/room-types', tag: 'Reference data', perm: 'catalog.view', status: 'implemented', sum: 'Room types of my property.', ok: [200, 'RoomType[]'] },
  { m: 'GET', p: '/api/dashboard', tag: 'Reference data', perm: 'reports.operational', status: 'implemented', sum: "Today's arrivals and departures, in-house count, room occupancy and pending rates (pending_rates is null for Front Desk).", ok: [200, 'Dashboard'] },
  // ---- availability and reservations
  { m: 'GET', p: '/api/availability', tag: 'Reservations', perm: 'reservations.manage', status: 'implemented', sum: 'Rooms left, nightly rates and total for a stay, per room type.',
    query: { from: f('date', 1, 'Check-in, not in the past.'), to: f('date', 1, 'Check-out, after from.'), guests: f('int', 0, 'Default 1.') }, ok: [200, 'AvailabilityItem[]'], err: ['VALIDATION_ERROR'] },
  { m: 'POST', p: '/api/reservations', tag: 'Reservations', perm: 'reservations.manage', status: 'implemented', sum: 'Create a reservation (also creates its folio and one ROOM charge per night).',
    body: { guest: f('object', 0, 'New guest: ' + Object.keys(guest).join(', ') + '. full_name is required.'), guest_id: f('uuid', 0, 'Use an existing guest instead of guest.'), room_type_id: f('uuid', 1), check_in: f('date', 1), check_out: f('date', 1, 'Exclusive: the night of this date is not booked.'),
      total_guests: f('int', 1), source_id: f('int', 0, 'From GET /api/sources. Default 1.'), estimated_arrival: f('time'), special_requests: f('string'), notes: f('string') },
    ok: [201, 'ReservationCreated'], err: ['VALIDATION_ERROR', 'NOT_FOUND', 'SOLD_OUT', 'NO_STOCK', 'NO_APPROVED_RATE'] },
  { m: 'GET', p: '/api/reservations', tag: 'Reservations', perm: 'reservations.manage', status: 'implemented', sum: 'List reservations (newest check-in first, at most 200).',
    query: { status: f('enum:CONFIRMED|CHECKED_IN|CHECKED_OUT|CANCELLED'), q: f('string', 0, 'Matches reference or guest name.') }, ok: [200, 'ReservationRow[]'], err: ['VALIDATION_ERROR'] },
  { m: 'GET', p: '/api/reservations/{id}', tag: 'Reservations', perm: 'reservations.manage', status: 'implemented', sum: 'One reservation with its folio: charges, payments and balance.', ok: [200, 'ReservationDetail'], err: ['NOT_FOUND'] },
  { m: 'PATCH', p: '/api/reservations/{id}', tag: 'Reservations', perm: 'reservations.manage', status: 'implemented', sum: 'Edit guest contact details, notes, requests or arrival time.',
    body: { full_name: f('string'), phone: f('string'), email: f('string'), special_requests: f('string'), notes: f('string'), estimated_arrival: f('time') }, ok: [200, 'ReservationDetail'], err: ['NOT_FOUND', 'INVALID_STATE'] },
  { m: 'POST', p: '/api/reservations/{id}/cancel', tag: 'Reservations', perm: 'reservations.manage', status: 'implemented', sum: 'Cancel a CONFIRMED reservation and release its stock.', ok: [200, 'ReservationDetail'], err: ['NOT_FOUND', 'INVALID_STATE'] },
  { m: 'GET', p: '/api/reservations/{id}/free-rooms', tag: 'Stay', perm: 'stay.operate', status: 'implemented', sum: 'Rooms of the booked type that are free for the stay.', ok: [200, 'FreeRoom[]'], err: ['NOT_FOUND'] },
  { m: 'POST', p: '/api/reservations/{id}/assign-room', tag: 'Stay', perm: 'stay.operate', status: 'implemented', sum: 'Assign a physical room.', body: { room_id: f('uuid', 1) }, ok: [200, 'ReservationDetail'], err: ['VALIDATION_ERROR', 'NOT_FOUND', 'INVALID_STATE', 'ROOM_NOT_AVAILABLE'] },
  { m: 'POST', p: '/api/reservations/{id}/check-in', tag: 'Stay', perm: 'stay.operate', status: 'implemented', sum: 'Check in. Uses the assigned room or picks a free Available one. The room becomes OCCUPIED.', ok: [200, 'ReservationDetail'], err: ['NOT_FOUND', 'INVALID_STATE', 'ROOM_NOT_AVAILABLE'] },
  { m: 'POST', p: '/api/reservations/{id}/check-out', tag: 'Stay', perm: 'stay.operate', status: 'implemented', sum: 'Check out. Needs a zero balance. The room becomes CLEANING and the folio closes.', ok: [200, 'ReservationDetail'], err: ['NOT_FOUND', 'INVALID_STATE', 'BALANCE_OUTSTANDING'] },
  // ---- folio
  { m: 'POST', p: '/api/reservations/{id}/charges', tag: 'Folio', perm: 'folio.manage', status: 'implemented', sum: 'Post an additional charge to the folio.',
    body: { description: f('string', 1, 'Up to 200 characters.'), quantity: f('number', 0, 'Greater than 0. Default 1.'), unit_price: f('number', 1, '0 or more.') }, ok: [201, 'ReservationDetail'], err: ['VALIDATION_ERROR', 'NOT_FOUND', 'FOLIO_CLOSED'] },
  { m: 'POST', p: '/api/reservations/{id}/payments', tag: 'Folio', perm: 'folio.manage', status: 'implemented', sum: 'Record a payment. Cannot be more than the balance. Updates payment_status.',
    body: { amount: f('number', 1, 'Greater than 0.'), method: f(E.method, 1) }, ok: [201, 'ReservationDetail'], err: ['VALIDATION_ERROR', 'NOT_FOUND', 'INVALID_STATE'] },
  // ---- rooms
  { m: 'GET', p: '/api/rooms', tag: 'Rooms', perm: 'catalog.view', status: 'implemented', sum: 'All rooms of my property with their status.', ok: [200, 'Room[]'] },
  { m: 'PATCH', p: '/api/rooms/{id}/status', tag: 'Rooms', perm: 'stay.operate', status: 'implemented', sum: 'Change a room status. OCCUPIED is set by check-in only.', body: { status: f('enum:AVAILABLE|CLEANING|MAINTENANCE_BLOCKED', 1) }, ok: [200, 'Ok'], err: ['VALIDATION_ERROR', 'NOT_FOUND', 'INVALID_STATE'] },
  // ---- rates
  { m: 'GET', p: '/api/rates', tag: 'Rates', perm: 'rates.view_approved', status: 'implemented', sum: 'Rate rules. Front Desk sees APPROVED only; Administrator and Manager see all.', ok: [200, 'Rate[]'] },
  { m: 'POST', p: '/api/rates', tag: 'Rates', perm: 'rates.manage', status: 'implemented', sum: 'Create a rate rule. It starts as PENDING and has no effect until approved.',
    body: { room_type_id: f('uuid', 1), rule_type: f(E.rule, 1), rate_amount: f('number', 1, '0 or more.'), date_from: f('date', 0, 'DATE_RANGE only (required there).'), date_to: f('date', 0, 'DATE_RANGE only (required there, on or after date_from).'),
      selected_days: f('int[]', 0, 'SELECTED_DAY only (required there): 0 = Sunday to 6 = Saturday.'), specific_date: f('date', 0, 'SPECIFIC_DATE only (required there).'), priority: f('int', 0, 'Higher wins (FR-17 is still to be confirmed).') },
    ok: [201, 'RateCreated'], err: ['VALIDATION_ERROR', 'NOT_FOUND'] },
  { m: 'POST', p: '/api/rates/{id}/approve', tag: 'Rates', perm: 'rates.approve', status: 'implemented', sum: 'Approve a PENDING rate. Administrator, or a Manager whose can_approve_rates is true.', ok: [200, 'Ok'], err: ['NOT_FOUND', 'INVALID_STATE', 'BASE_RATE_EXISTS'] },
  // ---- audit
  { m: 'GET', p: '/api/audit', tag: 'Audit', perm: 'audit.view', status: 'implemented', sum: 'Latest 100 audit records of my property.', ok: [200, 'AuditRecord[]'] },
  // ---- planned: staff accounts and passwords
  { m: 'GET', p: '/api/password-policy', tag: 'Staff accounts', who: 'public', status: 'implemented', sum: 'The password rules, so a form can show them.', ok: [200, 'PasswordPolicy'] },
  { m: 'POST', p: '/api/me/password', tag: 'Staff accounts', who: 'any', status: 'implemented', sum: 'Change my password. Ends my other sessions.', body: { current_password: f('string', 1), new_password: f('string', 1, 'Must meet the password rules.') }, ok: [200, 'Ok'], err: ['VALIDATION_ERROR'] },
  { m: 'GET', p: '/api/roles', tag: 'Staff accounts', perm: 'users.view', status: 'implemented', sum: 'The three roles.', ok: [200, 'Role[]'] },
  { m: 'GET', p: '/api/users', tag: 'Staff accounts', perm: 'users.view', status: 'implemented', sum: 'Staff accounts of my property.', ok: [200, 'StaffUser[]'] },
  { m: 'POST', p: '/api/users', tag: 'Staff accounts', perm: 'users.manage_frontdesk', status: 'implemented', sum: 'Create a staff account. Administrator: any role. Manager: Front Desk accounts only.',
    body: { full_name: f('string', 1, '2 to 120 characters.'), email: f('string', 1, 'Unique, ignoring upper/lower case.'), role: f(E.role, 1), password: f('string', 1, 'Must meet the password rules.'), can_approve_rates: f('bool', 0, 'Administrator only; Owner/Manager accounts only.') },
    ok: [201, 'StaffUser'], err: ['VALIDATION_ERROR', 'FORBIDDEN', 'CONFLICT'] },
  { m: 'PATCH', p: '/api/users/{id}', tag: 'Staff accounts', perm: 'users.manage_frontdesk', status: 'implemented', sum: 'Edit an account. A Manager may only edit full_name and is_active of Front Desk accounts. Deactivating or changing a role ends that user\'s sessions.',
    body: { full_name: f('string'), role: f(E.role, 0, 'Administrator only.'), can_approve_rates: f('bool', 0, 'Administrator only.'), is_active: f('bool') }, ok: [200, 'StaffUser'], err: ['VALIDATION_ERROR', 'FORBIDDEN', 'NOT_FOUND', 'INVALID_STATE'] },
  { m: 'POST', p: '/api/users/{id}/reset-password', tag: 'Staff accounts', perm: 'users.manage_frontdesk', status: 'implemented', sum: 'Set a new password for an account (also unlocks it) and end its sessions.', body: { new_password: f('string', 1) }, ok: [200, 'Ok'], err: ['VALIDATION_ERROR', 'FORBIDDEN', 'NOT_FOUND'] },
  { m: 'POST', p: '/api/users/{id}/revoke-sessions', tag: 'Staff accounts', perm: 'users.manage_frontdesk', status: 'implemented', sum: 'End every session of an account.', ok: [200, 'Revoked'], err: ['FORBIDDEN', 'NOT_FOUND'] },
];

// who may call: derived from the permission matrix so the contract cannot drift from the code
function rolesOf(e) {
  if (e.who === 'public') return 'Public';
  if (e.who === 'any') return 'Any signed-in user';
  const roles = P.MATRIX[e.perm].map(r => ({ ADMINISTRATOR: 'Administrator', OWNER_MANAGER: 'Manager', FRONT_DESK: 'Front Desk' }[r]));
  const all = roles.length === 3;
  let s = all ? 'All roles' : roles.join(', ');
  if (e.perm === 'rates.approve') s = 'Administrator; Manager only if can_approve_rates';
  if (e.perm === 'users.manage_frontdesk') s = 'Administrator (any role); Manager (Front Desk accounts only)';
  return s;
}
module.exports = { schemas, endpoints, rolesOf, E };
